# PMK-274 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Step 2 of `commands/spec/record-decision.md` stops keeping the old ADR's `ref` for the Supersedes line, and steps 2 and 4 agree that the line cites `supersedesRef`.

**Architecture:** A text change in one command file, guarded by a rule test in `scripts/plugin.test.mjs` that is written first. No code path changes.

**Tech Stack:** Node test runner (`npm test`), Markdown command files, the CHANGELOG.

**Spec:** `docs/superpowers/specs/2026-11-11-pmk-274-record-decision-step-2-ref-design.md`

## Global Constraints

- The phrase `` `ref` is the path without the display label `tracker:` `` stays verbatim in step 2 (asserted at `scripts/plugin.test.mjs:219`).
- No rule of `commands/spec/record-decision.md` is removed; every existing assertion in the `record-decision` block of `scripts/plugin.test.mjs` keeps passing.
- Commit messages carry `(PMK-274)` and end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

- `ref` in step 2 read as a citation for the Supersedes line, in any spelling of the sentence. Test: step 2 must not match `/keep its .*ref/` and must say the line never takes `ref`.
- The `../...` explanation survives in step 2 and misleads the agent. Test: step 2 does not contain `../`.
- Step 2 and step 4 disagree on what the line cites. Test: step 2 names `supersedesRef` as what step 4 reads.

---

### Task 1: Rule test for step 2

**Files:**
- Test: `scripts/plugin.test.mjs` (the `record-decision` block, after the existing step 2 assertions near line 219)

**Interfaces:**
- Consumes: the existing `step(number)` helper in that block (it returns the text of step `number`).
- Produces: nothing for later tasks.

- [ ] **Step 1: Write the failing test**

Add these assertions right after the line that asserts `` `ref` is the path without the display label `tracker:` `` in step 2:

```js
  assert.doesNotMatch(step(2), /keep its .*`ref`/, 'step 2 does not keep ref for the Supersedes line (PMK-274)')
  assert.doesNotMatch(step(2), /\.\.\//, 'step 2 does not explain the ../ form of ref (PMK-274)')
  assert.match(step(2), /the Supersedes line never takes it/, 'step 2 says the line never takes ref (PMK-274)')
  assert.match(step(2), /`supersedesRef`, which step 4 reads/, 'steps 2 and 4 agree the line cites supersedesRef (PMK-274)')
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test scripts/plugin.test.mjs`
Expected: FAIL on the first new assertion (step 2 still contains "keep its ... `ref`").

### Task 2: Rewrite the step 2 sentences

**Files:**
- Modify: `commands/spec/record-decision.md` step 2 (the paragraph starting `2. Check the related issues.`)

**Interfaces:**
- Consumes: nothing.
- Produces: step 2 text that Task 1's assertions read.

- [ ] **Step 1: Replace the sentences**

Replace this text:

```
The older ADR is the one this call names, so keep its `number` and its `ref`. `ref` is the path without the display label `tracker:` that `path` carries for a tracker outside the repository; for a tracker outside the repository it is the path from the repository root (`../...`). The Supersedes line cites `supersedesRef`, which step 4 reads once the new ADR's path is known.
```

with:

```
The older ADR is the one this call names, so keep its `number`. `ref` is the path without the display label `tracker:` that `path` carries for a tracker outside the repository. It only shows the user which file the ADR is; the Supersedes line never takes it. The Supersedes line cites `supersedesRef`, which step 4 reads once the new ADR's path is known.
```

- [ ] **Step 2: Run the rule test to verify it passes**

Run: `node --test scripts/plugin.test.mjs`
Expected: PASS, all tests in the file.

- [ ] **Step 3: Commit**

```bash
git add commands/spec/record-decision.md scripts/plugin.test.mjs
git commit -m "docs(spec): stop record-decision step 2 keeping ref for Supersedes (PMK-274)"
```

Add the trailer `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>` as the last line of the message.

### Task 3: CHANGELOG line

**Files:**
- Modify: `CHANGELOG.md` (under `## Unreleased`, at the top, same style as the lines there)

**Interfaces:**
- Consumes: nothing.
- Produces: nothing.

- [ ] **Step 1: Add the line**

Read the first lines under `## Unreleased` and add one line in the same style, naming `/pmkit:spec:record-decision` step 2 and PMK-274.

- [ ] **Step 2: Verify**

Run: `node --test scripts/plugin.test.mjs` (expected PASS, no CHANGELOG assertion breaks).

- [ ] **Step 3: Commit**

```bash
git add CHANGELOG.md
git commit -m "docs(changelog): record PMK-274 (PMK-274)"
```

### Task 4: Scenario and full test run

**Files:** none changed.

- [ ] **Step 1: Run the record-decision scenario**

Run the scenario named `spec-record-decision` in `scripts/__scenarios__/` with the project's scenario runner (see `scripts/scenarios.test.mjs` for how it is selected). Expected: PASS, no golden changed.

- [ ] **Step 2: Run the full suite in the foreground**

Run: `npm test` (foreground, long timeout). Check the exit code, not only the failure count. Expected: exit code 0.
