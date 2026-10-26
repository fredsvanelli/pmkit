# PMK-118: give the migration failure a source so validate lists it

## Problem

When a migration step throws, `planMigration` in `scripts/lib/local/migrations.mjs` (line 85) throws `INVALID_INPUT`, message `migration X to Y failed: <cause>`, next step `pmkit validate`. The error has no `details` and its message does not start with the tracker file label. `brokenConfigProblem` in `scripts/lib/validate.mjs` turns a `loadConfig` error into a problem only when it has `details.format`, or when it is `INVALID_INPUT` and its message starts with `<trackerPath>/config.yaml`. This error has neither, so `validateRepo` rethrows it. The next step then sends the user to a command that throws the same error.

The built-in 1 to 2 step does nothing, so no real tracker reaches this today. The first migration that can fail will.

Acceptance criteria:

1. When a migration step fails, `validate` lists the failure as a problem at the tracker's `config.yaml`, with the step and the cause, instead of rethrowing the error.
2. The command that hits the failure still exits 2 with `INVALID_INPUT`, and its next step points to something that works.
3. A test with a failing migration step proves both, and `npm test` passes.

## Reproduced behavior

Scratch scripts outside the repo (`/tmp/claude-1000/-home-fred-projects-pmkit/8e89dc6e-0858-4f92-ab5c-b6cee20c5dc2/scratchpad/repro118.mjs` and `repro118b.mjs`) build the `basic` fixture at format 1 in a git repo. The first passes `migrations: [bad]` to the library, where `bad` is `{ from: 1, to: 2, describe: 'bad', run() { throw new Error('bad event') } }`. The second replaces `MIGRATIONS[0].run` with a throw inside its own process and calls the exported `run()`, so it shows the CLI view. Neither touches the repo's `.issues/`.

| Call | Today |
|---|---|
| `loadConfig(root, { migrations: [bad] })` | throws `INVALID_INPUT`, `migration 1 to 2 failed: bad event`, next step `pmkit validate`, `details` undefined |
| `runMigrate(root, { migrations: [bad] })`, also with `dryRun` | the same error |
| `validateRepo(root, { migrations: [bad] })` | the option is ignored (`validateRepo` forwards no `migrations`) and it returns the `FORMAT` problem of the working built-in step |
| `validateRepo(root)` with the built-in step made to throw | throws the same `INVALID_INPUT` instead of returning problems |
| CLI `validate`, `migrate`, `migrate --dry-run`, `issues list` with that step | each exits 2 with `{ error: { code: 'INVALID_INPUT', message: 'migration 1 to 2 failed: bad event', nextStep: 'pmkit validate' } }` |
| files under the repo after each call | unchanged (`hashTree` equal) |

So the loop is real. `pmkit validate`, the next step of every other failing call, fails with the error it points away from.

The issue says `upgrade`. The slash command `/pmkit:upgrade` updates the plugin and then runs the CLI command `pmkit migrate`. The CLI has no `upgrade` command, so this spec says `migrate`.

## Callers and what each should do

- `validate` lists the failure as a problem and exits 0, like every other problem.
- `migrate` and `migrate --dry-run` throw the error. They exit 2 with `INVALID_INPUT`.
- Every command that reads an older-format tracker (`issues list`, `issues get`, and the rest, through `loadConfig`) throws the same error and exits 2 with `INVALID_INPUT`.

The next step for the last two stays `pmkit validate`. After this change that command works and prints the problem with the step and the cause. It is the form the codebase already uses for next steps that name a CLI command (`scripts/lib/local/tracker.mjs` line 142 uses the same text). The cause is in the error message, so the user does not need a second hop. No other next step fits. `/pmkit:upgrade` and `migrate` run the failing step again, and `/pmkit:local:doctor` has no branch for this problem code, so it shows the problem and gives no manual step (see decision 2 and the follow-ups).

## Approaches

A. Give the error `details: { migration: { from, to } }`, and make `brokenConfigProblem` list any error that carries `details.migration`, like it does for `details.format`. Chosen.

B. Start the message with the tracker file label, `.issues/config.yaml: migration 1 to 2 failed: ...`, so the existing prefix rule matches. Rejected for three reasons.
- The problem would get the code `config`, and `doctor` tells the user to correct a setting in `config.yaml`. The failing step usually reads event or issue files, so that advice is wrong.
- The path would appear twice in the `validate` text, once as the path column and once in the message.
- The rule would rest on a message prefix. The version below 1 error already does that. A second case makes the string check carry more meaning than it can bear.

C. Let `validateRepo` catch every `INVALID_INPUT` from `loadConfig` and list it at the tracker config. Rejected. It lists errors from other sources (a bad `tracker.path`, a bad `.pmkit/config.yaml`) at the wrong file, and PMK-112 chose to rethrow those on purpose.

D. Put a ready-made problem record in the error, such as `details: { problem: { code, message } }`, so any caller can list any error. Rejected. Nothing else needs it today, and PMK-120 will decide how `loadConfig` reports `.pmkit/config.yaml` problems. A key per kind (`format`, `migration`) matches the existing code and is easy to merge into one rule later.

A is also the smallest change. It adds one argument to one constructor call and one condition to one function.

## The exact records

The error thrown at `migrations.mjs` line 85:

```js
new PmkitError(
  'INVALID_INPUT',
  `migration ${step.from} to ${step.to} failed: ${error.message}`,
  'pmkit validate',
  { migration: { from: step.from, to: step.to } },
)
```

Code, message and next step do not change. Only `details` is new, so the existing test that pins the three keeps passing.

The problem record `validate` lists:

```js
{ path: '.issues/config.yaml', code: 'migration', message: 'migration 1 to 2 failed: bad event' }
```

- `path` is `<trackerPath>/config.yaml` relative to the root, built the same way as `formatProblem` and `brokenConfigProblem` build it. A custom `tracker.path` changes it.
- `code` is `migration`, lowercase like `config` and `conflict`. `FORMAT` stays reserved for a format that is behind or ahead, because `doctor` answers `FORMAT` by running `migrate`, which would fail again.
- `message` is the error message as thrown. It holds the step (`1 to 2`) and the cause. The message has no "run X" tail, unlike `formatProblem`, because no command fixes the cause. The user fixes the data the step names.

`validateRepo` returns `{ checked: noneChecked(), problems }` for this case, with the `.pmkit/config.yaml` problems merged and sorted as for any broken config. No file is checked, because the other checks assume the current format.

Code changes (for the plan, not done here):

1. `migrations.mjs`: add `details` to the thrown error.
2. `validate.mjs`: in `brokenConfigProblem`, add the `migration` condition (`error?.details?.migration !== undefined`) to the label-prefix check, the one guard that rethrows an `INVALID_INPUT` whose message lacks the tracker file label. The first guard (`code !== 'INVALID_INPUT' && !format`) needs no change, because the migration error is already `INVALID_INPUT`. Return the record above, with code `migration`, after the `format` return. Update the comment above the function.
3. `validate.mjs`: `validateRepo(root, { config, migrations } = {})` forwards `migrations` to `loadConfig(root, { migrations })`.

## How a test injects a failing step

The built-in `MIGRATIONS` stays untouched. `loadConfig`, `runMigrate` and `planMigration` already take a `migrations` list (ADR 0004 says so for this purpose), and the tests in `scripts/migrations.test.mjs` use it. `validateRepo` is the one entry point without it, so it gets the same optional argument. The cost is one destructured option and one forwarded argument. Production callers pass nothing and get the built-in list.

Rejected hooks:

- A `migrations` option on `run(argv, ...)` in `pmkit.mjs`. It would have to reach `ctx.config()`, the `validate` command and the `migrate` command, to let one test spawn the whole CLI. That is three edits in the dispatcher for one test.
- An environment variable that swaps the list. Production code would read a test switch.
- Mutating `MIGRATIONS[0].run` in the test and restoring it. It changes the built-in list for the whole file while the test runs.

None of these is needed to cover the CLI. `run(argv, { env, cwd })` is exported from `scripts/pmkit.mjs` and returns `{ code, stdout, stderr }`, and the file starts the CLI only when it is the entry script. A spawned child can import `MIGRATIONS` and `run`, replace `MIGRATIONS[0].run` with a throw inside its own process, and call `run()`. The parent process and its built-in list stay untouched. The test near `scripts/migrations.test.mjs:171` (`the migrated copy is removed when the process exits`) already uses this shape: `spawnSync(process.execPath, ['--input-type=module', '-e', script])`. So one test drives the real `validate` and `issues list` commands with a failing step and needs no production hook. It also exercises the default `migrations` argument that the library tests skip.

## No partial write

`migrate` calls `planMigration` first. It runs every step on a temporary copy and throws on the first failure. `applyMigration` runs only after `planMigration` returns, so a failing step, even a later one, writes nothing to the tracker folder. Dry run never writes. The code is correct today. A search of `scripts/migrations.test.mjs` finds no test that proves it for a failing step. The existing `planMigration turns a throwing step into INVALID_INPUT` test checks the error only, and the `migrate refuses ...` tests check the git and CONFLICT refusals.

A test fills that gap with a two-step chain, where step 1 changes the copy and step 2 throws.

## Assertions per criterion

All tests go in `scripts/migrations.test.mjs`. They use the `setup()` repo (format 1) and the existing helpers. `bad` is `{ from: 1, to: 2, describe: 'bad', run() { throw new Error('bad event') } }`.

Criterion 1, `validate` lists it:

- `validateRepo(root, { migrations: [bad] })` does not throw.
- Its `problems` deep-equal `[{ path: '.issues/config.yaml', code: 'migration', message: 'migration 1 to 2 failed: bad event' }]`.
- Its `checked` deep-equals zero for every count.
- A second case with `tracker.path` set to another folder: the problem `path` follows it. Fixture setup copies the `gitRepo({ trackerPath })` rename already in this file.
- The rule stays narrow. The existing `validate.test.mjs` cases that expect a rethrown error (a bad `tracker.path`, an unsupported `tracker.system`) must keep passing. They need no new case.

Criterion 2, the command still fails and its next step works:

- `loadConfig(root, { migrations: [bad] })` throws an error with `code === 'INVALID_INPUT'`, `nextStep === 'pmkit validate'`, and `details` deep-equal `{ migration: { from: 1, to: 2 } }`.
- `runMigrate(root, { migrations: [bad] })` and the same with `dryRun: true` throw the same code, message and next step.
- In the same test, `validateRepo(root, { migrations: [bad] })` returns the problem instead of throwing. This pair proves the next step works, because it runs the command the error names against the same repo and the same list.
- A spawned-child CLI test, `the CLI lists a failing migration step as a problem and exits 2 on reads`. It uses the `setup()` repo (format 1). The child script imports `MIGRATIONS` from `scripts/lib/local/migrations.mjs` and `run` from `scripts/pmkit.mjs`, sets `MIGRATIONS[0].run = () => { throw new Error('bad event') }`, calls `run(['issues', 'list', '--json'], { cwd, env })` and `run(['validate', '--json'], { cwd, env })`, and prints both results as JSON. The parent asserts:
  - `issues list` has `code` 2 and an error body with `code: 'INVALID_INPUT'`, `message: 'migration 1 to 2 failed: bad event'` and `nextStep: 'pmkit validate'`.
  - `validate` has `code` 0 and `problems` deep-equal to `[{ path: '.issues/config.yaml', code: 'migration', message: 'migration 1 to 2 failed: bad event' }]`.
  - `hashTree(root)` is the same before and after.

  The child sets the environment the `cli()` helper sets (`PMKIT_USER`, `PMKIT_NOW`, `PMKIT_SEED`, no global git config). This test is the one that proves exit 2 with `INVALID_INPUT` and the working next step for the real CLI. The library assertions above stay, because they name the failing call precisely.
- Extend the existing test `planMigration turns a throwing step into INVALID_INPUT` (`scripts/migrations.test.mjs:221`). It asserts `code`, `message` and `nextStep` today. Add an assertion that `error.details` deep-equals `{ migration: { from: 1, to: 2 } }`. This is an edit to that test, not a new one.

No partial write (from the task, not a criterion):

- In a git repo from `gitRepo()`, run `runMigrate(root, { formatVersion: 3, migrations: [renameLogTime, step23] })` where `step23` is `{ from: 2, to: 3, describe: 'bad', run() { throw new Error('boom') } }`. It throws with message `migration 2 to 3 failed: boom` and `details.migration` equal to `{ from: 2, to: 3 }`.
- `hashTree(dir)` equals its value from before the call, `.issues/config.yaml` still has `version: 1`, and `git status --porcelain` is empty and `git log` still shows only `initial`.

Criterion 3: `node --test scripts/migrations.test.mjs` passes, then `npm test` passes with the count at its current value plus the new tests (the extended `planMigration` test adds none). The new tests fail before the code change: the `details`, `validateRepo` and `migrations` assertions fail on today's code (run them first, as the TDD step does).

## Decisões

1. **The error carries `details.migration`, not a label prefix.** It keeps the message and code, gives `validate` a typed key to test, and gives the problem its own code. A prefix would label the failure `config` and send `doctor` to the wrong advice.
2. **The problem code is `migration`.** `FORMAT` makes `doctor` run `migrate`, which fails again. A new lowercase code avoids that loop. Doctor shows a `migration` problem (step 1 groups and shows every code) and proposes no fix (step 4 skips problems with no CLI fix). Its step 5 has no manual step to give for it, and its step 6 `reindex` fails with the same error, which the command text says to report and go on from. Nothing tries a wrong fix. I checked that no list in `commands/`, `skills/`, `CONTEXT.md`, the design spec, the ADRs, `schemas/` or the tests pins the set of problem codes, so a new code breaks nothing. A `migration` branch in doctor is a follow-up.
3. **The problem message is the error message, with no "run X" tail.** The step and the cause are what criterion 1 asks for, and no command repairs the cause.
4. **The next step stays `pmkit validate`.** It becomes true with this change, it matches the form other errors use, and the cause is already in the error, so the user needs no second hop.
5. **Every caller keeps its behavior except the error's source.** `migrate` and the read commands still throw `INVALID_INPUT` and exit 2, as the scope guard says. Only `validate` changes, from rethrow to a listed problem.
6. **`validateRepo` takes a `migrations` option, and there is no CLI hook.** It matches the seam `loadConfig`, `runMigrate` and `planMigration` already have, per ADR 0004. A hook on `run()` costs three edits for one test. A spawned child covers the real CLI without a hook: it replaces `MIGRATIONS[0].run` in its own process and calls the exported `run()`, as the test near `migrations.test.mjs:171` does for `migratedCopy`.
7. **No code change for "no partial write", only a test.** The order in `runMigrate` (plan everything, then apply) already guarantees it. The missing proof is the gap.
8. **A step that fails reports one problem and skips every other check.** This matches the `FORMAT` problem. The other checks assume the current shape, and the copy never finished migrating.
9. **The text says `migrate`, not `upgrade`.** `upgrade` is a slash command with no CLI counterpart. `CONTEXT.md` asks to keep the two apart.

## Risks and non-goals

- No new migration, no change to the built-in 1 to 2 step, and no change to `FORMAT_VERSION`.
- No change to command files, schemas or goldens. No golden prints this problem, because no built-in step fails.
- The `.cache` exclusion and the temporary copy cleanup in `planMigration` do not change.
- PMK-120 will make `loadConfig` check `.pmkit/config.yaml` for every command. A `details` key per error kind composes with that. The `migration` rule is independent of the `.pmkit/config.yaml` rules.

## Follow-up candidates

1. A `migration` branch in `/pmkit:local:doctor`. Steps 3 and 5 have none, so the user gets the problem and no manual step. The branch would show the message, name the step, and tell the user to fix the data the step reads or report the bug. This is a command file change, so it waits for its own issue. Open question for that issue: whether the `migration` problem should repeat the cause when `issues list` already shows it in the error. This spec repeats it, because `validate` is where the user lands and decision 4 accepts that single hop.
2. `chain()` throws `NOT_SUPPORTED` with no `details` when a tracker is behind and this pmkit has no migration path. `validateRepo` rethrows that too. It has the same shape of bug and also has no reachable case today. A second issue can list it as a `FORMAT`-like problem.
3. `planMigration` writes `config.yaml` with `setScalar` outside the `try`. A throw there is an unwrapped error with no code. It is unreachable while the file parses, since `loadConfig` has already parsed it.
4. The `pmkit validate` next step is not a runnable command string for an agent (the CLI is `node "${CLAUDE_PLUGIN_ROOT}/scripts/pmkit.mjs" validate`). All next steps that name the CLI use the short form. One issue could decide a common form for them.
5. When PMK-120 moves `.pmkit/config.yaml` checks into `loadConfig`, fold the `format`, `migration` and config rules in `brokenConfigProblem` into one table.
