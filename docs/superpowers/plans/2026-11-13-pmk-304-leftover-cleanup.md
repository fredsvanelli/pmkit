# PMK-304 Leftover Cleanup Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When `issues delete` cannot remove its leftover, the warning names a file inside and permissions as the likely cause, and the `validate` step removes a read-only leftover.

**Architecture:** Two small edits. The warning in `tracker.mjs` appends a cause sentence when the code is `EACCES`, `EPERM` or `ENOTEMPTY`. The `validate` leftover message in `validate.mjs` becomes `chmod -R u+rwX '<rel>' && rm -rf '<rel>'`, with the path shell-quoted.

**Tech Stack:** Node.js (ESM), `node:test`, `node:assert/strict`. No new dependencies.

**Spec:** `docs/superpowers/specs/2026-11-13-pmk-304-leftover-cleanup-design.md`

## Global Constraints

- Warning cause text, verbatim: `a file or folder inside could not be removed, often for lack of write permission`
- Warning codes that get the cause: `EACCES`, `EPERM`, `ENOTEMPTY`. Other codes keep the current text.
- Step text, verbatim: `remove it with: chmod -R u+rwX <q> && rm -rf <q>`, where `<q>` is the relative path wrapped in single quotes, `'` written as `'\''`.
- Permission tests skip when `process.getuid?.() === 0` or on win32.
- Restore permissions in `finally` so the temp-folder leak guard in `scripts/run-tests.mjs` passes.

## Review Focus

- A leftover folder path with a space must work in the step (`.deleting-ISS-X 4242`). Covered by Task 2.
- A path with an apostrophe must not break the quoted step. Covered by Task 2.
- A read-only file inside a writable folder must also be cleared by the step. Covered by Task 2 (the locked subfolder holds a file).
- Warning for a non-permission code must keep its current text. Covered by Task 1.
- Running the step as root: the test skips, the step still works. Covered by the root skip in Task 2.

---

### Task 1: Warning names the cause

**Files:**
- Modify: `scripts/lib/local/tracker.mjs:695`
- Test: `scripts/tracker-delete.test.mjs:200` (the existing test already makes a read-only subfolder and asserts the warning)

**Interfaces:**
- Consumes: nothing new.
- Produces: the warning text in `result.warnings` from `tracker.delete`. Task 2 does not depend on it.

- [ ] **Step 1: Update the failing assertion**

In `scripts/tracker-delete.test.mjs`, replace line 200 with:

```js
    assert.match(result.warnings.join('\n'), /could not be removed: (EACCES|ENOTEMPTY); a file or folder inside could not be removed, often for lack of write permission; run pmkit validate/)
```

- [ ] **Step 2: Run it and see it fail**

Run: `node --test scripts/tracker-delete.test.mjs --test-name-pattern "cleanup that fails"`
Expected: FAIL, the warning has no cause sentence.

- [ ] **Step 3: Implement the cause sentence in `tracker.mjs`**

Above `function deleteWarnings` add `const PERMISSION_CODES = new Set(['EACCES', 'EPERM', 'ENOTEMPTY'])`. In the `catch` at line 695, build the cause part: when `PERMISSION_CODES.has(error.code)`, the cause is `a file or folder inside could not be removed, often for lack of write permission; `, otherwise an empty string. Push `the issue is deleted, but ${rel(trash)} could not be removed: ${error.code ?? error.message}; ${cause}run pmkit validate for the step to remove it`.

- [ ] **Step 4: Run it and see it pass**

Run: `node --test scripts/tracker-delete.test.mjs`
Expected: PASS, all tests in the file.

- [ ] **Step 5: Commit**

```bash
git add scripts/lib/local/tracker.mjs scripts/tracker-delete.test.mjs
git commit -m "fix(issues): name permissions as the cause of a failed delete cleanup (PMK-304)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Step removes a read-only leftover

**Files:**
- Modify: `scripts/lib/validate.mjs:340`
- Modify: `scripts/validate.test.mjs:17-30` (update the expected message)
- Test: `scripts/validate.test.mjs` (new test after the first one)

**Interfaces:**
- Consumes: nothing.
- Produces: the leftover problem message `... remove it with: chmod -R u+rwX <q> && rm -rf <q>`.

- [ ] **Step 1: Update the expected message and add the failing test**

In `scripts/validate.test.mjs`, change the expected `message` on line 26 to:

```js
    message: 'it is what a failed issues delete left behind, not an issue; remove it with: chmod -R u+rwX \'.issues/issues/.deleting-ISS-X-4242\' && rm -rf \'.issues/issues/.deleting-ISS-X-4242\'',
```

Add `import { spawnSync } from 'node:child_process'` at the top if it is missing. Add after the first test:

```js
test('the leftover step removes a read-only leftover, with spaces and an apostrophe in its path', { skip: process.getuid?.() === 0 || process.platform === 'win32' }, () => {
  const root = makeRepo('basic')
  const leftover = path.join(root, '.issues', 'issues', ".deleting-ISS-X 4'2")
  const locked = path.join(leftover, 'comments')
  fs.mkdirSync(locked, { recursive: true })
  fs.writeFileSync(path.join(locked, 'c.md'), 'x')
  fs.chmodSync(locked, 0o555)
  try {
    const problem = validateRepo(root).problems.find((item) => item.code === 'leftover')
    const step = problem.message.split('remove it with: ')[1]
    const run = spawnSync('sh', ['-c', step], { cwd: root, encoding: 'utf8' })
    assert.equal(run.status, 0, run.stderr)
    assert.equal(fs.existsSync(leftover), false)
  } finally {
    if (fs.existsSync(locked)) fs.chmodSync(locked, 0o755)
    fs.rmSync(leftover, { recursive: true, force: true })
  }
})
```

- [ ] **Step 2: Run it and see it fail**

Run: `node --test scripts/validate.test.mjs`
Expected: FAIL, the message still says `rm -rf`, and the new test's step fails on the read-only subfolder.

- [ ] **Step 3: Implement the quoted step in `validate.mjs`**

Near the top of the issues section, next to `const LEFTOVER`, add `const shellQuote = (text) => \`'${text.replace(/'/g, "'\\\\''")}'\``. Replace line 340 so its message is `it is what a failed issues delete left behind, not an issue; remove it with: chmod -R u+rwX ${q} && rm -rf ${q}`, where `const q = shellQuote(rel(dir))`.

- [ ] **Step 4: Run it and see it pass**

Run: `node --test scripts/validate.test.mjs`
Expected: PASS, all tests in the file.

- [ ] **Step 5: Commit**

```bash
git add scripts/lib/validate.mjs scripts/validate.test.mjs
git commit -m "fix(validate): make the leftover step remove a read-only folder (PMK-304)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Changelog, docs and verification

**Files:**
- Modify: `CHANGELOG.md` (one line at the top of `## Unreleased`, in the style of the lines already there)
- Modify: `.issues/issues/PMK-304/` (acceptance checks, through the CLI)

**Interfaces:**
- Consumes: Tasks 1 and 2.
- Produces: the verified branch.

- [ ] **Step 1: Add the changelog line**

Read the top of `CHANGELOG.md`, add one line under `## Unreleased` in the same style as its neighbors, saying that a failed `issues delete` cleanup names permissions as the cause and that `validate` removes a read-only leftover (PMK-304).

- [ ] **Step 2: Run the suite on Node 22**

Run: `node --version` then `npm test`, in the foreground, with a long timeout.
Expected: exit code 0. Check the exit code, not only the failure count.

- [ ] **Step 3: Run the two files on Node 26**

Run: `/opt/homebrew/bin/node --test scripts/tracker-delete.test.mjs scripts/validate.test.mjs`
Expected: PASS on v26.4.0.

- [ ] **Step 4: Check the acceptance criteria in the tracker (dry-run, then real)**

Run: `node scripts/pmkit.mjs issues update PMK-304 --check 1 --dry-run --json` and the same with `--check 2`, then without `--dry-run`. Commit `.issues/` with the trailer.

- [ ] **Step 5: Commit the changelog**

```bash
git add CHANGELOG.md
git commit -m "docs(changelog): note the delete cleanup cause and leftover step (PMK-304)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```
