# PMK-201 macOS test suite Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `npm test` exits 0 on a default macOS setup (`TMPDIR` under the `/var` symlink, case-insensitive APFS, Node 22.22, a loaded machine).

**Architecture:** Test-only changes. Temp folders made by the test helpers become canonical paths; the case test skips where the filesystem folds case; the depth tests trigger the stack overflow with a `toJSON` that throws instead of relying on the stack size; the timing test measures CPU time.

**Tech Stack:** Node `node:test`, `node:fs`, `node:assert/strict`.

**Spec:** issue PMK-201 (`.issues/issues/PMK-201/issue.md`) and the design agreed in chat on 2026-11-08: the issue's path diagnosis was off (the tests already call `realpathSync`; the unresolved path comes from `tempDir()`).

## Global Constraints

- No product code changes. Only `scripts/*.test.mjs` and `scripts/test-helpers.mjs`.
- Every commit message carries `(PMK-201)` and ends with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- The suite still passes on Linux: the case test runs there, and nothing is skipped by platform name.

## Review Focus

- A test that builds an expected path from `os.tmpdir()` and compares it with a `tempDir()` path would break after Task 1. Task 1 runs the whole suite to catch it; if more than a few tests break, fall back to fixing `cli-migrate.test.mjs:102` and `golden-helpers.test.mjs:194` alone.
- The leak guard in `scripts/run-tests.mjs` reads leftovers in its private folder by path; canonical temp paths must still be found and removed. Task 1's full run (exit code, not just failures) checks it.
- The case probe must look at the real folder after the write, not compare strings, so it is right on any filesystem.

---

### Task 1: Canonical temp folders

**Files:**
- Modify: `scripts/test-helpers.mjs:13-17` (`tempDir`)

**Interfaces:**
- Produces: `tempDir(prefix?: string): string` returns `fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), prefix)))`; the same path is pushed to `made`.

- [ ] **Step 1: See the two failures** — `node --test scripts/cli-migrate.test.mjs scripts/golden-helpers.test.mjs`, default `TMPDIR`. Expected: `not ok` for "export from a Linear repository reads the Local side at --path" and "childEnv points the user store at a temp folder".
- [ ] **Step 2: Resolve the path in `tempDir`.**
- [ ] **Step 3: Rerun step 1.** Expected: 0 fail.
- [ ] **Step 4: Full suite with the default `TMPDIR`** — `npm test; echo exit=$?`, then `grep '^not ok'` on the output. Expected: only the case, depth and timing tests may fail; any other new failure means the fallback above.
- [ ] **Step 5: Commit** `test: give test temp folders their real path (PMK-201)`.

### Task 2: Skip the case test where the filesystem folds case

**Files:**
- Modify: `scripts/validate.test.mjs:196-202`

- [ ] **Step 1: Change the test** to take `t`, write `ISS-1AAA`, then, when `fs.existsSync(path.join(root, '.issues', 'issues', 'iss-1aaa'))`, call `t.skip('the filesystem folds case, so ISS-1AAA and iss-1aaa are one folder')` and return. Otherwise write `iss-1aaa` and keep the current assertion.
- [ ] **Step 2: Run** `node --test scripts/validate.test.mjs`. Expected on macOS: 0 fail, the test reported as `# SKIP the filesystem folds case…`.
- [ ] **Step 3: Commit** `test: skip the same-id test where the filesystem folds case (PMK-201)`.

### Task 3: Depth tests independent of the stack size

**Files:**
- Modify: `scripts/cli.test.mjs:1472-1494` (`chainCtx` and the test)
- Modify: `scripts/dependencies.test.mjs:336-341`

**Interfaces:**
- Produces: in each file, a value `const OVERFLOW = { toJSON() { throw new RangeError('Maximum call stack size exceeded') } }` (local to the test file).

- [ ] **Step 1: `dependencies.test.mjs`** — rename the test to "the JSON of a map that overflows JSON.stringify is a PmkitError" and replace the 6000-deep tree with `serializable({ tree: OVERFLOW })`. Keep both assertions (`throws` INVALID_INPUT, `doesNotThrow` on `{ tree: [] }`).
- [ ] **Step 2: `cli.test.mjs`** — `chainCtx(depth, json, { title = 't' } = {})` uses `title` for the last issue. The test keeps the text run at depth 3000 (`includes('N2999')`) and runs JSON with `chainCtx(3000, true, { title: OVERFLOW })`, expecting the same rejection (`INVALID_INPUT`, `/too deep/`). Add one assertion that `chainCtx(3000, true)` without the trigger resolves, so a normal deep chain prints as JSON.
- [ ] **Step 3: Run** `node --test scripts/cli.test.mjs scripts/dependencies.test.mjs`. Expected: 0 fail.
- [ ] **Step 4: Check the trigger is load-bearing** — temporarily remove the `serializable(...)` call at `scripts/pmkit.mjs:518`, rerun step 3, expect the cli test to fail, then restore it.
- [ ] **Step 5: Commit** `test: trigger the JSON overflow without depending on the stack size (PMK-201)`.

### Task 4: CPU time for the matchTodos timing test

**Files:**
- Modify: `scripts/todos.test.mjs:173-175`

- [ ] **Step 1: Measure with `process.cpuUsage()`** — take `const started = process.cpuUsage()` before `matchTodos`, then `const used = process.cpuUsage(started)`, `const ms = (used.user + used.system) / 1000`, and assert `ms < 5000` with the message `` `took ${Math.round(ms)} ms of CPU` ``.
- [ ] **Step 2: Run** `node --test scripts/todos.test.mjs`. Expected: 0 fail.
- [ ] **Step 3: Commit** `test: time matchTodos by CPU, not the clock (PMK-201)`.

### Task 5: Verify and tick the criteria

- [ ] **Step 1: Full suite, default `TMPDIR`** — `npm test > <scratch>/suite.log 2>&1; echo exit=$?`, then `grep '^not ok' <scratch>/suite.log`. Expected: exit 0, no `not ok`.
- [ ] **Step 2: Full suite under load** — run it while 3 other `npm test` copies run. Expected: exit 0.
- [ ] **Step 3: Tick criteria 1–4** with `node scripts/pmkit.mjs issues update PMK-201 --check <n>` (dry run, then real) and commit `.issues/` as `chore(issues): check PMK-201 criteria (PMK-201)`.
