# PMK-119: list an unsupported tracker.system as a problem in validate

## Problem

PMK-112 made `pmkit validate` list the problems of `.pmkit/config.yaml`. One case still throws. When `tracker.system` is a known tracker other than `local` (for example `linear`) and no other key is wrong, `loadConfig` throws `NOT_SUPPORTED` and `validateRepo` rethrows it, because there is no other `.pmkit/config.yaml` problem to return. With another bad key, `validate` lists that key but says nothing about the tracker.

Acceptance criteria:

1. With `tracker.system: linear` and no other bad key, `validate` lists a problem at `.pmkit/config.yaml` that names the unsupported tracker, instead of failing with `NOT_SUPPORTED`.
2. With `tracker.system: linear` and another bad key, `validate` lists both problems.
3. In both cases the exit code and the output shape are the same as for any other problem `validate` lists.
4. Tests cover both cases, and `npm test` passes.

## Reproduction

Temp project: `git init`, `pmkit init --git-host github`, then edit `.pmkit/config.yaml`. Output of the current code on this branch (`26705e4`).

Baseline, valid file:

```
checked: 0 issues, 0 epics, 0 sprints, 0 milestones, 0 comments
no problems
```
Exit code 0.

Case A, `tracker.system: linear`, every other key valid. `validate` fails:

```
error: tracker.system "linear" is not supported yet
next: Set tracker.system to local in .pmkit/config.yaml
```
Exit code 2. With `--json` the output is `{"error":{"code":"NOT_SUPPORTED","message":"tracker.system \"linear\" is not supported yet","nextStep":"Set tracker.system to local in .pmkit/config.yaml"}}`, also exit 2.

Case B, `tracker.system: linear` and `git_host.system: gitlab`. `validate` lists one problem and omits the tracker:

```
checked: 0 issues, 0 epics, 0 sprints, 0 milestones, 0 comments
.pmkit/config.yaml  config  git_host.system must be github or none
```
Exit code 0. The `--json` output is `{ "checked": {...all 0}, "problems": [ { "path": ".pmkit/config.yaml", "code": "config", "message": "git_host.system must be github or none" } ] }`.

Other command, same file as case A: `pmkit issues list` prints the same `NOT_SUPPORTED` error and exits 2.

Cause. `validatePmkitConfig` accepts every name in `TRACKERS` (the JSON Schema does too, and `schemas.test.mjs` keeps the two equal), so `pmkitConfigProblems` returns nothing for `linear`. Only `loadConfig` rejects it, at `scripts/lib/config.mjs:183`. `brokenConfigProblem` rethrows it because it is neither an `INVALID_INPUT` nor a newer-format error. `validateRepo` then rethrows it when `pmkit` is empty (case A) and returns the `pmkit` problems when it is not (case B).

Existing test: `scripts/validate.test.mjs:273` has `tracker.system linear alone still throws NOT_SUPPORTED`. It pins today's behavior and changes with this issue. Both of its halves change. The first half asserts the throw for `linear` alone. The second half sets `git_host.system: gitlab` and asserts exactly one problem, `git_host.system must be github or none`, which pins the omission of the tracker. New assertions for both halves are in "Assertions per criterion".

This reverses a choice of PMK-112. Its spec (`2026-10-26-pmk-112-validate-pmkit-config-design.md`, "Design", "Decisões" and "Risks and non-goals") kept the throw for `linear` alone, called it a change to the support policy, and listed it as a follow-up candidate. Listing the problem does not change the support policy, because `loadConfig` and every other command still reject the tracker with `NOT_SUPPORTED`. This issue reverses only the `validate` half of that choice.

## Approaches

A. `pmkitConfigProblems` adds a problem for a valid but unsupported tracker. It reads the parsed file, the same source as the other `.pmkit/config.yaml` problems, and does not depend on what `loadConfig` throws. `validateRepo` needs no change: the problem list is now never empty for `linear`, so the existing branch returns it. Case A and case B both list.

B. `brokenConfigProblem` turns this `NOT_SUPPORTED` into a problem. It would have to tell this error from the newer-format `NOT_SUPPORTED` (by `details.format`), re-read `.pmkit/config.yaml` for the path, and match on the message text. It also fires only when `loadConfig` throws, so case B needs a second rule to merge it with the other problems. More code, and it keys off an error message. Rejected.

C. `validateRepo` checks the tracker before it calls `loadConfig`. This duplicates the file read that `pmkitConfigProblems` already does and adds a third place that parses `.pmkit/config.yaml`. Rejected.

D. Make `validatePmkitConfig` report it. That function also guards `init` and is paired with the JSON Schema, which accepts `linear`. It would make `init --update` refuse a file the schema calls valid, and PMK-120 owns what the other commands do with the check. Rejected.

Chosen: A.

## Design

In `scripts/lib/validate.mjs`:

In `scripts/lib/config.mjs`, the shared rule:

- Export `unsupportedTracker(system)` with the signature `(system: string) => { message: string, nextStep: string } | null`. It returns `null` when `system` is `local`. For any other string it returns `{ message: 'tracker.system "<system>" is not supported yet', nextStep: 'Set tracker.system to local in .pmkit/config.yaml' }`. These are the exact strings of today's error at line 183.
- `loadConfig` calls it where it now tests `system !== 'local'`, and throws `new PmkitError('NOT_SUPPORTED', rule.message, rule.nextStep)`. The error code, message and next step stay exactly as today. `config.test.mjs` (`tracker.system jira throws NOT_SUPPORTED`) guards the code, and a new assertion on that test checks the message and next step text.

In `scripts/lib/validate.mjs`:

- Import `TRACKERS` and `unsupportedTracker` from `./config.mjs`.
- Add `unsupportedTrackerMessage(parsed)`. It first checks that `parsed` is a plain map (not `null`, not an array) and that `parsed.tracker` is one too, because an empty `.pmkit/config.yaml` parses to `null` and `tracker: linear` parses to a string, and reading `.tracker.system` on either would throw a TypeError or return nonsense inside `pmkitConfigProblems`, which has no catch. `isObject` in `config.mjs` is not exported, so the helper uses its own check, written the same way as the one in `validateRepo` (`typeof x === 'object' && x !== null && !Array.isArray(x)`).
- When both checks pass and `parsed.tracker.system` is in `TRACKERS`, it calls `unsupportedTracker(system)`. For a non-null result it returns `` `${rule.message}, set it to local` ``. It returns `null` in every other case. A name outside `TRACKERS` is already a `tracker.system must be one of ...` problem, so it gets no second one.
- In `pmkitConfigProblems`, after `validatePmkitConfig(parsed)`, append that message when it is not `null`.
- Update the comment above `brokenConfigProblem`: the rethrown `.pmkit/config.yaml` errors include the unsupported tracker, which `pmkitConfigProblems` now lists.

`validateRepo`, `brokenConfigProblem`, `validatePmkitConfig` and `scripts/pmkit.mjs` do not change. `loadConfig` changes only in how it builds the error. What it throws stays the same.

### The problem record

```js
{
  path: '.pmkit/config.yaml',
  code: 'config',
  message: 'tracker.system "linear" is not supported yet, set it to local',
}
```

- `path` is the root-relative `.pmkit/config.yaml`, as for every other problem of that file.
- `code` is `config`. `commands/local/doctor.md` step 3 already handles `config` problems in `.pmkit/config.yaml` (show the message, the user edits the file). A new code would need a new case there.
- The message names the tracker and reuses the words of the `NOT_SUPPORTED` error. A problem has no next step field, so the message carries it after a comma, as `formatProblem` does with `; run ...`.
- It is added after the `validatePmkitConfig` messages. The final sort is by path then code, and it is stable, so the order inside the file is the order of insertion.

### What validate does after the problem

`validateRepo` returns `{ checked: noneChecked(), problems: [...] }`, the same early return it uses for any `.pmkit/config.yaml` problem that stops `loadConfig`. `checked` is all zeros, and the text starts with `checked: 0 issues, 0 epics, 0 sprints, 0 milestones, 0 comments`. The `.issues/` checks do not run, because a tracker other than `local` has no `.issues/` folder that pmkit reads. The zeros match what `validate` prints today when `.pmkit/config.yaml` blocks `loadConfig`.

### Results

Case A (`linear`, nothing else wrong):

```
checked: 0 issues, 0 epics, 0 sprints, 0 milestones, 0 comments
.pmkit/config.yaml  config  tracker.system "linear" is not supported yet, set it to local
```

Case B (`linear` and `git_host.system: gitlab`):

```
checked: 0 issues, 0 epics, 0 sprints, 0 milestones, 0 comments
.pmkit/config.yaml  config  git_host.system must be github or none
.pmkit/config.yaml  config  tracker.system "linear" is not supported yet, set it to local
```

Exit code 0 in both, as for any problem. `--json` carries the same objects.

### Other commands

Every other command keeps failing with `NOT_SUPPORTED` and exit 2 through `loadConfig`. PMK-120 decides whether `loadConfig` checks `.pmkit/config.yaml` for every command. This issue leaves that behavior alone.

### Effect on `/pmkit:setup`

This issue does not change `commands/setup.md`. Step 2 runs `validate --json`. With `tracker.system: linear`, step 2 today stops on the `NOT_SUPPORTED` error. After this change `validate` returns the new problem, so step 2 shows it and asks the user to fix the file by hand (see `/pmkit:local:doctor`). Setup still stops, now with the reason in view. That direction is safe, because the tracker is unusable until the user sets it to `local`.

One sentence in step 2 is not literally true for this problem. It says a problem in `.pmkit/config.yaml` "makes `init --update` refuse". For `linear`, `init --update` does not refuse, because `validatePmkitConfig` accepts `linear`. Setup stops because the step tells the agent to stop, not because `init` refuses. A rewording of that sentence is a follow-up candidate.

## Assertions per criterion and how each is proven

All tests use `makeRepo('basic')` and `editPmkit` in `scripts/validate.test.mjs`, and `run`/`json` in `scripts/cli.test.mjs`.

1. Case A lists one problem.
   - Unit, `validate.test.mjs`: replace both halves of `tracker.system linear alone still throws NOT_SUPPORTED`. This item is the new first half and item 2 is the new second half. After `editPmkit(root, 'system: local', 'system: linear')`, `validateRepo(root)` does not throw, `brief(result)` equals `['config .pmkit/config.yaml']`, and the message equals `tracker.system "linear" is not supported yet, set it to local`.
   - Unit: the same for `jira`, `github`, `gitlab` and `azure-devops` (loop over `TRACKERS` without `local`).
   - Unit: `checked` equals `{ issues: 0, epics: 0, sprints: 0, milestones: 0, comments: 0 }`.
   - Unit: the problem message starts with the `message` of `unsupportedTracker('linear')`, so a change in the shared rule shows up here.
   - Unit, `config.test.mjs`: `unsupportedTracker('local')` is `null`, and `unsupportedTracker('linear')` equals `{ message: 'tracker.system "linear" is not supported yet', nextStep: 'Set tracker.system to local in .pmkit/config.yaml' }`. The `jira` test also asserts that message and next step on the `loadConfig` error.
   - Unit, no throw on odd shapes. Today's output for these files, recorded in a temp project (`git init`, `pmkit init --git-host github`, then the file rewritten), is the expected result, and the helper must not add a problem to it:
     - Empty `.pmkit/config.yaml`: four problems, in this order, all `config` at `.pmkit/config.yaml`: `version must be 1`, `tracker.system must be one of local, linear, jira, github, gitlab, azure-devops`, `git_host.system must be github or none`, `write_policy.confirm must be one of all_writes, single_writes, none`. Exit code 0.
     - `tracker: linear` written as a string, every other key valid: one problem, `tracker.system must be one of local, linear, jira, github, gitlab, azure-devops`. Exit code 0.
     - Each test asserts that `validateRepo` does not throw and that the messages equal those lists exactly.
2. Case B lists both. This replaces the second half of the old test, which asserted that `linear` plus `gitlab` gives one problem and omits the tracker.
   - Unit: `linear` plus `git_host.system: gitlab` gives two problems, in this order: `git_host.system must be github or none` and `tracker.system "linear" is not supported yet, set it to local`. This is the assertion that the old second half becomes.
   - Unit: `linear` plus `breakPmkit(root)` gives three problems (`git_host.system`, `write_policy.confirm` and the tracker), all at `.pmkit/config.yaml` with code `config`. The messages are exact.
   - Unit: `linear` plus a broken `.issues/config.yaml` lists the tracker problem only, since `.issues/` is not read for an unsupported tracker. This pins the "what is checked" decision.
3. Same exit code and shape.
   - CLI, `cli.test.mjs`: with `linear`, `validate` exits 0, the text has the line `.pmkit/config.yaml  config  tracker.system "linear" is not supported yet, set it to local`, and `--json` has `problems[0]` with exactly the keys `path`, `code`, `message`. Repeat with `linear` plus `git_host.system: gitlab` and assert exit 0 and both lines.
   - The existing test `validate exits 0 and prints a .pmkit/config.yaml problem as path, code and message` stays and shows the shape for an ordinary problem.
4. Tests and `npm test`.
   - The tests above, plus `validateRepo writes nothing` extended with a `linear` repo (`hashTree` before and after).
   - Guard for no double listing. The existing `trello` test (`tracker.system trello and a numeric tracker.path are problems, not throws`, `validate.test.mjs:216`) asserts exactly one problem that starts with `tracker.system must be one of`. It stays as it is and proves that an unknown tracker value gets no second problem. A new unit test adds that `tracker.system: local` with another bad key lists no tracker problem.
   - A guard that other commands are unchanged. In `cli.test.mjs`, with `linear`, `issues list` exits 2 and `--json` gives `error.code` `NOT_SUPPORTED` and `error.message` `tracker.system "linear" is not supported yet`. `config.test.mjs` already covers `loadConfig` for `jira`.
   - Run `npm test` and confirm it passes.

## Goldens and scenarios

No change. Searches for `linear` and `not supported yet` in `scripts/__fixtures__`, `scripts/__goldens__`, `scripts/__scenarios__`, `commands`, `skills`, `docs/adr` and `CONTEXT.md` find nothing that shows this output. No fixture sets a tracker other than `local`. The implementation runs `npm test` and does not set `UPDATE_GOLDENS=1`. If a golden differs, the stage stops and reads the diff line by line before any regeneration.

No change to `CHANGELOG.md` on this branch (the release adds the line, as for PMK-112), to `commands/local/doctor.md`, or to help text.

## Decisões

| Decision | Reason |
| --- | --- |
| Add the problem in `pmkitConfigProblems`, not in `brokenConfigProblem` or before `loadConfig`. | It reads the parsed file like the other `.pmkit/config.yaml` checks. `validateRepo` stays unchanged, and case A and case B go through the existing branch. |
| Reverse PMK-112's choice to keep the throw for `linear` alone. | Listing the problem does not change the support policy. `loadConfig` and every other command still reject the tracker with `NOT_SUPPORTED`. |
| Guard that `parsed` and `parsed.tracker` are plain maps before reading `tracker.system`. | An empty file parses to `null` and `tracker: linear` parses to a string. Tests pin that both give today's problems and no throw. |
| Export `unsupportedTracker(system)` from `config.mjs` and use it in `loadConfig` and `validate`. | One copy of the "only `local` is supported" rule and its words. `loadConfig` keeps its code, message and next step. PMK-120 has nothing to reconcile. |
| Do not change `commands/setup.md`. Describe its effect in "Other commands". | Setup still stops on `linear`, now with the reason. The sentence "makes `init --update` refuse" is not literally true for this problem, and a rewording is a follow-up candidate. |
| Keep the check out of `validatePmkitConfig`. | `init` and the JSON Schema share it, and both accept `linear`. Refusing it there changes `init` and the schema contract, and PMK-120 owns the other commands. |
| Path `.pmkit/config.yaml`, code `config`. | Matches PMK-112 and the `config` case in `doctor.md`. A new code needs a doctor case. |
| Message `tracker.system "linear" is not supported yet, set it to local`. | It names the tracker, reuses the `NOT_SUPPORTED` wording and carries the next step, because a problem has no next step field. |
| Report the problem for every tracker in `TRACKERS` except `local`. | The unsupported set is the known trackers other than `local`, which is the rule `unsupportedTracker` takes from `config.mjs:183`. |
| After the problem, `validate` returns zeros for `checked` and skips `.issues/`. | A tracker other than `local` has no folder pmkit reads, and `.pmkit/config.yaml` problems that stop `loadConfig` already return zeros. |
| Exit code stays 0. | The command summary says problems are output, not errors, and criterion 3 asks for the same code. |
| Other commands keep throwing `NOT_SUPPORTED`, and a CLI test pins it. | PMK-120 owns that change. The test makes sure this issue does not leak into it. |
| Replace the existing `linear alone still throws` test. | It pins the behavior this issue removes. |
| No change to `doctor.md`, `CHANGELOG.md`, goldens or scenarios. | `doctor.md` already covers `config` problems in this file, the release adds the changelog line, and no golden shows this output. |

## Follow-up candidates

- PMK-120: when `loadConfig` checks `.pmkit/config.yaml`, it can reuse `unsupportedTracker`, which `validate` and `loadConfig` already share. It must keep `NOT_SUPPORTED` for the other commands.
- Reword the sentence in `commands/setup.md` step 2 that says a `.pmkit/config.yaml` problem "makes `init --update` refuse". For an unsupported tracker the file is accepted by `init --update`, and setup stops because step 2 says so. A possible wording is "makes `init --update` refuse, or, for an unsupported tracker, cannot be used until fixed".
- `commands/local/doctor.md` and the new message advise "set it to local" only. If `.issues/` does not exist, the next `validate` throws `NOT_CONFIGURED`. Today's `nextStep` has the same gap.
- PMK-118 edits `brokenConfigProblem` for the migration error. It does not touch `pmkitConfigProblems`, so the two do not conflict.
- `validate` prints `checked: 0 issues, ...` when it skips the tracker, which can read as an empty tracker. A later issue could print `not checked` in that case. This applies to every early return, not only this one.
