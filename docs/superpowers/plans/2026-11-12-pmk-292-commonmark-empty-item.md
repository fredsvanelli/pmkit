# PMK-292 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Pin with tests that the end of the `## Status` section follows CommonMark for an empty list item, for a 10-digit ordered marker and for the 9-digit limit.

**Architecture:** Test-only. `scripts/lib/adr.mjs` (`sectionEnd`, PMK-291) already behaves as the issue asks; the new tests run each case through `adrInfo`, `setAdrStatus` and the CLI (`docs adr-get`, `docs adr-status`), in the style of the PMK-291 tests in `scripts/adr.test.mjs`.

**Tech Stack:** Node 22 (`node --test`), the existing helpers `repo`, `writeAdr`, `adrGetFrom`, `adrStatus` in `scripts/adr.test.mjs`.

**Spec:** `docs/superpowers/specs/2026-11-12-pmk-292-commonmark-empty-item-design.md`

## Global Constraints

- Do not change `scripts/lib/adr.mjs`.
- Run `npm test` with Node 22 (`node --version` shows v22.x); the exit code must be 0.
- Every commit message ends with `(PMK-292)` and the trailer `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

- Empty item followed by a `---` underline (not only `===`) ends the section at the line: covered by Task 1.
- Empty ordered item `1.` followed by a line and an underline: covered by Task 1.
- A 10-digit marker with a blank line before it is paragraph text: covered by Task 2.
- A 10-digit marker glued to the status text: the underline takes the text, status null: covered by Task 2.
- A 9-digit marker is still a list item and keeps the section open: covered by Task 3.

## Task 1: Empty item followed by a line and a setext underline

**Files:**
- Test: `scripts/adr.test.mjs` (append after the last test in the file)

**Interfaces:**
- Consumes: `adrInfo`, `setAdrStatus`, `repo`, `writeAdr`, `adrGetFrom`, `adrStatus` (already in the file)
- Produces: none

- [ ] **Step 1: Write the failing test**

Append to `scripts/adr.test.mjs`:

```js
test('an empty item followed by a line and a === or --- underline ends the Status section at that line, in adr-get and adr-status alike (PMK-292)', async () => {
  const cases = {
    'empty - then ---': ['Accepted\n\n-\nfoo\n---\n', 'Accepted -'],
    'empty * then ===': ['Accepted\n\n*\nfoo\n===\n', 'Accepted *'],
    'empty * then ---': ['Accepted\n\n*\nfoo\n---\n', 'Accepted *'],
    'empty 1. then ===': ['Accepted\n\n1.\nfoo\n===\n', 'Accepted 1.'],
    'empty 1. then ---': ['Accepted\n\n1.\nfoo\n---\n', 'Accepted 1.'],
  }
  const root = repo()
  let number = 20
  for (const [name, [tail, status]] of Object.entries(cases)) {
    const text = `# ${number}. Use E\n\n## Status\n\n${tail}\n## Context\n\nWhy.\n`
    assert.equal(adrInfo(text).status, status, name)
    const written = setAdrStatus(text, 'deprecated').text
    assert.match(written, /\n## Status\n\nDeprecated\n/, name)
    assert.ok(written.endsWith('\n## Context\n\nWhy.\n'), name)
    const file = `docs/adr/${String(number).padStart(4, '0')}-use-e.md`
    writeAdr(root, file, text)
    assert.equal((await adrGetFrom(root, String(number))).data.status, status, name)
    assert.equal((await adrStatus(root, String(number), 'deprecated')).code, 0, name)
    assert.equal(fs.readFileSync(path.join(root, file), 'utf8'), written, name)
    number++
  }
})
```

- [ ] **Step 2: Run test to verify it passes**

Run: `node --test --test-name-pattern "empty item followed by a line" scripts/adr.test.mjs`
Expected: PASS (the behaviour is already there; this test pins it). If a case fails, stop: this is the issue's case wrong, and the coordinator gets a PERGUNTA.

- [ ] **Step 3: Commit**

```bash
git add scripts/adr.test.mjs
git commit -m "test(adr): empty item then a line and a --- or === underline (PMK-292)" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

## Task 2: A 10-digit ordered marker is paragraph text

**Files:**
- Test: `scripts/adr.test.mjs` (append)

**Interfaces:**
- Consumes: same helpers as Task 1
- Produces: none

- [ ] **Step 1: Write the failing test**

```js
test('a 10-digit ordered marker is paragraph text, so an underline ends the Status section at it, in adr-get and adr-status alike (PMK-292)', async () => {
  const cases = {
    'blank line, then --- underline': ['Accepted\n\n1234567890. a\nb\n---\n', 'Accepted'],
    'blank line, then === underline': ['Accepted\n\n1234567890. a\nb\n===\n', 'Accepted'],
    // Glued to the status text, the underline takes the text with it, as a setext heading does (PMK-273).
    'glued to the status, then ---': ['Accepted\n1234567890. a\nb\n---\n', null],
  }
  const root = repo()
  let number = 30
  for (const [name, [tail, status]] of Object.entries(cases)) {
    const text = `# ${number}. Use T\n\n## Status\n\n${tail}\n## Context\n\nWhy.\n`
    assert.equal(adrInfo(text).status, status, name)
    const written = setAdrStatus(text, 'deprecated').text
    assert.ok(written.endsWith('\n## Context\n\nWhy.\n'), name)
    const file = `docs/adr/${String(number).padStart(4, '0')}-use-t.md`
    writeAdr(root, file, text)
    assert.equal((await adrGetFrom(root, String(number))).data.status, status, name)
    assert.equal((await adrStatus(root, String(number), 'deprecated')).code, 0, name)
    assert.equal(fs.readFileSync(path.join(root, file), 'utf8'), written, name)
    number++
  }
})
```

- [ ] **Step 2: Run test to verify it passes**

Run: `node --test --test-name-pattern "10-digit ordered marker" scripts/adr.test.mjs`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add scripts/adr.test.mjs
git commit -m "test(adr): a 10-digit ordered marker is paragraph text (PMK-292)" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

## Task 3: The 9-digit limit

**Files:**
- Test: `scripts/adr.test.mjs` (append)

**Interfaces:**
- Consumes: same helpers as Task 1
- Produces: none

- [ ] **Step 1: Write the failing test**

```js
test('a 9-digit ordered marker is still a list item, so the Status section stays open past it, in adr-get and adr-status alike (PMK-292)', async () => {
  const text = '# 40. Use N\n\n## Status\n\nAccepted\n\n123456789. a\nb\n---\n\n## Context\n\nWhy.\n'
  assert.equal(adrInfo(text).status, 'Accepted 123456789. a b ---')
  const root = repo()
  const file = 'docs/adr/0040-use-n.md'
  writeAdr(root, file, text)
  assert.equal((await adrGetFrom(root, '40')).data.status, 'Accepted 123456789. a b ---')
  assert.equal((await adrStatus(root, '40', 'deprecated')).code, 0)
  assert.match(fs.readFileSync(path.join(root, file), 'utf8'), /\n## Status\n\nDeprecated\n\n123456789\. a\nb\n---\n\n## Context\n/)
})
```

- [ ] **Step 2: Run test to verify it passes**

Run: `node --test --test-name-pattern "9-digit ordered marker" scripts/adr.test.mjs`
Expected: PASS. If the regex fails on blank-line placement, adjust the regex to the actual output (the assertion is that the item lines are kept as written), not the code.

- [ ] **Step 3: Commit**

```bash
git add scripts/adr.test.mjs
git commit -m "test(adr): a 9-digit ordered marker is still a list item (PMK-292)" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

## Task 4: CHANGELOG, criteria, full test run

**Files:**
- Modify: `CHANGELOG.md` (top, under `## Unreleased`)

**Interfaces:**
- Consumes: Tasks 1 to 3
- Produces: none

- [ ] **Step 1: Add the CHANGELOG line** in the style of the existing lines under `## Unreleased`, saying it is test-only and cites PMK-291, for example: `- Tests only: pin the CommonMark end of the Status section for an empty list item and for 9- and 10-digit ordered markers, behaviour already in place from PMK-291 (PMK-292).`

- [ ] **Step 2: Run the full suite**

Run: `npm test; echo "exit=$?"`
Expected: `exit=0`. Run it in the foreground with a long timeout.

- [ ] **Step 3: Commit**

```bash
git add CHANGELOG.md
git commit -m "docs(changelog): PMK-292 test-only CommonMark status cases (PMK-292)" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```
