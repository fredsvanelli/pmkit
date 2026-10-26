# PMK-111 Test Temp Directories Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every test that makes a temp directory removes it when the test ends, and `npm test` leaves no `pmkit-*` directory behind.

**Architecture:** `scripts/test-helpers.mjs` gets a registry (`tempDir`) that records each folder it makes. A root-level `afterEach` removes the folders of the finished test, and an `exit` listener removes the rest. `makeRepo`, `fakeGh` and every hand-written `mkdtempSync` in tests go through it. `npm test` runs `scripts/run-tests.mjs`, which gives the test processes a private `TMPDIR` and fails if anything is left in it.

**Tech Stack:** Node 22 (floor in ADR-0003 is Node 18), `node:test`, no dependencies.

**Spec:** `docs/superpowers/specs/2026-10-26-pmk-111-test-temp-dirs-design.md`

## Global Constraints

- No dependencies (ADR-0003). `scripts/plugin.test.mjs` asserts `package.json` has no `dependencies` or `devDependencies`. Use `node:` modules only.
- Do not edit `CHANGELOG.md` (release writes it) or anything under `.issues/`.
- Registry API, in `scripts/test-helpers.mjs`:
  - `tempDir(prefix = 'pmkit-') -> string`: runs `fs.mkdtempSync(path.join(os.tmpdir(), prefix))`, records the path, returns it.
  - `removeTempDirs() -> void`: removes every recorded folder with `fs.rmSync(dir, { recursive: true, force: true })` and empties the record. Exported so tests can call it.
  - At module load, the module registers `afterEach(removeTempDirs)` (root level, from `node:test`) and `process.on('exit', removeTempDirs)` (sync, backstop for file-level folders).
- `makeRepo(name = 'basic')` keeps its signature and return value; only its folder creation changes to `tempDir('pmkit-')`.
- `fake-gh.mjs`: the default `dir` of `fakeGh(canned, dir)` becomes `tempDir('pmkit-pr-')`. Its signature does not change.
- No direct `fs.mkdtempSync` in tests after Task 2. Production code (`scripts/lib/local/migrations.mjs` `planMigration`) and `runScenario` stay unchanged. Existing `try/finally` stays unless `tempDir` makes it dead code.
- `scripts/run-tests.mjs` (node: modules only):
  1. Makes a private folder with `fs.mkdtempSync(path.join(os.tmpdir(), 'pmkit-run-'))`.
  2. Runs `process.execPath` with args `['--test', 'scripts/**/*.test.mjs']` through `spawnSync`, `stdio: 'inherit'`, `cwd` the repo root, and `TMPDIR`, `TMP` and `TEMP` set to the private folder. The glob is the same one `package.json` uses today. Node expands it itself, so the runner passes it unquoted by a shell.
  3. After the run, `findLeaks(dir) -> string[]` lists the private folder's entries. If it is not empty, print `pmkit: tests left N entries in the temp folder:` and one name per line to stderr, remove the folder, and exit 1 even when tests passed. If it is empty, remove the folder and exit with the test run's status (1 when the child was killed by a signal).
  4. Exports `findLeaks`. The CLI part runs only when the file is the entry point (`process.argv[1]` equals `fileURLToPath(import.meta.url)`), so importing it in a test has no side effects.
- `package.json`: `"test"` becomes `node scripts/run-tests.mjs`. Nothing else changes.
- Commit trailer: every commit message ends with `Co-Authored-By: Claude <model of the implementer> <noreply@anthropic.com>`, naming the model that made the commit. Every message also carries the issue ID, for example `test: add tempDir registry (PMK-111)`.

## Review Focus

- A failing test still cleans up: Task 1 runs a fixture that creates a folder and throws, and asserts the folder is gone.
- `makeRepo` keeps its signature. The 21 files that call it must not need an edit.
- Goldens and snapshots do not change. After each task run `node --test scripts/goldens.test.mjs scripts/scenarios.test.mjs` and never regenerate; `git status` must show no change under the golden or snapshot folders.
- `GIT_CEILING_DIRECTORIES` in `scripts/golden-helpers.mjs` uses `os.tmpdir()`, which now points at the private `TMPDIR` under `npm test`. Check the goldens still pass through `npm test`, not only when run alone.
- A child process that makes its own folder (`planMigration`, `runScenario`) cleans up already. The runner's leak check is what would catch a new one.
- `scripts/scenarios-live.mjs` imports `fake-gh.mjs`, so it now loads `node:test` through `test-helpers.mjs`. Check it still loads: `node --check scripts/scenarios-live.mjs` and `node -e "import('./scripts/fake-gh.mjs')"`.
- `npm test` run time: compare against `main` (`time npm test`). The runner adds one directory listing; anything above noise is a bug.

---

### Task 1: `tempDir` registry, `makeRepo` and `fakeGh`

Complexity: standard
Covers: criterion 1 (every test that makes a temp directory removes it, pass or fail)

**Files:**
- Modify: `scripts/test-helpers.mjs`
- Modify: `scripts/fake-gh.mjs:29-32`
- Create: `scripts/__fixtures__/leaky.fixture.mjs` (not matched by the `*.test.mjs` glob)
- Modify: `scripts/test-helpers.test.mjs`

**Interfaces:**
- Produces: `tempDir(prefix?: string): string`, `removeTempDirs(): void`, both exported from `scripts/test-helpers.mjs`. Task 2 imports `tempDir`.

- [ ] **Step 1: Write the failing tests** in `scripts/test-helpers.test.mjs`:
  - `tempDir makes a folder under os.tmpdir() with the prefix`: `const dir = tempDir('pmkit-x-')`; assert `fs.existsSync(dir)`, `path.dirname(dir) === os.tmpdir()`, `path.basename(dir).startsWith('pmkit-x-')`.
  - `removeTempDirs removes every recorded folder and tolerates one already gone`: make two, `fs.rmSync` one by hand, call `removeTempDirs()`, assert neither exists and no throw. Call it again; no throw.
  - `makeRepo and fakeGh folders are registered`: `const root = makeRepo()`, `const { dir } = fakeGh({})`, `removeTempDirs()`, assert both gone.
  - `a folder is removed after a test that throws`: write `scripts/__fixtures__/leaky.fixture.mjs` that imports `tempDir`, creates a folder in a test, writes its path to the file named by `process.env.LEAKY_OUT`, then throws. The test spawns `process.execPath --test <fixture>` with `LEAKY_OUT` set to a path inside a `tempDir()` folder and `TMPDIR` set to another `tempDir()` folder. Assert the child exit status is 1 (the fixture test failed), `LEAKY_OUT` holds a path, and that path no longer exists.
  - Replace the existing hand-written `mkdtempSync` in the `hashTree` test with `tempDir('pmkit-hash-')`.
- [ ] **Step 2: Run** `node --test scripts/test-helpers.test.mjs`. Expected: FAIL, `tempDir` is not exported.
- [ ] **Step 3: Implement** the registry in `scripts/test-helpers.mjs` as described in Global Constraints (import `afterEach` from `node:test`). Change `makeRepo` to call `tempDir('pmkit-')`.
- [ ] **Step 4: Implement** in `scripts/fake-gh.mjs`: delete `scratch`, import `tempDir` from `./test-helpers.mjs`, default `dir = tempDir('pmkit-pr-')`. Update the doc comment.
- [ ] **Step 5: Run** `node --test scripts/test-helpers.test.mjs scripts/cli-pr.test.mjs`, then `node --test scripts/goldens.test.mjs scripts/scenarios.test.mjs`, then `node --check scripts/scenarios-live.mjs`. Expected: all PASS, no golden or snapshot diff in `git status`.
- [ ] **Step 6: Run** `node --test "scripts/**/*.test.mjs"`. Expected: PASS. Count of `ls "${TMPDIR:-/tmp}" | grep -c '^pmkit-'` before and after drops sharply (only the files of Task 2 still leak).
- [ ] **Step 7: Commit** `test: add tempDir registry and use it in makeRepo and fakeGh (PMK-111)` with the trailer.

---

### Task 2: Route hand-written `mkdtempSync` calls through `tempDir`

Complexity: mechanical
Covers: criterion 1 (the folders `makeRepo` and `fakeGh` do not own)

**Files:**
- Modify: `scripts/cli.test.mjs` (lines ~40, 57, 65, 109, 310, 329: `pmkit-init-` and `pmkit-body-`)
- Modify: `scripts/cli-init.test.mjs:27` (`tmp()`)
- Modify: `scripts/cli-pr.test.mjs:14` (`scratch()`)
- Modify: `scripts/config.test.mjs:15` (`tmp()`)
- Modify: `scripts/events.test.mjs:8` (`tmp()`)
- Modify: `scripts/query-index.test.mjs:17`
- Modify: `scripts/golden-helpers.test.mjs` (lines ~64, 119, 151; keep the `'pmkit golden '` prefix with a space, it tests paths with spaces)
- Modify: `scripts/scenario-helpers.test.mjs:307` (`scratchDir()`)

**Interfaces:**
- Consumes: `tempDir(prefix?: string): string` from `./test-helpers.mjs`.

- [ ] **Step 1: Replace** each `fs.mkdtempSync(path.join(os.tmpdir(), '<prefix>'))` in the files above with `tempDir('<prefix>')`, keeping each prefix. Add `tempDir` to the existing import from `./test-helpers.mjs`, or add the import. Remove `os`, `tmpdir` or `mkdtempSync` imports that become unused. Keep `os.tmpdir()` where tests read it (`run(os.tmpdir(), ...)`, `GIT_CEILING_DIRECTORIES` assertions). Leave existing `try/finally` blocks; remove one only if its sole job was the `rmSync` that `tempDir` now does and the change is trivial.
- [ ] **Step 2: Verify none are left.** Run `grep -n mkdtempSync scripts/*.test.mjs`. Expected: no output.
- [ ] **Step 3: Run** `node --test "scripts/**/*.test.mjs"`. Expected: PASS.
- [ ] **Step 4: Check the leak count** per criterion 2 by hand: `before=$(ls /tmp | grep -c '^pmkit-')`, run the suite, then count again. Expected: the two counts are equal.
- [ ] **Step 5: Run** `node --test scripts/goldens.test.mjs scripts/scenarios.test.mjs`. Expected: PASS, no golden or snapshot diff.
- [ ] **Step 6: Commit** `test: route every test temp folder through tempDir (PMK-111)` with the trailer.

---

### Task 3: `run-tests.mjs` and the `test` script

Complexity: standard
Covers: criterion 2 (`npm test` leaves no `pmkit-*` directory in the temp folder)

**Files:**
- Create: `scripts/run-tests.mjs`
- Create: `scripts/run-tests.test.mjs`
- Modify: `package.json` (`scripts.test`)

**Interfaces:**
- Produces: `findLeaks(dir: string): string[]` exported from `scripts/run-tests.mjs`, returning the entry names of `dir`, sorted.

- [ ] **Step 1: Write the failing tests** in `scripts/run-tests.test.mjs`:
  - `findLeaks returns nothing for an empty folder`: `assert.deepEqual(findLeaks(tempDir('pmkit-leaks-')), [])`.
  - `findLeaks names what is left`: create `pmkit-x` inside a `tempDir()` folder; assert `['pmkit-x']`.
  - `finish returns the exit code and removes the private folder`: `finish(privateDir, status) -> number` prints the leaked names to stderr and returns 1 on leaks, else `status`. Assert: empty folder and status 0 gives 0; empty and status 3 gives 3; a folder holding `pmkit-x` and status 0 gives 1; in every case the folder is gone afterwards.
  - `package.json test script runs the runner`: parse `package.json`, assert `scripts.test === 'node scripts/run-tests.mjs'`.
- [ ] **Step 2: Run** `node --test scripts/run-tests.test.mjs`. Expected: FAIL, module not found.
- [ ] **Step 3: Implement** `scripts/run-tests.mjs` per Global Constraints, exporting `findLeaks(dir)` and `finish(privateDir, status)`. The entry-point block creates the private folder, runs the child, and calls `process.exit(finish(...))`.
- [ ] **Step 4: Change** `package.json` `"test"` to `node scripts/run-tests.mjs`.
- [ ] **Step 5: Run** `npm test`. Expected: PASS and exit 0. Then `ls /tmp | grep -c '^pmkit-'` is unchanged from before the run, and no `pmkit-run-*` folder remains.
- [ ] **Step 6: Prove the failure path.** Temporarily add `fs.mkdtempSync(path.join(os.tmpdir(), 'pmkit-leak-'))` at file level of a throwaway `scripts/zz-leak.test.mjs`, run `npm test`, and expect exit code 1 with `pmkit-leak-...` in the listing (the `exit` listener is not registered in that file, which is the point). Delete the file.
- [ ] **Step 7: Run** `node --test scripts/goldens.test.mjs scripts/scenarios.test.mjs` and `time npm test` against `time` on `main`. Expected: goldens PASS with no diff, run time within noise.
- [ ] **Step 8: Commit** `test: run npm test in a private TMPDIR and fail on leftovers (PMK-111)` with the trailer.
