# PMK-121 velocity counts moves made during a late cycle close Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A closed sprint records its close time in a `closed` key, `velocity` counts a move to `done` up to that time (the end date stays the rule for a sprint without `closed`), and `/pmkit:cycle:close` step 8 runs every move and split before `cycle close`.

**Architecture:** `parseSprint` reads and checks `closed`, `closeCycle` writes it with `stamp()`, and `velocity` in `scripts/lib/metrics.mjs` stays the one function that applies the cutoff. `validate` lists a malformed `closed`. The command text of `commands/cycle/close.md` steps 6 to 9 changes, and a static test in `scripts/scenarios.test.mjs` pins the step 8 order.

**Tech Stack:** Node 18+ ES modules, no dependencies (ADR 0003), `node:test`. Run tests with `npm test`.

**Spec:** `docs/superpowers/specs/2026-10-26-pmk-121-velocity-late-close-design.md`

## Global Constraints

### The `closed` key

- File: `closed: <timestamp>` in `.issues/sprints/<id>.yaml`, right after `state`. `FILE_ORDER` in `scripts/lib/local/sprints.mjs` becomes `['name', 'start', 'end', 'goal', 'state', 'closed', 'capacity', 'days_off']`.
- Model: `closed` on the sprint object, right after `state`. Key order of a sprint with it: `id, name, start, end, goal, state, closed, capacity, daysOff` (then `extra` when present). Left out (no key, not `null`) when the file has none.
- `scripts/lib/model.mjs`, `Sprint` typedef, a new line after `state`: ` * @property {string} [closed] ISO timestamp of the close, with Z or an offset, set by closeCycle`.
- Valid when all three hold: the value is a string matching `^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$`, `validDate(value.slice(0, 10))` is true, and `Date.parse(value)` is not `NaN`.
- A valid value is kept as written (offset and fraction included, no conversion to UTC).
- Missing: no key, `closed:` with no value (`null`), or `''`. It reads with no `closed` key and adds nothing to `extra`. `validate` lists nothing. The next write drops the line.
- Malformed (any other value, a number or boolean included): not fatal. `parseSprint` leaves `closed` off the sprint, puts the value in `extra.closed` (the next write keeps the line as written), and velocity uses the end-date fallback.
- `closeCycle` sets `closed: stamp()` in the same write that sets `state: closed`, builds the sprint in model order, and drops `extra.closed` (other `extra` keys stay). The dry run returns the same sprint, `closed` included, and writes nothing. It overwrites any `closed` the active sprint already had.
- `updateCycleCapacity`, `setCapacity` and every other sprint write keep `closed`.
- The text output of `cycle close` does not change (it does not print `closed`).

### The velocity rule

For each closed sprint `S` in the window, an issue counts when its current `sprint` is `S.id`, its status category is `done`, `doneAt` exists, and:

- `S.closed` exists: `Date.parse(issue.doneAt) <= Date.parse(S.closed)`. A move in the same second as the close counts.
- `S.closed` is missing (the fallback): `issue.doneAt.slice(0, 10) <= S.end`, the rule of today.

Points, count, unit choice, average and the window (last `window` closed sprints sorted by `end`) stay as they are. The signature `velocity(sprints, issuesBySprint, { window, categoryOf })` does not change, and `issuesBySprint` does not change.

### The `validate` problem

One problem per sprint file whose parsed sprint has an own `extra.closed`:

- path: `.issues/sprints/<id>.yaml`
- code: `sprint`
- message: `` `closed "${value}" is not a timestamp with a date, a time and a zone (Z or an offset such as -03:00), so velocity uses the end date` ``. Example: `closed "2026-10-26" is not a timestamp with a date, a time and a zone (Z or an offset such as -03:00), so velocity uses the end date`.

### The new text of `commands/cycle/close.md`

Steps 1 to 5, step 10, "Confirmation points", "Output" and "If something is missing" do not change. Paragraphs inside a step are separated by one blank line, and the next numbered step follows the last paragraph with no blank line, as today.

Step 6 keeps its paragraph and gains this second paragraph, after one blank line:

```markdown
   A failed step 8 can leave a split half done, with the new issue created and linked but the original not yet `done`. For each unfinished issue whose `related` list in the step 3 read names an issue that is not in that read, run `node "${CLAUDE_PLUGIN_ROOT}/scripts/pmkit.mjs" issues get <related id> --json`. When that issue has no `sprint`, a status category other than `done` and `canceled`, and a `created` date on or after the sprint's start, it may hold the remaining work of a split already made. Name it, and propose to finish that split in place of a new one: step 7 asks for the delivered part, and step 8 runs only the estimate update and the move to `done` of the original. Do not offer a new split for that issue, because its create would make a second remaining-work issue. The two moves stay on offer.
```

Step 7 keeps its first paragraph and its three bullets. This paragraph goes after the bullets, after one blank line:

```markdown
   For a split that a failed step 8 started (step 6), run only the estimate update and the move dry runs above, and show the new issue's ID and its `related` link in place of a create.
```

The last paragraph of step 7 becomes:

```markdown
   Run `node "${CLAUDE_PLUGIN_ROOT}/scripts/pmkit.mjs" cycle close <sprint id> --dry-run --json` as well. Its `unfinished` list is the list before the moves and splits. Step 8 runs them before the close, so the real close leaves no issue unfinished. Moving issues between sprints is a scope move and closing ends the sprint, so show one full preview of all of it and ask once, whatever `write_policy.confirm` says. When the user declines, change nothing.
```

Step 8 becomes:

```markdown
8. After the approval, run the same moves and splits without `--dry-run`, and close the sprint last. Velocity counts a move to `done` only up to the moment the sprint closes, so every write that moves an issue runs before the close. For each split, run the create first and note the new ID. Then run `node "${CLAUDE_PLUGIN_ROOT}/scripts/pmkit.mjs" issues link <new id> <original id> --kind related --json`, then the estimate update, then `node "${CLAUDE_PLUGIN_ROOT}/scripts/pmkit.mjs" issues move <original id> done --json`. For a split that a failed step 8 started, run only the estimate update and the move. The approval of step 7 covers the link, because the preview showed it. After the last move and split, run `node "${CLAUDE_PLUGIN_ROOT}/scripts/pmkit.mjs" cycle close <sprint id> --json`. When its `unfinished` list is not empty, those issues joined the sprint after step 3. Name each one and say it stays in the closed sprint.

   When a write fails, stop, list what was done and what was not, and do not retry it. Say that the sprint is still active, because the close is the last write. For a split whose create ran, give the new ID and the commands of that split that did not run. When its link did not run, say that a second run of `/pmkit:cycle:close` cannot tell the new issue belongs to the split, so the user runs the link before that. A second run finds the sprint still active: the moves that ran took their issues out of the sprint, a finished split is `done`, and step 6 finds a split whose link ran.

   After the last write, or after a failed one, run `node "${CLAUDE_PLUGIN_ROOT}/scripts/pmkit.mjs" cycle issues <sprint id> --json` again. Delivered is the issues of this read whose status category is `done`: their count, and the sum of their `estimate`. Throughput is the same count. Planned stays the step 4 number, with the estimates of the step 3 read. Scope added and removed and cycle time keep the numbers of steps 4 and 5. Carry-over keeps the step 4 list, with the decision applied to each unfinished issue and the new ID of each split.
```

Step 9 gains two sentences at its start. Its line begins:

```markdown
9. Run this step only when `cycle close` succeeded in step 8. When it did not, say that the sprint is still active and that no retro is offered, and go to step 10. Offer a retro document. Draft it from the numbers of step 8 ...
```

The rest of step 9 stays word for word. A parse of the new file with `parseCommandFile` gives step 6 calls `cycle list`, `issues get`, and step 8 calls `issues link`, `issues move`, `cycle close`, `cycle issues`, in that order, with no loose flag (checked on a scratch copy while writing this plan).

### The static test

In `scripts/scenarios.test.mjs`, inside `describe('scenarios')`, after the test `the real files parse to the expected step ids`:

```js
test('cycle/close step 8 runs cycle close after every issues link and issues move call', () => {
  const step8 = FILES.find((file) => file.rel === 'cycle/close.md').parsed.calls
    .filter((call) => call.step === '8' && !call.dryRun)
    .map((call) => call.command)
  const close = step8.indexOf('cycle close')
  assert.ok(close >= 0, 'step 8 runs cycle close')
  for (const name of ['issues link', 'issues move']) {
    assert.ok(step8.includes(name), `step 8 runs ${name}`)
    assert.ok(step8.lastIndexOf(name) < close, `${name} comes before cycle close in step 8`)
  }
})
```

### The design spec and CONTEXT.md

`docs/superpowers/specs/2026-10-23-pmkit-design.md` line 66, the Sprint row becomes:

> | Sprint | `id`, `name`, `start`, `end`, `goal`, `state` (`planned`, `active`, `closed`), `closed` (optional, ISO timestamp of the close with `Z` or an offset, set by `closeCycle`), `capacity` (member id → points or hours), `daysOff` (member id → dates) |

Line 253, the sentence "`closeCycle` sets `closed` and returns the issues that were not `done` or `canceled`, for the command to move." becomes these three sentences, and the rest of the line stays:

> `closeCycle` sets `state: closed` and `closed`, the time of the close, and returns the issues not in a terminal category. `/pmkit:cycle:close` moves or splits them before the close, so the list is empty after a full run. Velocity counts a done issue of a closed sprint when its last move to `done` is at or before `closed`, and, for a closed sprint without `closed`, when the UTC date of that move is on or before `end`.

`CONTEXT.md`, the **Sprint** entry (line 40) gains one sentence at its end:

> A closed sprint records when it was closed, and velocity counts only the moves to `done` made up to that moment.

### Files

- May change: `scripts/lib/metrics.mjs`, `scripts/lib/local/sprints.mjs`, `scripts/lib/local/tracker.mjs`, `scripts/lib/model.mjs`, `scripts/lib/validate.mjs`, `scripts/metrics.test.mjs`, `scripts/sprints.test.mjs`, `scripts/validate.test.mjs`, `scripts/cli.test.mjs`, `scripts/scenarios.test.mjs`, `scripts/__scenarios__/cycle-close.mjs`, `commands/cycle/close.md`, `docs/superpowers/specs/2026-10-23-pmkit-design.md`, `CONTEXT.md`, `.superpowers/state/PMK-121-state.md`, and, by regeneration only, the goldens and the snapshot below.
- Must not change: `scripts/pmkit.mjs`, `scripts/lib/contract.mjs`, `scripts/contract-suite.mjs`, `scripts/scenario-helpers.mjs`, `scripts/__fixtures__/`, `schemas/`, `templates/`, `CHANGELOG.md`, `README.md`, `commands/cycle/plan.md`, `commands/report/status.md`, every other command file, and `skills/pmkit/references/conventions.md`.

### Goldens and scenario snapshots

Never edit a golden or a snapshot by hand. Regenerate only with these exact commands, then read `git diff` of each changed file line by line:

- `UPDATE_GOLDENS=1 node --test scripts/goldens.test.mjs`
- `UPDATE_GOLDENS=1 node --test scripts/scenarios.test.mjs`

Expected changes, and no others:

- `scripts/__goldens__/team/cycle-close.txt` (Task 2): in the `cycle close 2026-10-12 --json` and the `--dry-run --json` output, the `sprint` object gains `"closed": "2026-10-23T12:00:00Z",` right after `"state": "closed",`. 2 added lines. The text outputs do not change.
- `scripts/__goldens__/messy-merge/cycle-close.txt` (Task 2): the same line in the same two JSON outputs. 2 added lines.
- `scripts/__scenarios__/cycle-close.after.txt`, Task 2: the diff of `.issues/sprints/2026-10-12.yaml` gains `+closed: 2026-10-23T12:00:00Z` right after `+state: closed`. 1 added line.
- `scripts/__scenarios__/cycle-close.after.txt`, Task 4: `$ pmkit issues get ISS-0G5E --json  [step 6, read]` and `exit 0` after the step 6 `cycle list` read. `$ pmkit issues move ISS-2X6D done --json` shows `[step 8, write]` in place of `[step 7, write]`. The `$ pmkit cycle close 2026-10-12 --json  [step 8, write]` line and its `exit 0` move from before `cycle add ... --to none --json` to right after the `issues move ISS-2X6D done --json` write. The file diffs below the call list do not change.

Must stay byte for byte, and a diff in any of them is a bug: every `metrics-velocity.txt` golden, `team/cycle-list.txt`, `team/cycle-current.txt`, `basic/cycle-close.txt`, `no-sprints/cycle-close.txt`, `scripts/__scenarios__/cycle-plan.after.txt`, and every other golden and snapshot. If a regeneration changes a file outside the expected list, run `git checkout -- <file>` on the regenerated files, find the cause, and fix the code.

### Tests and commits

- Baseline: 1069 tests pass at `b6b1c4d`. The final count must be higher.
- TDD: write the tests of a task first, run them, and see them fail for the reason the task states before writing the code.
- Every task runs its focused tests, then `npm test` in full, before its commit. Every commit leaves `npm test` green.
- Commit subject: `<type>: <subject> (PMK-121)`. The body ends with `Co-Authored-By: <model> <noreply@anthropic.com>`, with the implementing model's name (for example `Claude Opus 5.5`).
- Straight quotes, no em dashes in prose. No new dependency. Do not run pmkit write commands on this repo's `.issues/`.

## Review Focus

1. A `closed` with a fraction of a second, such as `2026-10-26T12:00:00.500Z`. It is valid, reads as written, and a move at `12:00:00Z` counts. Pinned in Tasks 1 and 2.
2. A `closed` that YAML reads as a number (`closed: 2026`). `parseSprint` must not throw, keeps `2026` in `extra.closed`, and a write keeps the line. Pinned in Task 2, and the `validate` message in Task 3.
3. An active sprint whose file already has a `closed` line, valid or malformed, beside another hand-added key. `closeCycle` writes the run time, keeps the other key, and leaves no `extra.closed`. Pinned in Task 2.
4. A window that mixes a sprint with `closed` and an older one without it. Each sprint applies its own rule. Pinned in Task 1.
5. A done issue with no `doneAt` in a sprint with `closed`. It does not count, as today. Pinned in Task 1.

---

### Task 1: velocity counts a move to done up to the close

**Files:**
- Modify: `scripts/lib/metrics.mjs` (`velocity`, line 25)
- Test: `scripts/metrics.test.mjs`

**Interfaces:**
- Consumes: sprint objects with an optional `closed` string, already valid (Task 2 guarantees it for the Local tracker).
- Produces: `velocity(sprints, issuesBySprint, { window, categoryOf })`, same signature and result shape as today.

- [ ] **Step 1: Write the failing tests** in `scripts/metrics.test.mjs`, after `velocity with no closed sprint is zero`. Add a helper `const closedAt = (id, end, closed) => ({ id, end, state: 'closed', closed })`. Keep every existing test unchanged: they have no `closed`, so they now test the fallback.
  - `velocity counts a move to done up to the close of a late-closed sprint`: sprint `closedAt('a', '2026-10-25', '2026-10-26T12:00:00Z')`, issues `item(2, '2026-10-24T15:00:00Z')`, `item(3, '2026-10-26T10:00:00Z')`, `item(5, '2026-10-26T12:00:00Z')`, `item(8, '2026-10-27T10:00:00Z')`. `perSprint` deep-equals `[{ id: 'a', points: 10, count: 3 }]`.
  - `velocity compares doneAt and closed as instants, with an offset or a fraction`: sprint `closedAt('a', '2026-10-25', '2026-10-26T09:00:00-03:00')` with `item(3, '2026-10-26T11:30:00Z')` and `item(5, '2026-10-26T12:00:01Z')` gives `[{ id: 'a', points: 3, count: 1 }]`. Sprint `closedAt('b', '2026-10-25', '2026-10-26T12:00:00.500Z')` with `item(3, '2026-10-26T12:00:00Z')` and `item(5, '2026-10-26T12:00:01Z')` gives `[{ id: 'b', points: 3, count: 1 }]` (Review Focus 1).
  - `velocity leaves out a move to done after an early close`: sprint `closedAt('a', '2026-10-25', '2026-10-23T12:00:00Z')` with `item(3, '2026-10-24T10:00:00Z')` gives `[{ id: 'a', points: 0, count: 0 }]`.
  - `velocity applies the close cutoff per sprint and the end date to a sprint without closed`: sprints `sprint('old', '2026-10-11')` and `closedAt('new', '2026-10-25', '2026-10-26T12:00:00Z')`. Issues of `old`: `item(6, '2026-10-11T10:00:00Z')`, `item(4, '2026-10-12T10:00:00Z')`. Issues of `new`: `item(3, '2026-10-26T10:00:00Z')`, `item(7, undefined)` (done with no `doneAt`). `perSprint` deep-equals `[{ id: 'old', points: 6, count: 1 }, { id: 'new', points: 3, count: 1 }]` and `average` is `4.5` (Review Focus 4 and 5).

- [ ] **Step 2: Run to verify they fail**

Run: `node --test scripts/metrics.test.mjs`
Expected: the four new tests FAIL, because today's rule compares `doneAt.slice(0, 10)` with `end`. The late-close test gets `{ points: 2, count: 1 }`, the instants test `{ points: 0, count: 0 }` for `a`, the early-close test `{ points: 3, count: 1 }`, and the mixed test `{ points: 0, count: 0 }` for `new`. The existing tests PASS.

- [ ] **Step 3: Implement** the cutoff in `velocity`. The filter becomes:

```js
categoryOf(issue.status) === 'done' && issue.doneAt !== undefined && (
  sprint.closed !== undefined ? Date.parse(issue.doneAt) <= Date.parse(sprint.closed) : issue.doneAt.slice(0, 10) <= sprint.end
)
```

- [ ] **Step 4: Run to verify they pass**

Run: `node --test scripts/metrics.test.mjs`
Expected: PASS, the whole file.

- [ ] **Step 5: Run the whole suite**

Run: `npm test`
Expected: PASS, 1073 tests, no golden or snapshot differs (no sprint has `closed` yet).

- [ ] **Step 6: Commit**

```bash
git add scripts/lib/metrics.mjs scripts/metrics.test.mjs
git commit -m "fix: count moves to done up to a sprint's close in velocity (PMK-121)" -m "Co-Authored-By: <model> <noreply@anthropic.com>"
```

Complexidade: baixa

---

### Task 2: the sprint file records closed, and closeCycle writes it

**Files:**
- Modify: `scripts/lib/local/sprints.mjs` (`FILE_ORDER` line 9, `parseSprint` lines 28 to 54), `scripts/lib/local/tracker.mjs` (`closeCycle` line 735), `scripts/lib/model.mjs` (`Sprint` typedef, line 57)
- Test: `scripts/sprints.test.mjs`, `scripts/cli.test.mjs`
- Regenerate: `scripts/__goldens__/team/cycle-close.txt`, `scripts/__goldens__/messy-merge/cycle-close.txt`, `scripts/__scenarios__/cycle-close.after.txt`

**Interfaces:**
- Consumes: `velocity` from Task 1.
- Produces: sprint objects with `closed` after `state` when valid, and `extra.closed` when malformed. Task 3 reads `extra.closed`.

- [ ] **Step 1: Write the failing sprint tests** in `scripts/sprints.test.mjs`, after `closeCycle reports the issues it could not read as problems`. Add helpers `const raw = (sprints, id) => fs.readFileSync(path.join(sprints, `${id}.yaml`), 'utf8')` and `const addLine = (sprints, id, line) => fs.appendFileSync(path.join(sprints, `${id}.yaml`), `${line}\n`)`. Let `KEYS = ['id', 'name', 'start', 'end', 'goal', 'state', 'closed', 'capacity', 'daysOff']` and `AT = '2026-10-26T12:00:00Z'`.
  - `closeCycle writes closed with the run time and returns it right after state`: `setup('team', AT)`. `closeCycle('2026-10-12', 'fred').sprint` has `closed` equal to `AT` and `Object.keys` deep-equal to `KEYS`. `raw(sprints, '2026-10-12')` contains `` `state: closed\nclosed: ${AT}\n` ``. `listCycles({ state: 'closed' })` finds `2026-10-12` with `closed` equal to `AT`.
  - `closeCycle with dryRun returns closed and writes nothing`: `setup('team', AT)`, `hashTree(root)` before. The dry run's `sprint.closed` is `AT` and its keys deep-equal `KEYS`. `hashTree(root)` is unchanged.
  - `a valid closed reads as written and survives a write`: for each value `'2026-10-26T09:00:00-03:00'` and `'2026-10-26T12:00:00.500Z'` (Review Focus 1), on a fresh `setup()`, `addLine(sprints, '2026-09-28', `closed: ${value}`)`. The `2026-09-28` sprint of `listCycles()` has `closed` equal to `value`, keys deep-equal to `KEYS`, and no `extra`. After `setCapacity('2026-09-28', { fred: 5 }, 'fred')`, `raw` contains `` `state: closed\nclosed: ${value}\n` ``.
  - `a missing or empty closed reads as no key`: the fixture's `2026-09-28` has no `closed` key (`'closed' in sprint` is false) and no `extra`. On a fresh `setup()`, after `addLine(sprints, '2026-09-28', 'closed:')`, the same holds, and after `setCapacity('2026-09-28', { fred: 5 }, 'fred')` `raw` has no line starting with `closed`.
  - `a malformed closed is kept in extra and does not block reads`: for each value `'soon'`, `'2026-10-26'`, `'2026-10-26T12:00:00'`, `'2026-10-26 12:00:00Z'`, `'2026-02-30T12:00:00Z'` and `'2026'` (Review Focus 2), on a fresh `setup()`, `addLine(sprints, '2026-10-12', `closed: ${value}`)`. `currentCycle()` does not throw, has no `closed` key, and its `extra` deep-equals `{ closed: expected }`, where `expected` is the number `2026` for `'2026'` and the string otherwise. `listCycles()` has 2 sprints. After `setCapacity('2026-10-12', { fred: 5 }, 'fred')`, `raw` contains `` `\nclosed: ${value}\n` ``.
  - `closeCycle replaces a closed the active sprint already had and keeps other hand-added keys` (Review Focus 3): for each value `'soon'` and `'2026-10-01T00:00:00Z'`, on a fresh `setup('team', AT)`, `addLine` both `closed: ${value}` and `retro: notes` to `2026-10-12`. `closeCycle('2026-10-12', 'fred').sprint` has `closed` equal to `AT` and `extra` deep-equal to `{ retro: 'notes' }`. `raw` has exactly one line starting with `closed:`, which is `` `closed: ${AT}` ``, and keeps `retro: notes`.
  - `updateCycleCapacity on a closed sprint keeps closed`: `setup('team', AT)`, close `2026-10-12`, then `updateCycleCapacity('2026-10-12', { capacity: { fred: 1 } }, 'fred')`. `parseYaml(raw(...)).closed` is `AT` and its `capacity` is `{ fred: 1 }`.

- [ ] **Step 2: Write the failing CLI test** in `scripts/cli.test.mjs`, after `a split in cycle close leaves the remaining work for cycle plan`. Name: `velocity counts the moves to done made before a late close and not after it`. On `makeRepo('team')`, with `const at = (iso) => ({ env: { PMKIT_NOW: iso } })` passed as the third argument of `json`:
  - `issues move ISS-5N1R done` at `2026-10-24T15:00:00Z`.
  - `issues move ISS-8C4W done` at `2026-10-26T10:00:00Z` (the write `pr sync` makes).
  - The split of ISS-2X6D, all at `2026-10-26T11:00:00Z`: the `issues create` argv of the existing split test, then `issues link <new id> ISS-2X6D --kind related`, `issues update ISS-2X6D --estimate 5`, `issues move ISS-2X6D done`.
  - `cycle close 2026-10-12` at `2026-10-26T12:00:00Z`. Its `sprint.closed` is `'2026-10-26T12:00:00Z'`, and its `unfinished` ids deep-equal `['ISS-4M2S']`. The file `.issues/sprints/2026-10-12.yaml` matches `/^state: closed\nclosed: 2026-10-26T12:00:00Z$/m`.
  - `cycle issues 2026-10-12`: the done issues are `ISS-2X6D`, `ISS-5N1R`, `ISS-8C4W` (sorted), and their estimates sum to 13.
  - `metrics velocity` `perSprint` deep-equals `[{ id: '2026-09-28', points: 10, count: 3 }, { id: '2026-10-12', points: 13, count: 3 }]`. The `2026-10-12` row equals `{ id: '2026-10-12', points: <the sum above>, count: <the done count above> }` (criterion 3).
  - `issues move ISS-4M2S done` at `2026-10-27T10:00:00Z`, then `metrics velocity` `perSprint` deep-equals the same two rows.

- [ ] **Step 3: Run to verify they fail**

Run: `node --test scripts/sprints.test.mjs scripts/cli.test.mjs`
Expected: these FAIL. `closeCycle writes closed`, the dry run test, `closeCycle replaces a closed` and `updateCycleCapacity ... keeps closed` fail because `closed` is `undefined` (with `soon` the old value is also still in `extra`). `a valid closed reads as written` fails because the value lands in `extra.closed` and `closed` is `undefined`. `a missing or empty closed` fails because `closed:` lands in `extra` as `{ closed: null }`. The CLI test fails on `sprint.closed` (`undefined`); without that assertion its velocity would be `{ points: 3, count: 1 }` for `2026-10-12`. `a malformed closed is kept in extra` already PASSES (an unknown key goes to `extra` today) and must keep passing.

- [ ] **Step 4: Implement**
  - `scripts/lib/local/sprints.mjs`: add `closed` to `FILE_ORDER` as in Global Constraints. Add a module-private `validClosed(value): boolean` with the three checks of Global Constraints. In `parseSprint`, put `closed` on the sprint right after `state` when `validClosed(data.closed)`. Build `extra` from the unknown keys plus `closed: data.closed` when `data.closed` is not `undefined`, `null` or `''` and is not valid. Set `sprint.extra` only when it has a key. `serializeSprint` does not change: `{ ...extra, ...rest }` with `closed` in `FILE_ORDER` writes either value at its place.
  - `scripts/lib/model.mjs`: the typedef line of Global Constraints.
  - `scripts/lib/local/tracker.mjs`, `closeCycle`: replace `{ ...before, state: 'closed' }` with a sprint in model order. A plain spread would put `closed` after `daysOff` and keep `extra.closed`:

```js
const { capacity, daysOff, extra, closed: _previous, ...head } = before
const { closed: _malformed, ...kept } = extra ?? {}
const next = { ...head, state: 'closed', closed: stamp(), capacity, daysOff, ...(Object.keys(kept).length > 0 ? { extra: kept } : {}) }
```

- [ ] **Step 5: Run to verify they pass**

Run: `node --test scripts/sprints.test.mjs scripts/cli.test.mjs scripts/metrics.test.mjs`
Expected: PASS.

- [ ] **Step 6: Run the whole suite and see the expected golden failures**

Run: `npm test`
Expected: FAIL only in `scripts/goldens.test.mjs` for `team/cycle-close.txt` and `messy-merge/cycle-close.txt`, and in `scripts/scenarios.test.mjs` for `scenario cycle-close` (rule 12). Any other failure is a bug.

- [ ] **Step 7: Regenerate and read the diffs**

Run: `UPDATE_GOLDENS=1 node --test scripts/goldens.test.mjs`, then `UPDATE_GOLDENS=1 node --test scripts/scenarios.test.mjs`, then `git status --short scripts/__goldens__ scripts/__scenarios__` and `git diff scripts/__goldens__ scripts/__scenarios__`.
Expected: only the three files of Task 2 in "Goldens and scenario snapshots" change, with the 2, 2 and 1 added lines listed there and nothing removed.

- [ ] **Step 8: Run the whole suite**

Run: `npm test`
Expected: PASS, 1081 tests.

- [ ] **Step 9: Commit**

```bash
git add scripts/lib/local/sprints.mjs scripts/lib/local/tracker.mjs scripts/lib/model.mjs scripts/sprints.test.mjs scripts/cli.test.mjs scripts/__goldens__/team/cycle-close.txt scripts/__goldens__/messy-merge/cycle-close.txt scripts/__scenarios__/cycle-close.after.txt
git commit -m "feat: record when a sprint closes in its closed key (PMK-121)" -m "Co-Authored-By: <model> <noreply@anthropic.com>"
```

Complexidade: alta

---

### Task 3: validate lists a malformed closed

**Files:**
- Modify: `scripts/lib/validate.mjs` (the sprint loop, lines 185 to 196)
- Test: `scripts/validate.test.mjs`, `scripts/cli.test.mjs`

**Interfaces:**
- Consumes: `sprint.extra.closed` from Task 2's `parseSprint`.
- Produces: nothing for later tasks.

- [ ] **Step 1: Write the tests.** In `scripts/validate.test.mjs`, after `team fixture reports only its conflicted issue`, with `const addClosed = (root, value) => fs.appendFileSync(path.join(root, '.issues', 'sprints', '2026-09-28.yaml'), `closed: ${value}\n`)`:
  - `a malformed closed in a sprint file is one sprint problem`: `makeRepo('team')`, `addClosed(root, '2026-10-26')`. `brief(result)` deep-equals `['conflict .issues/issues/ISS-3Q6T/issue.md', 'sprint .issues/sprints/2026-09-28.yaml']`, and the `sprint` problem deep-equals `{ path: '.issues/sprints/2026-09-28.yaml', code: 'sprint', message: 'closed "2026-10-26" is not a timestamp with a date, a time and a zone (Z or an offset such as -03:00), so velocity uses the end date' }`. With `addClosed(root, '2026')` on a fresh copy the message starts with `closed "2026" is not a timestamp` (Review Focus 2).
  - `a valid closed in a sprint file is no problem`: `makeRepo('team')`, `addClosed(root, '2026-10-12T09:00:00Z')`. `brief(result)` deep-equals `['conflict .issues/issues/ISS-3Q6T/issue.md']`.

  In `scripts/cli.test.mjs`, after `metrics velocity on the team fixture`:
  - `metrics velocity falls back to the end date for a malformed closed`: `makeRepo('team')`, append `closed: 2026-10-26\n` to `.issues/sprints/2026-09-28.yaml`. `json(root, ['metrics', 'velocity']).perSprint` deep-equals `[{ id: '2026-09-28', points: 10, count: 3 }]`.

- [ ] **Step 2: Run to verify which fail**

Run: `node --test scripts/validate.test.mjs scripts/cli.test.mjs`
Expected: `a malformed closed in a sprint file is one sprint problem` FAILS, because `brief(result)` has only the conflict problem. `a valid closed in a sprint file is no problem` and the CLI fallback test PASS already: they guard the "not fatal" rule.

- [ ] **Step 3: Implement** in the sprint loop of `scripts/lib/validate.mjs`, right after `readSprint` and before the `start > end` check:

```js
if (sprint.extra && Object.hasOwn(sprint.extra, 'closed')) {
  add(file, 'sprint', `closed "${sprint.extra.closed}" is not a timestamp with a date, a time and a zone (Z or an offset such as -03:00), so velocity uses the end date`)
}
```

- [ ] **Step 4: Run to verify they pass**

Run: `node --test scripts/validate.test.mjs scripts/cli.test.mjs`
Expected: PASS.

- [ ] **Step 5: Run the whole suite**

Run: `npm test`
Expected: PASS, 1084 tests, no golden or snapshot differs (no fixture has `closed`).

- [ ] **Step 6: Commit**

```bash
git add scripts/lib/validate.mjs scripts/validate.test.mjs scripts/cli.test.mjs
git commit -m "feat: list a malformed sprint closed in validate (PMK-121)" -m "Co-Authored-By: <model> <noreply@anthropic.com>"
```

Complexidade: baixa

---

### Task 4: cycle:close runs every move and split before the close

**Files:**
- Modify: `commands/cycle/close.md` (steps 6, 7, 8 and 9), `scripts/__scenarios__/cycle-close.mjs`, `scripts/cli.test.mjs` (the test at line 483)
- Test: `scripts/scenarios.test.mjs`
- Regenerate: `scripts/__scenarios__/cycle-close.after.txt`

**Interfaces:**
- Consumes: `closed` from Task 2 (the scenario's sprint diff already shows it).
- Produces: nothing for later tasks.

- [ ] **Step 1: Write the static test.** Add the test of "The static test" in Global Constraints to `scripts/scenarios.test.mjs`, word for word.

- [ ] **Step 2: Change the scenario** `scripts/__scenarios__/cycle-close.mjs`:
  - The header comment lines "Step 8 closes the sprint first, then runs the moves and the split, then reads the sprint's issues again for the delivered numbers." become: "Step 6 reads ISS-0G5E, the issue outside the sprint that the related list of ISS-2X6D names. It is canceled and older than the sprint, so it is no half-done split. Step 8 runs the moves and the split, closes the sprint last, then reads the sprint's issues again for the delivered numbers."
  - After `{ step: '6', read: ['cycle', 'list', '--state', 'planned'], save: 'planned' }`, add `{ step: '6', read: ['issues', 'get', 'ISS-0G5E'], save: 'related' }`.
  - The step 8 block becomes, in this order, with its comment changed to `// Step 8: the same moves and the split without --dry-run (create, link, estimate, move), then the close.`: `{ step: '7', write: toBacklog }`, `{ step: '7', write: split, save: 'remaining' }`, the `issues link` entry as today, `{ step: '7', write: shrink }`, `{ step: '8', write: done }`, `{ step: '8', write: close }`.
  - In `expect`, after the `saved.planned` assertion: `assert.equal(saved.related.status.category, 'canceled', 'the related issue outside the sprint is no half-done split')`.

- [ ] **Step 3: Run to verify they fail**

Run: `node --test --test-name-pattern="cycle/close step 8|scenario cycle-close" scripts/scenarios.test.mjs`
Expected: both FAIL against today's `close.md`. The static test fails with `step 8 runs issues move`. The scenario fails with rule 5 problems: step 6 has no `issues get` call, and step 8 has no `issues move` call.

- [ ] **Step 4: Change `commands/cycle/close.md`** to the text of "The new text of `commands/cycle/close.md`" in Global Constraints, word for word.

- [ ] **Step 5: Run to verify the static test passes and the snapshot is the only difference**

Run: `node --test --test-name-pattern="cycle/close step 8|scenario cycle-close|every flag|every call ends" scripts/scenarios.test.mjs`
Expected: the static test, rule 3 and rule 4 PASS. `scenario cycle-close` fails only on rule 12 (the snapshot differs), with no rule 5, 6 or 9 problem.

- [ ] **Step 6: Regenerate and read the diff**

Run: `UPDATE_GOLDENS=1 node --test scripts/scenarios.test.mjs`, then `git status --short scripts/__scenarios__` and `git diff scripts/__scenarios__/cycle-close.after.txt`.
Expected: only `cycle-close.after.txt` changes, with the Task 4 changes listed in "Goldens and scenario snapshots": the `issues get ISS-0G5E` read, `[step 8, write]` on the move to `done`, and the `cycle close` write moved after it. No line below `--- added` or `--- changed` changes.

- [ ] **Step 7: Reorder the PMK-113 CLI test** `a split in cycle close leaves the remaining work for cycle plan` in `scripts/cli.test.mjs`. Move `json(root, ['cycle', 'close', '2026-10-12'])` after `json(root, ['issues', 'move', 'ISS-2X6D', 'done'])`. The first comment becomes `// The step 8 writes of the cycle-close scenario: create, link, lower the estimate, move to done, then close.` The two comment lines that start `// PMKIT_NOW 2026-10-23 falls before` and `// No assertion covers a late close` become one line: `// Every call runs at PMKIT_NOW 2026-10-23, before the sprint's end. "velocity counts the moves to done made before a late close and not after it" covers a late close.` The velocity assertion `{ id: '2026-10-12', points: 5, count: 1 }` stays.

- [ ] **Step 8: Run the focused tests**

Run: `node --test scripts/scenarios.test.mjs scripts/cli.test.mjs scripts/scenario-helpers.test.mjs`
Expected: PASS.

- [ ] **Step 9: Run the whole suite**

Run: `npm test`
Expected: PASS, 1085 tests.

- [ ] **Step 10: Commit**

```bash
git add commands/cycle/close.md scripts/scenarios.test.mjs scripts/__scenarios__/cycle-close.mjs scripts/__scenarios__/cycle-close.after.txt scripts/cli.test.mjs
git commit -m "fix: run the moves and splits before cycle close in /pmkit:cycle:close (PMK-121)" -m "Co-Authored-By: <model> <noreply@anthropic.com>"
```

Complexidade: média

---

### Task 5: the design spec and CONTEXT.md describe closed and the cutoff

**Files:**
- Modify: `docs/superpowers/specs/2026-10-23-pmkit-design.md` (lines 66 and 253), `CONTEXT.md` (line 40)

**Interfaces:**
- Consumes: the behavior of Tasks 1, 2 and 4.
- Produces: nothing.

- [ ] **Step 1: Edit the texts** as "The design spec and CONTEXT.md" in Global Constraints gives them, word for word.

- [ ] **Step 2: Check the edits**

Run: `grep -n "ISO timestamp of the close with" docs/superpowers/specs/2026-10-23-pmkit-design.md`, `grep -n "so the list is empty after a full run" docs/superpowers/specs/2026-10-23-pmkit-design.md` and `grep -n "records when it was closed" CONTEXT.md`
Expected: one match each, at lines 66, 253 and 40.

- [ ] **Step 3: Run the whole suite**

Run: `npm test`
Expected: PASS, 1085 tests.

- [ ] **Step 4: Commit**

```bash
git add docs/superpowers/specs/2026-10-23-pmkit-design.md CONTEXT.md
git commit -m "docs: describe the sprint closed key and the velocity cutoff (PMK-121)" -m "Co-Authored-By: <model> <noreply@anthropic.com>"
```

Complexidade: baixa

---

## Decisions made in this plan

- Task order: the pure rule (Task 1), then the key that feeds it (Task 2), then `validate` (Task 3), then the command text (Task 4), then the docs (Task 5). Each commit leaves `npm test` green. The `cycle-close` snapshot changes in Tasks 2 and 4, once per cause, so each diff has one explanation.
- `closed: ''` reads as missing, like `closed:` with no value. The spec names only the empty value. Both are dropped by the next write, so listing `''` as malformed would report a value no write keeps.
- `validClosed` stays private to `sprints.mjs`. Only `parseSprint` uses it, and the sprint tests cover it through the tracker.
- The design spec gets one velocity sentence in the Sprints section (line 253), and `CONTEXT.md` one sentence in the Sprint entry. The spec fixed where, not the words, so the words are in Global Constraints.
- Test counts in the "Expected" lines assume one `test()` per bullet: 4 in Task 1, 7 sprint tests and 1 CLI test in Task 2, 2 validate tests and 1 CLI test in Task 3, 1 static test in Task 4. A different count is fine when every listed test exists and passes.
- Open question 1 of the spec (a split whose create ran and whose link failed) stays out of this issue. Step 8 names the case and gives the link command. The state file records it for PMK-123.
