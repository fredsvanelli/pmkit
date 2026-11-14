# PMK-276: Supersedes mixed-case test Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix with a test that `docs adr-get <old> --from docs/adr/<new>` gives `supersedesRef` equal to `ref` when the old ADR is in a Local tracker outside the repository.

**Architecture:** Test-only change in `scripts/adr.test.mjs`, reusing the `adrGetFrom` helper and the `withOutsideTracker` fixture. No production code changes.

**Tech Stack:** Node test runner (`node:test`), the existing `scripts/adr.test.mjs` helpers.

**Spec:** `docs/superpowers/specs/2026-11-14-pmk-276-supersedes-mixed-case-design.md`

## Global Constraints

- Test-only: do not change `scripts/lib/adr.mjs` or any production file.
- Commit message carries the issue ID: `test(adr): ... (PMK-276)`, with the trailer `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

Not applicable: the spec is a single fixed case with no user input beyond the path argument, which the existing PMK-270 test already covers for rejection.

---

### Task 1: Mixed-case test

**Files:**
- Test: `scripts/adr.test.mjs` (insert after the test titled `docs adr-get --from keeps ref for repository ADRs and a tracker inside the repository, and is null without it (PMK-270)`)

**Interfaces:**
- Consumes: `withOutsideTracker(inGit, fn)`, `writeAdr(root, rel, text?)`, `adrGetFrom(root, ...args)` (all in `scripts/adr.test.mjs`)
- Produces: none

- [ ] **Step 1: Write the test**

Test name: `docs adr-get --from of a repository ADR that replaces a tracker ADR outside the repository gives supersedesRef equal to ref (PMK-276)`

Body: inside `withOutsideTracker(false, async ({ root, outside }) => { ... })`:
- `writeAdr(root, 'docs/adr/0003-x.md')`
- `const { code, data } = await adrGetFrom(root, '1', '--from', 'docs/adr/0003-x.md')`
- `assert.equal(code, 0)`
- `assert.equal(data.supersedesRef, data.ref)`
- `assert.equal(data.ref, `../${path.basename(outside)}/docs/adr/0001-a.md`)`

- [ ] **Step 2: Run test to verify it passes (characterization)**

Run: `node --test --test-name-pattern "PMK-276" scripts/adr.test.mjs`
Expected: PASS. If `supersedesRef` differs from `ref`, stop and send the PERGUNTA block; do not change `adrRef`.

- [ ] **Step 3: Verify the test can fail**

Temporarily make the assertion expect `'0001-a.md'`, run it, expect FAIL, then restore.

- [ ] **Step 4: Run the full file**

Run: `node scripts/adr.test.mjs` (or `npm test` later)
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add scripts/adr.test.mjs docs/superpowers/specs docs/superpowers/plans .issues/issues/PMK-276
git commit -m "test(adr): pin supersedesRef of a repository ADR replacing a tracker ADR outside (PMK-276)" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```
