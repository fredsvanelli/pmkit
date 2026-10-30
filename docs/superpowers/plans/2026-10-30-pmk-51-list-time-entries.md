# PMK-51 List the time entries of an issue Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `pmkit issues time-entries <id>` lists the `log_time` events of an issue with the total in minutes, through a new tracker contract operation `listTimeEntries`.

**Architecture:** The Local tracker reads the issue's events file and keeps the `log_time` events. The Linear adapter refuses the operation with the manifest's `time_tracking` hint, as it does for `logTime`. The CLI formats the result as a table with a total line, or as JSON.

**Tech Stack:** Node.js ESM, `node:test`, the existing Local and Linear trackers, `scripts/pmkit.mjs` command table.

**Spec:** `docs/superpowers/specs/2026-10-30-pmk-51-list-time-entries-design.md`

## Global Constraints

- Every commit message ends with `PMK-51` in its subject, for example `feat(issues): add issues time-entries (PMK-51)`.
- Commit lines end with `Co-Authored-By: Claude Haiku 5.5 <noreply@anthropic.com>`.
- `scripts/lib/capabilities.mjs` changes by one name in `SERVED_BY.time_tracking`. Nothing else in that file.
- Golden files are regenerated only with `UPDATE_GOLDENS=1 node --test scripts/goldens.test.mjs`, and only the files of the new command change.
- `npm test` passes before the PR opens.

## Review Focus

1. An issue with no time logged returns an empty list and a total of 0, not an error. Test: Task 1 and Task 3.
2. An unknown issue ID gives `NOT_FOUND`, as the other reads do. Test: Task 1.
3. A Linear workspace refuses with `NOT_SUPPORTED` and the manifest hint, and sends no request. Test: Task 2.
4. The text table prints the minutes as integers and the total line sums them. Test: Task 3.
5. `--json` prints the object shape from the spec, with `total` as a number. Test: Task 3.

---

### Task 1: Local tracker lists the time entries

**Files:**
- Modify: `scripts/lib/local/tracker.mjs` (near `logTime`, line ~708; return object, line ~1071)
- Modify: `scripts/lib/contract.mjs` (add `'listTimeEntries'` after `'logTime'` in `TRACKER_OPERATIONS`)
- Test: `scripts/tracker-comments.test.mjs`

**Interfaces:**
- Consumes: `readIssue(id)` (returns `paths.events`), `readEvents(file)` from `scripts/lib/local/events.mjs`.
- Produces: `listTimeEntries(id: string) -> { issue: string, entries: { at: string, by: string, minutes: number }[], total: number }`. Entries are in file order, oldest first. `total` is the sum of `minutes`. Throws `NOT_FOUND` for an unknown ID, the same error `getHistory` throws.

- [ ] **Step 1: Write the failing test**

Add to `scripts/tracker-comments.test.mjs`, after the `logTime` tests:

```js
test('listTimeEntries returns the log_time events in order with the total', () => {
  const { tracker, id, setNow } = setup()
  assert.deepEqual(tracker.listTimeEntries(id), { issue: id, entries: [], total: 0 })
  setNow('2026-10-24T10:00:00Z')
  tracker.logTime(id, 30, 'fred')
  tracker.comment(id, 'between', 'fred')
  tracker.logTime(id, 15, 'fred')
  assert.deepEqual(tracker.listTimeEntries(id), {
    issue: id,
    entries: [
      { at: '2026-10-24T10:00:00Z', by: 'fred', minutes: 30 },
      { at: '2026-10-24T10:00:00Z', by: 'fred', minutes: 15 },
    ],
    total: 45,
  })
  assert.throws(() => tracker.listTimeEntries('NOPE-1'), (error) => error.code === 'NOT_FOUND')
})
```

Use the timestamp the test's `setNow` produces if the second `logTime` gets a different time; the assertion compares the stored `at` values, so read them back from `rawEvents()` if needed.

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test scripts/tracker-comments.test.mjs --test-name-pattern="listTimeEntries"`
Expected: FAIL with `tracker.listTimeEntries is not a function`.

- [ ] **Step 3: Implement `listTimeEntries` in `scripts/lib/local/tracker.mjs`**

Add next to `logTime`. It reads the events of the issue (`readEvents(readIssue(id).paths.events).events`), keeps the events whose `op` is `log_time`, maps each to `{ at, by, minutes }`, sums the minutes, and returns `{ issue: id, entries, total }`. Add `listTimeEntries` to the returned object on the line that lists `logTime`.

Add `'listTimeEntries'` to `TRACKER_OPERATIONS` in `scripts/lib/contract.mjs`, after `'logTime'`.

- [ ] **Step 4: Run the test to verify it passes**

Run: `node --test scripts/tracker-comments.test.mjs`
Expected: PASS, all tests in the file.

- [ ] **Step 5: Commit**

```bash
git add scripts/lib/local/tracker.mjs scripts/lib/contract.mjs scripts/tracker-comments.test.mjs
git commit -m "feat(tracker): list the time entries of an issue (PMK-51)" -m "Co-Authored-By: Claude Haiku 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Linear refuses the operation

**Files:**
- Modify: `scripts/lib/linear/tracker.mjs` (line 148, `STUB_CAPABILITY`; the stub wiring next to `logTime`)
- Test: `scripts/lib/linear/tracker.test.mjs` (the test around line 1153 and the write table near line 56)

**Interfaces:**
- Consumes: `stub(operation)` in the Linear tracker, `STUB_CAPABILITY`.
- Produces: `listTimeEntries(id)` on the Linear tracker, which rejects with `NOT_SUPPORTED` and the `time_tracking` enable hint, and sends no request after discovery.

- [ ] **Step 1: Write the failing test**

In `scripts/lib/linear/tracker.test.mjs`, extend the test at line ~1153 (the one that checks `logTime`, `createRelease`, `markReleased`) with:

```js
await assert.rejects(linear.listTimeEntries('ACME-1'), { code: 'NOT_SUPPORTED' })
```

Use the same fixture setup as the `logTime` assertion in that test, so the check that no request is sent still applies.

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test scripts/lib/linear/tracker.test.mjs`
Expected: FAIL, `listTimeEntries` is not a function.

- [ ] **Step 3: Implement the stub**

In `scripts/lib/linear/tracker.mjs`, change line 148 to:

```js
const STUB_CAPABILITY = { logTime: 'time_tracking', listTimeEntries: 'time_tracking', createRelease: 'releases', markReleased: 'releases' }
```

Then wire `listTimeEntries: stub('listTimeEntries')` in the same place `logTime` is wired.

- [ ] **Step 4: Run the test to verify it passes**

Run: `node --test scripts/lib/linear/tracker.test.mjs`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add scripts/lib/linear/tracker.mjs scripts/lib/linear/tracker.test.mjs
git commit -m "feat(linear): refuse listTimeEntries with the time tracking hint (PMK-51)" -m "Co-Authored-By: Claude Haiku 5.5 <noreply@anthropic.com>"
```

---

### Task 3: The CLI command, the capability name and the goldens

**Files:**
- Modify: `scripts/pmkit.mjs` (add a command entry after `issues log-time`, near line 495)
- Modify: `scripts/lib/capabilities.mjs` (`SERVED_BY.time_tracking`, one name)
- Modify: `scripts/golden-cases.mjs` (add `'issues time-entries'` next to `'issues log-time'`, line ~51)
- Modify: `scripts/cli-degraded-coverage.test.mjs` (line ~62, map entry for the new command, so the coverage test accepts it)
- Modify: `scripts/cli.test.mjs` (add a CLI test)
- Create (generated): `scripts/__goldens__/<fixture>/issues-time-entries.txt` for each fixture the golden case runs on

**Interfaces:**
- Consumes: `(await ctx.tracker()).listTimeEntries(id)` from Task 1.
- Produces: the command `issues time-entries <id>`, usage `<id>`, `args: ['id']`, `flags: []`, read-only (no `write: true`).

- [ ] **Step 1: Write the failing CLI test**

Add to `scripts/cli.test.mjs`, after the `assign, link, comment, log-time, archive and get --comments --history` test. It uses the `team` fixture, as that test does:

```js
test('time-entries lists the logged time and the total, text and JSON', () => {
  const root = makeRepo('team')
  assert.equal(run(root, ['issues', 'log-time', 'ISS-3F7H', '45']).status, 0)
  assert.equal(run(root, ['issues', 'log-time', 'ISS-3F7H', '15']).status, 0)
  const text = run(root, ['issues', 'time-entries', 'ISS-3F7H']).stdout
  assert.match(text, /45/)
  assert.match(text, /total: 60 minutes/)
  const got = json(root, ['issues', 'time-entries', 'ISS-3F7H'])
  assert.equal(got.issue, 'ISS-3F7H')
  assert.equal(got.total, 60)
  assert.deepEqual(got.entries.map((entry) => entry.minutes), [45, 15])
  assert.match(run(root, ['issues', 'time-entries', 'ISS-9ZZZ']).stderr, /NOT_FOUND|not found/i)
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test scripts/cli.test.mjs --test-name-pattern="time-entries"`
Expected: FAIL, unknown command `issues time-entries`.

- [ ] **Step 3: Implement the command and the capability name**

In `scripts/pmkit.mjs`, after the `issues log-time` entry, add:

```js
{
  name: 'issues time-entries', summary: 'lists the time logged on an issue, with the total', usage: '<id>', args: ['id'], flags: [],
  run: async (ctx) => {
    const result = await (await ctx.tracker()).listTimeEntries(ctx.args[0])
    const text = result.entries.length === 0
      ? `no time logged on ${result.issue}\ntotal: 0 minutes`
      : [table(['At', 'By', 'Minutes'], result.entries.map((entry) => [entry.at, entry.by, String(entry.minutes)])), `total: ${result.total} minutes`].join('\n')
    return { data: result, text }
  },
},
```

Add `'issues time-entries'` to `SERVED_BY.time_tracking` in `scripts/lib/capabilities.mjs`, so it reads `time_tracking: ['issues log-time', 'issues time-entries'],`. Change nothing else in that file.

Add `'issues time-entries': (a) => [[a.issue]],` to `scripts/golden-cases.mjs` after the `'issues log-time'` line. Add the new command to the map in `scripts/cli-degraded-coverage.test.mjs` with the value that the file's comments name for read commands, or `'REFUSALS'` if that is the only fit.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test scripts/cli.test.mjs`
Expected: PASS.

- [ ] **Step 5: Regenerate the goldens and check the diff**

Run: `UPDATE_GOLDENS=1 node --test scripts/goldens.test.mjs`, then `git status --short scripts/__goldens__`.
Expected: only new `issues-time-entries.txt` files appear. No existing golden changes. If `capabilities.txt` changes, the `SERVED_BY` edit added more than one name; fix that before committing.

Run: `node --test scripts/goldens.test.mjs`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add scripts/pmkit.mjs scripts/lib/capabilities.mjs scripts/golden-cases.mjs scripts/cli-degraded-coverage.test.mjs scripts/cli.test.mjs scripts/__goldens__
git commit -m "feat(issues): add issues time-entries (PMK-51)" -m "Co-Authored-By: Claude Haiku 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Contract suite and full run

**Files:**
- Modify: `scripts/contract-suite.mjs` (the `logs time on an issue` case, line ~446)

**Interfaces:**
- Consumes: `listTimeEntries` from Tasks 1 and 2.
- Produces: a contract case that runs on every adapter that has the `time` family (Local runs it; Linear skips it, as it already skips `log_time`).

- [ ] **Step 1: Extend the contract case**

In `scripts/contract-suite.mjs`, inside the `logs time on an issue and shows it in the history and the metric events` case, after `logTime(id, 45, actor)`, add:

```js
const listed = await tracker.listTimeEntries(id)
assert.deepEqual(listed.entries.map((entry) => entry.minutes), [45])
assert.equal(listed.total, 45)
```

- [ ] **Step 2: Run the contract tests**

Run: `node --test scripts/contract.test.mjs`
Expected: PASS for Local. The Linear contract run skips the `time` case with the existing reason.

- [ ] **Step 3: Commit**

```bash
git add scripts/contract-suite.mjs
git commit -m "test(contract): cover listTimeEntries (PMK-51)" -m "Co-Authored-By: Claude Haiku 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Full suite

- [ ] **Step 1: Run the full suite**

Run: `npm test`
Expected: all tests pass. Record the summary line for the PR and the final report.

No commit in this task. `verification-before-completion` runs at the end of the implementation.
