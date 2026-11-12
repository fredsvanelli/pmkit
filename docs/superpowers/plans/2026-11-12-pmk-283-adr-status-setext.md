# PMK-283 adr-status on a setext-underlined Status: Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Pin, with exact assertions, what `setAdrStatus` and `docs adr-status` write for `## Status\nAccepted\n---`, and what `docs adr-get` reads before and after.

**Architecture:** Two characterization tests in `scripts/adr.test.mjs` (one unit, one CLI) and one CHANGELOG line. No production code changes.

**Tech Stack:** Node test runner (`node --test`), `assert/strict`, existing helpers `repo()`, `writeAdr()`, `adrStatus()`, `adrGetFrom()`.

**Spec:** `docs/superpowers/specs/2026-11-12-pmk-283-adr-status-setext-design.md`

## Global Constraints

- Do not change `scripts/lib/adr.mjs` or the setext rule.
- Test names and comments say the test pins the CommonMark reading, and that a human sees two status-like entries.
- Commit trailer: `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`; every commit message carries `(PMK-283)`.

## Review Focus

- Input with a blank line before `---` (`## Status\n\nAccepted\n\n---`): already covered by PMK-273 test at `scripts/adr.test.mjs:858`; not repeated here.
- Empty `## Status` followed by a setext heading: reads as `null` in `adr-get`; recorded as a follow-up, not tested here.

---

### Task 1: Unit characterization of `setAdrStatus`

**Files:**
- Modify: `scripts/adr.test.mjs` (insert after the test at line 858's block, before `const headings = {`)

**Interfaces:**
- Consumes: `setAdrStatus(text, status) -> { text, before, after }`, `adrInfo(text) -> { title, status, statuses }` from `scripts/lib/adr.mjs` (already imported in the test file).
- Produces: none.

- [ ] **Step 1: Write the failing test**

```js
test('setAdrStatus on a Status section underlined by --- pins the CommonMark reading (PMK-283)', () => {
  // CommonMark makes `Accepted` a setext h2 heading, so the Status section is empty and the status is null.
  // This pins that reading: a human reader sees two status-like entries (Deprecated and Accepted) after the write.
  const text = '# 1. Use X\n\n## Status\nAccepted\n---\n\n## Context\n\nSome text.\n'
  assert.deepEqual(adrInfo(text), { title: '1. Use X', status: null, statuses: [] })
  assert.deepEqual(setAdrStatus(text, 'deprecated'), {
    text: '# 1. Use X\n\n## Status\n\nDeprecated\n\nAccepted\n---\n\n## Context\n\nSome text.\n',
    before: null,
    after: 'Deprecated',
  })
})
```

- [ ] **Step 2: Run test to verify it passes (characterization: current behaviour is the expectation)**

Run: `node --test --test-name-pattern='PMK-283' scripts/adr.test.mjs`
Expected: PASS, 1 test. If it fails, stop and report the actual output; do not change `adr.mjs`.

- [ ] **Step 3: Commit**

```bash
git add scripts/adr.test.mjs
git commit -m "test(adr): pin setAdrStatus on a Status section underlined by --- (PMK-283)" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: CLI characterization of `docs adr-status` and `docs adr-get`

**Files:**
- Modify: `scripts/adr.test.mjs` (insert after the test from Task 1)

**Interfaces:**
- Consumes: helpers `repo()`, `writeAdr(root, rel, text)`, `adrStatus(root, ...args)` returning `{ code, data, stderr }`, `adrGetFrom(root, id)` returning `{ code, data }` (already defined in the file, as used at line 861).
- Produces: none.

- [ ] **Step 1: Write the test**

```js
test('docs adr-status and docs adr-get on a Status section underlined by --- pin what is written (PMK-283)', async () => {
  const root = repo()
  const text = '# 1. Use X\n\n## Status\nAccepted\n---\n\n## Context\n\nSome text.\n'
  const written = '# 1. Use X\n\n## Status\n\nDeprecated\n\nAccepted\n---\n\n## Context\n\nSome text.\n'
  writeAdr(root, 'docs/adr/0001-use-x.md', text)
  const before = await adrGetFrom(root, '1')
  assert.equal(before.code, 0)
  assert.equal(before.data.status, null)
  const result = await adrStatus(root, '1', 'deprecated')
  assert.equal(result.code, 0, result.stderr)
  assert.deepEqual(result.data.status, { before: null, after: 'Deprecated' })
  assert.equal(fs.readFileSync(path.join(root, 'docs/adr/0001-use-x.md'), 'utf8'), written)
  const after = await adrGetFrom(root, '1')
  assert.equal(after.code, 0)
  assert.equal(after.data.status, 'Deprecated')
})
```

- [ ] **Step 2: Run it to verify it passes**

Run: `node --test --test-name-pattern='PMK-283' scripts/adr.test.mjs`
Expected: PASS, 2 tests. If a helper signature differs from the one above, adapt the call to match the neighbouring tests (`adrGetFrom` at `scripts/adr.test.mjs:861`), not the assertions.

- [ ] **Step 3: Commit**

```bash
git add scripts/adr.test.mjs
git commit -m "test(adr): pin docs adr-status and adr-get on a setext-underlined Status (PMK-283)" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: CHANGELOG line

**Files:**
- Modify: `CHANGELOG.md` (top of `## Unreleased`, line 5 area)

- [ ] **Step 1: Add the line at the top of `## Unreleased`**

```markdown
- Pins with tests what `docs adr-get` and `docs adr-status` do on a `## Status` section whose text is underlined by `---` (PMK-283): `## Status\nAccepted\n---` reads as a setext heading, as CommonMark does, so the section is empty and `adr-status` writes `Deprecated` above the `Accepted` heading. The file then shows two status-like entries to a human reader; the tests fix this current behaviour and change no code.
```

- [ ] **Step 2: Commit**

```bash
git add CHANGELOG.md
git commit -m "docs(changelog): pin adr-status on a setext-underlined Status (PMK-283)" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Full verification

- [ ] **Step 1: Run the whole suite in the foreground**

Run: `npm test; echo "EXIT $?"`
Expected: `EXIT 0`. A failure in `redact-probes.test.mjs:303` under load is known: run that file alone, then repeat `npm test` until it exits 0.
