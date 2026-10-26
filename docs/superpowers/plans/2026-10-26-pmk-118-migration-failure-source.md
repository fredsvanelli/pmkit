# PMK-118 migration failure source Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When a migration step fails, `pmkit validate` lists the failure as a problem at the tracker's `config.yaml` instead of rethrowing, while every other command still exits 2 with `INVALID_INPUT`.

**Architecture:** `planMigration` gives its error a `details.migration` key. `brokenConfigProblem` in `validate.mjs` lists any error with that key as a problem with code `migration`. `validateRepo` takes a `migrations` option and forwards it to `loadConfig`, which is how tests inject a failing step.

**Tech Stack:** Node 18+ ES modules, no dependencies (ADR 0003), `node:test`. Run tests with `npm test`.

**Spec:** `docs/superpowers/specs/2026-10-26-pmk-118-migration-failure-source-design.md`

## Global Constraints

- The error thrown in `planMigration` (`scripts/lib/local/migrations.mjs`) gets a fourth argument, exactly `{ migration: { from: step.from, to: step.to } }`. Code `INVALID_INPUT`, message `migration ${step.from} to ${step.to} failed: ${error.message}` and next step `pmkit validate` do not change.
- Problem record, exactly: `{ path: '.issues/config.yaml', code: 'migration', message: 'migration 1 to 2 failed: bad event' }`. `path` is `<trackerPath>/config.yaml` relative to the root (a custom `tracker.path` changes it). `code` is lowercase `migration`, never `FORMAT` or `config`. `message` is the error message as thrown, with no "run X" tail.
- `brokenConfigProblem` lists the error when `error?.details?.migration !== undefined`. That condition joins only the label-prefix guard. The first guard (`code !== 'INVALID_INPUT' && !format`) does not change. The `migration` return comes after the `format` return. Update the comment above the function.
- `validateRepo(root, { config, migrations } = {})` forwards `migrations` to `loadConfig(root, { migrations })`. Production callers pass nothing. There is no hook on `run()` in `pmkit.mjs`, no environment variable, and no mutation of `MIGRATIONS` in the parent test process.
- For this case `validateRepo` returns `{ checked: noneChecked(), problems }` with all counts zero (`{ issues: 0, epics: 0, sprints: 0, milestones: 0, comments: 0 }`), the `.pmkit/config.yaml` problems merged and sorted as for any broken config.
- `migrate`, `migrate --dry-run` and every read command keep throwing `INVALID_INPUT` and exit 2, with next step `pmkit validate`. A bad `tracker.path` and an unsupported `tracker.system` are still rethrown by `validateRepo`.
- No change to the built-in `MIGRATIONS`, `FORMAT_VERSION`, command files, schemas or `pmkit.mjs`.
- Files that may change: `scripts/lib/local/migrations.mjs`, `scripts/lib/validate.mjs`, `scripts/migrations.test.mjs`, and this plan plus the state file. Nothing else.
- Goldens must not change. Run `npm test` without `UPDATE_GOLDENS=1`. If a golden differs, stop and read the diff line by line. Regenerate only with `UPDATE_GOLDENS=1`, and only if this issue explains the diff (the spec expects none).
- Commit messages carry `(PMK-118)` in the subject and end with the trailer `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`. Every task ends with the whole suite green.
- Straight quotes, no em dashes in prose. The text says `migrate`, not `upgrade`, for the CLI command.

## Review Focus

1. A custom `tracker.path` moves the problem's `path`. Pinned in Task 1.
2. The rule stays narrow, so a bad `tracker.path` and an unsupported `tracker.system` still rethrow. The existing `scripts/validate.test.mjs` cases pin this, and Task 1 runs them.
3. A later step that fails after an earlier step changed the copy writes nothing to the tracker folder. Pinned in Task 2.
4. The real CLI path with the default `migrations` argument gives exit 2 on reads and exit 0 on `validate`. Pinned in Task 2.
5. `migrate --dry-run` throws the same error as `migrate`. Pinned in Task 1.

---

### Task 1: Error details and the validate listing

**Files:**
- Modify: `scripts/lib/local/migrations.mjs` (the `throw` in `planMigration`, line 85)
- Modify: `scripts/lib/validate.mjs` (`brokenConfigProblem`, line 72 and the comment above it; `validateRepo`, line 126)
- Test: `scripts/migrations.test.mjs` (extend the test at line 221; add two tests after `const options = ...`, which is after `gitRepo`)

**Interfaces:**
- Produces: `PmkitError.details.migration` equal to `{ from: number, to: number }` on the step failure error, and `validateRepo(root, { config?, migrations? })`. Task 2 relies on the problem record.

- [ ] **Step 1: Write the failing tests** in `scripts/migrations.test.mjs`.
  - In `planMigration turns a throwing step into INVALID_INPUT`, change the predicate to a block that keeps its three checks and adds `assert.deepEqual(error.details, { migration: { from: 1, to: 2 } })`, then returns `true`.
  - Add `const bad = { from: 1, to: 2, describe: 'bad', run() { throw new Error('bad event') } }` and `const problem = (at) => ({ path: at, code: 'migration', message: 'migration 1 to 2 failed: bad event' })` after `const options`.
  - New test `a failing step is INVALID_INPUT for loadConfig and migrate, and validate lists it`, on `gitRepo()`:
    ```js
    const { root } = gitRepo()
    const check = (error) => {
      assert.equal(error.code, 'INVALID_INPUT')
      assert.equal(error.message, 'migration 1 to 2 failed: bad event')
      assert.equal(error.nextStep, 'pmkit validate')
      assert.deepEqual(error.details, { migration: { from: 1, to: 2 } })
      return true
    }
    assert.throws(() => loadConfig(root, { migrations: [bad] }), check)
    assert.throws(() => runMigrate(root, { migrations: [bad] }), check)
    assert.throws(() => runMigrate(root, { dryRun: true, migrations: [bad] }), check)
    const result = validateRepo(root, { migrations: [bad] })
    assert.deepEqual(result.problems, [problem('.issues/config.yaml')])
    assert.deepEqual(result.checked, { issues: 0, epics: 0, sprints: 0, milestones: 0, comments: 0 })
    ```
  - New test `validate lists a failing step at a custom tracker path`: `const { root } = gitRepo({ trackerPath: 'tracker' })`, then assert `validateRepo(root, { migrations: [bad] }).problems` deep-equals `[problem('tracker/config.yaml')]`. The folder name has no parent, so `gitRepo`'s rename works as is.

- [ ] **Step 2: Run to verify they fail for the stated reason**

Run: `node --test scripts/migrations.test.mjs`
Expected: FAIL in the three changed or new tests. The `planMigration` test fails on `details` being `undefined`. The `loadConfig` test fails on the same `details` check. The custom path test fails because `validateRepo` ignores `migrations` and returns a `FORMAT` problem. If a test fails for another reason (import error, setup), fix the test first.

- [ ] **Step 3: Implement** the three edits, exact code.
  - `migrations.mjs`:
    ```js
    throw new PmkitError('INVALID_INPUT', `migration ${step.from} to ${step.to} failed: ${error.message}`, 'pmkit validate', { migration: { from: step.from, to: step.to } })
    ```
  - `validate.mjs`, `brokenConfigProblem`:
    ```js
    const format = error?.details?.format !== undefined
    const migration = error?.details?.migration !== undefined
    ...
    // loadConfig starts every other INVALID_INPUT from the local config.yaml with this label.
    if (!format && !migration && !error.message.startsWith(`${trackerPath}/config.yaml`)) throw error
    const file = path.join(root, trackerPath, 'config.yaml')
    if (!fs.existsSync(file)) throw error
    if (format) return formatProblem(root, file, error)
    if (migration) return { path: relative(root, file), code: 'migration', message: error.message }
    ```
    Update the comment above the function to say a failing migration step is also a finding, listed with code `migration`.
  - `validate.mjs`, `validateRepo`: signature `validateRepo(root, { config, migrations } = {})` and `config = loadConfig(root, { migrations })`.

- [ ] **Step 4: Run to verify they pass**

Run: `node --test scripts/migrations.test.mjs scripts/validate.test.mjs`
Expected: PASS, including the `validate.test.mjs` cases that expect a rethrow.

- [ ] **Step 5: Run the whole suite**

Run: `npm test`
Expected: PASS, no golden differs. The count is the previous count plus 2.

- [ ] **Step 6: Commit**

```bash
git add scripts/lib/local/migrations.mjs scripts/lib/validate.mjs scripts/migrations.test.mjs
git commit -m "fix: list a failing migration step as a validate problem (PMK-118)

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

Complexidade: média

### Task 2: Real CLI and no partial write

**Files:**
- Test: `scripts/migrations.test.mjs` (two new tests, no production change)

**Interfaces:**
- Consumes: Task 1's `details.migration` and problem record. Exports `MIGRATIONS` from `scripts/lib/local/migrations.mjs` and `run(argv, { env, cwd })` from `scripts/pmkit.mjs`, which returns `{ code, stdout, stderr }`.

These tests pass as soon as they are written, because Task 1 already holds the behavior. Prove each one can fail (Step 2) before trusting it.

- [ ] **Step 1: Write the tests** in `scripts/migrations.test.mjs`.
  - `the CLI lists a failing migration step as a problem and exits 2 on reads`. Build `setup()`, take `before = hashTree(root)`. The child script, run with `spawnSync(process.execPath, ['--input-type=module', '-e', script], { encoding: 'utf8' })`, imports `MIGRATIONS` and `run` through `new URL(..., import.meta.url).href` as the test at line 171 does, sets `MIGRATIONS[0].run = () => { throw new Error('bad event') }`, builds `env = { ...process.env, PMKIT_USER: 'fred', PMKIT_NOW: '2026-10-23T12:00:00Z', PMKIT_SEED: '1', GIT_CONFIG_GLOBAL: os.devNull, GIT_CONFIG_NOSYSTEM: '1' }`, and prints `JSON.stringify({ list: run(['issues', 'list', '--json'], { cwd, env }), validate: run(['validate', '--json'], { cwd, env }) })`. The parent parses stdout and asserts:
    ```js
    assert.equal(list.code, 2)
    assert.deepEqual(JSON.parse(list.stdout).error, { code: 'INVALID_INPUT', message: 'migration 1 to 2 failed: bad event', nextStep: 'pmkit validate' })
    assert.equal(validate.code, 0)
    assert.deepEqual(JSON.parse(validate.stdout).problems, [{ path: '.issues/config.yaml', code: 'migration', message: 'migration 1 to 2 failed: bad event' }])
    assert.equal(hashTree(root), before)
    ```
    If the error body has extra keys, assert the three keys by field instead of `deepEqual`, and say so in the commit body.
  - `migrate writes nothing when a later step fails`, on `gitRepo()`:
    ```js
    const { root, dir } = gitRepo()
    const before = hashTree(dir)
    const step23 = { from: 2, to: 3, describe: 'bad', run() { throw new Error('boom') } }
    assert.throws(
      () => runMigrate(root, { formatVersion: 3, migrations: [renameLogTime, step23] }),
      (error) => error.code === 'INVALID_INPUT' && error.message === 'migration 2 to 3 failed: boom' && error.details.migration.from === 2 && error.details.migration.to === 3,
    )
    assert.equal(hashTree(dir), before)
    assert.match(fs.readFileSync(path.join(dir, 'config.yaml'), 'utf8'), /^version: 1$/m)
    assert.equal(git(root, 'status', '--porcelain').stdout, '')
    assert.equal(subjects(root), 'initial\n')
    ```

- [ ] **Step 2: Run, then prove each test can fail**

Run: `node --test scripts/migrations.test.mjs`
Expected: PASS. Then temporarily revert only the `migration` return line in `brokenConfigProblem` (edit it out, run the file, restore it with `git checkout -- scripts/lib/validate.mjs`). The CLI test must then fail on the `validate` assertions. Check `git diff --stat` shows only the test file before going on.

- [ ] **Step 3: Run the whole suite**

Run: `npm test`
Expected: PASS, no golden differs. The count is the Task 1 count plus 2.

- [ ] **Step 4: Commit**

```bash
git add scripts/migrations.test.mjs
git commit -m "test: cover the CLI view of a failing migration and no partial write (PMK-118)

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

Complexidade: média
