# PMK-191 ctime test stable: Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The query-index ctime test no longer depends on the kernel's ctime granularity or on the wall clock.

**Architecture:** `readThroughIndex` takes an optional `sign` function, defaulting to `signature`. The named test keeps its size-change half on the real filesystem and moves its ctime-only half to a deterministic test that injects a signer.

**Tech Stack:** Node.js 22, `node:test`, `node:assert/strict`.

**Spec:** `docs/superpowers/specs/2026-11-08-pmk-191-ctime-test-design.md`

## Global Constraints

- Signature stays `size, mtimeMs, ctimeMs, ino` (spec, Non-goals).
- The tracker takes an optional `sign` option and passes it on; production passes none, so the default `signature` applies.
- Commits carry `(PMK-191)` and the trailer `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

- A fake signer whose `ctimeMs` changes must reparse the entry even when size and mtime are equal. Covered by Task 2.
- A signer that throws for a missing file must still give "no entry" for that folder. Covered by Task 1.
- A same-size edit inside the whole `runStates` matrix must be caught by ctime alone. Covered by Task 4.

---

### Task 1: Inject the signer into `readThroughIndex`

**Files:**
- Modify: `scripts/lib/local/query-index.mjs:117-131`
- Test: `scripts/query-index.test.mjs` (new test near the other `readThroughIndex` tests)

**Interfaces:**
- Consumes: `signature(file)` from the same module.
- Produces: `readThroughIndex({ cacheDir, header, ids, fileOf, read, write, sign = signature })`. `sign(fileOf(id))` returns `{ size, mtimeMs, ctimeMs, ino }` or throws.

- [ ] **Step 1: Write the failing test**

Add to `scripts/query-index.test.mjs`:

```js
test('readThroughIndex signs every file with the injected signer', () => withDir((dir) => {
  const f = fake(dir, { A: 'one' })
  const seen = []
  const sign = (file) => { seen.push(file); return { size: 3, mtimeMs: 1, ctimeMs: 2, ino: 9 } }
  readThroughIndex({ cacheDir: f.cacheDir, header: HEADER, ids: ['A'], fileOf: f.fileOf, read: (id) => issueOf(id, 'one'), write: false, sign })
  assert.deepEqual(seen, [f.fileOf('A')])
}))
```

- [ ] **Step 2: Run it to verify it fails**

Run: `node --test --test-name-pattern "injected signer" scripts/query-index.test.mjs`
Expected: FAIL, `seen` is `[]` because the module calls its own `signature`. Note: `readThroughIndex` is not yet imported in the test file; add it to the existing import from `./lib/local/query-index.mjs` as part of this step.

- [ ] **Step 3: Implement**

In `scripts/lib/local/query-index.mjs`, add `sign = signature` to the destructured parameters of `readThroughIndex` and change `sig = signature(fileOf(id))` to `sig = sign(fileOf(id))`. Update the JSDoc: `sign` defaults to `signature`.

- [ ] **Step 4: Run it to verify it passes**

Run: `node --test --test-name-pattern "injected signer" scripts/query-index.test.mjs`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add scripts/lib/local/query-index.mjs scripts/query-index.test.mjs
git commit -m "refactor(index): inject the file signer into readThroughIndex (PMK-191)" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task 2: Make the ctime half deterministic

**Files:**
- Modify: `scripts/query-index.test.mjs:140-160` (the test "an edit reparses that file only, and a same-size edit with the mtime restored is caught by ctime")

**Interfaces:**
- Consumes: `readThroughIndex` with `sign` from Task 1.

- [ ] **Step 1: Write the failing test**

Replace the ctime half (from the `settle` after the size edit onward) of that test with a new test, and rename the original to `an edit that changes the size reparses that file only`:

```js
test('a same-size change with equal size, mtime and ino is caught by a changed ctime alone', () => withDir((dir) => {
  const files = path.join(dir, 'files')
  fs.mkdirSync(files, { recursive: true })
  fs.writeFileSync(path.join(files, 'A'), 'one')
  const cacheDir = path.join(dir, '.cache')
  const fileOf = (id) => path.join(files, id)
  const read = (id) => issueOf(id, fs.readFileSync(fileOf(id), 'utf8'))
  let ctimeMs = 2
  const sign = () => ({ size: 3, mtimeMs: 1, ctimeMs, ino: 9 })
  const run = () => readThroughIndex({ cacheDir, header: HEADER, ids: ['A'], fileOf, read, write: true, sign })
  run()
  settle(cacheDir)
  assert.deepEqual(counts(run().stats), { parsed: 0, reused: 1, written: false })
  fs.writeFileSync(fileOf('A'), 'TWO')
  ctimeMs = 3
  settle(cacheDir)
  const result = run()
  assert.deepEqual(result.issues, [issueOf('A', 'TWO')])
  assert.equal(result.stats.parsed, 1)
}))
```

The `settle` helper only moves the index mtime; with a fake signer and an index an hour ahead, no entry is racy, so the signature alone decides.

- [ ] **Step 2: Run it to verify it fails**

Run: `node --test --test-name-pattern "changed ctime alone" scripts/query-index.test.mjs`
Expected: FAIL only if the signer is ignored. Before Task 1 it would reuse the entry; after Task 1 it should PASS. Confirm the failure mode by temporarily making `sign` return the same ctime: the test must then fail with `parsed` 0.

- [ ] **Step 3: Remove the real-clock half**

In the original test, delete the lines from the second `settle` through the `B` assertions (the `while (fs.statSync ... ctimeMs ...)` loop, the `pinned` restore and the `result.issues[1]` check), keeping the size-edit assertions. Rename it to `an edit that changes the size reparses that file only`.

- [ ] **Step 4: Run both tests**

Run: `node --test --test-name-pattern "reparses that file only|changed ctime alone" scripts/query-index.test.mjs`
Expected: PASS, 2 tests.

- [ ] **Step 5: Commit**

```bash
git add scripts/query-index.test.mjs
git commit -m "test(index): check the ctime signature with an injected signer (PMK-191)" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task 3: CHANGELOG, verification and the 20-run gate

**Files:**
- Modify: `CHANGELOG.md` (top line under `## Unreleased`)

- [ ] **Step 1: Add the changelog line**

Add at the top of `## Unreleased`, in the style of the existing lines: `- Test: the query-index ctime check no longer depends on the kernel clock (PMK-191).`

- [ ] **Step 2: Run the file 20 times in a row**

Run: `for i in $(seq 1 20); do node --test scripts/query-index.test.mjs >/dev/null 2>&1 || echo "FAIL $i"; done; echo done`
Expected: `done` with no `FAIL` lines.

- [ ] **Step 3: Run the full suite in the foreground**

Run: `npm test; echo "EXIT $?"`
Expected: `EXIT 0`. Check the exit code, not only the failure count (lesson round 5).

- [ ] **Step 4: Commit**

```bash
git add CHANGELOG.md
git commit -m "docs(changelog): query-index ctime test is clock-free (PMK-191)" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task 4: Run the `runStates` matrix on the injected signer

Added after the first pass, when the rebase on `origin/develop` showed that `runStates` still used the kernel's
ctime (through `tick()`).

**Files:**
- Modify: `scripts/lib/local/tracker.mjs` (`createLocalTracker` option `sign`, passed to `readThroughIndex`)
- Modify: `scripts/query-index.test.mjs` (`ctimeSigner`, `assertSame`, `runStates`; `tick` removed)

**Interfaces:**
- Consumes: `readThroughIndex` with `sign` from Task 1.
- Produces: `createLocalTracker(root, { ..., sign })`. `ctimeSigner()` returns `{ sign(file), bump(file) }`; `sign` gives the real size, mtime and inode with `ctimeMs` 0 until a bump, then the bump count.

- [ ] **Step 1: Write the failing check**

Change `runStates` to call `signer.bump(fileOf(a))` after the same-size edit and to pass `sign: signer.sign` to every tracker and to `assertSame`. Then temporarily make `bump` a no-op.
Run: `node --test scripts/query-index.test.mjs`
Expected: FAIL in `team fixture`, `broken fixture` and `basic fixture`, with `parsed` 0 at `same-size edit`. Restore `bump` afterwards.

- [ ] **Step 2: Implement**

Add the optional `sign` option to `createLocalTracker` and pass it into `readThroughIndex` in `indexedRead`. Write `ctimeSigner` as described in the spec, remove `tick`, and move the remaining `trackerFor(root)` and `assertSame` calls in `runStates` to the signer.

- [ ] **Step 3: Run the whole file**

Run: `node --test scripts/query-index.test.mjs`
Expected: PASS, 35 tests, 0 failures.

- [ ] **Step 4: Commit**

```bash
git add scripts/lib/local/tracker.mjs scripts/query-index.test.mjs docs/superpowers/specs/2026-11-08-pmk-191-ctime-test-design.md docs/superpowers/plans/2026-11-08-pmk-191-ctime-test.md
git commit -m "test(index): run the runStates matrix on the injected signer (PMK-191)" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```
