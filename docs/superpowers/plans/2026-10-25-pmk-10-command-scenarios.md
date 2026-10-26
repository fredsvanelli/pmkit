# PMK-10 Command Scenarios Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give each of the 24 command files under `commands/**` a scripted scenario that runs its sequence of CLI calls on a fresh fixture copy, checks the files the run leaves and checks that every write sits behind a declared confirmation point.

**Architecture:** One data module per command file in `scripts/__scenarios__/`. `scripts/scenario-helpers.mjs` parses each command file into calls and confirmation points, runs a scenario as child processes, applies the rules and builds a snapshot. `scripts/scenarios.test.mjs` is the required, offline suite. An opt-in live suite, `scripts/scenarios-live.mjs`, comes last and depends on a spike.

**Tech Stack:** Node 18+ ES modules, `node:test`, `node:assert/strict`, `node:child_process`, `node:fs`. No dependencies (ADR-0003).

**Spec:** `docs/superpowers/specs/2026-10-25-pmk-10-command-scenarios-design.md`. Read it whole before any task. Also read `CONTEXT.md`, `docs/adr/0002-commands-are-the-source-for-every-agent.md`, `docs/adr/0003-no-dependencies.md` and `skills/pmkit/references/conventions.md`.

## Global Constraints

**Process**
- Issue PMK-10 (epic EPC-1). Every commit message carries `(PMK-10)`, for example `test: add scenario parser (PMK-10)`.
- Every commit ends with the trailer `Co-Authored-By: Claude <model of the implementer> <noreply@anthropic.com>`, naming the model that made that commit, for example `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`.
- Do not switch branches, push, edit anything under `.issues/` by hand or create issues with the CLI. Do not edit `CHANGELOG.md`, `package.json`, `scripts/pmkit.mjs`, `scripts/__fixtures__/**` or `scripts/__goldens__/**`.
- Code, comments and commits are in English. Tests first: write the failing test, watch it fail, then write the code. Run one file with `node --test scripts/<file>.test.mjs` and the whole suite with `npm test`.
- Every test that creates a temporary folder removes it in `finally` (`fs.rmSync(dir, { recursive: true, force: true })`).
- `npm test` took 5.6 s on 2026-10-25 before this work. Report the time after Task 8. The scenario tests run inside `describe('scenarios', { concurrency: Math.max(2, os.cpus().length) }, ...)`.
- Goldens: no task here changes CLI output, so `node --test scripts/goldens.test.mjs` must pass unchanged after every task. If one fails, find the cause; do not regenerate. A regeneration (`UPDATE_GOLDENS=1 node --test scripts/goldens.test.mjs`) is allowed only for an intended CLI output change, and the task report says why.

**What a scenario finds, and where it goes**
- A text divergence between a command file and the CLI (a wrong flag, a confirmation point written as a paragraph, a step that names the wrong subcommand) is fixed in the command file within the task that finds it. The task report lists it under "Command file fixes", one line per file, for the PR body. `node --test scripts/plugin.test.mjs` must still pass after the edit.
- A missing CLI behavior is not fixed. The scenario records it as a `skip` or `notHit` reason that names the gap, and the task report lists it under "Follow-ups" for the PR body. No issue is created.

**Paths**
- `scripts/__scenarios__/<name>.mjs`: one scenario module per command file. `<name>` is the path under `commands/` without `.md`, `/` turned into `-`: `issues/create` gives `issues-create`, `help` gives `help`.
- `scripts/__scenarios__/<name>.after.txt`, or `<name>.<index>.after.txt` when the module exports an array: the snapshot.
- `scripts/__scenarios__/_inputs/`: body files passed by absolute path (`description.md`, `criteria.md`, `comment.md`, `plan.md`, `summary.md`, `pr-body.md`, `status-update.md`, `retro.md`, and `CHANGELOG.md`, a frozen copy of `scripts/__goldens__/_inputs/CHANGELOG.md`). Add a file when a scenario needs it.
- `scripts/scenario-helpers.mjs` and `scripts/scenario-helpers.test.mjs`: parser, rules, runner, snapshot, and their unit tests.
- `scripts/scenarios.test.mjs`: the required suite. `scripts/scenarios-live.mjs`: the opt-in live suite (its name does not end in `.test.mjs`).
- `scripts/fake-gh.mjs`: the fake `gh` and the bare-remote helper, moved from `scripts/cli-pr.test.mjs`.
- Fixtures: `scripts/__fixtures__/{basic,team,messy-merge,no-sprints}`, used as they are.

**Scenario module format.** A module's default export is one scenario object, or an array of them when one command needs two paths.

```js
export default {
  command: 'issues/move',            // path under commands/ without .md
  fixture: 'team',                   // fixture folder name, or null for an empty folder
  git: false,                        // optional: git init -b main and one initial commit
  github: false,                     // optional: implies git; bare origin, git_host github, fake gh
  gh: {},                            // optional, with github: { '<gh args joined by a space>': { stdout, stderr, status } }
  async setup({ root, pmkit, git }) {},  // optional: prepares the copy before the baseline
  prompt: '/pmkit:issues:move ISS-2X6D done',  // live suite only
  answers: ['Yes'],                  // live suite only
  steps: [
    { step: '1', read: ['issues', 'get', 'ISS-2X6D'] },
    { step: '4', dryRun: ['issues', 'move', 'ISS-2X6D', 'done'] },
    { confirm: 'Step 5' },
    { step: '4', write: ['issues', 'move', 'ISS-2X6D', 'done'] },
  ],
  skip: { '3 discover': 'done has one status in team, so step 3 does not ask' },
  notHit: {},
  expect(repo) { /* 2 or 3 assertions */ },
}
```

- Entry kinds: `read`, `dryRun`, `write` (each with `step` and `args`), `confirm` (a confirmation key), `edit: { file, content }` (only `local/doctor` step 2.4), `git: args` (runs `git` in the copy; drift checks ignore it).
- `args` never contains `--json` or `--dry-run`. The runner appends `--json` to a read or write and `--dry-run --json` to a dry run.
- `args` may be a function of the saved results, `(saved) => [...]`. Any entry may add `save: '<name>'` (keeps the parsed JSON stdout under that name), `stdin: '<text>'` (for `--body-file -` and `--members-file -`) and `expectError: '<CODE>'` (the run must exit non-zero with `error.code` equal to it).
- A `write` that repeats a dry run ("run the same command without `--dry-run`") carries the `step` of the dry run's call. A `write` of a call that the command file writes without `--dry-run` in its own step (for example `cycle close <id> --json` in step 8 of `cycle/close`) carries that step.
- `skip` keys are `'<step id> <cli command>'`, for example `'First run 9 validate'` or `'missing issues update'`. `notHit` keys are confirmation keys. Every value is a non-empty reason.
- `setup` receives `root` (the copy), `pmkit(args, { stdin })` (runs the CLI with the scenario environment, appends `--json`, returns the parsed JSON, throws on a non-zero exit) and `git(...args)` (runs git in the copy with the scenario environment and `-c user.name=pmkit -c user.email=pmkit@example.com`). It may run CLI writes and git commands, and it may edit files of the copy to build a state the fixture lacks. The baseline (tree hash, file contents, event logs) is taken after `setup`.
- `expect(repo)`: `repo.issue(id)` and `repo.epic(id)` (parsed frontmatter), `repo.sprint(id)` (parsed sprint YAML), `repo.file(path)` (text or `null`), `repo.newEvents(id)` (events of an issue or epic appended after the baseline, parsed), `repo.ghCalls()` (fake gh log lines), `repo.git(...args)` (stdout).

**Reading a command file**
- Calls: every match of `pmkit\.mjs" +<rest up to the closing backtick>`, so `node "<installPath>/scripts/pmkit.mjs" migrate --json` counts. The CLI command is the first two words when they name a `COMMANDS` entry, else the first word. Flags are the `--name` tokens; a flag inside `[...]` is optional. A call whose text holds a `<...>` placeholder in flag position (`<flags>`, `<fields>`) accepts every flag of its CLI command.
- Section: `steps` (under `## Steps`), `missing` (under `## If something is missing`, step id `missing`), `other` (any other section; only rules 3 and 4 read these).
- Step id: a top-level item `N.` gives `N`. A nested numbered item `M.` under it gives `N.M`. A `-` bullet belongs to the numbered item above it. A heading `### N. Title` gives `N` to every item under it (`upgrade`). A heading without a number prefixes the ids under it with its text: `First run 6`, `Existing config 3`.
- Call key: `'<step id> <cli command>'`. Two calls with the same key are one key for rule 6.
- Confirmation points: each `- ` bullet of `## Confirmation points` that has `: ` after a label. The key is the text before the first `: `. Other bullets and paragraphs are notes.

**The rules** (`scripts/scenarios.test.mjs`; rule 13 is a plan addition)
1. Every file under `commands/**` has a scenario module and every module names an existing command file. The failure names each missing and extra one.
2. Every `*.after.txt` in `scripts/__scenarios__/` matches a scenario entry. A stale snapshot fails, and `UPDATE_GOLDENS=1` deletes it.
3. Every flag of every call in every command file exists in the CLI: the command's `flags` or `booleans`, or `json` and `root`, or `dry-run` for a write or `init`, or `as` for a write (`init` is not a write).
4. Every call in every command file ends with `--json`.
5. Every `read`, `dryRun` and `write` entry matches a call of the same step: same CLI command, entry flags a subset of the call's flags (any flag when the call has a placeholder). A `dryRun` needs a call with `--dry-run`. A `write` matches a call without `--dry-run` of that command in its step when there is one, else the call with `--dry-run` (marked "via dry run").
6. Every call key of the `steps` and `missing` sections is used by an entry or listed in `skip`. A `skip` key that matches no call key fails.
7. The confirmation keys of the command file equal the keys the scenario confirms plus the keys of `notHit`. A `notHit` key not in the file fails.
8. Every `read` and `dryRun` exits 0 (or fails with the declared `expectError`), prints JSON on stdout, and leaves `hashTree(root, ['.git'])` unchanged.
9. Every `write` and `edit` comes after a `confirm`. A `write` marked "via dry run" also comes after a `dryRun` entry with the same resolved args, before or after that `confirm`.
10. Every `confirm` key is a key of the command file. A key may repeat.
11. `expect(repo)` passes.
12. The snapshot equals `<name>.after.txt` (or `<name>.<index>.after.txt`).
13. A command file with at least one write call (a call with `--dry-run`, or a CLI command with `write: true`) declares at least one confirmation point.

Rules 5 and 6 run during the run, on resolved args, because `args` may be a function. Rules 3, 4, 7 and 13 need no run. Under `UPDATE_GOLDENS=1` every rule still runs; only rule 12 writes instead of comparing.

**Snapshot format.** Trace rows first, one blank line, then the file changes, then (only for `github: true`) the gh calls. LF only, one final newline. Paths go through `makeNormalizer({ root, inputs })` and args through `displayArgs` and the golden quoting.

```
$ pmkit issues get ISS-2X6D --json  [step 1, read]
exit 0
$ pmkit issues move ISS-2X6D done --dry-run --json  [step 4, dry run]
exit 0
? Step 5  [confirmed]
$ pmkit issues move ISS-2X6D done --json  [step 4, write]
exit 0
~ edit .issues/issues/ISS-5/issue.md  [step 2.4]
$ git commit -qm 'feat: x (ISS-4M2S)'  [step 8, git]
exit 0

--- changed .issues/issues/ISS-2X6D/issue.md
<lineDiff(before, after) lines>
--- added .issues/docs/retros/2026-10-12.md
+<each line>
--- removed <path>
--- gh calls
pr view ...
```

- An expected error shows `exit <code> (expected <CODE>)`. Stdout is never shown (the goldens own it).
- File changes compare every file of the copy except `.git` with the baseline taken after `setup`, sorted by path. No change prints `(no file changed)`.
- Regenerate with `UPDATE_GOLDENS=1 node --test scripts/scenarios.test.mjs`. The test's header comment and every failure message give this command. Never edit a snapshot by hand.

**Child environment.** `childEnv()` from `scripts/golden-helpers.mjs` (built from scratch: `PATH`, `TZ=UTC`, `PMKIT_USER=fred`, `PMKIT_NOW=2026-10-23T12:00:00Z`, `PMKIT_SEED=1`, `GIT_CONFIG_GLOBAL=os.devNull`, `GIT_CONFIG_NOSYSTEM=1`, `GIT_CEILING_DIRECTORIES`), plus for `github: true` the fake gh folder first on `PATH` and `PMKIT_FAKE_GH`. Each run of a scenario gets one scratch folder from `fs.mkdtempSync(path.join(os.tmpdir(), 'pmkit-scn-'))` holding `repo/`, `origin.git/` and `gh/`; it is removed in `finally`. Working directory is `repo/`, no `--root`.

**Fake gh.** The script now in `scripts/cli-pr.test.mjs`: it answers from the JSON file named by `PMKIT_FAKE_GH` (args joined by a space map to `{ status, stdout, stderr }`), appends each call to `<file>.log`, and exits 1 with `fake gh: no canned response for <key>` on an unknown key. `github: true` does what `teamRepo()` plus `pushableRepo()` do: replace `system: none` with `system: github\n  default_branch: main` in `.pmkit/config.yaml`, `git init -q -b main`, `git add -A`, initial commit, `git init -q --bare` the origin and `git remote add origin`.

## Review Focus

1. A note bullet in "Confirmation points" with `: ` mid-sentence is read as a point, and a long label with backticks (the branch-recording bullet of `issues/pause`) must match exactly. Task 2 pins both.
2. Step ids of nested items, of `### N. Title` headings, of unnumbered headings (`First run 6`) and of a `-` bullet under a nested item (`local/doctor` step 4). Task 2 pins each against a small Markdown string, and Task 3 against the real `setup.md`, `upgrade.md` and `local/doctor.md`.
3. A write that follows a dry run with different args (another `--estimate`, another ID) must fail rule 9, and a write before any confirm must fail even when its dry run came first. Task 2 pins both.
4. A dry run or read that writes anything under the copy (an event line, a cache file) must fail rule 8, while a change only under `.git` must not. Task 4 pins it with a fake step that writes a file.
5. Determinism and leakage: running `UPDATE_GOLDENS=1` twice leaves `git diff scripts/__scenarios__/` empty, no snapshot holds `/tmp`, `pmkit-scn-` or a real date, and `PMKIT_USER=other` or a global git email in the developer's shell changes nothing. Task 4 checks it on `issues-move`, Task 8 on all.

---

### Task 1: Shared helpers for child runs, tree hashes and the fake gh

Complexity: mechanical
Covers: support for "Each scenario checks the files after the run" (stdin, a scenario environment and a hash that skips `.git`)

**Files:**
- Create: `scripts/fake-gh.mjs`, `scripts/test-helpers.test.mjs`
- Modify: `scripts/golden-helpers.mjs` (`runPmkit`, export `quoteArg`), `scripts/golden-helpers.test.mjs`, `scripts/test-helpers.mjs` (`hashTree`), `scripts/cli-pr.test.mjs` (imports the fake gh)

**Interfaces:**
- Produces:
  - `runPmkit(args: string[], cwd: string, { env?: object, input?: string } = {}) -> Promise<{ code, stdout, stderr }>`: env is `{ ...childEnv(), ...env }`; `input` is written to stdin before it closes. Called with two arguments it behaves as today.
  - `quoteArg(arg: string) -> string`: the existing `quote`, exported.
  - `hashTree(dir: string, skip: string[] = []) -> string`: skips the listed top-level names.
  - `scripts/fake-gh.mjs`: `FAKE_GH_SCRIPT: string`, `fakeGh(canned: object, dir?: string) -> { dir, responses }` (a new `pmkit-pr-` temp folder when `dir` is not given), `ghCalls(gh) -> string[]`, `addBareOrigin(root: string, remote: string, env?: object) -> void`.

- [ ] **Step 1: Write the failing tests.**
  - `golden-helpers.test.mjs`, `runPmkit sends input on stdin`: on a `team` copy, `runPmkit(['issues', 'comment', 'ISS-5N1R', '--body-file', '-', '--dry-run', '--json'], root, { input: 'hello\n' })` exits 0 and the JSON body contains `hello`.
  - `golden-helpers.test.mjs`, `runPmkit merges env over childEnv`: `runPmkit(['whoami', '--json'], root, { env: { PMKIT_USER: 'ana' } })` returns id `ana`; without the option it returns `fred`.
  - `test-helpers.test.mjs`, `hashTree skips the named top-level entries`: a temp folder with `a.txt` and `.git/x`; changing `.git/x` changes `hashTree(dir)` but not `hashTree(dir, ['.git'])`; changing `a.txt` changes both.
- [ ] **Step 2: Run** `node --test scripts/golden-helpers.test.mjs scripts/test-helpers.test.mjs`. Expected: FAIL on the three new tests.
- [ ] **Step 3: Implement** the three helper changes, then move `FAKE_GH`, `fakeGh`, `ghCalls` and the bare-remote lines of `pushableRepo()` from `cli-pr.test.mjs` to `scripts/fake-gh.mjs`, and import them back. No assertion in `cli-pr.test.mjs` changes.
- [ ] **Step 4: Run** `npm test`. Expected: PASS, including `goldens.test.mjs` and `cli-pr.test.mjs` unchanged.
- [ ] **Step 5: Commit** `test: share the fake gh and extend runPmkit and hashTree (PMK-10)`.

### Task 2: Command file parser and trace rules

Complexity: hard
Covers: "Each scenario checks ... the confirmation points the command must hit" (parsing the points and rules 5, 6, 7, 9, 10)

**Files:**
- Create: `scripts/scenario-helpers.mjs`, `scripts/scenario-helpers.test.mjs`

**Interfaces:**
- Consumes: `COMMANDS` from `scripts/pmkit.mjs` (each with `name`, `flags`, optional `booleans`, `write`, `dryRun`).
- Produces (all pure, problems are strings that name the scenario entry or call):
  - `scenarioName(rel: string) -> string` (`'issues/create'` or `'issues/create.md'` gives `'issues-create'`).
  - `snapshotFile(name: string, index: number, count: number) -> string` (`count` 1 gives `<name>.after.txt`, else `<name>.<index>.after.txt`).
  - `parseCommandFile(text: string, cliNames: string[]) -> { calls: Call[], points: string[] }`, with `Call = { step: string, section: 'steps'|'missing'|'other', command: string, flags: string[], optional: string[], anyFlags: boolean, dryRun: boolean, endsWithJson: boolean, text: string }`.
  - `callKey(call) -> string`.
  - `unknownFlags(call: Call, cliCommand) -> string[]` (rule 3).
  - `matchEntry(entry: { step, kind: 'read'|'dryRun'|'write', args: string[] }, calls: Call[], cliNames: string[]) -> { key: string, viaDryRun: boolean } | { error: string }` (rule 5).
  - `coverageProblems(calls: Call[], usedKeys: Set<string>, skip: object) -> string[]` (rule 6).
  - `pointProblems(points: string[], confirmed: string[], notHit: object) -> string[]` (rules 7 and 10).
  - `orderProblems(trace: TraceRow[]) -> string[]` (rule 9), with `TraceRow = { kind: 'read'|'dryRun'|'confirm'|'write'|'edit'|'git', step?: string, args?: string[], key?: string, viaDryRun?: boolean }`.

- [ ] **Step 1: Write the failing tests** in `scenario-helpers.test.mjs`, each on a small Markdown string:
  - `parseCommandFile gives step ids to items, nested items, bullets and headings`: `1.`, a nested `2.` under `3.` gives `3.2`, a `-` bullet under nested `2.` gives `3.2`, `### 4. Update` with an item `2.` gives `4`, `### First run` with item `6.` gives `First run 6`, a call under `## If something is missing` gives `missing`, a call under `## Parameters` has section `other`.
  - `parseCommandFile reads command, flags, optional flags and placeholders`: `issues link <from> <to> --kind <k> [--remove] --dry-run --json` gives command `issues link`, flags `kind, remove, dry-run, json`, optional `remove`, `dryRun: true`; `issues list <flags> --json` gives `anyFlags: true`; `node "<installPath>/scripts/pmkit.mjs" migrate --json` gives command `migrate`.
  - `parseCommandFile keys confirmation points by label`: bullets `- Step 5: the status change.`, ``- Recording the current branch on the issue, when `pr open` finds no branch: a single write that asks once.`` and `- First run: the one summary` give three keys; `- Step 3 is a choice of input, not a confirmation.` and a paragraph give none.
  - `unknownFlags accepts json, root, dry-run and as by kind`: `--as` on `issues move` passes, on `init` fails; `--dry-run` passes on `init`; `--nope` fails.
  - `matchEntry`: a dry run without a `--dry-run` call in its step fails; a write with a non-dry call in its step matches it with `viaDryRun: false`; a write with only a dry-run call matches with `viaDryRun: true`; an entry flag not in the call fails; any flag passes against a placeholder call; a step with no call of that command fails.
  - `coverageProblems`: an unused key without skip fails; a skip key matching no call fails; an empty reason fails.
  - `pointProblems`: a file key neither confirmed nor in `notHit` fails; a `notHit` key not in the file fails; a confirmed key not in the file fails; a repeated confirm passes.
  - `orderProblems`: write before any confirm fails; edit before any confirm fails; a via-dry-run write after confirm with no matching dry run fails; the dry run after the confirm passes; a dry run with `--estimate 3` does not cover a write with `--estimate 5`.
  - `scenarioName` and `snapshotFile` on the examples above.
- [ ] **Step 2: Run** `node --test scripts/scenario-helpers.test.mjs`. Expected: FAIL, module not found.
- [ ] **Step 3: Implement** the functions in `scripts/scenario-helpers.mjs`. Walk the body line by line, tracking the current `##` section, the current `###` heading and a stack of numbered items by indentation.
- [ ] **Step 4: Run** `node --test scripts/scenario-helpers.test.mjs`, then `npm test`. Expected: PASS.
- [ ] **Step 5: Commit** `test: parse command files and check scenario traces (PMK-10)`.

### Task 3: Static checks over all 24 command files

Complexity: standard
Covers: "One scripted scenario per command in `commands/**`" (rules 1 and 2), and rules 3, 4 and 13

**Files:**
- Create: `scripts/scenarios.test.mjs`, `scripts/__scenarios__/_inputs/` (empty `.gitkeep` until a scenario adds files)
- Modify: `scripts/scenario-helpers.mjs`, `scripts/scenario-helpers.test.mjs`, `commands/issues/summary.md`

**Interfaces:**
- Consumes: Task 2's parser, `unknownFlags`, `scenarioName`, `snapshotFile`.
- Produces:
  - `compareScenarios(commandNames: string[], scenarioNames: string[], pending: Set<string>) -> { missing, extra, pendingWithScenario }`.
  - `staleSnapshots(files: string[], expected: string[]) -> string[]` (ignores `_inputs` and `*.mjs`).
  - `loadScenarios(dir: string) -> Promise<Array<{ name: string, entries: object[] }>>` (array exports become entries, a single object one entry).
  - `PENDING` in `scenarios.test.mjs`: a `Set` of the 24 scenario names that have no module yet. Rule 1 ignores a pending name with no module and fails on a pending name that has one ("remove it from PENDING"). Tasks 4 to 7 remove their names; Task 8 deletes `PENDING`.

- [ ] **Step 1: Write the failing tests.**
  - In `scenario-helpers.test.mjs`: `compareScenarios` reports missing, extra and pending-with-scenario names; `staleSnapshots` returns a `.after.txt` with no entry and leaves `_inputs`.
  - In `scenarios.test.mjs`, with the header comment that explains the suite and the regeneration command: `every command file has a scenario` (rule 1), `no stale snapshot` (rule 2, deletes under `UPDATE_GOLDENS=1`), `every flag of every command file exists in the CLI` (rule 3, all 24 files, all sections), `every call ends with --json` (rule 4), `every command file with a write call declares a confirmation point` (rule 13), and `the real files parse to the expected step ids`: `setup.md` has a call with step `First run 6` and one with `Existing config 7`, `upgrade.md` has `5 migrate`, `local/doctor.md` has `2.1 issues get` and `4 issues parent`, `report/status.md` has `epic list` in section `other`.
- [ ] **Step 2: Run** `node --test scripts/scenarios.test.mjs`. Expected: FAIL on rule 13 for `commands/issues/summary.md`. A scratch check on 2026-10-25 found no unknown flag and no call without `--json`; if rule 3 or 4 fails, the fix is a command file edit listed under "Command file fixes".
- [ ] **Step 3: Implement** the helpers and edit `commands/issues/summary.md`. Replace the paragraph under "Confirmation points" with these two lines, which keep its words:
  ```
  - Step 5: posting the summary of an issue as a comment asks once, before the comment is posted. When the user declines the offer, post nothing.
  - The summary itself only reads.
  ```
- [ ] **Step 4: Run** `node --test scripts/scenarios.test.mjs scripts/plugin.test.mjs`, then `npm test`. Expected: PASS.
- [ ] **Step 5: Commit** `test: check every command file's flags, json and confirmation points (PMK-10)`. Record the `summary.md` edit under "Command file fixes".

### Task 4: Scenario runner, snapshot and the `issues/move` scenario

Complexity: hard
Covers: "Each scenario checks the files after the run and the confirmation points the command must hit" (rules 5 to 12, first scenario)

**Files:**
- Create: `scripts/__scenarios__/issues-move.mjs`, `scripts/__scenarios__/issues-move.after.txt` (generated)
- Modify: `scripts/scenario-helpers.mjs`, `scripts/scenario-helpers.test.mjs`, `scripts/scenarios.test.mjs`

**Interfaces:**
- Consumes: Task 1's `runPmkit`, `hashTree`, `fakeGh`, `ghCalls`, `addBareOrigin`, `childEnv`, `makeNormalizer`, `displayArgs`, `quoteArg`; `lineDiff` from `scripts/lib/diff.mjs`; `splitFrontmatter` and `parseYaml` from `scripts/lib/yaml.mjs`; Task 2's rules; Task 3's loader.
- Produces:
  - `readTree(dir: string, skip: string[] = ['.git']) -> Map<string, string>` (posix relative path to UTF-8 text).
  - `treeChanges(before: Map, after: Map) -> string[]` (snapshot lines, or `['(no file changed)']`).
  - `formatSnapshot({ rows: string[], changes: string[], gh: string[] | null }) -> string`.
  - `makeRepoView(root: string, baseline: Map, gh) -> RepoView` (methods in Global Constraints).
  - `runScenario(scenario, { name: string, parsed, cliCommands, fixturesDir: string, inputsDir: string, run?: typeof runPmkit }) -> Promise<{ problems: string[], snapshot: string | null }>`: `run` defaults to `runPmkit` and exists for the rule 8 test. It prepares the copy, runs `setup`, takes the baseline, plays the entries (stopping at the first entry that cannot run), applies rules 5 to 11 and returns the snapshot. It removes its scratch folder in `finally`.

- [ ] **Step 1: Write the failing tests.**
  - In `scenario-helpers.test.mjs`: `treeChanges lists added, removed and changed files sorted`, `treeChanges prints (no file changed)`, `formatSnapshot puts the gh calls last only when given`, `makeRepoView.newEvents returns only appended events`.
  - In `scenario-helpers.test.mjs`, `runScenario fails a dry run that writes`: a scenario on `team` with `git: true` whose only entry is `{ step: '4', dryRun: ['issues', 'move', 'ISS-2X6D', 'done'] }`, run against the parsed `commands/issues/move.md` with a `run` override that writes `.issues/x` and then calls `runPmkit`. Expected: one problem, rule 8, naming the entry. A second case whose override writes only under `.git/` gives no rule 8 problem.
  - In `scenarios.test.mjs`: for each loaded scenario entry, one test inside the `describe` block that calls `runScenario`, asserts `problems` is empty (message lists them and ends with the regeneration command), then writes or compares the snapshot (rule 12).
  - `scripts/__scenarios__/issues-move.mjs` as in the Global Constraints example: confirm on `team` that `ISS-2X6D` is blocked by `ISS-5N1R` (in progress) and has no children, so step 2 reads `ISS-5N1R`. `expect`: status `done`, exactly one new `move` event on `ISS-2X6D`. Remove `issues-move` from `PENDING`.
- [ ] **Step 2: Run** `node --test scripts/scenario-helpers.test.mjs scripts/scenarios.test.mjs`. Expected: FAIL, `runScenario` not defined.
- [ ] **Step 3: Implement** the runner. Preparation order: copy the fixture into `repo/` (or create it empty), apply `github` to `.pmkit/config.yaml`, `git init` and the initial commit, the bare origin, the fake gh, then `setup`, then the baseline. `git` entries and the harness's own commits use `-c user.name=pmkit -c user.email=pmkit@example.com`.
- [ ] **Step 4: Run** `UPDATE_GOLDENS=1 node --test scripts/scenarios.test.mjs` twice, then `git diff --stat scripts/__scenarios__/` (empty after the second run), then `PMKIT_USER=other npm test`. Expected: PASS. Read `issues-move.after.txt`: one changed `issue.md` (status line), one changed `events.jsonl`, no temp path.
- [ ] **Step 5: Commit** `test: run command scenarios with snapshots, starting with issues move (PMK-10)`.

### Task 5: Scenarios for issue writes on `team`

Complexity: standard
Covers: "One scripted scenario per command in `commands/**`" and "Each scenario checks the files after the run and the confirmation points" for 8 commands

**Files:**
- Create: `scripts/__scenarios__/issues-{assign,capture,comment,create,link,update,progress,breakdown}.mjs`, their `.after.txt`, the `_inputs/` files they use
- Modify: `scripts/scenarios.test.mjs` (`PENDING`), command files only for text divergences

**Interfaces:**
- Consumes: the scenario format and `runScenario` (Task 4). No new helper.

For each scenario: write the module, run `node --test scripts/scenarios.test.mjs` and read the rule failures, fix the module (or the command file for a text divergence), regenerate with `UPDATE_GOLDENS=1`, read the snapshot, remove the name from `PENDING`. All run on `team` without git.

| Scenario | Path and IDs | Confirms | `notHit` / `skip` | `expect` |
|---|---|---|---|---|
| `issues/assign` | `ISS-3F7H` to `ana` | `Step 4` | | assignee `ana`, one new event |
| `issues/capture` | text search that matches a webhook issue, create a bug with `_inputs/description.md` and `_inputs/criteria.md`, link the new ID to `ISS-5N1R` with `--kind related` (args as a function of `save`) | `Step 5`, `Step 7`, `Step 9` | | one new issue of type `bug`, its `related` link |
| `issues/comment` | `ISS-5N1R`, `--body-file -` with `stdin` | `Step 3` | | one new comment file or event, per the tracker layout |
| `issues/create` | title, `--type task --priority high --estimate 3 --sprint current` | `Step 5` | | new issue in sprint `2026-10-12` |
| `issues/link` | `ISS-6J0B` blocks `ISS-3F7H` | `Step 5` | skip `4 issues parent`: link path | blocker recorded on both sides as the tracker stores it |
| `issues/update` | `ISS-3F7H` `--priority high --estimate 3 --criteria-file` | `Step 6` | | priority, estimate, criteria count |
| `issues/progress` | a `fred` issue in progress with an ID given, comment from `_inputs/comment.md`, tick criterion 1, log 30 minutes. If no such issue has criteria, `setup` adds them with `pmkit(['issues', 'update', id, '--criteria-file', ...])` | `Step 4`, `Step 7`, `Step 8` | skip `1 issues list`: ID given | criterion 1 checked, one `log-time` event |
| `issues/breakdown` | `ISS-3F7H` into two sub-issues, the first blocks the second | `Step 5` (before the dry runs) | `notHit` `Step 1` (no children), `Step 6` (no failed dry run) | two children with parent `ISS-3F7H`, one `blocks` link |

The writes of `issues/breakdown` carry step `6` (they repeat its dry runs); its links carry step `8`.

- [ ] **Step 1:** Write `issues-assign.mjs`, `issues-comment.mjs`, `issues-create.mjs` and `issues-link.mjs`; run until rules 5 to 11 pass; regenerate; read the four snapshots.
- [ ] **Step 2:** Same for `issues-update.mjs`, `issues-capture.mjs`, `issues-progress.mjs` and `issues-breakdown.mjs`.
- [ ] **Step 3: Run** `npm test`. Expected: PASS with 15 names left in `PENDING`.
- [ ] **Step 4: Commit** `test: add scenarios for the issue write commands (PMK-10)`. The task report lists command file fixes and follow-ups.

### Task 6: Scenarios for reads, reports and the GitHub read path

Complexity: standard
Covers: "One scripted scenario per command in `commands/**`" and "Each scenario checks the files after the run and the confirmation points" for 7 commands, plus `pr sync`, `pr status` and `pr open --draft` on a fake gh

**Files:**
- Create: `scripts/__scenarios__/{help,issues-find,issues-summary,issues-mine,team-standup,report-status,issues-pause}.mjs`, their snapshots, `_inputs/` files
- Modify: `scripts/scenarios.test.mjs` (`PENDING`), command files only for text divergences

**Interfaces:**
- Consumes: as Task 5. The gh keys come from `scripts/lib/github/` and from `scripts/cli-pr.test.mjs`; an unknown key fails with `fake gh: no canned response for <key>`, which names the key to add.

| Scenario | Fixture and path | Confirms | `notHit` / `skip` | `expect` |
|---|---|---|---|---|
| `help` | `team`, `capabilities` | none | | snapshot `(no file changed)` |
| `issues/find` | `team`, `discover` then `issues list` with `--category in_progress --assignee me` and `--type bug --sprint current` | none | | no change |
| `issues/summary` (array) | entry 0: `no-sprints` `ISS-9B2X`, `get --comments --history`, comment from `stdin`; entry 1: epic `EPC-4H7V`, `epic get`, `epic updates`, `issues list --parent` | 0: `Step 5`; 1: none | 0: skip `1 epic get`, `1 epic updates`, `2 issues list` (no children). 1: skip `1 issues get`, `5 issues comment`, `notHit` `Step 5` (epic) | 0: one new comment; 1: no change |
| `issues/mine` | `team`, `github`; `setup` records branch `feat-retries` on `ISS-5N1R` with `pmkit`; gh: an open PR for that branch with checks and reviews | none | `notHit` `Step 1`: no merged PR, so `pr sync --dry-run` moves nothing | no change; gh calls include `pr view feat-retries` |
| `team/standup` | `team`, `github`, prompt `/pmkit:team:standup me`; `setup` records a branch on `ISS-8C4W` (in review); gh: an open PR | none | `notHit` `Step 1` (same reason) | no change; `whoami` ran |
| `report/status` | `team`, `github`, `EPC-2M9D`, update from `_inputs/status-update.md` with `--health on_track` (check the allowed values) | `Step 7` | `notHit` `Step 1` (same reason) | one new status update file under `epics/EPC-2M9D/updates/` |
| `issues/pause` | `team`, `github`; `setup` creates branch `feat-retries` with one commit, records it on `ISS-5N1R`; gh: no PR for the branch, then `pr create ... --draft` returns a URL | `Step 2`, `Step 5`, `Step 7` | skip `1 issues list` (ID given), `missing issues update`; `notHit` the branch-recording point (the issue has a branch); skip `4 issues assign` when the scenario keeps the assignee | status `todo`, one new comment, the branch on origin, a `pr create` gh call with `--draft` |

- [ ] **Step 1:** Write `help.mjs`, `issues-find.mjs` and `issues-summary.mjs`; run, regenerate, read.
- [ ] **Step 2:** Write `issues-mine.mjs`, `team-standup.mjs` and `report-status.mjs`; run, regenerate, read. Check that each gh-calls section lists what pmkit asked.
- [ ] **Step 3:** Write `issues-pause.mjs`; run, regenerate, read.
- [ ] **Step 4: Run** `npm test`. Expected: PASS with 8 names left in `PENDING`.
- [ ] **Step 5: Commit** `test: add scenarios for reads, reports and the GitHub read path (PMK-10)`.

### Task 7: Scenarios for `issues/work`, cycles and the backlog

Complexity: hard
Covers: "One scripted scenario per command in `commands/**`" and "Each scenario checks the files after the run and the confirmation points" for 4 commands, plus `issues branch`, `pr open` on an existing draft, `pr ready` and the `pr sync` write

**Files:**
- Create: `scripts/__scenarios__/{issues-work,cycle-plan,cycle-close,backlog-groom}.mjs`, their snapshots, `_inputs/` files
- Modify: `scripts/scenarios.test.mjs` (`PENDING`), command files only for text divergences

**Interfaces:**
- Consumes: as Task 5.

Long scenarios: `issues/work` and `cycle/close` (60 to 100 lines each). Comment each block of entries with the step it follows.

| Scenario | Fixture and path | Confirms | `notHit` / `skip` | `expect` |
|---|---|---|---|---|
| `issues/work` (long) | `team`, `github`, prompt `/pmkit:issues:work ISS-4M2S`. Step 2 reads the parent `ISS-2X6D`. Step 5 moves to `in_progress` (already assigned to `fred`). Step 6 `issues branch`. Step 7 posts `_inputs/plan.md`. Step 8 is a `git` entry that commits a file with `(ISS-4M2S)` in the message. Step 9: gh answers `pr view <branch>` with an open draft PR #7, so `pr open` takes the `existing: true` path and pushes, then `pr ready`, the summary comment and the move to `in_review`. Step 10 creates one follow-up and links it `related` | `Step 5`, `Step 6`, `Step 7` twice, `Step 9` before each of its 4 writes, `Step 10` before the create and before the link | skip `1 issues list` (ID given), `2 epic get` (issue parent), `5.1 issues assign` (already assigned); `notHit` `Step 1`, `Step 4` (clean tree), and `Step 3` unless `ISS-4M2S` has a readiness problem, in which case confirm it | status `in_review`, `branch` set, branch on origin, gh calls include `pr ready 7` |
| `cycle/plan` | `team`; next sprint `2026-10-26` to `2026-11-08` (first Monday after `2026-10-25`, 14 days); capacity `fred=8,ana=6`; scope from `issues list --category todo,backlog --sprint none` (args of `cycle add` as a function of the saved `cycle open` result) | `Step 6`, `Step 8` | `notHit` `Step 1` (no planned sprint) | new sprint file with the goal and capacity, the chosen issues in it |
| `cycle/close` (long) | `team`, `github`, prompt `/pmkit:cycle:close`. `setup` records branch `feat-dlq` on `ISS-8C4W` (in review); gh answers it as merged, so step 1 previews, confirms and writes `pr sync`. Steps 2 to 6 read. Step 7: confirm the decisions, dry-run `cycle add <unfinished ids> --to none`, a split of `ISS-2X6D` (`issues create --title ... --estimate 3 --parent EPC-2M9D` and `issues update ISS-2X6D --estimate 5`) and `cycle close 2026-10-12`, then confirm the preview. Step 8 writes `cycle close` (step `8`), then the moves and the split (step `7`). Step 9 writes `retros/2026-10-12.md` from `_inputs/retro.md` | `Step 1`, `Step 7` twice, `Step 9` | none expected; `cycle list --state planned` returns no sprint, which the snapshot shows | sprint `2026-10-12` closed, `ISS-8C4W` done, the moved issues have no sprint, the retro file exists |
| `backlog/groom` | `team`; cutoff `2026-08-24` (`stale_days` 60 before `2026-10-23`). Fixes: estimate on `ISS-6J0B`, parent `EPC-2M9D` on `ISS-3F7H`, `ISS-1V9Z` marked duplicate of an issue with a close title, which also moves it to `canceled`. Step 10 runs steps 2 to 4 again | `Step 6`, `Step 8` | skip `7 issues move` only if no fix uses it | the three changes, one `duplicate` link |

- [ ] **Step 1:** Write `cycle-plan.mjs` and `backlog-groom.mjs`; run, regenerate, read.
- [ ] **Step 2:** Write `cycle-close.mjs`; run, regenerate, read the gh calls and the retro file.
- [ ] **Step 3:** Write `issues-work.mjs`; run, regenerate, read. Check that each `Step 9` row in the snapshot sits right above its write.
- [ ] **Step 4: Run** `npm test`. Expected: PASS with 4 names left in `PENDING`.
- [ ] **Step 5: Commit** `test: add scenarios for issues work, cycles and backlog grooming (PMK-10)`.

### Task 8: Scenarios for setup, upgrade, the doctor and spec import

Complexity: hard
Covers: "One scripted scenario per command in `commands/**`" (the last four, and `PENDING` removed) and "Each scenario checks the files after the run and the confirmation points"

**Files:**
- Create: `scripts/__scenarios__/{setup,upgrade,local-doctor,spec-import}.mjs`, their snapshots, `_inputs/CHANGELOG.md` and other inputs
- Modify: `scripts/scenarios.test.mjs` (delete `PENDING` and its branch in rule 1), command files only for text divergences

**Interfaces:**
- Consumes: as Task 5.

Long scenarios: `local/doctor` and `spec/import`.

| Scenario | Fixture and path | Confirms | `notHit` / `skip` | `expect` |
|---|---|---|---|---|
| `setup` (array) | entry 0: `null`, `git`; `init --git-host none --prefix ISS --id-style random --estimate-unit points --members-file -` with a one-member YAML on `stdin`, dry run, confirm, write (step `First run 6`), then `First run 9` reads. Entry 1: `basic`; `setup` deletes one scaffolded file so the `--update` dry run lists one `create`; `Existing config 2` validate, `Existing config 3` dry run, confirm, `Existing config 7` write `init --update`, `Existing config 8` reads | 0: `First run`; 1: `Existing config` | 0: skip every `Existing config` key, `notHit` `Existing config`. 1: the reverse | 0: `.pmkit/config.yaml` and `.issues/config.yaml` exist with prefix `ISS`; 1: the deleted file is back |
| `upgrade` | `basic`, `git`; `setup` sets `version: 1` in `.issues/config.yaml` and commits it. `3 changelog --file <inputs>/CHANGELOG.md --since 0.1.0`, confirm, `5 migrate` dry run, confirm, write | `Step 3`, `Step 5` | `notHit` `Step 4`: no `shownCommand`, and `claude plugin` steps are left to the live suite (say so in a comment) | `.issues/config.yaml` has `version: 2` |
| `local/doctor` (long) | `messy-merge`. Step 1 validate. Step 2 for `ISS-5`: `2.1 issues get ISS-5 --history` (use `expectError: 'CONFLICT'` if it does not parse), confirm `Step 2.3`, `edit` of the resolved `issue.md` (step `2.4`), `2.5` validate. `ISS-4` is declined: no confirm, no edit, the snapshot keeps its markers. Step 4: when validate reports no `value` or `reference` problem the CLI can fix, `setup` adds one of each (an unknown priority on `ISS-7`, a missing parent on `ISS-8`); dry runs `issues update ISS-7 --priority <allowed>` and `issues parent ISS-8 none`. Confirm `Step 5`, writes (step `4`). Step 6 validate | `Step 2.3`, `Step 5` | `notHit` `Step 3` (no config or format problem); skip `3 validate`, `3 migrate`, `4 issues move`, `4 issues link`, `4 cycle add` with the reason the data gives | `ISS-5` has no markers, `ISS-7` priority allowed, `ISS-8` no parent |
| `spec/import` (long) | `no-sprints`, prompt `/pmkit:spec:import .issues/docs/specs/overview.md`. `1 docs read specs/overview.md`, `2 discover`, confirm `Step 5`, `6` dry runs of `epic create` and two top-level `issues create` (check whether milestones and `needs-criteria` are allowed in this fixture), `7 epic create`, `8 issues create --parent` for the two issues and one sub-issue (args as functions of saved IDs), `9 issues link --kind blocks` | `Step 5` | skip `2 epic get`, `2 issues list` (new epic), `10 docs create` (spec already under `docs/`); `notHit` `Step 6`, `Step 10` | one new epic with 2 children, a sub-issue, one `blocks` link |

- [ ] **Step 1:** Write `upgrade.mjs` and `setup.mjs`; run, regenerate, read.
- [ ] **Step 2:** Write `spec-import.mjs`; run, regenerate, read.
- [ ] **Step 3:** Write `local-doctor.mjs`; run, regenerate, read. Check that `ISS-4` still has markers in the copy and that no file without markers was edited.
- [ ] **Step 4:** Delete `PENDING`. Run `UPDATE_GOLDENS=1 node --test scripts/scenarios.test.mjs` twice and confirm `git diff --stat scripts/__scenarios__/` is empty after the second run. Run `grep -lE '/tmp|/private|pmkit-scn-' scripts/__scenarios__/*.after.txt` and expect no output. Run `time npm test` and report the time against 5.6 s.
- [ ] **Step 5: Commit** `test: add scenarios for setup, upgrade, doctor and spec import (PMK-10)`.

### Task 9: Live suite spike, then `scripts/scenarios-live.mjs` if it holds

Complexity: hard
Covers: the spec's opt-in live suite (not an acceptance criterion; this task is the one to cut)

**Files:**
- Create: `scripts/scenarios-live.mjs` (only if the spike allows it)
- Modify: `scripts/scenario-helpers.mjs`, `scripts/scenario-helpers.test.mjs` (`traceFromLog`)

**Interfaces:**
- Consumes: `loadScenarios`, the runner's preparation (factor out `prepareCopy(scenario, scratch) -> Promise<{ root, env, baseline, gh }>` from `runScenario` if not already separate), `orderProblems`, `makeRepoView`.
- Produces: `traceFromLog(lines: Array<{ tool: 'Bash', command } | { tool: 'AskUserQuestion', questions }>, cliCommands) -> TraceRow[]`: a `pmkit.mjs` call with `--dry-run` is a `dryRun`, one without it is a `write` when its CLI command has `write: true` or is `init`, else a `read`; a question is a `confirm` with no key.

Budget limit: at most 2 runs of `claude -p`, each with `--max-budget-usd 1`. The full live suite never runs in this session.

- [ ] **Step 1: Spike run 1.** Build an `issues/move` copy with the Task 4 preparation, outside the repo. Write a settings file with two `PreToolUse` hooks (small Node scripts in the scratch folder): `Bash` appends `{ tool, command }` to a JSONL log; `AskUserQuestion` appends `{ tool, questions }` and answers "Yes" by returning `updatedInput` with the answers. Ask the `claude-code-guide` agent for the exact hook output shape before writing it. Run in the copy: `claude -p "/pmkit:issues:move ISS-2X6D done" --plugin-dir /home/fred/projects/pmkit --settings <file> --output-format stream-json --verbose --max-budget-usd 1`, plus the permission flags the guide gives for running `node` under `-p`. Record: did the slash command run despite `disable-model-invocation: true`; was `AskUserQuestion` offered; did the hook answer; what the log holds; the cost.
- [ ] **Step 2: Spike run 2, only if run 1 left one question open** (for example the hook could not answer through `updatedInput`): retry with the other method, denying with the answer in the reason. Otherwise skip it.
- [ ] **Step 3: Decide.**
  - The command did not run under `-p`: stop the task. Commit nothing for the live suite. The task report and the PR body say the live part left PMK-10, with the spike's evidence, under "Follow-ups".
  - The command ran but no hook could answer: build the suite without the confirmation check (rule 9 and the question count) and say so in its header comment.
  - Both worked: build the full suite.
- [ ] **Step 4 (when building): Write the failing test** `traceFromLog maps calls and questions` in `scenario-helpers.test.mjs`: a log with `issues get`, `issues move --dry-run`, a question and `issues move` gives `read`, `dryRun`, `confirm`, `write`, and `orderProblems` on it passes; the same log without the question fails. Run it: FAIL.
- [ ] **Step 5 (when building): Implement** `traceFromLog` and `scripts/scenarios-live.mjs`: `PMKIT_LIVE=1 node --test scripts/scenarios-live.mjs [name ...]`; each test skips unless `PMKIT_LIVE` is `1` and `claude` is on `PATH`; per scenario it prepares the copy, writes the hooks from the spike, runs `claude -p` with `--max-budget-usd 1`, builds the trace, checks rule 9, at least as many questions as the scenario's `confirm` entries, and `expect(repo)`. It never compares snapshots. The header comment records the spike's findings and the `claude` version (2.1.310 on 2026-10-25).
- [ ] **Step 6: Run** `node --test scripts/scenario-helpers.test.mjs` (PASS), `node --test scripts/scenarios-live.mjs` without `PMKIT_LIVE` (every test skipped, no `claude` run), and `npm test` (PASS, the live file not loaded).
- [ ] **Step 7: Commit** `test: add the opt-in live scenario suite (PMK-10)`, or no commit when Step 3 dropped it.
