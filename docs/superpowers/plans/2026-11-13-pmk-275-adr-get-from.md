# PMK-275 `docs adr-get --from` Implementation Plan

> **For agentic workers:** execute inline with superpowers:executing-plans (no sub-agents, chosen by the orchestrator). Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `docs adr-get <n> --from` refuses a bare or empty `--from` with a "needs a path" message and next step, and matches differently spelled paths to the same ADR folder.

**Architecture:** A per-flag `valueHints` map on the command definition, read by `checkUsage` for the valueless case. `runAdrGet` normalises the path (backslashes, `.` and repeated `/`, optional `tracker:` prefix) before matching folders; the error text quotes what the user typed.

**Tech Stack:** Node 22, `node:test` via `scripts/run-tests.mjs`, no new dependencies.

**Spec:** docs/superpowers/specs/2026-11-13-pmk-275-adr-get-from-design.md

## Global Constraints

- Exit code 2 and `INVALID_INPUT` for the refused cases, as the PMK-270 tests assert.
- No new dependencies. No change to other commands' messages.

## Review Focus

- `--from=` (empty string) gets the same refusal as the bare flag: test in Task 1.
- `tracker:` prefix plus a spelling variant still matches: test in Task 1.

---

### Task 1: Tests for the refusals and the spellings

**Files:**
- Test: `scripts/adr.test.mjs` (next to `docs adr-get --from keeps ref for repository ADRs...`, around line 1306)

**Interfaces:**
- Consumes: the existing helper `adrGetFrom(root, number, ...args)` (returns `{ code, data }`).
- Produces: nothing.

- [ ] **Step 1: Write the failing tests**

```js
test('docs adr-get --from with no path is refused as INVALID_INPUT, with a needs-a-path message (PMK-275)', async () => {
  const root = repo()
  writeAdr(root, 'docs/adr/0001-a.md')
  for (const args of [['--from'], ['--from='], ['--from', '']]) {
    const result = await adrGetFrom(root, '1', ...args)
    assert.equal(result.code, 2, args.join(' '))
    assert.equal(result.data.error.code, 'INVALID_INPUT', args.join(' '))
    assert.match(result.data.error.message, /--from needs a path/, args.join(' '))
    assert.match(result.data.error.nextStep, /--from docs\/adr\//, args.join(' '))
  }
})

test('docs adr-get --from gives the same supersedesRef for every spelling of the path (PMK-275)', async () => {
  const root = repo()
  writeAdr(root, 'docs/adr/0001-a.md')
  writeAdr(root, '.issues/docs/adr/0002-b.md')
  const plain = await adrGetFrom(root, '1', '--from', 'docs/adr/0003-x.md')
  for (const spelling of ['./docs/adr/0003-x.md', 'docs//adr/0003-x.md', 'docs\\adr\\0003-x.md']) {
    const result = await adrGetFrom(root, '1', '--from', spelling)
    assert.equal(result.code, 0, spelling)
    assert.equal(result.data.supersedesRef, plain.data.supersedesRef, spelling)
  }
  const tracker = await adrGetFrom(root, '2', '--from', 'tracker:docs/adr/0003-x.md')
  const trackerOther = await adrGetFrom(root, '2', '--from', 'tracker:./docs//adr/0003-x.md')
  assert.equal(trackerOther.code, 0)
  assert.equal(trackerOther.data.supersedesRef, tracker.data.supersedesRef)
})
```

Note: the tracker case assumes the `root` above has a tracker folder. If `repo()` has none, the test should use `withOutsideTracker` like the PMK-270 test; check the helper while writing it and keep the same shape.

- [ ] **Step 2: Run the tests to see them fail**

Run: `node --test --test-name-pattern "PMK-275" scripts/adr.test.mjs`
Expected: FAIL. The bare flag answers `--from needs a value`, and the `./` and `\` spellings answer `INVALID_INPUT` with "not the path of an ADR".

- [ ] **Step 3: Commit**

```bash
git add scripts/adr.test.mjs
git commit -m "test(docs): cover adr-get --from refusals and spellings (PMK-275)"
```

---

### Task 2: Hint and normalise in the handler

**Files:**
- Modify: `scripts/pmkit.mjs:4389` (`checkUsage`), `scripts/pmkit.mjs:1832` (the `docs adr-get` definition), `scripts/pmkit.mjs:446-455` (`runAdrGet`)

**Interfaces:**
- Consumes: Task 1 tests.
- Produces: `valueHints` on a command definition: `{ [flag]: { message: string, nextStep: string } }`, read only by `checkUsage`.

- [ ] **Step 1: Add the hint to the `docs adr-get` definition**

Add `valueHints: { from: { message: '--from needs a path', nextStep: 'Pass the path docs next-adr gave the new ADR, such as --from docs/adr/0003-x.md' } }` to the command object.

- [ ] **Step 2: Use it in `checkUsage`**

In the `options[key] === true` branch, throw `usageError(hint.message, hint.nextStep)` when `command.valueHints?.[key]` exists, otherwise keep the generic `--${key} needs a value` error.

- [ ] **Step 3: Normalise in `runAdrGet`**

Reject `''` (after `--from=`) with the same message and next step. Then match on the normalised path: split an optional `tracker:` prefix, replace `\` with `/`, `path.posix.normalize` the rest, and use the normalised value for the folder lookup and the basename check. Keep `from` as typed for the error message.

- [ ] **Step 4: Run the targeted tests**

Run: `node --test --test-name-pattern "PMK-275|PMK-270" scripts/adr.test.mjs`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add scripts/pmkit.mjs
git commit -m "fix(docs): refuse a bare --from and match normalised ADR paths (PMK-275)"
```

---

### Task 3: Full verification

- [ ] **Step 1: Run the full suite in the foreground**

Run: `npm test; echo "exit $?"`
Expected: `exit 0`, with no failing tests. Check the exit code, not only the summary (lesson of round 5).

- [ ] **Step 2: Check the `.issues/` changes**

Run: `git status --short`. The `.issues/` changes from claim and checks are committed on this branch with their own commit, and a `CHANGELOG.md` line under `## Unreleased` is added in Task 2's commit if the change is user-visible.
