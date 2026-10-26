# PMK-120: check .pmkit/config.yaml in loadConfig for every command

## Problem

`pmkit validate` lists every problem in `.pmkit/config.yaml` (PMK-112, PMK-119), and `init` refuses to write an invalid one. Every other command reads the file through `loadConfig`, which checks only `tracker.system` and `tracker.path`. A wrong `git_host.system`, `write_policy.confirm` or `version` goes unnoticed, and writes go through.

Acceptance criteria:

1. `loadConfig` checks `.pmkit/config.yaml` with the same rules `validate` uses, and each command reacts to an invalid file as the spec decides for its class (refuse, or warn and go on), and no command writes the tracker while the file is invalid.
2. `validate` still lists every `.pmkit/config.yaml` problem instead of failing, and `init --update` can still repair the file.
3. A refused command exits 2 with an error that names `.pmkit/config.yaml` and the bad key, and gives a next step that works (`pmkit validate` or `/pmkit:local:doctor`).
4. The tracker rule and the config rules have one source shared by `loadConfig` and `validate`, tests cover each command class, and `npm test` passes.

## Reproduced behavior

A script in the session scratchpad builds a temp project: `git init`, `pmkit init --git-host github --member fred ...`, one issue, one commit. It copies that project once per bad file, breaks `.pmkit/config.yaml` with `sed`, and runs each command. Code on this branch at `762a672`. This repo's `.issues/` was not touched.

Bad key: `git_host.system: gitlab`.

| Command | Exit | Output today |
| --- | --- | --- |
| `issues list` | 0 | the issue table, no warning |
| `issues get ISS-3Q7S` | 0 | the issue, no warning |
| `issues create --title Second --type task --dry-run` | 0 | the new issue preview |
| `issues create --title Second --type task` | 0 | writes `.issues/issues/ISS-H4TX/issue.md` and `events.jsonl` |
| `cycle current` | 0 | `no active sprint` |
| `validate` | 0 | `.pmkit/config.yaml  config  git_host.system must be github or none` |
| `init --update --dry-run` | 2 | `error: the .pmkit/config.yaml is not valid: git_host.system must be github or none`, `next: Fix .pmkit/config.yaml by hand, then run init --update again` |
| `migrate --dry-run` | 0 | `the tracker is already at format 2, nothing to migrate` |
| `reindex` | 0 | `indexed 1 issues (0 could not be read) in .issues/.cache/index.json` |
| `capabilities --json` | 0 | `"gitHost": "gitlab"`, and `linked_code` has no enable hint |
| `issues branch ISS-3Q7S --dry-run --json` | 2 | `NOT_SUPPORTED`, `this repository has no git host configured` |
| `pr status --branch x` | 2 | the same `NOT_SUPPORTED` error |

Bad key: `write_policy.confirm: maybe`, and bad key `version: 2`. Every command in the table above behaves the same as for `gitlab`, with the matching `validate` line (`write_policy.confirm must be one of all_writes, single_writes, none`, or `version must be 1`) and the matching `init --update` refusal. `issues create` writes the issue in both cases. `pr status` gets past the host check and fails in `gh` instead, because the temp project has no remote.

`tracker.system: linear`:

| Command | Exit | Output today |
| --- | --- | --- |
| `issues list`, `issues get`, `issues create --dry-run`, `issues create`, `cycle current`, `migrate --dry-run`, `reindex`, `pr status` | 2 | `error: tracker.system "linear" is not supported yet`, `next: Set tracker.system to local in .pmkit/config.yaml` (`NOT_SUPPORTED`) |
| `validate` | 0 | `checked: 0 issues, ...` and `.pmkit/config.yaml  config  tracker.system "linear" is not supported yet, set it to local` |
| `init --update --dry-run` | 0 | every file `keep` |

Two more cases that show the tracker rule differs between `loadConfig` and `validate`:

| File | `issues list --json` | `validate` |
| --- | --- | --- |
| `tracker.system: trello` | exit 2, `NOT_SUPPORTED`, `tracker.system "trello" is not supported yet` | `tracker.system must be one of local, linear, jira, github, gitlab, azure-devops` |
| `tracker.path: 7` | exit 2, `INVALID_INPUT`, `tracker.path in .pmkit/config.yaml must be a folder name such as .issues`, next `Fix tracker.path in .pmkit/config.yaml` | `tracker.path must be a string` |

An invalid `.issues/config.yaml` already has a rule. `default_status: nope` in a copy of the same project: `issues list` exits 0 with no warning, `reindex` exits 0, and `issues create --dry-run --json` exits 2 with `INVALID_INPUT`, `the tracker config is not valid, so writes are refused: default_status must be a status`, next step `pmkit validate`. `requireWriter` in `scripts/lib/local/tracker.mjs` does this for every tracker write, dry runs included.

What reads which key today:

- `tracker.system` and `tracker.path`: `loadConfig`, for every command that loads a config.
- `git_host.system`: `makeHost` (`issues branch`, `pr open`, `pr ready`, `pr status`, `pr sync`) and `capabilities`.
- `git_host.default_branch`: `issues branch`, `pr open`.
- `write_policy`: no CLI code. The command texts read it to decide when to ask before a write.
- `version`: no code.

So a bad `git_host` or `write_policy` changes what an agent does before or during a write, and no read result depends on `write_policy` or `version`.

## Options

A. Every command refuses with exit 2, except a named set (`validate`, `init`, `changelog`).
- No write under a bad file.
- Reads stop too, though none of them uses `version` or `write_policy`. A typo in `write_policy.confirm` blocks `issues list`, `/pmkit:report:status` and `/pmkit:team:standup`.
- Recovery: `validate` and `init --update` still run. `/pmkit:local:doctor` reaches step 6, where `reindex` fails. Its text says to report that and go on, so doctor still finishes.
- It differs from the rule for an invalid `.issues/config.yaml`, where reads go on and writes refuse.
- Tests: no golden changes, because every fixture is valid.

B. Writes refuse with exit 2, dry runs included. Reads go on and print one warning on stderr.
- No write under a bad file, same as A.
- Reads keep working, and the warning tells the agent the file is bad before it tries a write.
- Recovery: `validate`, `init --update` and every step of `/pmkit:local:doctor` run.
- It matches the `.issues/config.yaml` rule (`requireWriter`), so a user meets one rule for both files.
- Tests: no golden changes. JSON on stdout does not change for reads, because the warning goes to stderr.

C. Refuse only when the command uses a bad key, and warn for the rest. For example, `git_host` refuses `issues branch` and `pr *`.
- `write_policy` and `version` are used by no CLI command. Under C, `issues create` with `write_policy.confirm: maybe` goes on and writes, which breaks criterion 1 ("no command writes the tracker while the file is invalid").
- To meet criterion 1, C has to refuse every write. It then becomes B plus a refusal of `pr status` for a bad `git_host`, and `pr status` already fails there with `NOT_SUPPORTED` from `makeHost`.
- It needs a map from each command to the keys it reads. That map goes stale when a command starts to read a new key.

Recommendation: B. It is the only option that blocks every write and still lets reads, reports and doctor run. It reuses the existing rule for `.issues/config.yaml`. The conventions file says "Reads run freely" and "Fail with a next step", and B keeps both.

## Design

### Two kinds of problem

A problem in `.pmkit/config.yaml` either stops the CLI from finding the tracker or does not.

Blocking problems. Every command that loads a config refuses, reads included, and `validate` lists the problems. This is today's behavior for each of them. Only the code for an unknown `tracker.system` and the message for a bad `tracker.path` change.

| Case | Code | Message | Next step |
| --- | --- | --- | --- |
| no file | `NOT_CONFIGURED` | `no .pmkit/config.yaml in <root>` (unchanged) | `/pmkit:setup` (unchanged) |
| not valid YAML | `INVALID_INPUT` | `.pmkit/config.yaml is not valid YAML: <error>` (unchanged) | `Fix .pmkit/config.yaml` (unchanged) |
| not a map, or no string `tracker.system` | `INVALID_INPUT` | `.pmkit/config.yaml has no tracker.system` (unchanged) | `/pmkit:setup` (unchanged) |
| `tracker.system` is in `TRACKERS` but not `local` | `NOT_SUPPORTED` | `tracker.system "<name>" is not supported yet` (unchanged) | `Set tracker.system to local in .pmkit/config.yaml` (unchanged) |
| `tracker.system` is not in `TRACKERS`, or `tracker.path` is not a string | `INVALID_INPUT` (was `NOT_SUPPORTED` for an unknown system) | `.pmkit/config.yaml is not valid: <every problem, joined with "; ">` | `pmkit validate` |

Other problems: `version`, `git_host.*` and `write_policy.*`, the rest of `validatePmkitConfig`. `loadConfig` does not throw for them. It returns them as `pmkitProblems`, and each command class reacts as the table below says.

### Command classes

Every command in `COMMANDS` in `scripts/pmkit.mjs`, 45 in all. The reaction applies when `.pmkit/config.yaml` has problems of the second kind. A blocking problem refuses every command that loads a config, as listed above.

| Class | Reaction | Commands |
| --- | --- | --- |
| No config | runs as today, no check, no warning | `init` (with or without `--update`), `changelog` |
| Lists problems | runs as today, lists every problem, exit 0, no warning | `validate` |
| Read | goes on, prints one warning line on stderr, exit code and stdout as with a valid file | `capabilities`, `discover`, `whoami`, `issues list`, `issues get`, `cycle list`, `cycle current`, `cycle issues`, `cycle capacity` without `--set` and `--days-off`, `epic list`, `epic get`, `epic progress`, `epic updates`, `milestone list`, `milestone get`, `docs read`, `metrics velocity`, `metrics cycle-time`, `events`, `pr status`, `reindex` |
| Write | refuses with exit 2, with or without `--dry-run`, and writes nothing | `issues create`, `issues update`, `issues move`, `issues assign`, `issues link`, `issues parent`, `issues comment`, `issues log-time`, `issues archive`, `cycle open`, `cycle close`, `cycle add`, `cycle capacity` with `--set` or `--days-off`, `epic create`, `epic update-status`, `milestone create`, `docs create`, `issues branch`, `pr open`, `pr ready`, `pr sync`, `migrate` |

The write class is every command with `write: true`, with one exception. `cycle capacity` without `--set` and `--days-off` only reads, so it is in the read class.

Why each exempt command is exempt:

- `init`. It never calls `loadConfig`, and it is the repair path. `init --update --git-host github` rewrites a bad `git_host.system`, and its own check (`pmkitConfigRefusal`, PMK-112) refuses to write a file that is still invalid. A first run refuses with `CONFLICT` when the file exists. Both stay as they are.
- `changelog`. It reads a changelog file, needs no config, and says so in its summary. `/pmkit:upgrade` runs it before any config is read.
- `validate`. Its job is to list the problems, and it is the next step of every refusal. It must never refuse because of the file it reports on.

Notes on single commands:

- `reindex` writes only `.issues/.cache/`, which git ignores and which every read without `--dry-run` also refreshes. That cache is not the tracker, so `reindex` is a read. `/pmkit:local:doctor` step 6 keeps working.
- `migrate` changes the tracker files, so it refuses, with `--dry-run` too. `runMigrate` loads its config itself (`checkFormat: false`) and checks `pmkitProblems` there, so the library call refuses as well.
- `issues branch`, `pr open`, `pr ready` and `pr sync` write to git or GitHub and use `git_host`. They refuse like any write.
- `pr status` is a read. With a bad `git_host.system`, `makeHost` still fails with today's `NOT_SUPPORTED` error, and the warning line above it names the real cause.
- A dry run refuses because the real run would refuse. Otherwise a preview asks the user to confirm a write that cannot happen. `requireWriter` refuses dry runs for the same reason.

### Messages

Write refusal:

```js
new PmkitError(
  'INVALID_INPUT',
  `.pmkit/config.yaml is not valid, so writes are refused: ${problems.join('; ')}`,
  'pmkit validate',
  { pmkitConfig: { problems } },
)
```

Blocking error, for an unknown `tracker.system` or a non-string `tracker.path`:

```js
new PmkitError('INVALID_INPUT', `.pmkit/config.yaml is not valid: ${problems.join('; ')}`, 'pmkit validate', { pmkitConfig: { problems } })
```

Warning, one line on stderr, in text and `--json` mode:

```
warning: .pmkit/config.yaml is not valid, so writes are refused: git_host.system must be github or none; run pmkit validate
```

- `problems` is every message from the shared rule (below), in its order. Each message starts with its key (`version`, `tracker.system`, `git_host.system`, `write_policy.confirm`, ...), so the error names the file and every bad key. Listing all of them lets the user fix the file in one pass. `init` lists all problems for the same file in the same way.
- The code is `INVALID_INPUT`, as for the `.issues/config.yaml` write refusal. `NOT_SUPPORTED` stays for a known tracker other than `local`.
- The next step is `pmkit validate`. It is the next step of the `.issues/config.yaml` refusal and of a failing migration, it always runs (it is exempt), and it lists every problem with its path. The conventions file sends the agent to `/pmkit:local:doctor` for the fix (see "Command texts").
- `details.pmkitConfig` lets `brokenConfigProblem` rethrow the error without matching on its message. Today it matches `INVALID_INPUT` messages against the `<tracker.path>/config.yaml` label. A tracker path of `.pmkit` would make that label match `.pmkit/config.yaml is not valid`. `run()` prints only `code`, `message` and `nextStep`, so `details` never reaches the output.

Example after the change, `git_host.system: gitlab`:

```
$ pmkit issues list
ID       | Title | Status  | Assignee | Estimate | Sprint
...
(stderr) warning: .pmkit/config.yaml is not valid, so writes are refused: git_host.system must be github or none; run pmkit validate
exit 0

$ pmkit issues create --title Second --type task --dry-run --json
{ "error": { "code": "INVALID_INPUT", "message": ".pmkit/config.yaml is not valid, so writes are refused: git_host.system must be github or none", "nextStep": "pmkit validate" } }
exit 2
```

### One source for the rules

In `scripts/lib/config.mjs`:

- `unsupportedTracker(system)` returns `null` for `local` and for any name outside `TRACKERS`. A name outside the list is an invalid value, and `validatePmkitConfig` already reports it. For the other names in `TRACKERS` it returns `{ message, nextStep, problem }`:
  - `message`: `tracker.system "<name>" is not supported yet` (unchanged)
  - `nextStep`: `Set tracker.system to local in .pmkit/config.yaml` (unchanged)
  - `problem`: `tracker.system "<name>" is not supported yet, set it to local`. This is today's `validate` text, which `validate.mjs` builds by hand. It moves next to the next step it shortens.
- New export `pmkitConfigMessages(parsed)`. It returns `validatePmkitConfig(parsed)` and, when `parsed.tracker.system` is unsupported, appends `unsupportedTracker(system).problem`. It guards `parsed` and `parsed.tracker` as plain maps, as `unsupportedTrackerMessage` in `validate.mjs` does today. That helper moves here and `validate.mjs` drops it.
- `validatePmkitConfig` does not change. `init` and the JSON Schema keep using it alone, because both accept `linear` (PMK-119).
- `loadConfig`, after the YAML parse:
  1. No string `tracker.system`: throw as today.
  2. `unsupportedTracker(system)` is not `null`: throw `NOT_SUPPORTED` as today.
  3. `const problems = pmkitConfigMessages(pmkit)`.
  4. `tracker.system` is not in `TRACKERS`, or `tracker.path` is set and not a string: throw the blocking `INVALID_INPUT` with `problems`.
  5. Go on as today. Every object `loadConfig` returns, including the `checkFormat: false` and older-format returns, carries `pmkitProblems: problems`. The list is empty for a valid file.

Both differences in the carried notes are settled here. The suffix lives in one place (`unsupportedTracker`), and both callers apply the rule to the same names: the entries of `TRACKERS` other than `local`. With `trello`, `issues list` now says `INVALID_INPUT` and `tracker.system must be one of ...`, which matches what `validate` lists.

In `scripts/lib/validate.mjs`:

- `pmkitConfigProblems(root)` calls `pmkitConfigMessages(parsed)` in place of `validatePmkitConfig` plus `unsupportedTrackerMessage`. Its output does not change.
- `brokenConfigProblem` rethrows an error that has `details.pmkitConfig` before it reads any file. `validateRepo` then returns the `pmkit` problems, as it does today when `pmkit` is not empty.
- When `loadConfig` succeeds with `pmkitProblems`, `validateRepo` goes on with every tracker check, as today. The `.pmkit/config.yaml` problems come from `pmkitConfigProblems(root)`, so they are not listed twice.

In `scripts/pmkit.mjs`, `run()`:

- A helper (the builder names it) reads `ctx.config().pmkitProblems`. A write throws the write refusal when the list is not empty. A read adds the warning once.
- The dispatcher runs the check before `command.run` for every write command except `migrate` and `cycle capacity`. `runMigrate` checks the config it loads. `cycle capacity` runs the check in its write branch, before `parseCapacity`. The builder may express this as a field on the command instead. The class table is what binds.
- The read warning goes to stderr on success and on failure. Today warnings print only after a successful run. The config warning prints before the `error:` line, and in `--json` mode stdout keeps only the JSON. When `loadConfig` throws, no config was returned, so there is no warning. The error stands alone.
- `createLocalTracker` and `requireWriter` do not change. The dispatcher is the one place that classifies commands, and it also covers writes that never reach the tracker, such as `pr open`.

### What validate and init do

- `validate` lists every problem and exits 0, as today. With `git_host.system: gitlab` it still checks the whole tracker (`checked: 1 issues, ...`). With a blocking problem it returns the `.pmkit/config.yaml` problems with zero counts, as today. With a bad key and no `.issues/config.yaml` it still throws `NOT_CONFIGURED`, because `loadConfig` only throws for the second kind of problem after the tracker folder check.
- `init --update` is not touched. It still repairs `git_host.system` with `--git-host`, still refuses a file that stays invalid, and `--dry-run` follows the same path without writing.

### Command texts

- `skills/pmkit/references/conventions.md`, "Reading errors": add one bullet. "A call can succeed and print `warning: .pmkit/config.yaml is not valid, so writes are refused: ...` on stderr. Show it once, with `/pmkit:local:doctor` as the fix. Reads still work. Every write and every dry run fails with `INVALID_INPUT` until the file is fixed, so skip the writes and go on with the reads." Without it, an agent has no rule for this stderr line and may hide it. This also covers the four commands whose first step is `pr sync --dry-run`, which now fails on a bad file. The bullet tells the agent to go on with the rest of the command.
- `commands/local/doctor.md`: no change. Step 3 already says every write and dry run fails while the config is invalid, and it names `.pmkit/config.yaml` for `config` problems. That sentence becomes true for this file. Step 6 `reindex` is a read and keeps working.
- `commands/setup.md`: no change. "Existing config" step 2 stops on any `.pmkit/config.yaml` problem before step 3 runs `discover` and `issues list`. The first run starts with no file.
- `commands/upgrade.md`: no change. Step 5 `migrate --dry-run` now fails with `INVALID_INPUT` on a bad file, and its "If something is missing" section sends errors to the conventions.
- `docs/superpowers/specs/2026-10-23-pmkit-design.md`, `.pmkit/config.yaml` section: the sentence "The MVP loader rejects any `tracker.system` other than `local` with `NOT_SUPPORTED`" becomes "rejects a known `tracker.system` other than `local` with `NOT_SUPPORTED`, and an unknown one with `INVALID_INPUT`". Add one sentence: "With any other problem in the file, reads go on with a warning and writes refuse."
- `CHANGELOG.md`: no change on this branch. The release adds a line such as "Every write refuses an invalid `.pmkit/config.yaml`, and reads warn".

### Goldens and scenarios

No change is expected. All five fixtures and the template pass `validatePmkitConfig` (`every fixture has no .pmkit/config.yaml problem` in `validate.test.mjs`). The only scenario edit to the file turns `system: none` into `system: github`, which stays valid. A valid file adds no warning and no refusal. A search of `scripts/__goldens__`, `scripts/__scenarios__`, `commands` and `skills` finds no output for `trello`, `folder name such as` or `Fix tracker.path`. The implementation runs `npm test` (1044 tests pass at `762a672`) without `UPDATE_GOLDENS=1`. If a golden differs, the stage stops and reads the diff line by line before any regeneration.

## Assertions per criterion and how each is proven

Unit tests use `makeRepo` and the `editPmkit` and `breakPmkit` helpers of `scripts/validate.test.mjs` (or copies of them). CLI tests use `run` and `json` in `scripts/cli.test.mjs`, which return the exit code, stdout and stderr. `hashTree` proves that nothing was written.

### Criterion 1: same rules, a reaction per class, no write

- `config.test.mjs`
  - `loadConfig` on the `basic` fixture returns `pmkitProblems: []`.
  - With `git_host.system: gitlab`, `write_policy.confirm: maybe` and `version: 2`, it returns without throwing, and `pmkitProblems` deep-equals `pmkitConfigMessages` of the parsed file. Also with `checkFormat: false`.
  - `pmkitConfigMessages` returns `validatePmkitConfig` plus the unsupported problem for `linear`, nothing extra for `local` or `trello`, and no throw for `null`, a string or a list.
  - `unsupportedTracker('trello')` is `null`. `unsupportedTracker('linear')` deep-equals `{ message, nextStep, problem }` with the three exact strings.
  - `tracker.system: trello` throws `INVALID_INPUT` with message `.pmkit/config.yaml is not valid: tracker.system must be one of local, linear, jira, github, gitlab, azure-devops; ...` and `details.pmkitConfig.problems` equal to the messages.
  - `jira` still throws `NOT_SUPPORTED` with today's message and next step (existing test).
  - The existing tests for `''`, `'# nothing yet'`, `'- local'` and `'version: 1'` keep their `/pmkit:setup` next step. The `path: 5` test keeps passing (its message names `tracker.path`).
- `cli.test.mjs`, write class. One test holds a table with one argv for each write command, keyed by name. It asserts that the table's names equal `COMMANDS.filter((c) => c.write).map((c) => c.name)`, so a new write command fails the test until it gets a row. For each row, on a `team` repo with `write_policy.confirm: maybe`, run with `--dry-run --json` and without `--dry-run`:
  - exit 2, `error.code` `INVALID_INPUT`, `error.message` `.pmkit/config.yaml is not valid, so writes are refused: write_policy.confirm must be one of all_writes, single_writes, none`, `error.nextStep` `pmkit validate`;
  - `hashTree(root)` is unchanged.
  - `cycle capacity` uses `--set`. `issues branch` and the `pr` commands run on a repo with `git_host.system: github` and the fake `gh` from `scripts/fake-gh.mjs` on the `PATH`. Its `.log` file stays empty, because the refusal comes before any host call.
- `cli.test.mjs`, the case from the reproduction: `issues create --title Second --type task` with `git_host.system: gitlab` exits 2 and creates no issue folder.
- `cli.test.mjs`, read class. A table with one argv per read command, guarded the same way: its names equal the commands that are not write and not exempt, plus `cycle capacity <id>` with no flags. For each, with `write_policy.confirm: maybe`:
  - the exit code and stdout equal those of the same call on an unchanged copy of the repo (`capabilities` without its `generatedAt` field);
  - stderr has the warning line exactly once.
- `cli.test.mjs`, warning on failure: `pr status --branch x --json` with `git_host.system: gitlab` exits 2 with today's `NOT_SUPPORTED` body on stdout, and stderr holds the warning line.
- `migrations.test.mjs`: `runMigrate(root)` and `runMigrate(root, { dryRun: true })` on a format 1 repo in git with `git_host.system: gitlab` throw the write refusal, and `hashTree` is unchanged.

### Criterion 2: validate lists, init repairs

- `validate.test.mjs`: the existing PMK-112 and PMK-119 tests pass unchanged. That covers `breakPmkit`, the unparseable file, conflict markers, `trello`, the numeric path, `linear` alone and with other keys, and `NOT_CONFIGURED`. New: with `git_host.system: gitlab`, `validateRepo` returns the problem and `checked.issues` above 0, so the tracker checks still run.
- `validate.test.mjs`: with `tracker.system: trello` and `tracker.path: .pmkit`, `validateRepo` returns the `tracker.system must be one of ...` problem once. `loadConfig` throws the blocking error with `details.pmkitConfig`, and `brokenConfigProblem` rethrows it before the label match, so no second problem appears.
- `cli.test.mjs`: `validate` and `validate --json` with `write_policy.confirm: maybe` exit 0, list the problem, and print no `warning:` line on stderr.
- `cli-init.test.mjs`: with `git_host.system: gitlab`, `init --update --git-host github --dry-run --json` exits 0 and marks `.pmkit/config.yaml` `change`. The same call without `--dry-run` writes `system: github`. A following `issues create --dry-run --json` exits 0 with no warning. The existing tests for `init --update` refusing a bad file stay.
- `cli.test.mjs`: `changelog --file <path to this repo's CHANGELOG.md> --since 0.1.0` in a repo with a bad file exits 0 and prints no warning.

### Criterion 3: exit 2, the file, the key, a next step that works

- Covered by the write class test above: exit 2, the message starts with `.pmkit/config.yaml is not valid`, contains `write_policy.confirm`, and the next step is `pmkit validate`.
- One test with two bad keys (`breakPmkit`) asserts that the message names both `git_host.system` and `write_policy.confirm`, in that order.
- One test runs the refused command, then `validate --json` on the same repo, and asserts exit 0 and a problem for each key in the error. That proves the next step works.
- The blocking case: `issues list --json` with `trello` exits 2 with `INVALID_INPUT`, the `.pmkit/config.yaml is not valid: tracker.system must be one of ...` message and `pmkit validate`. The existing `linear` CLI test keeps `NOT_SUPPORTED`.

### Criterion 4: one source, tests per class, npm test

- `validate.test.mjs` asserts that the `linear` problem text equals `unsupportedTracker('linear').problem`, and `validate.mjs` no longer has its own `, set it to local` string. A source check is enough: `grep -n "set it to local" scripts/lib/validate.mjs` finds nothing.
- `config.test.mjs` asserts that `loadConfig`'s `pmkitProblems` equal `pmkitConfigMessages` of the parsed file, and `validate.test.mjs` asserts that `validateRepo`'s `.pmkit/config.yaml` messages equal the same call. Both callers use one function.
- The class tests above cover no config, lists problems, read, write and blocking.
- `npm test` passes with the count above 1044 and no golden or scenario edit.

## Decisões

| Decision | Reason |
| --- | --- |
| Option B: writes refuse, reads warn and go on. | It blocks every write, as criterion 1 asks, and keeps reads, reports, `validate`, `init --update` and doctor working. It matches the rule for an invalid `.issues/config.yaml`. A refuses reads that use none of the bad keys. C lets writes through for `write_policy` and `version`. |
| The exempt commands are `init`, `changelog` and `validate`. | `init` is the repair path and has its own check. `changelog` needs no config. `validate` reports the problems and is the next step of every refusal. |
| `cycle capacity` without `--set` and `--days-off` is a read. | It only prints capacity. Refusing it would block a read under a write flag. |
| `reindex` is a read. | It writes only `.issues/.cache/`, which git ignores and every read already refreshes. Doctor step 6 relies on it. |
| `migrate` refuses, with `--dry-run` too. | It rewrites the tracker files, and criterion 1 forbids any tracker write while the file is invalid. |
| Dry runs refuse. | The real run would refuse, so the preview would ask to confirm a write that cannot happen. `requireWriter` already refuses dry runs. |
| Problems that stop the CLI from finding the tracker keep refusing every command. Only the code for an unknown `tracker.system` changes to `INVALID_INPUT`. | Without a tracker no read can run. `trello` is an invalid value, not an unsupported tracker, and `validate` already reports it that way. |
| `NOT_SUPPORTED` stays for a known tracker other than `local`, with today's message and next step. | Asked by the task, and PMK-119 pinned these strings in tests. |
| `unsupportedTracker` returns `null` for names outside `TRACKERS` and carries the `problem` text. `pmkitConfigMessages` in `config.mjs` is the one rule list for `loadConfig` and `validate`. | It settles both carried notes. One suffix, one set of names, one function. |
| `validatePmkitConfig` stays as it is. | `init` and the JSON Schema accept `linear` (PMK-119). `schemas.test.mjs` pairs the function with the schema. |
| The error lists every problem, joined with "; ". | The user fixes the file in one pass. `init` does the same for this file. |
| The code is `INVALID_INPUT` and the next step is `pmkit validate`. | They match the `.issues/config.yaml` write refusal and the migration failure. `validate` always runs and lists each problem with its path. |
| The error carries `details.pmkitConfig.problems`, and `brokenConfigProblem` rethrows it first. | It removes a message match that a tracker path of `.pmkit` would confuse. The code tests a key, as PMK-118 did with `details.migration`. |
| `loadConfig` returns `pmkitProblems`, and the dispatcher decides per class. The tracker library stays as it is. | `loadConfig` cannot know the command. The dispatcher already holds the command table and covers host writes that never reach the tracker. |
| The warning goes to stderr, once, also when the read fails. | stdout stays the JSON the command texts parse, so no golden changes. On failure the warning explains errors such as `pr status`'s "no git host configured". |
| Add one bullet to "Reading errors" in the conventions. Change no command file. | Agents need a rule for the new stderr line and for skipping writes. Doctor, setup and upgrade already read correctly under B. |
| Update the loader sentence in the design spec. | It says every non-local tracker gets `NOT_SUPPORTED`, which stops being true for unknown names. |
| No golden or scenario change. | Every fixture has a valid file, and the warning goes to stderr. |
| A hand-written `.pmkit/config.yaml` without `git_host`, `write_policy` or `version` now refuses writes. This is in scope. | It is what the issue asks: every command checks the file. `init` has always written the full template (unchanged since `dbc26b2`), so only hand-written files hit this. Reads keep working, `validate` names the missing keys, and the release note mentions it. |

No choice here deletes user data. The behavior changes are the write refusal, the read warning and the `trello` error code, all inside this issue's scope. No open question needs the user.

## Follow-up candidates

- Warn on reads when `.issues/config.yaml` is invalid too. Today reads stay silent there and only writes refuse, so the two files still differ in that one point.
- `makeHost` says "this repository has no git host configured" for any value other than `github`, even `gitlab`. It could name the value it found.
- `/pmkit:report:status`, `/pmkit:team:standup`, `/pmkit:cycle:close` and `/pmkit:issues:mine` start with `pr sync --dry-run` and continue only on `NOT_SUPPORTED`, `NOT_CONFIGURED` or `AUTH`. The conventions bullet covers the bad-file case. Each text could also list `INVALID_INPUT` from a bad file.
- Make `git_host` and `write_policy` optional in the validator and the schema together, with defaults. This would let a minimal hand-written file pass. It changes PMK-8's schema contract.
- `commands/setup.md` "Existing config" step 2 says a `.pmkit/config.yaml` problem "makes `init --update` refuse". That is still not true for `linear` (PMK-119 follow-up).
- Fold the `format`, `migration` and `pmkitConfig` cases of `brokenConfigProblem` into one table keyed by `details` (PMK-118 follow-up 5). This spec adds the third `details` key.
- `capabilities` reports `gitHost` as written, such as `gitlab`. With the warning this is visible, but the manifest could report `none` for an invalid value.
