# PMK-272 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Pin the one-second unarchive history ceiling and the Local `bulk unarchive --limit` refusal with tests, without changing behaviour.

**Architecture:** Tests only. One unit test on the event replay, one CLI test on real archive and unarchive calls, and one tightened assertion on the existing bulk limit test.

**Tech Stack:** Node.js built-in test runner (`node:test`), `assert/strict`, the pmkit CLI helpers in `scripts/cli-bulk.test.mjs`.

**Spec:** `docs/superpowers/specs/2026-11-11-pmk-272-unarchive-one-second-limit-tests-design.md`

## Global Constraints

- No change to `scripts/lib/local/events.mjs`, `scripts/lib/bulk.mjs` or the `ponytail:` comment.
- Commit trailer, exactly: `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Every commit message carries `(PMK-272)`.
- Do not run the CLI inside `scripts/__fixtures__/`.

## Review Focus

- Four real flips in one second must show two events, not four, and must not be read as anything other than the known ceiling. Pinned by Task 1 and Task 2.
- A bulk unarchive with `--limit` must refuse because of the flag, not because of another `INVALID_INPUT`. Pinned by Task 3 (message assertion).
- A bulk unarchive with `--limit` must not write anything. Pinned by Task 3 (the test is a dry run).

## Task 1: Unit test for four flips in one second

**Files:**
- Test: `scripts/events.test.mjs` (add after the test at line 60, "PMK-267")

**Interfaces:**
- Consumes: `readEvents`, `replay` from `scripts/lib/local/events.mjs` (already imported in the test file).
- Produces: none.

- [ ] **Step 1: Write the failing test**

Add this test (the helpers `tmp`, `write` and the `ev` pattern already exist in the file):

```js
test('four real flips in one second, without a merge, show as two events and leave the issue unarchived (PMK-272, known ceiling of PMK-267)', () => {
  const ev = (op) => JSON.stringify({ at: '2026-10-01T10:00:00Z', by: 'f', op })
  const run = [ev('archive'), ev('unarchive'), ev('archive'), ev('unarchive')]
  const { events, problems } = readEvents(write(tmp(), 'events6.jsonl', run.join('\n') + '\n'))
  assert.deepEqual(problems, [])
  assert.deepEqual(events.map((event) => event.op), ['archive', 'unarchive'])
  assert.equal(replay(events).archived, undefined)
})
```

- [ ] **Step 2: Run it**

Run: `node --test scripts/events.test.mjs`
Expected: PASS. The behaviour already exists (equal halves rule). This test pins it; Task 4 proves it fails when the rule is removed.

- [ ] **Step 3: Commit**

```bash
git add scripts/events.test.mjs
git commit -m "test(issues): pin four real flips in one second as two events (PMK-272)" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

## Task 2: CLI test for real flips in one second

**Files:**
- Test: `scripts/cli-bulk.test.mjs` (add after the PMK-250 unarchive test, which ends near line 436)

**Interfaces:**
- Consumes: `withRepo`, `ok`, `cli` helpers and `ENV` (with a fixed `PMKIT_NOW`) already defined in the file. `ids.A` is an existing issue.
- Produces: none.

- [ ] **Step 1: Write the failing test**

```js
// PMK-272: the one-second ceiling of PMK-267, through the real commands.
test('four real archive and unarchive calls in one second show two history events and leave the issue active (PMK-272)', async () => {
  await withRepo(async (root, ids) => {
    for (const verb of ['archive', 'unarchive', 'archive', 'unarchive']) await ok(root, ['issues', verb, ids.A])
    const { data } = await ok(root, ['issues', 'get', ids.A, '--history'])
    assert.deepEqual(data.history.filter((event) => ['archive', 'unarchive'].includes(event.op)).map((event) => event.op), ['archive', 'unarchive'])
    assert.ok((await ok(root, ['issues', 'list'])).issues.some((issue) => issue.id === ids.A))
  })
})
```

Note: check the shape `ok` returns before running. `ok` returns the JSON body (other tests use `real.before.archived`, so the body is the top-level object). If the history sits at the top level, use `(await ok(...)).history` instead of `data.history`. Confirm with `grep -n "history" scripts/cli-bulk.test.mjs` and the `issues get --history` output in one run, then fix the access path in this step.

- [ ] **Step 2: Run it**

Run: `node --test scripts/cli-bulk.test.mjs --test-name-pattern="PMK-272"`
Expected: PASS, once the access path from Step 1 is right.

- [ ] **Step 3: Commit**

```bash
git add scripts/cli-bulk.test.mjs
git commit -m "test(issues): pin real archive and unarchive in one second as two events (PMK-272)" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

## Task 3: Tighten the bulk unarchive limit assertion

**Files:**
- Modify: `scripts/cli-bulk.test.mjs:465-472` (the test "bulk unarchive without --archived or with a limit is INVALID_INPUT")

**Interfaces:**
- Consumes: the flag parser's message on the Local tracker: `unknown option --limit for issues bulk`, code `INVALID_INPUT`.
- Produces: none.

- [ ] **Step 1: Change the assertion**

Replace

```js
    assert.equal(limited.body.error.code, 'INVALID_INPUT')
```

with

```js
    assert.equal(limited.body.error.code, 'INVALID_INPUT')
    assert.match(limited.body.error.message, /unknown option --limit for issues bulk/)
```

- [ ] **Step 2: Run it**

Run: `node --test scripts/cli-bulk.test.mjs --test-name-pattern="with a limit is INVALID_INPUT"`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add scripts/cli-bulk.test.mjs
git commit -m "test(issues): pin the bulk unarchive limit refusal message (PMK-272)" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

## Task 4: Mutation checks and the full suite

**Files:** none changed in the final tree. Temporary edits are reverted before commit.

- [ ] **Step 1: Mutate the equal-halves rule**

In `scripts/lib/local/events.mjs`, temporarily make the `if (Number.isInteger(half) && ...)` condition `false`. Run `node --test scripts/events.test.mjs --test-name-pattern="PMK-272"`. Expected: FAIL (events has four entries). Then revert with `git checkout -- scripts/lib/local/events.mjs`.

- [ ] **Step 2: No mutation for the limit refusal**

The refusal comes from the flag parser, not from `scripts/lib/bulk.mjs`, so Task 3's message assertion is the check. Nothing to mutate here. Expected: the Task 3 test passes on the current tree (it already did in Task 3).

- [ ] **Step 3: Confirm the tree is clean of mutations**

Run: `git status --short`. Expected: only `.issues/` changes that were already committed, the docs, and `package-lock.json` (untracked, not ours). No `events.mjs` or `bulk.mjs` diff.

- [ ] **Step 4: Full suite, foreground, check the exit code**

Run: `npm test; echo "EXIT=$?"` with a long timeout. Expected: `EXIT=0`. A zero failure count with exit 1 counts as a failure (run-tests leak guard).
