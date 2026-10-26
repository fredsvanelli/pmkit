# PMK-115 contract sprint aliases Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The contract suite proves that `current` and `none` work for sprints in `createIssue`, `updateIssue`, `moveToCycle` and `searchIssues`, so a hosted adapter cannot ignore them and still pass.

**Architecture:** Five new `it` blocks and one helper in `scripts/contract-suite.mjs`. The blocks go after the existing cycle test. The tracker already behaves as the tests expect, so no product code changes, and the failing-test step of TDD is the mutation check from the spec, run per task.

**Tech Stack:** Node 18+ ES modules, no dependencies (ADR 0003), `node:test`.

**Spec:** `docs/superpowers/specs/2026-10-26-pmk-115-contract-sprint-aliases-design.md`

## Global Constraints

- Only `scripts/contract-suite.mjs` changes. No product code, no golden, no snapshot, no `scripts/sprints.test.mjs` change. If `npm test` changes a snapshot or golden, stop and read why. Regenerate only with `UPDATE_GOLDENS=1` and read the diff line by line.
- Contract forms of `none`. Writes (`createIssue`, `updateIssue`, `moveToCycle`) use `null`. The `searchIssues` filter uses the string `'none'`. The suite never asserts what the string `'none'` does in a write.
- Error code for `current` with no active sprint is `INVALID_INPUT`, checked by `code` only through the existing `rejects` helper. No message assertions.
- Sprint dates. The active sprint is `openCycle({ start: today }, actor)`. A second, planned sprint is `openCycle({ start: '2099-01-01' }, actor)`. "No active sprint" has three states in test 3: fresh tracker, planned-only, and a sprint opened with `start: today` then closed with `closeCycle`.
- "Write nothing" is proven with the `issueState` snapshot helper (issue, history, `searchIssues({ archived: true })` ids, `listCycles()`, `metricEvents()`), plus one real write (`comment`) and `assert.notEqual` so the equality is not vacuous.
- Search tests read `.issues` only, never other result fields.
- Placement. The five `it` blocks go in `runTrackerContract`, in this order, directly after `'opens a cycle, adds issues, closes it and lists the unfinished ones'` and before `'sets and reads cycle capacity'`. `issueState` goes after `ids` at the top of the file.
- Test counts. `node --test scripts/contract.test.mjs` runs 59 tests before the change and 74 after. `npm test` runs 1011 before and 1026 after. Each test runs three times (plain, promises, no index). Record the real numbers in each task, and tell the orchestrator if they differ from these.
  - After Task 1: 65 and 1017. After Task 2: 68 and 1020. After Task 3: 74 and 1026.
- Commit format. Subject ends with `(PMK-115)`, body ends with `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`.
- Mutation rule. Edit `scripts/lib/local/tracker.mjs` only, with the `sed` line given. Check with `git diff --stat` that exactly that file changed. Undo with `git checkout -- scripts/lib/local/tracker.mjs`, then `git status --porcelain` must print nothing. Never `git stash`. Never commit a mutation. Each mutation also fails the three `Local tracker contract` parent entries. Count leaf tests only. A failing leaf test shows three failures, one per setup.
- No new dependency. Straight quotes, no em dashes in prose.

## Review Focus

1. A planned sprint (future start) counts as "no active sprint" for `current`. Pinned in Task 2, step 4 of test 3, and Task 3, test 5.
2. A closed sprint counts as "no active sprint". Pinned in Task 2, step 5 of test 3.
3. A failed `current` leaves no issue, no history entry and no metric event. Pinned by `issueState` in Task 2.
4. `sprint: 'none'` means "in no sprint", not "not in the active sprint". Pinned in Task 3, tests 4 and 5.
5. `current` in a write stores the sprint id, never the word `current`. Pinned in Task 1.

---

### Task 1: Create, update and move with `current`, and `null` takes issues out

**Files:**
- Modify: `scripts/contract-suite.mjs` (two `it` blocks after the cycle test)
- Test: `scripts/contract.test.mjs`

**Interfaces:**
- Consumes: `ids`, `it` and the `{ tracker, actor, today }` environment already in the file.
- Produces: tests 1 and 2. Task 2 and Task 3 insert after them, in the same place order.

- [ ] **Step 1: Add the two tests** after the `'opens a cycle, adds issues, closes it and lists the unfinished ones'` block.

```js
    it('createIssue and updateIssue with sprint current store the active sprint id', async ({ tracker, actor, today }) => {
      const sprint = (await tracker.openCycle({ start: today }, actor)).after
      const made = await tracker.createIssue({ title: 'Made current', sprint: 'current' }, actor)
      assert.equal(made.after.sprint, sprint.id)
      assert.equal((await tracker.getIssue(made.after.id)).sprint, sprint.id)

      const plain = (await tracker.createIssue({ title: 'Plain' }, actor)).after.id
      const moved = await tracker.updateIssue(plain, { sprint: 'current' }, actor)
      assert.equal(moved.before.sprint, undefined)
      assert.equal(moved.after.sprint, sprint.id)
      assert.equal((await tracker.getIssue(plain)).sprint, sprint.id)

      assert.deepEqual(ids(await tracker.cycleIssues(sprint.id)).sort(), [made.after.id, plain].sort())
    })

    it('moveToCycle with current moves issues into the active sprint, and null takes issues out of their sprint', async ({ tracker, actor, today }) => {
      const sprint = (await tracker.openCycle({ start: today }, actor)).after
      const a = (await tracker.createIssue({ title: 'A' }, actor)).after.id
      const b = (await tracker.createIssue({ title: 'B' }, actor)).after.id

      const moved = await tracker.moveToCycle([a, b], 'current', actor)
      assert.equal(moved.length, 2)
      for (const entry of moved) assert.equal(entry.after.sprint, sprint.id)
      assert.deepEqual(ids(await tracker.cycleIssues(sprint.id)).sort(), [a, b].sort())

      await tracker.moveToCycle([a], null, actor)
      assert.equal((await tracker.getIssue(a)).sprint, undefined)
      assert.deepEqual(ids(await tracker.cycleIssues(sprint.id)), [b])

      await tracker.updateIssue(b, { sprint: null }, actor)
      assert.equal((await tracker.getIssue(b)).sprint, undefined)
      assert.deepEqual(ids(await tracker.cycleIssues(sprint.id)), [])
    })
```

- [ ] **Step 2: Run the focused test.** Run `node --test scripts/contract.test.mjs`. Expect 65 tests, all passing.
- [ ] **Step 3: Run the whole suite.** Run `npm test`. Expect 1017 tests, all passing, no snapshot or golden changed (`git status --porcelain` shows only `scripts/contract-suite.mjs`).
- [ ] **Step 4: Commit.**

```bash
git add scripts/contract-suite.mjs
git commit -m "test: cover sprint current in create, update and moveToCycle (PMK-115)" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

- [ ] **Step 5: Mutation check 1 (test 1 must fail).** Run:

```bash
sed -i "s|^    if (value === 'current') return requireActiveSprintId()\$|    // mutation 1|" scripts/lib/local/tracker.mjs
git diff --stat
node --test scripts/contract.test.mjs 2>&1 | grep -E "✖|fail "
git checkout -- scripts/lib/local/tracker.mjs
git status --porcelain
```

Expected: `git diff --stat` lists only `scripts/lib/local/tracker.mjs`. The leaf test `createIssue and updateIssue with sprint current store the active sprint id` fails (three times). Test 2 passes (it uses `moveToCycle`, which does not call `requireSprint` for `current`). The last command prints nothing. If the diff is empty, the old text drifted, so fix the pattern first. If test 1 passes under the mutation, fix test 1 and amend with a new commit.

Complexidade: baixa

### Task 2: `current` with no active sprint fails and writes nothing

**Files:**
- Modify: `scripts/contract-suite.mjs` (helper after `ids`, one `it` block after test 2)
- Test: `scripts/contract.test.mjs`

**Interfaces:**
- Consumes: `rejects`, `ids`, `it`.
- Produces: `issueState(tracker, issueIds)` returning a JSON string. Task 3 does not use it.

- [ ] **Step 1: Add the helper** directly after the `ids` line.

```js
const issueState = async (tracker, issueIds) => JSON.stringify({
  issues: await Promise.all(issueIds.map(async (id) => ({ issue: await tracker.getIssue(id), history: await tracker.getHistory(id) }))),
  all: (await tracker.searchIssues({ archived: true })).issues.map((issue) => issue.id),
  cycles: await tracker.listCycles(),
  metrics: await tracker.metricEvents(),
})
```

- [ ] **Step 2: Add test 3** after test 2.

```js
    it('sprint current without an active sprint fails with INVALID_INPUT and writes nothing', async ({ tracker, actor, today }) => {
      const a = (await tracker.createIssue({ title: 'A' }, actor)).after.id
      const b = (await tracker.createIssue({ title: 'B' }, actor)).after.id
      const expectNothingWritten = async () => {
        const before = await issueState(tracker, [a, b])
        await rejects(() => tracker.createIssue({ title: 'Never', sprint: 'current' }, actor), 'INVALID_INPUT')
        assert.equal(await issueState(tracker, [a, b]), before)
        await rejects(() => tracker.updateIssue(a, { sprint: 'current' }, actor), 'INVALID_INPUT')
        assert.equal(await issueState(tracker, [a, b]), before)
        await rejects(() => tracker.moveToCycle([a, b], 'current', actor), 'INVALID_INPUT')
        assert.equal(await issueState(tracker, [a, b]), before)
        return before
      }

      await expectNothingWritten()
      await tracker.openCycle({ start: '2099-01-01' }, actor)
      await expectNothingWritten()
      const closing = (await tracker.openCycle({ start: today }, actor)).after
      await tracker.closeCycle(closing.id, actor)
      const last = await expectNothingWritten()

      await tracker.comment(a, 'real', actor)
      assert.notEqual(await issueState(tracker, [a, b]), last)
    })
```

Tests 3, 4 and 5 open a future sprint. An adapter that cannot do that removes the planned-sprint pair of lines in test 3, and the planned sprint with its issue in tests 4 and 5 (spec decision 6).

- [ ] **Step 3: Run the focused test.** `node --test scripts/contract.test.mjs`. Expect 68 tests, all passing.
- [ ] **Step 4: Run the whole suite.** `npm test`. Expect 1020 tests passing and no snapshot or golden change.
- [ ] **Step 5: Commit.**

```bash
git add scripts/contract-suite.mjs
git commit -m "test: cover sprint current without an active sprint (PMK-115)" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

- [ ] **Step 6: Mutation check 2 (tests 2 and 3 must fail).**

```bash
sed -i "s|^    const sprint = to === 'current' ? requireActiveSprintId() : to\$|    const sprint = to|" scripts/lib/local/tracker.mjs
git diff --stat
node --test scripts/contract.test.mjs 2>&1 | grep -E "✖|fail "
git checkout -- scripts/lib/local/tracker.mjs
git status --porcelain
```

Expected: leaf failures are test 2 (`moveToCycle with current ...`) and test 3 (`sprint current without an active sprint ...`). Test 1 passes. The last command prints nothing.

- [ ] **Step 7: Mutation check 4 (only test 3 must fail).**

```bash
sed -i "s|^    if (id === null) throw invalid('there is no active sprint', 'pmkit cycle list')\$|    if (id === null) return null|" scripts/lib/local/tracker.mjs
git diff --stat
node --test scripts/contract.test.mjs 2>&1 | grep -E "✖|fail "
git checkout -- scripts/lib/local/tracker.mjs
git status --porcelain
```

Expected: only test 3 fails among the leaf tests. The last command prints nothing.

Complexidade: média

### Task 3: Search with `current` and `none`

**Files:**
- Modify: `scripts/contract-suite.mjs` (two `it` blocks after test 3, before `'sets and reads cycle capacity'`)
- Test: `scripts/contract.test.mjs`

**Interfaces:**
- Consumes: `ids`, `it`.
- Produces: tests 4 and 5, the last of the five.

- [ ] **Step 1: Add tests 4 and 5** after test 3.

```js
    it('searchIssues with sprint current returns the active sprint issues and sprint none the issues in no sprint', async ({ tracker, actor, today }) => {
      const active = (await tracker.openCycle({ start: today }, actor)).after
      const planned = (await tracker.openCycle({ start: '2099-01-01' }, actor)).after
      const inActive = (await tracker.createIssue({ title: 'In active', sprint: active.id }, actor)).after.id
      const inPlanned = (await tracker.createIssue({ title: 'In planned', sprint: planned.id }, actor)).after.id
      const free = (await tracker.createIssue({ title: 'Free' }, actor)).after.id

      assert.deepEqual(ids((await tracker.searchIssues({ sprint: 'current' })).issues), [inActive])
      assert.deepEqual(ids((await tracker.searchIssues({ sprint: 'none' })).issues), [free])
      assert.deepEqual(ids((await tracker.searchIssues({ sprint: active.id })).issues), [inActive])
      assert.deepEqual(ids((await tracker.searchIssues({ sprint: planned.id })).issues), [inPlanned])
    })

    it('searchIssues with sprint current returns an empty list without an active sprint', async ({ tracker, actor }) => {
      const planned = (await tracker.openCycle({ start: '2099-01-01' }, actor)).after
      await tracker.createIssue({ title: 'In planned', sprint: planned.id }, actor)
      const free = (await tracker.createIssue({ title: 'Free' }, actor)).after.id

      assert.deepEqual((await tracker.searchIssues({ sprint: 'current' })).issues, [])
      assert.deepEqual(ids((await tracker.searchIssues({ sprint: 'none' })).issues), [free])
    })
```

- [ ] **Step 2: Run the focused test.** `node --test scripts/contract.test.mjs`. Expect 74 tests, all passing.
- [ ] **Step 3: Run the whole suite.** `npm test`. Expect 1026 tests passing and no snapshot or golden change.
- [ ] **Step 4: Commit.**

```bash
git add scripts/contract-suite.mjs
git commit -m "test: cover sprint current and none in searchIssues (PMK-115)" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

- [ ] **Step 5: Mutation check 3 (only test 4 must fail).**

```bash
sed -i "s|^    if (filter.sprint === 'current') resolved.sprint = activeSprintId()\$|    // mutation 3|" scripts/lib/local/tracker.mjs
git diff --stat
node --test scripts/contract.test.mjs 2>&1 | grep -E "✖|fail "
git checkout -- scripts/lib/local/tracker.mjs
git status --porcelain
```

Expected: only test 4 fails among the leaf tests (test 5 passes, since it expects an empty list). The last command prints nothing.

- [ ] **Step 6: Mutation check 5 (tests 3 and 5 must fail).**

```bash
sed -i "s|^  const activeSprintId = () => currentCycle()?.id ?? null\$|  const activeSprintId = () => currentCycle()?.id ?? listCycles()[0]?.id ?? null|" scripts/lib/local/tracker.mjs
git diff --stat
node --test scripts/contract.test.mjs 2>&1 | grep -E "✖|fail "
git checkout -- scripts/lib/local/tracker.mjs
git status --porcelain
```

Expected: leaf failures are tests 3 and 5. Tests 1, 2 and 4 pass. The last command prints nothing.

- [ ] **Step 7: Report.** Write the real counts (contract file and `npm test`, before and after) and the five mutation results in the state file, as the orchestrator asks. Do not edit this plan.

Complexidade: baixa
