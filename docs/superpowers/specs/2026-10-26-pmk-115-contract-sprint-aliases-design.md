# PMK-115 design: sprint aliases in the contract suite

Issue: PMK-115, "Cover sprint aliases in the contract suite". Found in PMK-114.
Spec stage. This issue changes `scripts/contract-suite.mjs` only. It changes no product code and no golden.

## Problem

PMK-114 made `current` work in `createIssue` and `updateIssue`, next to the existing `current` in `moveToCycle` and in the `searchIssues` filter. Only the local tracker's own tests (`scripts/sprints.test.mjs`) prove this. The contract suite has no test for `current` or `none`. ADR 0001 says a hosted adapter must pass the same suite as the local tracker. Today such an adapter could ignore `current` and pass.

## What the code does today

The suite asserts contract behavior, so the first job is to find the contract's spelling of `none`. The code gives this table. I checked each row by running the local tracker in a temp repo.

| Operation | Sprint value | Result |
|---|---|---|
| `createIssue`, `updateIssue` | `'current'` | Stores the active sprint id. `INVALID_INPUT` "there is no active sprint" if none is active. |
| `createIssue`, `updateIssue` | `null` | No sprint. `updateIssue` clears an existing one. |
| `createIssue`, `updateIssue` | `'none'` | `INVALID_INPUT` "sprint none does not exist". |
| `moveToCycle(ids, to, actor)` | `'current'` | Moves into the active sprint. `INVALID_INPUT` if none is active. |
| `moveToCycle` | `null` | Takes the issues out of their sprint. |
| `moveToCycle` | `'none'` | `NOT_FOUND` "sprint none does not exist". |
| `searchIssues({ sprint })` | `'current'` | Issues of the active sprint. Empty list with no active sprint (`activeSprintId()` gives null, and `runQuery` matches nothing for null). |
| `searchIssues({ sprint })` | `'none'` | Issues with no sprint. |

Sources, all in `scripts/lib/local/tracker.mjs` unless noted: `requireSprint`, `requireActiveSprintId`, `applyFields` and `blank` (null or undefined clears a field), `moveToCycle`, `search`, and `runQuery` in `scripts/lib/local/query.mjs`. The code comment on `moveToCycle` says "`current` for the active sprint, or null to take the issues out of their sprint".

So the contract spells `none` two ways.

- In filters (`searchIssues`), `none` is the string `'none'`. The design spec (`2026-10-23-pmkit-design.md`, the paragraph on natural-language queries) lists `sprint` (id, `current` or `none`) there.
- In writes (`createIssue`, `updateIssue`, `moveToCycle`), `none` is `null`. The design spec's operations table does not say this. The CLI maps the string `none` to `null` before it calls the tracker (`orNull` in `scripts/pmkit.mjs`, used for `--sprint`, and the `cycle add` command).

The CLI and the contract do not disagree on behavior. They disagree on spelling, and the CLI translates. The contract stays as it is. The suite uses `null` for writes and `'none'` for the filter.

## Criteria against the code

All four criteria describe behavior the code has today. I propose no criterion change.

- Criterion 1 says "the contract's form of `none`". That form is `null` for writes, as the table shows.
- Criterion 2 holds. Every failing call throws `INVALID_INPUT` before any write.
- Criterion 3 holds, including the empty list with no active sprint.
- Criterion 4 holds with one detail. `contract.test.mjs` runs the suite three times (plain, through promises, without the index), so the new tests run three times.

## State setup in the suite

The suite's `setup()` returns a fresh tracker with no issues and no sprints, and `today`.

- No active sprint is the fresh state. No setup call is needed. A second no-active state comes from opening a sprint and closing it with `closeCycle`, after which `currentCycle()` is null (the existing cycle test asserts this). A third comes from a sprint that starts in the future, which is `planned`, not `active`.
- An active sprint comes from `openCycle({ start: today }, actor)`, as the existing cycle test (`opens a cycle, adds issues, closes it and lists the unfinished ones`) does. `setup()` documents that this starts the sprint active.
- A second, different sprint for the search test comes from `openCycle({ start: '2099-01-01' }, actor)`. It is `planned`, it does not overlap the active one, and the dry-run test already uses this start date.

## How the suite proves "write nothing"

The suite may use contract operations only. The existing dry-run test shows the pattern. It builds a JSON snapshot from reads and compares it before and after.

The new tests add a helper next to `ids`:

```js
const issueState = async (tracker, issueIds) => JSON.stringify({
  issues: await Promise.all(issueIds.map(async (id) => ({ issue: await tracker.getIssue(id), history: await tracker.getHistory(id) }))),
  all: (await tracker.searchIssues({ archived: true })).issues.map((issue) => issue.id),
  cycles: await tracker.listCycles(),
  metrics: await tracker.metricEvents(),
})
```

`all` catches a created issue that should not exist. `history` and `metrics` catch an event written without a field change. The test ends with one real write and `assert.notEqual`, so the equality is not vacuous. The existing dry-run test does the same.

## Approaches

**A. One large `it`.** One test sets up an active sprint, checks every operation, then closes the sprint and checks the failures. Rejected. The first failed assertion hides the rest. The steps share state, so a failure in the active part makes the no-sprint part untrustworthy. The file already prefers one behavior per `it`.

**B. Five small `it` blocks, placed after the cycle test.** Each test starts from a fresh tracker with the state it needs. Chosen.

**C. A nested `describe('sprint aliases')`.** Rejected. The suite has no nested `describe` today, and `it` wraps `test` with setup and teardown, which a nested block would have to repeat. It adds structure and no isolation.

## Chosen design

Add five `it` blocks to `runTrackerContract`, directly after `'opens a cycle, adds issues, closes it and lists the unfinished ones'` and before `'sets and reads cycle capacity'`. They sit with the other cycle tests and use the same `today` setup. Add the `issueState` helper after `ids`. The header comment of the file stays as it is.

### Test 1. `createIssue and updateIssue with sprint current store the active sprint id`

State: active sprint `S` from `openCycle({ start: today })`.

1. `createIssue({ title: 'Made current', sprint: 'current' }, actor)`. Expect `after.sprint === S.id` and `getIssue(after.id).sprint === S.id`. The result is the id, never the string `'current'`.
2. `createIssue({ title: 'Plain' }, actor)`, then `updateIssue(plain, { sprint: 'current' }, actor)`. Expect `before.sprint === undefined`, `after.sprint === S.id` and `getIssue(plain).sprint === S.id`.
3. `ids(await tracker.cycleIssues(S.id)).sort()` equals both ids sorted.

### Test 2. `moveToCycle with current moves issues into the active sprint, and null takes issues out of their sprint`

State: active sprint `S`. Issues `a`, `b`, `c` with no sprint.

1. `moveToCycle([a, b], 'current', actor)`. Expect the result to have two entries, each with `after.sprint === S.id`. Expect `cycleIssues(S.id)` ids equal `[a, b]` sorted.
2. `moveToCycle([a], null, actor)`. Expect `getIssue(a).sprint === undefined` and `cycleIssues(S.id)` ids equal `[b]`.
3. `updateIssue(b, { sprint: null }, actor)`. Expect `getIssue(b).sprint === undefined` and `cycleIssues(S.id)` empty.

This covers the contract's form of `none` where it takes an issue out of its sprint: `moveToCycle` in step 2 and `updateIssue` in step 3. `createIssue` with `sprint: null` has no sprint to leave and `after.sprint === undefined` holds even if the adapter ignores `null`, so the suite has no step for it. Criterion 1 asks only that `none` takes an issue out of its sprint, and these two steps prove that.

### Test 3. `sprint current without an active sprint fails with INVALID_INPUT and writes nothing`

State: fresh tracker, so no sprint. Issues `a`, `b` with no sprint. Take `before = await issueState(tracker, [a, b])`.

1. `rejects(() => tracker.createIssue({ title: 'Never', sprint: 'current' }, actor), 'INVALID_INPUT')`. `issueState` equals `before`.
2. `rejects(() => tracker.updateIssue(a, { sprint: 'current' }, actor), 'INVALID_INPUT')`. `issueState` equals `before`.
3. `rejects(() => tracker.moveToCycle([a, b], 'current', actor), 'INVALID_INPUT')`. `issueState` equals `before`.
4. Open a sprint with `start: '2099-01-01'` (planned, not active). Take a new `before`. Repeat 1 to 3. A planned sprint is not an active sprint, so all three still fail and write nothing.
5. Open a sprint with `start: today`, close it with `closeCycle`, take a new `before`, repeat 1 to 3. A closed sprint is not an active one either.
6. A real write (`comment(a, 'real', actor)`) makes `issueState` differ from the last `before`.

Steps 4 and 5 also open sprints, which change `cycles` in the snapshot, so each takes its own `before` after the setup. Step 5 needs the planned sprint from step 4 to stay out of the way. The planned sprint starts in 2099 and cannot overlap a sprint that starts today, so the order works.

### Test 4. `searchIssues with sprint current returns the active sprint's issues and sprint none the issues in no sprint`

State: active sprint `S`, planned sprint `P` (start 2099-01-01). Issues `inActive` (in `S`), `inPlanned` (in `P`), `free` (no sprint).

1. `searchIssues({ sprint: 'current' })` ids equal `[inActive]`.
2. `searchIssues({ sprint: 'none' })` ids equal `[free]`. The planned sprint's issue is not in this list, so `none` means "in no sprint", not "not in the active sprint".
3. `searchIssues({ sprint: S.id })` ids equal `[inActive]`, and `searchIssues({ sprint: P.id })` ids equal `[inPlanned]`. These show that `current` resolves to the same set as the id.

### Test 5. `searchIssues with sprint current returns an empty list without an active sprint`

State: fresh tracker. Issues `free` (no sprint) and `planned` (in a sprint that starts 2099-01-01, so it is planned).

1. `searchIssues({ sprint: 'current' }).issues` deep equals `[]`. It does not throw and does not return all issues.
2. `searchIssues({ sprint: 'none' })` ids equal `[free]`. The planned-sprint issue stays out, and the alias still works with no active sprint.

The test reads `.issues` only. The rest of the result shape (`problems`, or a future note field) is not part of the assertion, so a CLI note or an extra result field in PMK-116 does not break it. A `searchIssues` that throws for `current` with no sprint would break it, and would also break criterion 3.

## How each criterion is proven

| Criterion | Proof |
|---|---|
| 1 | Test 1 (create and update with `current`), test 2 (`moveToCycle` with `current`, and `null` through `moveToCycle` and `updateIssue`). |
| 2 | Test 3, with the fresh, planned and closed states, and the snapshot comparison. |
| 3 | Tests 4 and 5. |
| 4 | The tests sit in `scripts/contract-suite.mjs`. `node --test scripts/contract.test.mjs` runs them in the three adapter setups (plain, promises, no index). `npm test` runs the whole repo. |

Commands:

- `node --test scripts/contract.test.mjs` passes. It reports 59 tests on this branch before the change and 74 after (five new tests times three setups). The implementer records both numbers.
- `npm test` passes. It reports 1011 tests on this branch before the change and 1026 after. The implementer records both numbers.

## Mutation check

Each new test must fail when the behavior breaks. The product code already behaves correctly, so the new tests pass on first run, and this check replaces the usual red step. The implementer runs it once, after the five tests exist and pass. Nothing from it is committed.

Recipe for every mutation: apply the edit with the `sed` line below (it replaces the whole line, and the old text is what that line holds today), run `node --test scripts/contract.test.mjs`, compare the failing tests with the expectation, then undo with `git checkout -- scripts/lib/local/tracker.mjs`. After the undo, `git status --porcelain` must show only `scripts/contract-suite.mjs` (the new tests, before they are committed) and nothing else. Do not use `git stash`. Each mutation also makes the three `Local tracker contract` entries (the parent `describe` blocks) fail. Count the leaf tests only. A failing leaf test fails in all three setups, so the run shows three failures per test name.

All edits are in `scripts/lib/local/tracker.mjs`. Line numbers are from this branch before the change and drift, so check the old text first.

| # | Line | Old text | New text | Must fail | May pass |
|---|---|---|---|---|---|
| 1 | 178 | `    if (value === 'current') return requireActiveSprintId()` | `    // mutation 1` | test 1 | tests 2 to 5 |
| 2 | 750 | `    const sprint = to === 'current' ? requireActiveSprintId() : to` | `    const sprint = to` | tests 2 and 3 | tests 1, 4 and 5 |
| 3 | 414 | `    if (filter.sprint === 'current') resolved.sprint = activeSprintId()` | `    // mutation 3` | test 4 | tests 1, 2, 3 and 5 |
| 4 | 404 | `    if (id === null) throw invalid('there is no active sprint', 'pmkit cycle list')` | `    if (id === null) return null` | test 3 | tests 1, 2, 4 and 5 |
| 5 | 401 | `  const activeSprintId = () => currentCycle()?.id ?? null` | `  const activeSprintId = () => currentCycle()?.id ?? listCycles()[0]?.id ?? null` | tests 3 and 5 | tests 1, 2 and 4 |

Why each result holds, from the runs on this branch (the failing test names below are what `node --test` printed):

1. Mutation 1 makes `createIssue` and `updateIssue` treat `current` as an unknown id. They throw `INVALID_INPUT` and write nothing, which test 3 expects, so test 3 passes. Test 1 fails.
2. Mutation 2 makes `moveToCycle` look up a sprint called `current`. It throws `NOT_FOUND`, so test 2 fails on the move and test 3 fails because it expects `INVALID_INPUT`.
3. Mutation 3 passes the string `current` to the query, which matches no issue. Only test 4 fails. Test 5 expects an empty list, so a lazy search cannot fail it. Test 5 guards the no-sprint case through mutation 5.
4. Mutation 4 stops `requireActiveSprintId` from throwing. Only test 3 fails, because tests 1 and 2 run with an active sprint.
5. Mutation 5 resolves `current` to the first sprint of `listCycles()` when none is active, so a planned or closed sprint counts as current. This is the case decision 6 exists for. Test 3 fails in its planned and closed states. Test 5 fails because the planned sprint's issue shows up in the `current` list.

Observed on this branch, with the five tests written as described above: the five failing test names were `createIssue and updateIssue with sprint current store the active sprint id` (mutation 1), `moveToCycle with current moves issues into the active sprint, and null takes issues out of their sprint` and `sprint current without an active sprint fails with INVALID_INPUT and writes nothing` (mutation 2), `searchIssues with sprint current returns the active sprint issues and sprint none the issues in no sprint` (mutation 3), `sprint current without an active sprint fails with INVALID_INPUT and writes nothing` (mutation 4), and the same test plus `searchIssues with sprint current returns an empty list without an active sprint` (mutation 5). The implementer's test titles may differ, so match by test number.

The tests are written in the order of the plan with `superpowers:test-driven-development`.

## Decisões

1. **The suite uses `null` for `none` in writes and `'none'` in the filter.** Reason: that is what the contract does today, as the table shows. The CLI maps `none` to `null` before it calls the tracker, so the CLI spelling does not belong in the suite.
2. **The suite does not assert what the string `'none'` does in a write.** Reason: the local tracker answers `INVALID_INPUT` for create and update and `NOT_FOUND` for `moveToCycle`. The design spec does not define it. Pinning it would turn an accident into a rule. See the follow-up list.
3. **Five `it` blocks, not one.** Reason: each block needs its own state (active, none, planned), one failure should not hide others, and the file already uses one behavior per `it`.
4. **The blocks go after the existing cycle test.** Reason: they are cycle tests and use the same `openCycle({ start: today })` setup.
5. **The active sprint comes from `openCycle({ start: today })`.** Reason: `setup()` documents that this starts the sprint active, and the existing cycle tests do it. It works for any adapter that follows the suite's `today` rule.
6. **"No active sprint" has three states in test 3 (fresh, planned only, closed).** Reason: criterion 2 says "no active sprint", and a planned or closed sprint is the case where a lazy adapter would return the wrong sprint. This is a small addition that stays inside the criterion. If a hosted adapter cannot open a future sprint, drop step 4 then.
7. **"Write nothing" is proven with a snapshot of issue, history, search, cycles and metric events, plus a non-vacuous check.** Reason: contract operations are all the suite may use, and this is the pattern the dry-run test already uses.
8. **No dry-run cases for `current`.** Reason: no criterion asks for them, and the dry-run test would need a state with an active sprint. See the follow-up list.
9. **No criterion change and no code change.** Reason: the code does what all four criteria say.
10. **Error assertions check `code` only, not the message.** Reason: `rejects` already does this, and the message text is not part of the contract (the contract lists codes).
11. **Brainstorming ran without the user.** I chose the recommended option at each decision point and wrote the reason here. The user can overturn any of them at the plan stage.

## Follow-up candidates

- Write the null form of `none` into the operations table of `2026-10-23-pmkit-design.md`. The Cycles row still says only `moveToCycle(ids, sprint, actor)`. PMK-117 already added `current` and `none` to the CLI table (`--sprint id|current|none`), and that table covers the CLI spelling only, so the contract spelling is still missing.
- Decide what the string `'none'` should do in `createIssue`, `updateIssue` and `moveToCycle`. Today the answers are `INVALID_INPUT`, `INVALID_INPUT` and `NOT_FOUND`. Either accept it as `null` in the contract, or make the three reject it with the same code. This changes contract behavior, so it needs its own issue.
- An unknown sprint id gives `INVALID_INPUT` in `createIssue` and `updateIssue` but `NOT_FOUND` in `moveToCycle`. Pick one code and add a suite test.
- Cover `current` with `dryRun: true` in the contract suite (PMK-114 tests it only in `scripts/sprints.test.mjs`).
- Cover the `assignee` aliases `me` and `none` in `searchIssues` the same way. `me` depends on the actor, so the suite needs a decision about how an adapter resolves it.
- Cover the `sprint` filter with an unknown id (`INVALID_INPUT` in the local tracker).
