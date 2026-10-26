# PMK-112: report .pmkit/config.yaml problems in validate and init

## Problem

`validatePmkitConfig` in `scripts/lib/config.mjs` checks `.pmkit/config.yaml`, but only tests call it. `pmkit validate` never reports a problem in that file, and `init` does not run the check on the file it writes. A wrong `git_host.system` or `write_policy.confirm` shows up only when a command fails. The JSON Schema already flags the same problems in an editor (`scripts/schemas.test.mjs` keeps schema and validator equal).

Acceptance criteria:

1. `pmkit validate` reports the problems of `.pmkit/config.yaml` with the file path, next to those of `.issues/config.yaml`.
2. `init` validates `.pmkit/config.yaml` before it writes it, in both modes, and refuses with the file to fix.

## Current behavior

- `validateRepo(root)` in `scripts/lib/validate.mjs` calls `loadConfig`. `loadConfig` reads `.pmkit/config.yaml` but checks only `tracker.system` (a string, and `local`) and `tracker.path` (a string). It throws `NOT_CONFIGURED` when the file is missing, and `INVALID_INPUT` or `NOT_SUPPORTED` for a file it cannot use. `brokenConfigProblem` turns only a broken `.issues/config.yaml` (or a newer format) into a problem. Every other error propagates, so `validate` exits with an error instead of listing a problem. A problem is `{ path, code, message }`; the text output prints `path  code  message`; the exit code is 0 even with problems (the golden `team/validate.txt` shows it).
- `runInit` in `scripts/pmkit.mjs` builds both file contents in memory (first run: the template plus `--git-host`; `--update`: the file as read, plus a `--git-host` line edit), then runs `validateLocalConfig` on the `.issues/config.yaml` content, and only then plans and writes entries. `--dry-run` goes through the same path and skips the write loop. A failing check throws `usageError` (code `INVALID_INPUT`, exit 2) before any write. Nothing checks the `.pmkit/config.yaml` content.
- All five fixtures in `scripts/__fixtures__/` and `templates/pmkit.config.yaml` pass `validatePmkitConfig` today (checked), so no golden or scenario output changes.

## Approaches

For `validate`:

A. Run `validatePmkitConfig` inside `validateRepo`, as one more source of `{ path, code: 'config', message }` problems. One output shape, one exit code, and `doctor` and `setup` read it with no new case.

B. Add a separate `pmkit validate --pmkit-config` mode or a second command. The user has to know to run it, and the bug is that nobody runs the check. Rejected.

C. Make `loadConfig` call `validatePmkitConfig` and throw. Every command would refuse on the first problem, which changes the behavior of every command outside this issue, and `validate` still could not list the problems. Rejected (see Open questions).

For `init`:

A. Validate the final in-memory content of `.pmkit/config.yaml`, next to the existing `validateLocalConfig` check, before any entry is planned or written. In `--update` also validate the file as read, before its `tracker.path` is used.

B. Validate only in `--update`, because on a first run the file comes from our template. Weaker: a template bug or a future flag would still write a bad file, and the criterion says both modes. Rejected.

Pick A for both.

## Design

### `validate`

New function `pmkitConfigProblems(root)` in `scripts/lib/validate.mjs`. It returns problems for `.pmkit/config.yaml` and never throws for the file's content:

1. File missing: returns `[]` (see Decisions; `loadConfig` keeps reporting `NOT_CONFIGURED`).
2. Text has git conflict markers (`hasConflictMarkers`): one problem, code `conflict`, message `the file contains git conflict markers`, as for `.issues/config.yaml`.
3. Text does not parse: one problem, code `config`, message `config.yaml does not parse: <error>`.
4. Parsed value is not a map: `validatePmkitConfig` already returns `config must be a map`.
5. Otherwise: one problem per string from `validatePmkitConfig(parsed)`, code `config`.

The `path` is `.pmkit/config.yaml`, root-relative with `/` separators, from the existing `relative(root, file)`.

`validateRepo` changes:

- Compute `pmkit = pmkitConfigProblems(root)` first.
- `loadConfig` succeeds: add `pmkit` to the problems list. The final sort (path, then code) keeps the output stable; `.issues/...` paths sort before `.pmkit/...`.
- `loadConfig` throws and `brokenConfigProblem` returns a problem: return `pmkit` plus that problem, with nothing else checked, as today.
- `loadConfig` throws and `brokenConfigProblem` rethrows: if `pmkit` is not empty, return `{ checked: noneChecked(), problems: pmkit }`. If it is empty, rethrow as today. This covers an unparseable file, a missing or unknown `tracker.system` (`trello`), and a non-string `tracker.path`, which `loadConfig` rejects before it can find the tracker folder.
- The older-format early return also includes `pmkit`.
- A valid `tracker.system` other than `local` (for example `linear`) keeps throwing `NOT_SUPPORTED`, because the validator accepts it and the local tracker cannot check it. This is today's behavior and stays.

`validate` text and `--json` need no code in `scripts/pmkit.mjs`: the command already prints each problem as `path  code  message`, and the JSON carries the same objects. Example text:

```
checked: 13 issues, 1 epics, 2 sprints, 0 milestones, 0 comments
.pmkit/config.yaml  config  git_host.system must be github or none
.pmkit/config.yaml  config  write_policy.confirm must be one of all_writes, single_writes, none
```

Exit code stays 0, as the command summary says: "problems are output, not errors".

### `init`

Add a helper in `scripts/pmkit.mjs`:

```js
const pmkitProblems = (text) => { /* parseYaml, then validatePmkitConfig; a parse error is one problem */ }
```

It imports `validatePmkitConfig` from `./lib/config.mjs`. Two call sites in `runInit`:

1. `--update`, right after `read(pmkitFile)` parses and before `trackerDir` is used. This reads the file as the user left it. On problems it throws, so a non-map or a non-string `tracker.path` can never reach `path.join`. (The existing `catch` for invalid YAML stays and keeps its message.)
2. The common point where `validateLocalConfig(parsedLocal())` runs today, on the final `pmkit` string after `--git-host` and the schema line are applied. This covers the first-run template and the edited `--update` file.

Refusal:

- Code `INVALID_INPUT`, exit 2, through `usageError`'s shape (`new PmkitError('INVALID_INPUT', message, nextStep)`), as for the `.issues/config.yaml` refusal.
- Message: `the .pmkit/config.yaml is not valid: <problems joined with "; ">`, with `generated ` before the path on a first run. Same wording as the existing local-config message, so a user sees one pattern.
- Next step, `--update`: `Fix .pmkit/config.yaml by hand, then run init --update again`. First run: `Fix the init flags`, as for the local config. A first-run failure is a template defect, so the message reads `the generated .pmkit/config.yaml is not valid: ...`.
- Both files fail together: the `.pmkit/config.yaml` check runs first and throws alone. The user fixes one file and sees the other on the next run. One error stays one file, which is what "the file to fix" asks for.
- Nothing is written: both checks run before `entries` is built and before the write loop. `--dry-run` refuses too, because the checks sit before the dry-run branch.

### Command texts and CHANGELOG

- `commands/setup.md`, "Existing config", step 2: today it says only a problem in `.issues/config.yaml` makes `init --update` refuse. Change it to name both `.issues/config.yaml` and `.pmkit/config.yaml`, keep "other problems do not stop the update", and keep the pointer to `/pmkit:local:doctor`.
- `commands/local/doctor.md`: no change. Step 3 already says a `config` problem sits in `.issues/config.yaml` or `.pmkit/config.yaml` and the user edits it by hand; the new problems use code `config`, so the existing text covers them. A `conflict` problem in `.pmkit/config.yaml` falls under step 2, which says "For each problem with the code `conflict`, one file at a time" and says to remove markers from a file that has them.
- `commands/backlog/groom.md`: no change. It filters problems by a message that names a parent, blocker, sprint or milestone; none of the new messages do.
- `CHANGELOG.md`: no change on this branch, as with PMK-2 and PMK-3. `changelog.test.mjs` ties the newest section to the version in `plugin.json`, and the next version number belongs to the release. The release adds a line such as: "`pmkit validate` reports problems in `.pmkit/config.yaml`, and `init` refuses to write an invalid one". No `Tracker format:` line and no `Setup:` line, because no file changes shape.
- Help text and the command `summary` strings stay as they are, so the `help` scenario output does not change.

### Goldens and scenarios

No change. The fixtures have valid `.pmkit/config.yaml` files, so `validate` and `init` goldens stay byte-equal. The `setup` and `local-doctor` scenarios run on fixtures and read `validate`, so they stay equal. The `commands/setup.md` edit changes the wording of a step, not its number, so the scenario step names (`Existing config 2`) hold. The implementation must run `npm test` to confirm this and not edit a golden to make it pass.

## Tests to add

`scripts/validate.test.mjs` (build with `makeRepo('basic')` or `'team'`, overwrite `.pmkit/config.yaml`):

1. A repo with `git_host.system: gitlab` and `write_policy.confirm: sometimes` returns two `config` problems at `.pmkit/config.yaml`, with the `validatePmkitConfig` messages, and no other problem.
2. A `.issues/config.yaml` problem and a `.pmkit/config.yaml` problem are both in the result, sorted by path.
3. An unparseable `.pmkit/config.yaml` is one `config` problem and does not throw.
4. `.pmkit/config.yaml` with conflict markers is one `conflict` problem.
5. `tracker.system: trello` and a numeric `tracker.path` are each reported as a problem, not thrown. (`loadConfig` fails first in both cases.)
6. A missing `.pmkit/config.yaml` still throws `NOT_CONFIGURED`.
7. `tracker.system: linear` still throws `NOT_SUPPORTED`.
8. `validateRepo` still writes nothing (extend or reuse the `hashTree` test).
9. All fixtures return no `.pmkit/config.yaml` problem.

`scripts/cli.test.mjs` or `scripts/cli-init.test.mjs` (CLI level, existing `run` helper):

10. `validate` exit code is 0 with a `.pmkit/config.yaml` problem; the text has the `path  code  message` line; `--json` has the object with `path: ".pmkit/config.yaml"` and `code: "config"`.

`scripts/cli-init.test.mjs`:

11. `--update` with `git_host.system: gitlab` in the existing file exits 2, `error.message` names `.pmkit/config.yaml` and `git_host.system`, `nextStep` names `.pmkit/config.yaml` and `init --update again`, and `hashTree(dir)` is unchanged.
12. The same with `--dry-run`.
13. `--update` with an unparseable file keeps the `is not valid YAML` message (existing behavior, regression guard).
14. `--update` with a non-map file, and with a non-string `tracker.path`, refuses with the file named and does not throw a `TypeError`.
15. `--update --git-host github` on a file that is otherwise valid still works (the edit path passes the check).
16. First run: a unit-level test that the check runs on the generated content. The CLI cannot make the template invalid, so export the check as `pmkitConfigRefusal(text, { update })` or test through a temp copy of the template folder if `TEMPLATES` can be pointed elsewhere; the plan picks whichever is smaller. If neither is cheap, the first-run path is covered by tests 1 to 15 for the shared helper and by the existing first-run tests staying green.
17. Both files invalid: the error names `.pmkit/config.yaml` only.

`scripts/config.test.mjs`: no change. Messages of `validatePmkitConfig` stay as they are.

Run `npm test`; the goldens and scenarios must pass unchanged.

## Acceptance criteria to design

| Criterion | Design part |
| --- | --- |
| 1. `validate` reports `.pmkit/config.yaml` problems with the path, next to the `.issues/config.yaml` ones | `pmkitConfigProblems` in `scripts/lib/validate.mjs`, merged in `validateRepo` on every return path; tests 1 to 5, 9, 10 |
| 2. `init` validates `.pmkit/config.yaml` before it writes it, in both modes, and refuses with the file to fix | `pmkitProblems` and two call sites in `runInit` (`--update` after the read, both modes before `entries`); error code `INVALID_INPUT`, next step names the file; tests 11 to 17 |

## Decisões

| Decision | Reason |
| --- | --- |
| Report the problems from `validateRepo` with code `config` and path `.pmkit/config.yaml`. | One output shape for both files. `doctor.md` already groups by `code` and names both files for `config`, so no command text needs a new case. |
| Keep the `validatePmkitConfig` messages as they are. | `config.test.mjs` asserts them, and the schema test pairs them with the schema. Adding the found value is a separate change. |
| Use code `conflict` for conflict markers in `.pmkit/config.yaml`. | Matches `.issues/config.yaml`, and `doctor.md` step 2 already handles that code. |
| `validate` still exits 0 with problems. | The command summary and the goldens say problems are output, not errors. Changing the exit code would change the contract for every caller of `validate`. |
| A missing `.pmkit/config.yaml` still throws `NOT_CONFIGURED` with next step `/pmkit:setup`. | There is no tracker to check, so a repo without setup is not a repo with a problem. `setup.md` chooses its path on that error. |
| When `loadConfig` throws and the cause is the `.pmkit/config.yaml` problems, return those problems alone. | `loadConfig` stops at the first bad key, so `validate` cannot read the tracker. Listing the pmkit problems is the useful part, and the tracker checks resume once the file is fixed. |
| `tracker.system` other than `local` and valid (such as `linear`) keeps throwing `NOT_SUPPORTED`. | The validator accepts it. Changing that is a change to the support policy, outside this issue. |
| `init` validates the in-memory content before any entry is built, in both modes, and in `--update` once more on the file as read. | The in-memory content is exactly what would be written, so nothing bad reaches disk, and `--dry-run` refuses too. The early read check keeps a non-map file or a non-string `tracker.path` from crashing `path.join`. |
| `init` refuses with `INVALID_INPUT` (exit 2), the same code and message pattern as the `.issues/config.yaml` refusal. | One pattern for the user and for tests. Exit 2 is how `init` already reports invalid input. |
| When both files are invalid, `init` reports `.pmkit/config.yaml` only. | One file to fix per error, as the criterion asks. The next run shows the other. |
| Change `commands/setup.md` step 2 of "Existing config"; leave `doctor.md` and `groom.md`. | `setup.md` states that only `.issues/config.yaml` stops `init --update`, which becomes false. `doctor.md` already names both files for `config` problems. |
| No CHANGELOG edit on this branch. | PMK-2 and PMK-3 set the pattern, and `changelog.test.mjs` ties sections to the version number. The release adds the line. |
| No new fixture, golden or scenario. | The fixtures are valid, and tests build the bad cases with `makeRepo` and a rewritten file. Fewer files to keep in step. |

## Open questions

1. Stricter than the commands. The validator requires `version: 1`, `git_host.system` and `write_policy.confirm`, but `loadConfig` and the commands read only `tracker`. A hand-written `.pmkit/config.yaml` that works today without `write_policy` will now show problems in `validate`, and `init --update` will refuse it until fixed. This is what the issue asks for, but it is a change for such users. Alternative: make `write_policy` and `git_host` optional in the validator and the schema together. Left out here because it changes PMK-8's schema contract.
2. `loadConfig` stays as it is. Making every command refuse an invalid `.pmkit/config.yaml` (approach C) would change the behavior of all commands, so it is not in this design. If wanted, it is a separate issue.
3. The `tracker.system: linear` case still makes `validate` throw instead of listing a problem. It is unrelated to this issue. A separate issue could make `validate` report it as a problem.
4. The first-run `init` check cannot fail from the CLI today (the template is valid and `--git-host` is checked by a flag). Test 16 needs a seam; the plan decides which.

No part of this design deletes user data. The only change outside `validate` and `init` is the wording in `commands/setup.md`.
