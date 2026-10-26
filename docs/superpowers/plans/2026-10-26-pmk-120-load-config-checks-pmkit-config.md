# PMK-120 loadConfig checks .pmkit/config.yaml Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every command checks `.pmkit/config.yaml` with the rules `validate` uses. Writes refuse with exit 2 while the file is invalid, reads go on with one stderr warning, and `validate`, `init` and `changelog` run as today.

**Architecture:** `config.mjs` holds the one rule list, `pmkitConfigMessages(parsed)`, and `loadConfig` returns its result as `pmkitProblems`. It throws only for the problems that stop the CLI from finding the tracker. The dispatcher in `pmkit.mjs` sorts each call into exempt, read or write, refuses writes before `command.run`, and prints the warning for reads. `runMigrate` makes its own check. `validate.mjs` uses the same rule list and rethrows `loadConfig` errors that carry `details.pmkitConfig`.

**Tech Stack:** Node 18+ ES modules, no dependencies (ADR 0003), `node:test`. Run tests with `npm test`.

**Spec:** `docs/superpowers/specs/2026-10-26-pmk-120-load-config-checks-pmkit-config-design.md`

## Global Constraints

### Command classes

The spec's "Command classes" table binds. `COMMANDS` has 45 entries: 22 with `write: true`, 23 without.

- Exempt, 3 commands: `init`, `changelog`, `validate`. No check, no warning. `validate` keeps listing every problem and exits 0.
- Read, 21 calls: the 20 commands without `write: true` that are not exempt (`capabilities`, `discover`, `whoami`, `issues list`, `issues get`, `cycle list`, `cycle current`, `cycle issues`, `epic list`, `epic get`, `epic progress`, `milestone list`, `milestone get`, `epic updates`, `docs read`, `metrics velocity`, `metrics cycle-time`, `events`, `pr status`, `reindex`), plus `cycle capacity` without `--set` and `--days-off`.
- Write, 22 commands: every command with `write: true`, which is `cycle capacity` only when `--set` or `--days-off` is given. With or without `--dry-run`. `migrate` refuses inside `runMigrate`, and the dispatcher does not check it.

### Two kinds of problem in `.pmkit/config.yaml`

Blocking problems keep refusing every command that loads a config, reads included:

| Case | Code | Message | Next step | `details` |
| --- | --- | --- | --- | --- |
| no file | `NOT_CONFIGURED` | `no .pmkit/config.yaml in <root>` | `/pmkit:setup` | none |
| not valid YAML | `INVALID_INPUT` | `.pmkit/config.yaml is not valid YAML: <error>` | `Fix .pmkit/config.yaml` | none |
| not a map, or no string `tracker.system` | `INVALID_INPUT` | `.pmkit/config.yaml has no tracker.system` | `/pmkit:setup` | `{ pmkitConfig: { problems: pmkitConfigMessages(parsed) } }` |
| `tracker.system` in `TRACKERS`, not `local` | `NOT_SUPPORTED` | `tracker.system "<name>" is not supported yet` | `Set tracker.system to local in .pmkit/config.yaml` | none |
| `tracker.system` not in `TRACKERS`, or `tracker.path` set and not a string | `INVALID_INPUT` | `` `.pmkit/config.yaml is not valid: ${problems.join('; ')}` `` | `pmkit validate` | `{ pmkitConfig: { problems } }` |

Every other problem (`version`, `git_host.*`, `write_policy.*`) does not throw. `loadConfig` returns it in `pmkitProblems`.

### Exact strings

- Write refusal: `new PmkitError('INVALID_INPUT', `.pmkit/config.yaml is not valid, so writes are refused: ${problems.join('; ')}`, 'pmkit validate', { pmkitConfig: { problems } })`.
- Read warning, one stderr line in text and `--json` mode: `warning: .pmkit/config.yaml is not valid, so writes are refused: <problems joined with "; ">; run pmkit validate`. Example: `warning: .pmkit/config.yaml is not valid, so writes are refused: git_host.system must be github or none; run pmkit validate`.
- `problems` is `pmkitConfigMessages(parsed)` in its order: `version`, `tracker`, `git_host`, `write_policy`, then the unsupported tracker problem.
- `unsupportedTracker('linear')` deep-equals `{ message: 'tracker.system "linear" is not supported yet', nextStep: 'Set tracker.system to local in .pmkit/config.yaml', problem: 'tracker.system "linear" is not supported yet, set it to local' }`.

### Shared rule functions, all in `scripts/lib/config.mjs`

- `unsupportedTracker(system: unknown): { message: string, nextStep: string, problem: string } | null`. `null` for `local` and for any value not in `TRACKERS`.
- `pmkitConfigMessages(parsed: unknown): string[]`. `validatePmkitConfig(parsed)` plus `unsupportedTracker(system).problem` when `parsed` and `parsed.tracker` are plain maps and the rule is not `null`. Never throws.
- `pmkitWriteRefusal(problems: string[]): PmkitError`. The write refusal above.
- `pmkitConfigWarning(problems: string[]): string`. The warning text without the `warning: ` prefix and newline, which `run()` adds as it does for other warnings.
- `validatePmkitConfig` does not change. `init` and the JSON Schema keep using it alone.
- `loadConfig` returns `pmkitProblems: string[]` on every object it returns (current, behind and `checkFormat: false`), empty for a valid file.

In `scripts/pmkit.mjs`:

- `exempt: true` on the `init`, `changelog` and `validate` entries of `COMMANDS`.
- `readUnless: ['set', 'days-off']` on the `cycle capacity` entry.
- `export function configClass(command, options): 'exempt' | 'read' | 'write'`. `options` is `parseArgs(argv).options`.

### Order and placement in `run()`

- `checkUsage` still runs first. For a write the config check comes before `command.run`, so its own input checks, such as `epic create needs --title`, come after it.
- The read warning is the first stderr line, before the command's own warnings and before an `error:` line. In `--json` mode stdout holds only the JSON.
- No warning when `loadConfig` throws, for the exempt class or for a write.

### Texts that change, exactly

`commands/report/status.md` line 19 and `commands/team/standup.md` line 20, the whole line becomes:

> 1. Sync merged pull requests. This is a bulk write, so preview it first. Run `node "${CLAUDE_PLUGIN_ROOT}/scripts/pmkit.mjs" pr sync --dry-run --json`. When `moved` is empty, skip to step 2. Otherwise show each issue in `moved` with its PR and the change from `in_review` to `done`, and ask once with `AskUserQuestion`, whatever `write_policy.confirm` says. When the user approves, run the same command without `--dry-run`. When the user declines, change nothing and carry on. Show each entry of `problems` as a warning. When the call fails with `NOT_SUPPORTED`, `NOT_CONFIGURED` or `AUTH`, say in one line that PR data is unavailable and why, and continue without it. When it fails with `INVALID_INPUT` and `error.message` starts with `.pmkit/config.yaml is not valid`, say in one line that `.pmkit/config.yaml` is not valid, so the sync is skipped, and go on with step 2.

`commands/cycle/close.md` line 19:

> 1. Sync merged pull requests. This is a bulk write, so preview it first. Run `node "${CLAUDE_PLUGIN_ROOT}/scripts/pmkit.mjs" pr sync --dry-run --json`. When `moved` is empty, skip to step 2. Otherwise show each issue in `moved` with its PR and the change from `in_review` to `done`, and ask once with `AskUserQuestion`, whatever `write_policy.confirm` says. When the user approves, run the same command without `--dry-run`. When the user declines, change nothing and carry on. Show each entry of `problems` as a warning. When the call fails with `NOT_SUPPORTED`, `NOT_CONFIGURED` or `AUTH`, say in one line that PR data is unavailable and why, and continue without it. When it fails with `INVALID_INPUT` and `error.message` starts with `.pmkit/config.yaml is not valid`, say in one line that `.pmkit/config.yaml` is not valid, so the sync is skipped, and go on with step 2. Steps 2 to 6 only read and still run. The writes from step 7 on fail with the same error, so show the sprint report of step 7 without asking for decisions, and stop there.

`commands/issues/mine.md` line 19:

> 1. Sync merged pull requests. This is a bulk write, so preview it first. Run `node "${CLAUDE_PLUGIN_ROOT}/scripts/pmkit.mjs" pr sync --dry-run --json`. When `moved` is empty, skip to step 2. Otherwise show each issue in `moved` with its PR and the change from `in_review` to `done`, and ask once with `AskUserQuestion`, whatever `write_policy.confirm` says. When the user approves, run the same command without `--dry-run`. When the user declines, change nothing and carry on with step 2. Show each entry of `problems` as a warning. When the call fails with `INVALID_INPUT` and `error.message` starts with `.pmkit/config.yaml is not valid`, say in one line that `.pmkit/config.yaml` is not valid, so the sync is skipped, and go on with step 2.

`skills/pmkit/references/conventions.md`, "Reading errors", a new bullet right after the bullet that starts "Use `error.code` to decide what to do." (line 31):

> - An error whose `error.message` starts with `.pmkit/config.yaml is not valid` comes from a broken config file, not from a value the user typed. Check for it before the `INVALID_INPUT` rule above, which asks the user for a corrected value. Stop that write and do not retry it. Show `error.message` as it is, and offer `pmkit validate` to list the problems and `/pmkit:local:doctor` to fix them. Then go on with the command's reads, if it has any. While the file stays broken, every write and dry run fails with this error, and reads print `warning: .pmkit/config.yaml is not valid, so writes are refused: ...` on stderr. Show that warning once. If a read fails with this error too, the CLI cannot find the tracker, so stop the command.

`README.md` line 94: the first two sentences ("The `issues branch` and `pr` commands need ... Without them they fail with `NOT_SUPPORTED`, `NOT_CONFIGURED` or `AUTH`.") become the text below. The rest of the line, from "Run `node scripts/pmkit.mjs --help`", stays.

> The `issues branch` and `pr` commands need `git_host.system: github` in `.pmkit/config.yaml` and a logged-in `gh`. With `git_host.system: none` they fail with `NOT_SUPPORTED`, and without `gh` or its login they fail with `NOT_CONFIGURED` or `AUTH`. A missing or invalid `git_host` makes `.pmkit/config.yaml` invalid. Then `issues branch`, `pr open`, `pr ready` and `pr sync` refuse with `INVALID_INPUT`, as every write does, and `pr status` prints a warning and fails with `NOT_SUPPORTED`.

`docs/superpowers/specs/2026-10-23-pmkit-design.md` line 128: "The MVP loader rejects any `tracker.system` other than `local` with `NOT_SUPPORTED`." becomes "The MVP loader rejects a known `tracker.system` other than `local` with `NOT_SUPPORTED`, and an unknown one with `INVALID_INPUT`. With any other problem in the file, reads go on with a warning and writes refuse."

### Files

- May change: `scripts/lib/config.mjs`, `scripts/lib/validate.mjs`, `scripts/pmkit.mjs`, `scripts/config.test.mjs`, `scripts/validate.test.mjs`, `scripts/cli.test.mjs`, `scripts/cli-init.test.mjs`, `scripts/migrations.test.mjs`, `skills/pmkit/references/conventions.md`, `commands/report/status.md`, `commands/team/standup.md`, `commands/cycle/close.md`, `commands/issues/mine.md`, `README.md`, `docs/superpowers/specs/2026-10-23-pmkit-design.md`, and `.superpowers/state/PMK-120-state.md`.
- Must not change: `scripts/__goldens__/`, `scripts/__scenarios__/`, `scripts/__fixtures__/`, `schemas/`, `templates/`, `CHANGELOG.md`, `scripts/lib/local/tracker.mjs` (`createLocalTracker` and `requireWriter` stay), and every other command file (`commands/local/doctor.md`, `commands/setup.md`, `commands/upgrade.md` included).

### Goldens and scenarios

- No golden or scenario changes. Every fixture and the template pass `validatePmkitConfig`, and the warning goes to stderr only for an invalid file.
- Run `npm test` without `UPDATE_GOLDENS=1`. If a golden or scenario differs, stop and read the diff line by line. Regenerate only with `UPDATE_GOLDENS=1 node --test scripts/goldens.test.mjs` (or `UPDATE_GOLDENS=1 node --test scripts/scenarios.test.mjs`), and only when this issue explains every changed line. The spec expects none, so a diff most likely means a bug in the dispatcher.
- Baseline: 1044 tests pass at `762a672`. The final count must be higher.

### Commits

- Subject ends with `(PMK-120)`. Body ends with `Co-Authored-By: <model> <noreply@anthropic.com>`, with the implementing model's name (for example `Claude Opus 5.5`).
- Every task runs its focused tests, then `npm test` in full, before its commit. Every commit leaves `npm test` green.
- Straight quotes, no em dashes in prose. No new dependency.

## Review Focus

1. Both config files invalid (`.pmkit/config.yaml` and `.issues/config.yaml`). A write should show the `.pmkit/config.yaml` refusal, since the dispatcher runs before `requireWriter`. Pinned in Task 2.
2. A hand-written `.pmkit/config.yaml` with only `version` and `tracker`. Reads should work with a warning that names `git_host.system` and `write_policy.confirm`, and writes should refuse. Pinned in Task 2.
3. Text mode, without `--json`. The refusal should print `error:` and `next: pmkit validate` on stderr with empty stdout, and a read should keep its stdout with the warning as the first stderr line. Pinned in Task 2.
4. A tracker on an older format (the `behind` branch of `loadConfig`) with a bad key. `pmkitProblems` should be there too, or reads lose the warning and writes slip through. Pinned in Task 1.
5. `cycle capacity` with `--days-off` and no `--set`. It writes, so it should refuse. Pinned in Task 2.

---

### Task 1: One rule list in config.mjs, and loadConfig returns pmkitProblems

**Files:**
- Modify: `scripts/lib/config.mjs` (`unsupportedTracker` at line 172, `loadConfig` at line 177, new exports beside them)
- Test: `scripts/config.test.mjs` (rewrite the test at line 53, add tests, add `makeRepo` to the import from `./test-helpers.mjs`)

**Interfaces:**
- Produces: `unsupportedTracker`, `pmkitConfigMessages`, `pmkitWriteRefusal`, `pmkitConfigWarning` with the signatures in Global Constraints, and `loadConfig(...).pmkitProblems: string[]`. Tasks 2 and 3 import them.

- [ ] **Step 1: Write the failing tests** in `scripts/config.test.mjs`. Import the three new names from `./lib/config.mjs`. Add a helper `basicWith(...edits)` that runs `makeRepo('basic')` and applies each `[from, to]` replacement to its `.pmkit/config.yaml`. Let `TRACKER_MSG = 'tracker.system must be one of local, linear, jira, github, gitlab, azure-devops'`.
  - Rewrite `unsupportedTracker is null for local and a message and next step for any other tracker` as `unsupportedTracker is null for local and for names outside TRACKERS, and gives a message, next step and problem for the others`. Assertions: `unsupportedTracker('local')` is `null`, `unsupportedTracker('trello')` is `null`, `unsupportedTracker('linear')` deep-equals the object in Global Constraints.
  - `pmkitConfigMessages adds the unsupported tracker problem to validatePmkitConfig`: on `template('pmkit.config.yaml')` it returns `[]`. With `tracker.system = 'linear'` it returns `['tracker.system "linear" is not supported yet, set it to local']`. With `'trello'` it deep-equals `validatePmkitConfig` of the same object (`[TRACKER_MSG]`). With `git_host.system = 'gitlab'` it returns `['git_host.system must be github or none']`. For `null`, `'local'`, `['local']` and `{ tracker: 'linear' }` it does not throw and deep-equals `validatePmkitConfig` of the same value.
  - `loadConfig returns pmkitProblems`: `loadConfig(fixture).pmkitProblems` deep-equals `[]`. For each edit `['system: none', 'system: gitlab']`, `['confirm: single_writes', 'confirm: maybe']` and `[/^version: 1$/m, 'version: 2']`, `loadConfig(root)` does not throw, and its `pmkitProblems` deep-equals `pmkitConfigMessages(parseYaml(<file text>))` and has length 1. The same holds for `loadConfig(root, { checkFormat: false })`.
  - `loadConfig returns pmkitProblems on an older tracker format` (Review Focus 4): `basicWith(['system: none', 'system: gitlab'])`, then set `version: 1` in `.issues/config.yaml` (replace `/^version: \d+$/m`). `loadConfig(root).format.state` is `'behind'` and `pmkitProblems` deep-equals `['git_host.system must be github or none']`.
  - `a .pmkit/config.yaml with no tracker.system carries its problems`: a temp root with `.pmkit/config.yaml` = `version: 1\ntracker:\n  path: .pmkit\n`. `loadConfig` throws with `code` `INVALID_INPUT`, `message` `.pmkit/config.yaml has no tracker.system`, `nextStep` `/pmkit:setup`, and `details.pmkitConfig.problems` deep-equal to `pmkitConfigMessages(parseYaml(text))`.
  - `an unknown tracker.system or a non-string tracker.path is INVALID_INPUT with every problem`: on `basicWith(['system: local', 'system: trello'])` the error has `code` `INVALID_INPUT`, `message` `` `.pmkit/config.yaml is not valid: ${TRACKER_MSG}` ``, `nextStep` `pmkit validate`, and `details` deep-equal to `{ pmkitConfig: { problems: [TRACKER_MSG] } }`. With `trello` and `gitlab` the message is `` `.pmkit/config.yaml is not valid: ${TRACKER_MSG}; git_host.system must be github or none` ``. With `['path: .issues', 'path: 5']` the message is `.pmkit/config.yaml is not valid: tracker.path must be a string` and the next step `pmkit validate`.
  - `pmkitWriteRefusal and pmkitConfigWarning word the refusal`: `pmkitWriteRefusal(['a', 'b'])` has `code` `INVALID_INPUT`, `message` `.pmkit/config.yaml is not valid, so writes are refused: a; b`, `nextStep` `pmkit validate`, and `details` `{ pmkitConfig: { problems: ['a', 'b'] } }`. `pmkitConfigWarning(['a', 'b'])` equals `.pmkit/config.yaml is not valid, so writes are refused: a; b; run pmkit validate`.
  - Keep unchanged: the `jira` test, the `''`/`'# nothing yet\n'`/`'- local\n'`/`'version: 1\n'` cases with `/pmkit:setup`, and the minimal-file `path: 5` case (its message still names `tracker.path`).

- [ ] **Step 2: Run to verify they fail**

Run: `node --test scripts/config.test.mjs`
Expected: FAIL. The whole file fails to load with `SyntaxError: The requested module './lib/config.mjs' does not provide an export named 'pmkitConfigMessages'` (or one of the other two new names).

- [ ] **Step 3: Implement** in `scripts/lib/config.mjs`.
  - `unsupportedTracker(system)`: return `null` when `system === 'local'` or `!TRACKERS.includes(system)`. Otherwise add `problem: `${message}, set it to local``.
  - `pmkitConfigMessages(parsed)`: `const messages = validatePmkitConfig(parsed)`, append the rule's `problem` when `isObject(parsed) && isObject(parsed.tracker)` and `unsupportedTracker(parsed.tracker.system)` is not `null`. The module's `isObject` is the plain-map guard.
  - `pmkitWriteRefusal(problems)` and `pmkitConfigWarning(problems)` build the exact strings in Global Constraints.
  - `loadConfig`, after `readYaml`: (1) no string `tracker.system`: throw today's error with `details` `{ pmkitConfig: { problems: pmkitConfigMessages(pmkit) } }`. (2) `unsupportedTracker(system)` not `null`: throw `NOT_SUPPORTED` as today. (3) `const problems = pmkitConfigMessages(pmkit)`. (4) `!TRACKERS.includes(system)`, or `tracker.path` set (not `undefined` or `null`) and not a string: throw the blocking `INVALID_INPUT` with `problems`. This replaces the `tracker.path ... folder name such as .issues` throw. (5) Add `pmkitProblems: problems` to each of the three `return` objects.

- [ ] **Step 4: Run to verify they pass**

Run: `node --test scripts/config.test.mjs scripts/validate.test.mjs`
Expected: PASS. `validate.test.mjs` still passes: `unsupportedTrackerMessage` in `validate.mjs` reads only `rule.message`, and a `trello` or `path: 7` error still does not start with `.issues/config.yaml`, so `brokenConfigProblem` rethrows it.

- [ ] **Step 5: Run the whole suite**

Run: `npm test`
Expected: PASS, more than 1044 tests, no golden or scenario differs.

- [ ] **Step 6: Commit**

```bash
git add scripts/lib/config.mjs scripts/config.test.mjs
git commit -m "feat: check every .pmkit/config.yaml rule in loadConfig (PMK-120)" -m "Co-Authored-By: <model> <noreply@anthropic.com>"
```

Complexidade: média

---

### Task 2: The dispatcher refuses writes and warns on reads, and migrate refuses

**Files:**
- Modify: `scripts/pmkit.mjs` (the `init`, `changelog`, `validate` and `cycle capacity` entries of `COMMANDS`; `runMigrate` at line 693; `run()` at line 984; new export `configClass`)
- Test: `scripts/cli.test.mjs`, `scripts/migrations.test.mjs`

**Interfaces:**
- Consumes: `pmkitWriteRefusal(problems)`, `pmkitConfigWarning(problems)` and `loadConfig(...).pmkitProblems` from Task 1.
- Produces: `configClass(command, options): 'exempt' | 'read' | 'write'`, exported from `scripts/pmkit.mjs`, and the `exempt` and `readUnless` fields on `COMMANDS` entries.

- [ ] **Step 1: Write the failing class test** in `scripts/cli.test.mjs`. Import `COMMANDS` and `configClass` from `./pmkit.mjs`. Let `cmd = (name) => COMMANDS.find((c) => c.name === name)`.
  - `configClass sorts every call into exempt, read or write`: `COMMANDS.filter((c) => c.exempt).map((c) => c.name)` deep-equals `['init', 'changelog', 'validate']`. `configClass(cmd('init'), {})`, `configClass(cmd('changelog'), {})` and `configClass(cmd('validate'), {})` are `'exempt'`. `configClass(cmd('issues list'), {})` is `'read'`, `configClass(cmd('issues create'), {})` is `'write'`, `configClass(cmd('migrate'), {})` is `'write'`. `cycle capacity` is `'read'` with `{}`, and `'write'` with `{ set: 'fred=5' }` and with `{ 'days-off': 'fred=2026-10-20' }` (Review Focus 5).

- [ ] **Step 2: Run to verify it fails**

Run: `node --test scripts/cli.test.mjs`
Expected: FAIL. The file fails to load with `SyntaxError: ... does not provide an export named 'configClass'`.

- [ ] **Step 3: Add the fields and `configClass`** in `scripts/pmkit.mjs`. `exempt: true` on `init`, `changelog` and `validate`, and `readUnless: ['set', 'days-off']` on `cycle capacity`. `configClass` returns `'exempt'` for `command.exempt`, `'write'` when `command.write` is true and `command.readUnless` is absent or one of its options is not `undefined` in `options`, and `'read'` otherwise.

- [ ] **Step 4: Run to verify it passes**

Run: `node --test scripts/cli.test.mjs`
Expected: PASS, the whole file.

- [ ] **Step 5: Write the failing behavior tests.** In `scripts/cli.test.mjs`, import `fakeGh` and `ghCalls` from `./fake-gh.mjs` and `hashTree` (already imported). Add these helpers: `editPmkit(root, from, to)` that replaces text in `.pmkit/config.yaml`, `MAYBE = ['confirm: single_writes', 'confirm: maybe']`, `CONFIRM_MSG = 'write_policy.confirm must be one of all_writes, single_writes, none'`, `HOST_MSG = 'git_host.system must be github or none'`, `REFUSAL = (...p) => `.pmkit/config.yaml is not valid, so writes are refused: ${p.join('; ')}``, and `WARNING = (...p) => `warning: ${REFUSAL(...p)}; run pmkit validate``. Body files come from `scripts/__goldens__/_inputs/` (`comment.md`, `update.md`, `doc.md`). Use the existing subprocess `run` and `json` helpers.
  - `every write refuses an invalid .pmkit/config.yaml and writes nothing`: a table `WRITES` keyed by command name, with one argv each on the `team` fixture: `issues create` `['--title', 'Second', '--type', 'task']`, `issues update` `['ISS-5N1R', '--title', 'Renamed']`, `issues move` `['ISS-5N1R', 'done']`, `issues assign` `['ISS-5N1R', 'fred']`, `issues link` `['ISS-5N1R', 'ISS-4M2S', '--kind', 'blocks']`, `issues parent` `['ISS-5N1R', 'EPC-2M9D']`, `issues comment` `['ISS-5N1R', '--body-file', <comment.md>]`, `issues log-time` `['ISS-5N1R', '30']`, `issues archive` `['ISS-5N1R']`, `cycle open` `['--start', '2026-10-26']`, `cycle close` `['2026-10-12']`, `cycle add` `['ISS-5N1R', '--to', 'current']`, `cycle capacity` `['2026-10-12', '--set', 'fred=5']`, `epic create` `['--title', 'New epic']`, `epic update-status` `['EPC-2M9D', '--health', 'on_track', '--body-file', <update.md>]`, `milestone create` `['v2.0']`, `docs create` `['notes/new.md', '--body-file', <doc.md>]`, `issues branch` `['ISS-5N1R']`, `pr open` `['--issue', 'ISS-5N1R']`, `pr ready` `['--issue', 'ISS-5N1R']`, `pr sync` `[]`, `migrate` `[]`. Assert `Object.keys(WRITES).sort()` deep-equals `COMMANDS.filter((c) => c.write).map((c) => c.name).sort()`. Set up one `team` repo with `editPmkit(root, 'system: none', 'system: github\n  default_branch: main')` and `MAYBE`, and `const fake = fakeGh({})` with env `{ PATH: `${fake.dir}${path.delimiter}${process.env.PATH}`, PMKIT_FAKE_GH: fake.responses }`. Take `hashTree(root)` once. For each row, run `[...name.split(' '), ...argv, '--json']` and the same with `--dry-run`. Each run has status 2 and `error` deep-equal to `{ code: 'INVALID_INPUT', message: REFUSAL(CONFIRM_MSG), nextStep: 'pmkit validate' }`, and `hashTree(root)` is unchanged. Also run `cycle capacity 2026-10-12 --days-off fred=2026-10-20 --json` with the same result (Review Focus 5). At the end `ghCalls(fake)` deep-equals `[]`.
  - `issues create with git_host.system gitlab exits 2 and creates no issue`: `team` with `['system: none', 'system: gitlab']`. `issues create --title Second --type task --json` has status 2 and message `REFUSAL(HOST_MSG)`, and the list of `.issues/issues/` is the same before and after.
  - `pr sync refuses an invalid file even when it would move nothing`: `basic` (no issues) with `gitlab`. `pr sync --dry-run --json` has status 2 and `error.message` `REFUSAL(HOST_MSG)`.
  - `a write checks the config before its own flags`: in `tempDir('pmkit-order-')` after `git init -q`, `epic create --json` and `pr open --json` each have status 2 and `error.code` `NOT_CONFIGURED` with `nextStep` `/pmkit:setup`. On a `team` repo with `MAYBE`, `epic create --json` has status 2 and `error.message` `REFUSAL(CONFIRM_MSG)`.
  - `every read goes on with one warning`: a table `READS` with argv on the `team` fixture: `capabilities` `[]`, `discover` `[]`, `whoami` `[]`, `issues list` `[]`, `issues get` `['ISS-5N1R']`, `cycle list` `[]`, `cycle current` `[]`, `cycle issues` `['2026-10-12']`, `cycle capacity` `['2026-10-12']`, `epic list` `[]`, `epic get` `['EPC-2M9D']`, `epic progress` `['EPC-2M9D']`, `epic updates` `['EPC-2M9D']`, `milestone list` `[]`, `milestone get` `['v1.0']`, `docs read` `['missing.md']`, `metrics velocity` `[]`, `metrics cycle-time` `[]`, `events` `[]`, `pr status` `[]`, `reindex` `[]`. Assert `Object.keys(READS).sort()` deep-equals `[...COMMANDS.filter((c) => !c.write && !['init', 'changelog', 'validate'].includes(c.name)).map((c) => c.name), 'cycle capacity'].sort()`. On one `team` repo, run every row with `--json` and record status and stdout, with `generatedAt` removed from `capabilities` output. Then apply `MAYBE` and run every row again. Status and stdout are equal to the first run. In the second run, stderr has exactly one line equal to `WARNING(CONFIRM_MSG)`. In the first run, stderr has none. Running on the same repo before and after the edit keeps root paths equal in error messages. `milestone get`, `docs read` and `pr status` fail in both runs (no milestone, no document, `git_host.system: none`), which also covers the warning on failure.
  - `pr status warns before its own error`: `team` with `gitlab`. `pr status --branch x --json` has status 2, `error.code` `NOT_SUPPORTED` and `error.message` `this repository has no git host configured` on stdout, and stderr equals `WARNING(HOST_MSG) + '\n'`. Without `--json`, the first stderr line is `WARNING(HOST_MSG)` and the second is `error: this repository has no git host configured`.
  - `text mode shows the refusal and the warning` (Review Focus 3): `team` with `MAYBE`. `issues create --title Second --type task` has status 2, stdout `''`, and stderr exactly `` `error: ${REFUSAL(CONFIRM_MSG)}\nnext: pmkit validate\n` ``. `issues list` gives the same stdout as before the edit, and the first stderr line is `WARNING(CONFIRM_MSG)`.
  - `with both config files invalid, a write names .pmkit/config.yaml` (Review Focus 1): `team` with `MAYBE` and `.issues/config.yaml` edited from `default_status: backlog` to `default_status: nope`. `issues create --title Second --type task --dry-run --json` has status 2 and `error.message` `REFUSAL(CONFIRM_MSG)`.
  - `a hand-written .pmkit/config.yaml with only version and tracker` (Review Focus 2): `team`, with `.pmkit/config.yaml` set to `version: 1\ntracker:\n  system: local\n  path: .issues\n`. `issues list --json` has status 0, and stderr has the line `WARNING(HOST_MSG, CONFIRM_MSG)`. `issues create --title Second --type task --dry-run --json` has status 2 and `error.message` `REFUSAL(HOST_MSG, CONFIRM_MSG)`.
  - `the refusal names every bad key, and its next step lists them`: `team` with `['system: none', 'system: gitlab']` and `['confirm: single_writes', 'confirm: sometimes']`. `issues create --title Second --type task --json` has `error.message` `` `.pmkit/config.yaml is not valid, so writes are refused: ${HOST_MSG}; write_policy.confirm must be one of all_writes, single_writes, none` ``. Then `json(root, ['validate'])` succeeds (status 0), and its `problems` at `.pmkit/config.yaml` have the messages `[HOST_MSG, CONFIRM_MSG]`.
  - `an unknown tracker.system refuses reads with INVALID_INPUT`: `basic` with `['system: local', 'system: trello']`. `issues list --json` has status 2, `error` deep-equal to `{ code: 'INVALID_INPUT', message: '.pmkit/config.yaml is not valid: tracker.system must be one of local, linear, jira, github, gitlab, azure-devops', nextStep: 'pmkit validate' }`, and stderr without `warning:`. The existing `linear` CLI test keeps `NOT_SUPPORTED`.
  - `validate and changelog print no warning`: `team` with `MAYBE`. `validate` and `validate --json` have status 0, list `CONFIRM_MSG`, and their stderr does not match `/^warning: \.pmkit/m`. `changelog --file <this repo's CHANGELOG.md> --since 0.1.0` has status 0 and the same stderr check.

  In `scripts/migrations.test.mjs`, add `migrate refuses an invalid .pmkit/config.yaml before every other check`. Define `gitlab(root)` that edits `system: none` to `system: gitlab` in `.pmkit/config.yaml`. For each of three repos, run `runMigrate(root)` and `runMigrate(root, { dryRun: true })`. Each throws with `code` `INVALID_INPUT`, `message` `.pmkit/config.yaml is not valid, so writes are refused: git_host.system must be github or none` and `nextStep` `pmkit validate`, and `hashTree(root)` is the same before and after. The repos: `gitRepo().root` (format 1, in git), `makeRepo('team')` (format 2, where today the result is "nothing to migrate") and `setup().root` (format 1, not in git, where today the error is `NOT_CONFIGURED`). Apply `gitlab(root)` before taking the hash.

- [ ] **Step 6: Run to verify they fail for the stated reasons**

Run: `node --test scripts/cli.test.mjs scripts/migrations.test.mjs`
Expected: these FAIL. The write table fails on the first row because `issues create` exits 0. The reproduction and the hand-written-file test fail because `issues create` writes or previews with exit 0. `pr sync` fails because the dry run exits 0. The error-order test fails because `epic create` gives `INVALID_INPUT` `epic create needs --title`. The read table, `pr status`, text-mode and hand-written tests fail because stderr has no warning. The both-files test fails because the message is `the tracker config is not valid, so writes are refused: default_status must be a status`. `the refusal names every bad key` fails because `issues create` exits 0. The `migrate` test fails because `runMigrate` returns a result or throws another error. These already PASS and must keep passing: `an unknown tracker.system refuses reads` (Task 1 did it) and `validate and changelog print no warning`.

- [ ] **Step 7: Implement** in `scripts/pmkit.mjs`.
  - `runMigrate`: right after `const config = loadConfig(root, { checkFormat: false })`, throw `pmkitWriteRefusal(config.pmkitProblems)` when the list is not empty. This comes before `formatState`, the `ahead` refusal, the "nothing to migrate" return and the git checks.
  - `run()`: declare `let loaded` and `let kind` above the `try`, so the `catch` sees them. After building `ctx`, set `kind = configClass(command, options)`. When `kind === 'write'` and `command.name !== 'migrate'`, call `ctx.config()` and throw `pmkitWriteRefusal(problems)` when `pmkitProblems` is not empty. `migrate` is skipped because `ctx.config()` loads with `checkFormat: true`, which would replace its own format errors.
  - The warning: when `kind === 'read'` and `loaded?.pmkitProblems.length > 0`, push `` `warning: ${pmkitConfigWarning(loaded.pmkitProblems)}\n` `` to stderr. On success, push it before the `result.warnings` loop. In the `catch`, push it first, before any branch pushes an `error:` line or the JSON body.
  - Read commands do not call `ctx.config()` from the dispatcher. They load it through `ctx.config()`, `ctx.tracker()` or `ctx.host()`, so their error order stays as today.

- [ ] **Step 8: Run to verify they pass**

Run: `node --test scripts/cli.test.mjs scripts/migrations.test.mjs scripts/cli-pr.test.mjs scripts/cli-autocommit.test.mjs scripts/cli-init.test.mjs`
Expected: PASS.

- [ ] **Step 9: Run the whole suite**

Run: `npm test`
Expected: PASS, no golden or scenario differs. A golden diff here most likely means the warning or the refusal fires on a valid fixture. Follow the golden rule in Global Constraints.

- [ ] **Step 10: Commit**

```bash
git add scripts/pmkit.mjs scripts/cli.test.mjs scripts/migrations.test.mjs
git commit -m "feat: refuse writes and warn on reads with an invalid .pmkit/config.yaml (PMK-120)" -m "Co-Authored-By: <model> <noreply@anthropic.com>"
```

Complexidade: alta

---

### Task 3: validate uses the shared rules and lists each problem once, and init still repairs

**Files:**
- Modify: `scripts/lib/validate.mjs` (import at line 5, comment and `brokenConfigProblem` at lines 69 to 94, remove `isMap` and `unsupportedTrackerMessage` at lines 100 to 108, `pmkitConfigProblems` at line 111)
- Test: `scripts/validate.test.mjs`, `scripts/cli-init.test.mjs`

**Interfaces:**
- Consumes: `pmkitConfigMessages(parsed)`, `unsupportedTracker(system)` and the `details.pmkitConfig` errors of `loadConfig` from Task 1, and the write refusal from Task 2.
- Produces: nothing for later tasks.

- [ ] **Step 1: Write the failing tests.** In `scripts/validate.test.mjs`, import `pmkitConfigMessages` from `./lib/config.mjs` and `parseYaml` from `./lib/yaml.mjs`. Let `TRACKER_MSG = 'tracker.system must be one of local, linear, jira, github, gitlab, azure-devops'`.
  - `a bad git_host still checks the whole tracker`: `makeRepo('team')` with `editPmkit(root, 'system: none', 'system: gitlab')`. `validateRepo(root)` has a problem `{ path: '.pmkit/config.yaml', code: 'config', message: 'git_host.system must be github or none' }`, and `checked.issues` is above 0.
  - `trello with tracker.path .pmkit is listed once`: `makeRepo('basic')`, `editPmkit(root, 'system: local', 'system: trello')`, `editPmkit(root, 'path: .issues', 'path: .pmkit')`. `messages(validateRepo(root))` deep-equals `[TRACKER_MSG]`.
  - `no tracker.system with tracker.path .pmkit is listed once`: `makeRepo('basic')`, `editPmkit(root, 'tracker:\n  system: local\n  path: .issues\n', 'tracker:\n  path: .pmkit\n')`. `messages(validateRepo(root))` deep-equals `[TRACKER_MSG]`, so no `.pmkit/config.yaml has no tracker.system` problem.
  - `validate and loadConfig share one rule list`: `makeRepo('basic')` with `linear` and `breakPmkit`. The messages at `.pmkit/config.yaml` deep-equal `pmkitConfigMessages(parseYaml(<file text>))`. The last one equals `unsupportedTracker('linear').problem`.

  In `scripts/cli-init.test.mjs`, add `init --update --git-host github repairs a bad git_host and writes go through again`. In `tmp()`, run `init --member fred --name Fred --email f@x.dev` (a bare `init` has no members, so `issues create` would fail with `NOT_CONFIGURED` for the actor). Then break `git_host.system` to `gitlab` the way `bad(dir)` does. `issues create --title X --type task --dry-run --json` has status 2 and an `error.message` that starts with `.pmkit/config.yaml is not valid, so writes are refused`. `init --update --git-host github --dry-run --json` has status 0, and its `files` entry for `.pmkit/config.yaml` has `action` `change`. `init --update --git-host github --json` has status 0, and `parseYaml(read(dir, '.pmkit/config.yaml')).git_host.system` is `github`. Then `issues create --title X --type task --dry-run --json` has status 0 and stderr without `warning:`. The existing `init --update` refusal tests stay.

- [ ] **Step 2: Run to verify they fail for the stated reasons**

Run: `node --test scripts/validate.test.mjs scripts/cli-init.test.mjs`, then `grep -n "set it to local" scripts/lib/validate.mjs`
Expected: the two `.pmkit` path tests FAIL with a second problem. For `trello` it is the blocking message `.pmkit/config.yaml is not valid: ...`, and for no `system` it is `.pmkit/config.yaml has no tracker.system`. `brokenConfigProblem` matches both on the `.pmkit/config.yaml` label. The `grep` prints line 107. These already PASS as guards: the `git_host` test, the one-rule-list test, and the `cli-init` repair test (Task 2 added the refusal).

- [ ] **Step 3: Implement** in `scripts/lib/validate.mjs`.
  - Import `{ loadConfig, pmkitConfigMessages, validateLocalConfig }` from `./config.mjs`. `TRACKERS`, `unsupportedTracker` and `validatePmkitConfig` are no longer used here.
  - Delete `isMap` and `unsupportedTrackerMessage`. In `pmkitConfigProblems`, `const messages = pmkitConfigMessages(parsed)`.
  - In `brokenConfigProblem`, after the first-line rethrow and before the `try` that parses `.pmkit/config.yaml`, add `if (error?.details?.pmkitConfig !== undefined) throw error`. This keeps the order `format`, `migration`, `pmkitConfig`.
  - Rewrite the comment above `brokenConfigProblem`: errors from `.pmkit/config.yaml` are rethrown, either because they are not `INVALID_INPUT` or because they carry `details.pmkitConfig`, and `pmkitConfigProblems` lists them.

- [ ] **Step 4: Run to verify they pass**

Run: `node --test scripts/validate.test.mjs scripts/cli-init.test.mjs scripts/cli.test.mjs`, then `grep -n "set it to local" scripts/lib/validate.mjs`
Expected: PASS, and the `grep` prints nothing (exit 1). Every PMK-112 and PMK-119 test in `validate.test.mjs` passes unchanged.

- [ ] **Step 5: Run the whole suite**

Run: `npm test`
Expected: PASS, no golden or scenario differs.

- [ ] **Step 6: Commit**

```bash
git add scripts/lib/validate.mjs scripts/validate.test.mjs scripts/cli-init.test.mjs
git commit -m "fix: list each .pmkit/config.yaml problem once in validate (PMK-120)" -m "Co-Authored-By: <model> <noreply@anthropic.com>"
```

Complexidade: média

---

### Task 4: Command texts, conventions, README and design spec

**Files:**
- Modify: `commands/report/status.md:19`, `commands/team/standup.md:20`, `commands/cycle/close.md:19`, `commands/issues/mine.md:19`, `skills/pmkit/references/conventions.md:31` (new bullet after it), `README.md:94`, `docs/superpowers/specs/2026-10-23-pmkit-design.md:128`

**Interfaces:**
- Consumes: the refusal message prefix `.pmkit/config.yaml is not valid` and the warning text from Tasks 1 and 2.
- Produces: nothing.

- [ ] **Step 1: Run the static checks to verify they fail**

```bash
cd /home/fred/projects/pmkit
grep -cF 'When it fails with `INVALID_INPUT` and `error.message` starts with `.pmkit/config.yaml is not valid`, say in one line that `.pmkit/config.yaml` is not valid, so the sync is skipped, and go on with step 2.' commands/report/status.md commands/team/standup.md commands/cycle/close.md
grep -cF 'When the call fails with `INVALID_INPUT` and `error.message` starts with `.pmkit/config.yaml is not valid`, say in one line' commands/issues/mine.md
grep -cF 'Steps 2 to 6 only read and still run. The writes from step 7 on fail with the same error' commands/cycle/close.md
grep -cF '- An error whose `error.message` starts with `.pmkit/config.yaml is not valid` comes from a broken config file' skills/pmkit/references/conventions.md
grep -cF 'A missing or invalid `git_host` makes `.pmkit/config.yaml` invalid.' README.md
grep -cF 'and an unknown one with `INVALID_INPUT`. With any other problem in the file, reads go on with a warning and writes refuse.' docs/superpowers/specs/2026-10-23-pmkit-design.md
```

Expected: every count is `0`.

- [ ] **Step 2: Replace the texts** with the exact texts in Global Constraints. Replace the whole step 1 line in each command file. Insert the conventions bullet as a new line right after line 31. In `README.md` line 94, replace only the first two sentences. In the design spec, replace the one sentence on line 128 with the two sentences.

- [ ] **Step 3: Run the static checks to verify they pass**

Run the six commands of Step 1, then `git diff --numstat`.
Expected: every count is `1`. `git diff --numstat` shows `1 1` for each command file, `README.md` and the design spec, and `1 0` for `conventions.md`.

- [ ] **Step 4: Run the focused and whole suite**

Run: `node --test scripts/plugin.test.mjs scripts/scenarios.test.mjs`, then `npm test`
Expected: PASS. `plugin.test.mjs` still finds the sections in order and every `pmkit.mjs` call names a CLI command. No scenario or golden differs.

- [ ] **Step 5: Commit**

```bash
git add commands/report/status.md commands/team/standup.md commands/cycle/close.md commands/issues/mine.md skills/pmkit/references/conventions.md README.md docs/superpowers/specs/2026-10-23-pmkit-design.md
git commit -m "docs: handle the .pmkit/config.yaml write refusal in commands and docs (PMK-120)" -m "Co-Authored-By: <model> <noreply@anthropic.com>"
```

Complexidade: baixa

---

## Final check

- [ ] `npm test` passes with more than 1044 tests.
- [ ] `git diff --stat main -- scripts/__goldens__ scripts/__scenarios__ scripts/__fixtures__ schemas templates CHANGELOG.md scripts/lib/local/tracker.mjs commands/local commands/setup.md commands/upgrade.md` prints nothing.
- [ ] `git log --format=%s main..HEAD` shows every subject ending with `(PMK-120)`.

## Self-review

- Spec coverage. Criterion 1: Task 1 (one rule list, `pmkitProblems`, blocking errors) and Task 2 (write table, read table, reproduction, `pr sync`, error order, `migrate`). Criterion 2: Task 3 (`validate` lists once and still checks the tracker, `init --update` repairs) and Task 2 (`validate` and `changelog` print no warning). Criterion 3: Task 2 (exit 2, file and key in the message, two keys, `validate` as the next step works, blocking `trello`). Criterion 4: Task 1 and Task 3 (`pmkitConfigMessages` in both callers, the `grep` for `set it to local`), the class tables in Task 2, and `npm test` in every task. The four command texts, the conventions bullet, the README line and the design spec sentence are in Task 4.
- Names match across tasks: `unsupportedTracker`, `pmkitConfigMessages`, `pmkitWriteRefusal`, `pmkitConfigWarning`, `pmkitProblems`, `configClass`, `exempt`, `readUnless`.
- Choices the spec left to the builder: the `cycle capacity` case is a `readUnless` field, the exempt commands carry `exempt: true`, and the read table compares runs on the same repo before and after the edit, not on a second copy, so root paths in error messages match.
- Every commit keeps `npm test` green. After Task 1 the CLI still lets writes through, as on `main`, and `validate` output does not change. Task 2 adds the refusal, and Task 3 removes the duplicate problems.
