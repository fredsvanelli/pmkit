# PMK-112 Validate .pmkit/config.yaml Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `pmkit validate` lists the problems of `.pmkit/config.yaml` with the file path, and `init` refuses to write an invalid `.pmkit/config.yaml` in both modes.

**Architecture:** `validate.mjs` gets `pmkitConfigProblems(root)`, merged into every return path of `validateRepo`. `pmkit.mjs` gets an exported pure helper `pmkitConfigRefusal(text, { update })`, called once in `runInit` on the final in-memory content, before any entry is built. `commands/setup.md` is reworded to match.

**Tech Stack:** Node, `node:test`, no dependencies (ADR 0003). Tests run with `npm test`.

**Spec:** `docs/superpowers/specs/2026-10-26-pmk-112-validate-pmkit-config-design.md`

## Global Constraints

- No dependencies (ADR 0003). Use `node:` modules only.
- Stay on branch `pmk-112-report-pmkit-config-yaml-problems-in`. Do not use `git stash`. Do not edit `CHANGELOG.md`, anything under `.issues/`, doctor.md, groom.md, goldens, scenarios or help text.
- Problem shape: `{ path, code, message }`. Path is `.pmkit/config.yaml` (root-relative, `/` separators, from `relative(root, file)`). Code is `config`, or `conflict` for git conflict markers.
- Messages in `validate`: conflict markers give `the file contains git conflict markers`; a parse failure gives `config.yaml does not parse: <error>`; otherwise one problem per string from `validatePmkitConfig(parsed)` (unchanged, a non-map gives `config must be a map`).
- `validate` exit code stays 0 with problems. A missing `.pmkit/config.yaml` still throws `NOT_CONFIGURED` (next step `/pmkit:setup`). A valid `tracker.system` other than `local` (`linear`) with no other bad key still throws `NOT_SUPPORTED`.
- `validate` result when `loadConfig` throws: if `brokenConfigProblem` returns a problem, return pmkit problems plus that problem. If it rethrows and the pmkit problems are not empty, return `{ checked: noneChecked(), problems: pmkit }`. If they are empty, rethrow. The older-format early return also includes the pmkit problems.
- `init` refusal: code `INVALID_INPUT` (exit 2), `new PmkitError('INVALID_INPUT', message, nextStep)`. Message `the .pmkit/config.yaml is not valid: <problems joined with "; ">`, with `generated ` before the path on a first run (`the generated .pmkit/config.yaml is not valid: ...`). Next step with `--update`: `Fix .pmkit/config.yaml by hand, then run init --update again`. First run: `Fix the init flags`.
- `init` checks only the final in-memory content, at the existing `validateLocalConfig(parsedLocal())` spot, and the `.pmkit/config.yaml` check runs first and throws alone. It runs before `entries` is built, so nothing is written, `--dry-run` included. A missing `.issues/config.yaml` still answers `NOT_CONFIGURED` first.
- Helper signature: `export function pmkitConfigRefusal(text, { update })` in `scripts/pmkit.mjs`, returns `null` when valid, else a `PmkitError`.
- Guard in the `--update` branch of `runInit` (replaces `parseYaml(read(pmkitFile)).tracker?.path ?? '.issues'`):
  `const parsed = parseYaml(read(pmkitFile)); const tp = parsed?.tracker?.path; trackerDir = typeof tp === 'string' ? tp : '.issues'`. The existing `catch` for invalid YAML keeps its message (`.pmkit/config.yaml is not valid YAML: ...`) and code.
- Files: `scripts/lib/validate.mjs`, `scripts/pmkit.mjs`, `commands/setup.md`, tests in `scripts/validate.test.mjs`, `scripts/cli.test.mjs`, `scripts/cli-init.test.mjs`. No new file.
- Goldens and scenarios pass unchanged. Never edit or regenerate a golden to make a test pass.
- Commit trailer: every commit message ends with `Co-Authored-By: <the implementer's model> <noreply@anthropic.com>`. Every message carries `(PMK-112)`, for example `feat: report .pmkit/config.yaml problems in validate (PMK-112)`.

## Review Focus

- Unparseable `.pmkit/config.yaml` in `validate`: one `config` problem, no throw (Task 1).
- Both files invalid in `validate`: both listed, sorted by path (Task 1).
- Empty `.pmkit/config.yaml` or non-string `tracker.path` in `init --update`: a refusal naming the file, not a `TypeError` (Task 4).
- Minimal hand-written file (`tracker: {system: local}`) in `init --update`: refused with the three missing-key messages, nothing written (Task 3).
- `init --update --git-host github` on a valid file still works (Task 3).

---

### Task 1: `validate` reports `.pmkit/config.yaml` problems

**Files:**
- Modify: `scripts/lib/validate.mjs` (imports at line 5; `validateRepo` at line ~92; add `pmkitConfigProblems` above it)
- Test: `scripts/validate.test.mjs`

**Interfaces:**
- Produces: `pmkitConfigProblems(root: string): Array<{ path, code, message }>` (module-private; no export needed). `validateRepo` return shape is unchanged.

- [ ] **Step 1: Write the failing tests** in `scripts/validate.test.mjs`, using the existing `brief` helper and `makeRepo`. A helper `setPmkit(root, text)` writes `.pmkit/config.yaml`. Tests:
  - `a bad .pmkit/config.yaml is reported with its path`: `makeRepo('basic')`; replace `system: none` with `system: gitlab` and the `confirm:` value with `sometimes`. Assert `result.problems` deep-equals two problems at path `.pmkit/config.yaml`, code `config`, messages `git_host.system must be github or none` and `write_policy.confirm must be one of all_writes, single_writes, none` (sorted by message as the final sort gives).
  - `problems of both config files are listed, sorted by path`: break `.issues/config.yaml` with `makeRepo('broken')`'s style (write `version: 1\nthis line has no colon\n`) and break `.pmkit/config.yaml` as above. Assert `brief(result)` equals `['config .issues/config.yaml', 'config .pmkit/config.yaml', 'config .pmkit/config.yaml']` and that the first problem's path is `.issues/config.yaml`.
  - `an unparseable .pmkit/config.yaml is one config problem and does not throw`: write `version: 1\nthis line has no colon\n`. Assert `brief` equals `['config .pmkit/config.yaml']` and the message starts with `config.yaml does not parse:`.
  - `.pmkit/config.yaml with conflict markers is one conflict problem`: write `version: 1\n<<<<<<< HEAD\ngit_host:\n=======\nx: 1\n>>>>>>> b\n`. Assert `brief` equals `['conflict .pmkit/config.yaml']` and the message is `the file contains git conflict markers`.
  - `tracker.system trello and a numeric tracker.path are problems, not throws`: first case replace `system: local` with `system: trello`; assert one problem whose message starts with `tracker.system must be one of`. Second case replace `path: .issues` with `path: 7`; assert one problem with message `tracker.path must be a string`. (`loadConfig` throws `NOT_SUPPORTED` and `INVALID_INPUT`; `validateRepo` must not.) If the fixture has no `path:` line, write the whole file with `tracker: {system: local, path: 7}` plus the valid `version`, `git_host` and `write_policy` keys.
  - `a missing .pmkit/config.yaml still throws NOT_CONFIGURED`: `fs.rmSync` the file; `assert.throws(() => validateRepo(root), { code: 'NOT_CONFIGURED' })`.
  - `tracker.system linear alone still throws NOT_SUPPORTED`: set `system: linear`; `assert.throws(..., { code: 'NOT_SUPPORTED' })`. Also: `linear` plus `git_host.system: gitlab` returns the `git_host.system` problem and does not throw.
  - `every fixture has no .pmkit/config.yaml problem`: for each name in `basic`, `broken`, `team`, `no-sprints`, `messy-merge`, assert no problem has path `.pmkit/config.yaml`.
  - The existing `validateRepo writes nothing` test already loops over fixtures. Add one more loop pass for a repo whose `.pmkit/config.yaml` is bad: `hashTree` before and after is equal.
- [ ] **Step 2: Run** `node --test scripts/validate.test.mjs`. Expected: the new tests fail (no problems at `.pmkit/config.yaml`, throws instead of returns).
- [ ] **Step 3: Implement `pmkitConfigProblems(root)` in `scripts/lib/validate.mjs`.** Import `validatePmkitConfig` next to `loadConfig`. Read `path.join(root, '.pmkit', 'config.yaml')`. Missing file gives `[]`. Then in order: `hasConflictMarkers(text)` gives one `conflict` problem; a `parseYaml` throw gives one `config` problem `config.yaml does not parse: ${error.message}`; otherwise `validatePmkitConfig(parsed).map(...)` with code `config`. `parseYaml` returning `null` (empty file) goes through `validatePmkitConfig`, which answers `config must be a map`.
- [ ] **Step 4: Change `validateRepo`** to compute `const pmkit = pmkitConfigProblems(root)` first and merge it on every path. When `config` is passed in by the caller, still compute `pmkit`. The three changes:
  ```js
  } catch (error) {
    let broken
    try { broken = brokenConfigProblem(root, error) } catch (rethrown) {
      if (pmkit.length > 0) return { checked: noneChecked(), problems: pmkit }
      throw rethrown
    }
    return { checked: noneChecked(), problems: [...pmkit, broken] }
  }
  ```
  The older-format return becomes `problems: [...pmkit, formatProblem(...)]`. In the main path, start with `const problems = [...pmkit]` (the function already sorts at the end by path then code; confirm the sort exists, and add it if the problems are returned unsorted).
- [ ] **Step 5: Run** `node --test scripts/validate.test.mjs` then `npm test`. Expected: all pass, goldens and scenarios unchanged (`git status` shows no change outside the two files).
- [ ] **Step 6: Commit.**
  ```bash
  git add scripts/lib/validate.mjs scripts/validate.test.mjs
  git commit -m "feat: report .pmkit/config.yaml problems in validate (PMK-112)" -m "Co-Authored-By: <your model> <noreply@anthropic.com>"
  ```

Complexidade: média

### Task 2: CLI-level `validate` test

**Files:**
- Test: `scripts/cli.test.mjs` (add after the test at line 226, `validate on the broken fixture exits 0 and lists every problem`)

**Interfaces:**
- Consumes: `validateRepo` change from Task 1. Uses the existing `run`, `json` and `makeRepo` in that file.

- [ ] **Step 1: Write the test.** It should already pass after Task 1; that is the point (the command prints problems with no code change in `scripts/pmkit.mjs`).
  ```js
  test('validate exits 0 and prints a .pmkit/config.yaml problem as path, code and message', () => {
    const root = makeRepo('basic')
    const file = path.join(root, '.pmkit', 'config.yaml')
    fs.writeFileSync(file, fs.readFileSync(file, 'utf8').replace(/system: none/, 'system: gitlab'))
    const text = run(root, ['validate'])
    assert.equal(text.status, 0)
    assert.match(text.stdout, /^\.pmkit\/config\.yaml {2}config {2}git_host\.system must be github or none$/m)
    const problem = json(root, ['validate']).problems.find((p) => p.path === '.pmkit/config.yaml')
    assert.equal(problem.code, 'config')
  })
  ```
  If the basic fixture's host line is not `system: none`, read the file first and use its actual line.
- [ ] **Step 2: Run** `node --test scripts/cli.test.mjs`. Expected: PASS. If the text assertion fails on separators, print `text.stdout` and match the real `path  code  message` spacing; do not change `scripts/pmkit.mjs`.
- [ ] **Step 3: Commit.**
  ```bash
  git add scripts/cli.test.mjs
  git commit -m "test: cover validate output for .pmkit/config.yaml problems (PMK-112)" -m "Co-Authored-By: <your model> <noreply@anthropic.com>"
  ```

Complexidade: baixa

### Task 3: `init` refuses an invalid `.pmkit/config.yaml`

**Files:**
- Modify: `scripts/pmkit.mjs` (import `validatePmkitConfig` at line 9; add `pmkitConfigRefusal` near `usageError` at line 25; call site in `runInit` just before `const problems = validateLocalConfig(parsedLocal())`, line ~867)
- Test: `scripts/cli-init.test.mjs`

**Interfaces:**
- Produces: `export function pmkitConfigRefusal(text: string, { update }: { update: boolean }): PmkitError | null`.

- [ ] **Step 1: Write the failing tests** in `scripts/cli-init.test.mjs`. Import `pmkitConfigRefusal` from `./pmkit.mjs` (it is safe to import; the file only runs the CLI when it is the entry point). Helper: `bad(dir)` runs `init`, then rewrites `.pmkit/config.yaml` replacing `system: none` with `system: gitlab`. Tests:
  - `init --update refuses a bad .pmkit/config.yaml and writes nothing`: `run(dir, ['init'])`, break the file, `hashTree` before. `run(dir, ['init', '--update', '--json'])` exits 2; `error.code` is `INVALID_INPUT`; `error.message` matches `/\.pmkit\/config\.yaml/` and `/git_host\.system/`; `error.nextStep` matches `/\.pmkit\/config\.yaml/` and `/init --update again/`; `hashTree` unchanged.
  - Same with `--dry-run`: exit 2, `hashTree` unchanged.
  - `--update --git-host github works on a valid .pmkit/config.yaml`: after `init`, `json(dir, ['init', '--update', '--git-host', 'github'])` succeeds and the file has `system: github`.
  - `a minimal hand-written .pmkit/config.yaml is refused with the missing keys`: `init`, then write `.pmkit/config.yaml` as `tracker:\n  system: local\n`. `init --update --json` and `init --update --dry-run --json` both exit 2; message contains `version must be 1`, `git_host.system must be github or none` and `write_policy.confirm must be one of all_writes, single_writes, none`; nextStep matches `/\.pmkit\/config\.yaml/`; `hashTree` unchanged.
  - `when both config files are invalid, the error names only .pmkit/config.yaml`: break both (`.issues/config.yaml` with `version: 1\nthis line has no colon\n`); message matches `/\.pmkit\/config\.yaml/` and not `/\.issues\/config\.yaml/`.
  - `pmkitConfigRefusal`, direct:
    ```js
    const bad = 'version: 1\ntracker: { system: local }\ngit_host: { system: gitlab }\nwrite_policy: { confirm: none }\n'
    const first = pmkitConfigRefusal(bad, { update: false })
    assert.equal(first.code, 'INVALID_INPUT')
    assert.ok(first.message.startsWith('the generated .pmkit/config.yaml is not valid:'))
    assert.equal(first.nextStep, 'Fix the init flags')
    const again = pmkitConfigRefusal(bad, { update: true })
    assert.ok(again.message.startsWith('the .pmkit/config.yaml is not valid:'))
    assert.equal(again.nextStep, 'Fix .pmkit/config.yaml by hand, then run init --update again')
    assert.equal(pmkitConfigRefusal(fs.readFileSync(path.join(ROOT, 'templates/pmkit.config.yaml'), 'utf8'), { update: false }), null)
    ```
    where `ROOT` is the repo root computed from `import.meta.url` (the file already builds `CLI` from it). Add a case where the text does not parse (`'a: [\n'`): the result is an `INVALID_INPUT` error whose message contains `does not parse`.
- [ ] **Step 2: Run** `node --test scripts/cli-init.test.mjs`. Expected: the new tests fail (`pmkitConfigRefusal` is not exported; `--update` succeeds on a bad file).
- [ ] **Step 3: Implement `pmkitConfigRefusal(text, { update })` in `scripts/pmkit.mjs`.** Parse with `parseYaml`; a throw is the single problem `config.yaml does not parse: ${error.message}`; otherwise `validatePmkitConfig(parsed)`. No problems: return `null`. Otherwise return `usageError(`the ${update ? '' : 'generated '}.pmkit/config.yaml is not valid: ${problems.join('; ')}`, update ? 'Fix .pmkit/config.yaml by hand, then run init --update again' : 'Fix the init flags')`. Import `validatePmkitConfig` from `./lib/config.mjs`.
- [ ] **Step 4: Call it once in `runInit`**, right before the `validateLocalConfig(parsedLocal())` line, after `pmkit = setSchemaLine(...)`: `const refusal = pmkitConfigRefusal(pmkit, { update }); if (refusal) throw refusal`.
- [ ] **Step 5: Run** `node --test scripts/cli-init.test.mjs`, then `npm test`. Expected: all pass, goldens and scenarios unchanged.
- [ ] **Step 6: Commit.**
  ```bash
  git add scripts/pmkit.mjs scripts/cli-init.test.mjs
  git commit -m "feat: refuse an invalid .pmkit/config.yaml in init (PMK-112)" -m "Co-Authored-By: <your model> <noreply@anthropic.com>"
  ```

Complexidade: média

### Task 4: Guard the `tracker.path` read in `init --update`

**Files:**
- Modify: `scripts/pmkit.mjs:797-801` (the `try` that sets `trackerDir`)
- Test: `scripts/cli-init.test.mjs`

**Interfaces:**
- Consumes: `pmkitConfigRefusal` call from Task 3 (the final check names the file).

- [ ] **Step 1: Write the failing tests.** After `run(dir, ['init'])`:
  - `an empty .pmkit/config.yaml in --update is refused with the file named`: write `''`. `init --update --json` exits 2, `error.code` is `INVALID_INPUT`, message matches `/\.pmkit\/config\.yaml/`, and `stderr` does not contain `TypeError`.
  - `a non-string tracker.path in --update is refused with the file named`: write a valid file with `path: 7`. Same assertions; message contains `tracker.path must be a string`.
  - `the same two inputs answer NOT_CONFIGURED when .issues/config.yaml is missing`: `fs.rmSync` `.issues/config.yaml`, repeat both; exit 2? No: assert `error.code === 'NOT_CONFIGURED'` (the status is whatever `NOT_CONFIGURED` already returns; assert only the code).
  - `an unparseable .pmkit/config.yaml in --update keeps the is not valid YAML message`: write `a: [\n`; message matches `/is not valid YAML/`, code `INVALID_INPUT`.
- [ ] **Step 2: Run** `node --test scripts/cli-init.test.mjs`. Expected: the empty-file and `path: 7` tests fail with a `TypeError` (crash). The unparseable one already passes.
- [ ] **Step 3: Apply the guard** from Global Constraints in place of `trackerDir = parseYaml(read(pmkitFile)).tracker?.path ?? '.issues'`. Leave the `catch` as it is.
- [ ] **Step 4: Run** `node --test scripts/cli-init.test.mjs`, then `npm test`. Expected: PASS.
- [ ] **Step 5: Commit.**
  ```bash
  git add scripts/pmkit.mjs scripts/cli-init.test.mjs
  git commit -m "fix: stop init --update crashing on an empty or odd .pmkit/config.yaml (PMK-112)" -m "Co-Authored-By: <your model> <noreply@anthropic.com>"
  ```

Complexidade: baixa

### Task 5: Reword `commands/setup.md` and run the full check

**Files:**
- Modify: `commands/setup.md:55` (step 2) and `commands/setup.md:64` (step 4) of "Existing config"

- [ ] **Step 1: Edit step 2.** Replace `A problem in `.issues/config.yaml` makes `init --update` refuse, so ask the user to fix that file by hand first` with `A problem in `.issues/config.yaml` or `.pmkit/config.yaml` makes `init --update` refuse, so ask the user to fix that file by hand first`. Keep the rest of the line (`(see /pmkit:local:doctor)`, `Other problems do not stop the update, ...`).
- [ ] **Step 2: Edit step 4.** Replace `When the dry run fails because `.issues/config.yaml` is not valid, it writes nothing and names the problem.` with `When the dry run fails because `.issues/config.yaml` or `.pmkit/config.yaml` is not valid, it writes nothing and names the problems.` Keep the following sentences.
- [ ] **Step 3: Run** `npm test`. Expected: PASS, including `scenarios` (step names are unchanged). `git status` shows only `commands/setup.md` modified.
- [ ] **Step 4: Commit.**
  ```bash
  git add commands/setup.md
  git commit -m "docs: setup stops on an invalid .pmkit/config.yaml too (PMK-112)" -m "Co-Authored-By: <your model> <noreply@anthropic.com>"
  ```

Complexidade: baixa
