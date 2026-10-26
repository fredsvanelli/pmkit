# PMK-121: count done issues moved during a late cycle close in velocity

## Problem

`velocity` in `scripts/lib/metrics.mjs` counts an issue for a closed sprint when three things hold. The issue's current sprint is that sprint. Its status is in the `done` category. The UTC date of its last move into `done` is on or before the sprint's `end` (`issue.doneAt.slice(0, 10) <= sprint.end`).

`/pmkit:cycle:close` usually runs on or after the end date. Two of its writes move issues to `done` at that time:

- Step 1 runs `pr sync`, which moves `in_review` issues with a merged PR to `done`.
- Step 8 runs the split from PMK-113, which moves the original issue to `done` with its estimate lowered to the delivered part.

When the close runs after `end`, velocity counts 0 for those issues, while the close report of step 8 counts them as delivered. `/pmkit:cycle:plan` step 3 plans the next sprint from that low velocity.

Acceptance criteria:

1. An issue of the sprint moved to `done` after the sprint's `end` but before the sprint is closed (by `pr sync` or by the split in `/pmkit:cycle:close`) counts in that sprint's velocity, with its points and in the count, as the `cycle:close` report shows it.
2. An issue moved to `done` after its sprint is closed does not count in that closed sprint.
3. `metrics velocity`, `/pmkit:cycle:plan` and `/pmkit:report:status` read the same rule, so their numbers agree with the `cycle:close` report.
4. Tests cover a move to `done` before the end, between the end and the close, and after the close, and `npm test` passes.

## Reproduced behavior

A script in the session scratchpad builds a temp project with `git init` and `pmkit init --git-host none --member fred ...`, and gives every call its own `PMKIT_NOW`. Code on this branch at `2bf5d05`. This repo's `.issues/` was not touched.

Sprint `2026-10-12`, `end` 2026-10-25. Four issues in the sprint:

| Issue | Estimate | What happens | When |
| --- | --- | --- | --- |
| ISS-8CYN | 2 | `issues move done` | 2026-10-24T15:00:00Z, before the end |
| ISS-W8M4 | 3 | `issues move done`, the same write `pr sync` makes | 2026-10-26T10:00:00Z, after the end, before the close |
| (close) | | `cycle close 2026-10-12` | 2026-10-26T12:00:00Z |
| ISS-JRR9 | 8, then 5 | `in_progress`, then the split writes of step 8 as `close.md` orders them today: estimate to 5, then `issues move done` | 2026-10-26T12:00:05Z and 12:00:06Z, seconds after the close |
| ISS-YWJ4 | 5 | `issues move done` while still in the closed sprint | 2026-10-27T10:00:00Z, after the close |

The sprint file after the close has no trace of when it was closed:

```yaml
name: Sprint 2026-10-12
start: 2026-10-12
end: 2026-10-25
state: closed
```

`closeCycle` writes no event either. Sprints have no `events.jsonl`.

The close report of step 8 (the `cycle issues` read after the writes, done issues only):

```
delivered: 3 issues, 10 points: ISS-8CYN=2 ISS-W8M4=3 ISS-JRR9=5
```

`metrics velocity` right after the close, and again after ISS-YWJ4 moves to `done` the next day:

```
Sprint     | Points | Issues
-----------|--------|-------
2026-10-12 | 2      | 1
average: 2 points
```

So velocity says 2 points and 1 issue where the close report says 10 points and 3 issues. ISS-W8M4 and ISS-JRR9 are criterion 1. ISS-YWJ4 is correctly left out, but only because its date is after `end`.

A second project closes the same sprint early, on 2026-10-23T12:00:00Z, and moves a 3-point issue that stayed in it to `done` on 2026-10-24T10:00:00Z. `metrics velocity` gives `2026-10-12 | 3 | 1`. The move came after the close, so criterion 2 fails today when a sprint closes before its end.

## What reads velocity today

- `metrics velocity` in `scripts/pmkit.mjs` calls `velocity(tracker.listCycles({ state: 'closed' }), tracker.issuesBySprint(), ...)`. That is the only caller of `velocity`.
- `/pmkit:cycle:plan` step 3 runs `metrics velocity --window <n> --json`. It reads the same function.
- `/pmkit:report:status` reads no velocity. It reads `epic progress`, `issues list --parent` and `events --since`. Its numbers are per epic and count every done issue, with no sprint and no date cutoff. The issue text says it reads the same metrics. It does not, so criterion 3 holds for it with no change.
- The `cycle:close` report does not call `metrics velocity`. Step 8 counts the done issues of the `cycle issues` read after the writes.
- `velocity`, `issuesBySprint` and the sprint shape are not in `TRACKER_OPERATIONS` (`scripts/lib/contract.mjs`). The contract lists `listCycles` and `closeCycle`. The Sprint entity in the design spec's common model lists its fields.

## Options

The cutoff is the question: up to what time does a move to `done` count for a closed sprint?

**A. Count a move to `done` up to the moment the sprint is closed.** `closeCycle` records the close time. The brief offered two places for it:

- A close event in `events.jsonl`. Sprints have no event log, so this needs a new `sprints/<id>.events.jsonl` or a tracker-wide log. Both are new files in the format.
- A new `closed` key in the sprint file, holding the timestamp of the close. Older pmkit versions already keep unknown keys (`parseSprint` puts them in `extra`, and `serializeSprint` writes them back), so a teammate on an older plugin does not drop it.

The `closed` key is the smaller change and the one this spec weighs as A.

- Criterion 1, `pr sync` in step 1: counts, because step 1 runs before the close.
- Criterion 1, the split: does not count with today's `close.md`, because step 8 runs `cycle close` first and the split after it. The repro shows the gap: ISS-JRR9 moves to `done` 6 seconds after the close. A needs step 8 to run the moves and splits before `cycle close`.
- Criterion 2: holds for a late close and for an early close.
- Old sprints have no `closed`. A needs a fallback for them (see "Old data").
- Other adapters: Linear cycles have `completedAt`, and Jira sprints have `completeDate`, so both can fill `closed`. GitHub Projects iterations, GitLab iterations and Azure DevOps iterations end by date, with no close action and no close time. Those adapters leave `closed` out, and the fallback applies. For them the end date stays the cutoff it is today, with its UTC limit (see "Old data").
- Format: one optional key. Readers that do not know it keep it. No migration, no format bump (the `1 → 2` bump existed because format 1 readers reject numbered IDs, which does not apply here).
- Contract: no operation changes. The Sprint entity gains one optional field.

**B. Count a move to `done` up to `end` plus a grace period**, fixed or from a new `defaults.velocity_grace_days`.

- Criterion 1 holds only when the close runs within the grace. A close on the Monday after a Sunday end needs 1 day. A close a week late needs 7.
- Criterion 2 fails inside the grace. With a grace of 2 days or more, ISS-YWJ4 counts. With a grace of 1, a close on day 2 misses ISS-W8M4. No grace satisfies both criteria.
- The early-close case fails too, as it does today.
- Old data, other adapters and the sprint file format need nothing. A configurable grace adds a key to `.issues/config.yaml` and its schema.

**C. Snapshot at close.** `closeCycle` writes the delivered issues (IDs, or count and points) into the sprint file, and velocity reads the snapshot.

- The split runs after the close today, so C needs the same reorder of step 8 as A.
- The snapshot freezes the estimates at the close. A later estimate fix or a move of a done issue out of the sprint no longer reaches velocity, and the file and the issues can disagree with no way to tell which is right.
- Old sprints have no snapshot, so C needs the same fallback as A.
- Format: a list or a map in the sprint file that duplicates what the issues already hold. Adapters: Linear and Jira have sprint reports, the date-based adapters have nothing.
- Contract: `closeCycle` must compute and return the snapshot.

**D. No cutoff: count every done issue of a closed sprint.** Checked and dropped. It passes criterion 1 in any order, but ISS-YWJ4 counts, so criterion 2 fails.

| | A: up to `closed` | B: `end` plus grace | C: snapshot |
| --- | --- | --- | --- |
| Criterion 1, `pr sync` | yes | only within the grace | yes |
| Criterion 1, split | yes, with the step 8 reorder | only within the grace | yes, with the step 8 reorder |
| Criterion 2, late close | yes | no, inside the grace | yes |
| Criterion 2, early close | yes | no | yes |
| Sprints closed before the change | fallback to `end` | same rule for all | fallback to `end` |
| Adapters without a close time | fallback to `end` | same rule for all | fallback to `end` |
| File format | one optional key, no migration | none, or one config key | a list per sprint, no migration |
| Contract | one optional Sprint field | none | `closeCycle` result grows |
| Command text | step 8 order in `close.md` | none | step 8 order in `close.md` |

**Recommendation: A, with the `closed` key in the sprint file, the step 8 reorder in `close.md`, and the end-date rule as the fallback for a closed sprint without `closed`.** It is the only option that meets criteria 1 and 2 in every case the repro shows, and it adds one optional key that older readers keep.

## The rule

For each closed sprint `S` in the window, an issue counts when all of these hold:

1. The issue's current `sprint` is `S.id`.
2. Its status is in the `done` category.
3. `doneAt`, the `at` of its last move into a `done` status, exists.
4. The cutoff:
   - When `S.closed` exists: `Date.parse(doneAt) <= Date.parse(S.closed)`. A move in the same second as the close counts. The comparison is on instants, so a `closed` with an offset works the same as one with `Z`.
   - When `S.closed` is missing: `doneAt.slice(0, 10) <= S.end`, the rule of today.

Points, the count, the unit choice and the average stay as they are. The window still takes the last `window` closed sprints sorted by `end`.

`velocity` in `scripts/lib/metrics.mjs` stays the one function that applies the rule. It reads `closed` from the sprint objects it already receives from `listCycles`. `issuesBySprint` does not change.

### The `closed` key

- File: `closed: 2026-10-26T12:00:00Z` in `sprints/<id>.yaml`, after `state`. `FILE_ORDER` becomes `name, start, end, goal, state, closed, capacity, days_off`.
- Model: `closed` on the sprint object, right after `state`, as an ISO timestamp with `Z` or an offset. It is left out when the file has none, the same way an issue leaves out a missing `sprint`. The name follows `created` and `updated` on issues. The `Sprint` typedef in `scripts/lib/model.mjs` gains `@property {string} [closed]` after `state`, described as "ISO timestamp of the close, with Z or an offset, set by closeCycle".
- A valid `closed` matches `^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$`, its first 10 characters pass `validDate`, and `Date.parse` gives a number. The `validDate` check refuses a day that does not exist, such as `2026-02-30T12:00:00Z`, which the regex and `Date.parse` both accept. The regex refuses a date with no time (it would cut off every move made later that day), a time with no zone (V8 reads it as local time, so the cutoff would depend on the machine), and a space in place of the `T`.
- `parseSprint` keeps a valid `closed` as written, offset or fraction of a second included. It does not convert it to UTC, so no write rewrites a value the user typed. `closeCycle` writes the `Z` form, because `stamp()` gives it.
- A malformed `closed` is not fatal. `parseSprint` leaves `closed` off the sprint object, so velocity takes the end-date fallback. It puts the value in `extra.closed`, so the next write keeps the line as written, as 0.1.0 and 0.2.0 do today for any unknown key. A `closed:` line with no value parses to `null`. It reads as missing, `validate` lists nothing for it, and the next write drops the line, as it drops any empty sprint key today.
- `validate` lists a malformed `closed` as one problem on the sprint file. Path: `.issues/sprints/<id>.yaml`. Code: `sprint`. Message: `closed "<value>" is not a timestamp with a date, a time and a zone (Z or an offset such as -03:00), so velocity uses the end date`. `validate` finds it in `sprint.extra.closed` after `readSprint`, so the existing loop over sprint files needs one more check and no second read of the file.
- `closeCycle` sets `closed` to the run time (`stamp()`, so `PMKIT_NOW` in tests), in the same file write that sets `state: closed`. It builds the sprint it writes in model order, with `closed` right after `state`, and drops `extra.closed` when the file held a malformed value. The JSON result then has `"closed"` right after `"state": "closed"`, not after `daysOff` or `extra`, which a plain `{ ...before, state: 'closed', closed }` would give. The dry run returns the same sprint, `closed` included, and writes nothing.
- A `closed` on a sprint whose `state` is not `closed` is kept and ignored. Velocity reads only closed sprints, and the next `closeCycle` overwrites it. No command reopens a sprint today.
- `updateCycleCapacity` and any other sprint write keep `closed`, because they spread the sprint they read.

### Step 8 of `/pmkit:cycle:close`

Step 8 runs the writes in this order: the moves (`cycle add`), then each split (create, link, estimate, move to `done`), then `cycle close`. The new text says why in one sentence: velocity counts a move to `done` only up to the close, so the splits run before it. The single approval of step 7 does not change. To make the order testable, step 8 names the `issues move <original id> done` call in full, where today it says "the move to `done` of the original".

**A failed write.** The stop rule stays as `close.md` has it today: stop at the first failed write, list what was done and what was not, and do not retry it. The close is now the last write, so after any failure the sprint is still active, and step 8 says so. For a split whose create ran, step 8 gives the new ID and the commands of that split that did not run.

**A second run.** A second run of `/pmkit:cycle:close` finds the sprint still active and repeats nothing that ran:

- A `cycle add` that ran took its issues out of the sprint, so step 3 does not list them.
- A split that finished left the original `done`, so step 3 counts it as delivered and step 6 offers nothing for it.
- A split whose link ran but whose estimate update or move did not is found in step 6. For each unfinished issue whose `related` list names an issue outside the step 3 read, step 6 runs `issues get <related id> --json`. When that issue has no `sprint`, a status category other than `done` and `canceled`, and a `created` date on or after the sprint's start, step 6 names it and proposes to finish that split, in place of a new split. Steps 7 and 8 then run only the estimate update and the move to `done` of the original, with no create and no link, so no second remaining-work issue is made. The estimate update with the value the issue already has writes nothing (checked in a temp project).
- A split whose create ran but whose link did not leaves no trace a second run can read. Step 8 names that case when it stops: it gives the new ID and the `issues link` command, and says that a second run cannot tell the new issue belongs to the split, so the user runs the link first. See open question 1.

**A failed close.** When `cycle close` fails after every move and split ran (a teammate closed the sprint, or `.pmkit/config.yaml` became invalid), the moves stay written and the sprint is not closed by this run. Step 9 (the retro) runs only when `cycle close` succeeded, and says so when it skips.

**The step 7 preview.** The dry run of `cycle close` in step 7 runs before the moves, so its `unfinished` list holds every unfinished issue. The real close runs after them and lists none. Step 7 says that the preview's list is the list before the moves and splits. When the real close lists an issue anyway, the issue joined the sprint after step 3, and step 8 names it and says it stays in the closed sprint.

The report text of `close.md` (step 8 numbers, Output) does not change. With the reorder, every done issue of the step 8 read has its move to `done` at or before `closed`, so the report and velocity give the same count and points. The exception is a done issue with no move event (follow-up 1): it counts in the report and not in velocity, as it does today.

### The new text of the steps that change

Steps 6, 7, 8 and 9 of `commands/cycle/close.md` change. Steps 1 to 5, step 10, the confirmation points, Output and "If something is missing" stay as they are. A parse of this text with `parseCommandFile` gives the step 8 calls `issues link`, `issues move`, `cycle close`, `cycle issues`, in that order, every flag is a flag of its CLI command, and no flag is loose (checked against a temp copy of the text).

Step 6 keeps its paragraph and gains a second one, indented under it:

```markdown
   A failed step 8 can leave a split half done, with the new issue created and linked but the original not yet `done`. For each unfinished issue whose `related` list in the step 3 read names an issue that is not in that read, run `node "${CLAUDE_PLUGIN_ROOT}/scripts/pmkit.mjs" issues get <related id> --json`. When that issue has no `sprint`, a status category other than `done` and `canceled`, and a `created` date on or after the sprint's start, it may hold the remaining work of a split already made. Name it, and propose to finish that split in place of a new one: step 7 asks for the delivered part, and step 8 runs only the estimate update and the move to `done` of the original. Do not offer a new split for that issue, because its create would make a second remaining-work issue. The two moves stay on offer.
```

Step 7 keeps its first paragraph and its three bullets. A new paragraph goes after the bullets:

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

Step 9 gains two sentences at its start. The rest of the step stays:

```markdown
9. Run this step only when `cycle close` succeeded in step 8. When it did not, say that the sprint is still active and that no retro is offered, and go to step 10. Offer a retro document. ...
```

## Old data

A sprint closed before this change has no `closed`. The rule falls back to the end date for it, so its velocity stays what it is today. No file is rewritten, and no command adds `closed` to old sprints.

Reasons for the end-date fallback over "count every done issue" for old sprints:

- The numbers a team already planned from do not move on upgrade.
- "Count every done issue" would count moves made after the close, the case criterion 2 rejects, and nothing in an old sprint tells the two apart.
- With the default `velocity_window` of 3, the old rule leaves the window after three closes made with this version.

The `team` fixture's closed sprint `2026-09-28` has no `closed`, so it stays the old-data case in the tests, and its velocity stays 10 points and 3 issues.

A teammate on an older pmkit who closes a sprint writes no `closed`, so that sprint uses the fallback too. A teammate on an older pmkit who edits a sprint that has `closed` keeps the key, because older readers keep unknown keys.

Teammates on mixed versions compute velocity with different rules for the same sprint. On 0.2.0, `closed` is an `extra` key, so `metrics velocity` and `/pmkit:cycle:plan` apply the end-date rule to every closed sprint. On the new version they apply the `closed` cutoff. The two agree when every move to `done` came before the close and on or before the end date. They differ when a move came between the end and a late close, or after an early close. The format stays 2 all the same: a bump would block the older teammate's writes, and the file stays readable by both.

The fallback keeps one limit of today's rule, unchanged. It compares the UTC date of the move with `end`. In a zone behind UTC, a move made late on the end date is already the next day in UTC, so it does not count. A temp copy of the `team` fixture reproduces it: a move at 22:00 and a close at 23:00 local time on 2026-10-25 in UTC-3 give `2026-10-12 | 0 | 0` today. A sprint with `closed` counts that move, because the cutoff is the close instant. Old sprints and adapters with no close time keep the limit.

## Changes

- `scripts/lib/local/sprints.mjs`: `closed` in `FILE_ORDER`. `parseSprint` checks it with the rule of "The `closed` key", puts a valid one right after `state`, leaves it out when missing or empty, and puts a malformed one in `extra.closed`.
- `scripts/lib/local/tracker.mjs`: `closeCycle` writes `closed: stamp()`, builds the sprint in model order, and drops `extra.closed`.
- `scripts/lib/validate.mjs`: one `sprint` problem for a sprint whose `extra.closed` is set.
- `scripts/lib/model.mjs`: the `Sprint` typedef gains `@property {string} [closed]` after `state`.
- `scripts/lib/metrics.mjs`: the cutoff of "The rule".
- `commands/cycle/close.md`: steps 6, 7, 8 and 9 as "The new text of the steps that change" gives them. The `cycle-close` scenario follows.
- `docs/superpowers/specs/2026-10-23-pmkit-design.md`: the Sprint row of the common model gains `closed` (ISO timestamp with `Z` or an offset, set by `closeCycle`, optional). In the Sprints section (line 253), the sentence "`closeCycle` sets `closed` and returns the issues that were not `done` or `canceled`, for the command to move." becomes "`closeCycle` sets `state: closed` and `closed`, the time of the close, and returns the issues not in a terminal category. `/pmkit:cycle:close` moves or splits them before the close, so the list is empty after a full run." A new sentence states the velocity cutoff.
- `CONTEXT.md`: the Sprint entry says a closed sprint records when it was closed.
- No change to `commands/cycle/plan.md`, `commands/report/status.md`, `skills/pmkit/references/conventions.md`, `README.md`, the `metrics velocity` summary, `TRACKER_OPERATIONS`, the config schemas or the tracker format.

## Assertions per criterion

Criterion 1:

- Unit, `velocity` with a sprint `{ id: 'a', end: '2026-10-25', state: 'closed', closed: '2026-10-26T12:00:00Z' }`: a done issue of 3 points with `doneAt` 2026-10-26T10:00:00Z counts, and one of 5 points with `doneAt` 2026-10-26T12:00:00Z (the same second) counts.
- Unit, `closed` with an offset: a sprint with `closed: '2026-10-26T09:00:00-03:00'` and a done issue with `doneAt` 2026-10-26T11:30:00Z counts, because 11:30Z is before 12:00Z.
- Static, step 8 order: in `scripts/scenarios.test.mjs`, inside `describe('scenarios')`, the test "cycle/close step 8 runs cycle close after every issues link and issues move call". It fails on today's `close.md`, whose step 8 calls are `cycle close`, `issues link`, `cycle issues`, with no `issues move`. The assertion:

  ```js
  const step8 = FILES.find((file) => file.rel === 'cycle/close.md').parsed.calls
    .filter((call) => call.step === '8' && !call.dryRun)
    .map((call) => call.command)
  const close = step8.indexOf('cycle close')
  assert.ok(close >= 0, 'step 8 runs cycle close')
  for (const name of ['issues link', 'issues move']) {
    assert.ok(step8.includes(name), `step 8 runs ${name}`)
    assert.ok(step8.lastIndexOf(name) < close, `${name} comes before cycle close in step 8`)
  }
  ```
- CLI, on a copy of the `team` fixture with one `PMKIT_NOW` per call:
  - ISS-5N1R moves to `done` at 2026-10-24T15:00:00Z (before the end, 3 points).
  - ISS-8C4W moves to `done` at 2026-10-26T10:00:00Z with `issues move`, the same `moveToCategory` write `pr sync` makes (5 points).
  - The split of ISS-2X6D runs at 2026-10-26T11:00:00Z: create, link, estimate 5, move to `done`.
  - `cycle close 2026-10-12` runs at 2026-10-26T12:00:00Z. The sprint file has `closed: 2026-10-26T12:00:00Z`, and the JSON result has the same `closed`.
  - The `cycle issues 2026-10-12` read after the close gives 3 done issues and 13 points.
  - `metrics velocity --json` gives `{ id: '2026-10-12', points: 13, count: 3 }`.

Criterion 2:

- Unit: the same sprint, a done issue of 8 points with `doneAt` 2026-10-27T10:00:00Z does not count. Total for the sprint: the 3 and 5 of criterion 1 plus a 2-point issue done before the end, so `{ points: 10, count: 3 }`.
- Unit, early close: `{ end: '2026-10-25', closed: '2026-10-23T12:00:00Z' }` and a done issue with `doneAt` 2026-10-24T10:00:00Z gives `{ points: 0, count: 0 }`.
- CLI: in the test of criterion 1, ISS-4M2S (1 point, still in the closed sprint) moves to `done` at 2026-10-27T10:00:00Z, and `metrics velocity --json` still gives `{ id: '2026-10-12', points: 13, count: 3 }`.

Criterion 3:

- The CLI test of criterion 1 compares `metrics velocity` with the step 8 read of `cycle issues` (count and sum of `estimate` of the done issues), and they match.
- `/pmkit:cycle:plan` step 3 runs `metrics velocity`, so it reads the same function. The `cycle-plan` scenario keeps its velocity of 10 from the fallback.
- `/pmkit:report:status` reads no velocity (see "What reads velocity today"). Nothing to assert.

Criterion 4:

- Old data, unit: the existing velocity tests have no `closed`, so they now test the fallback and pass unchanged. Case `c` of "velocity averages the last window of closed sprints" already has a done issue on the day after `end` (`item(4, '2026-02-08T10:00:00Z')` against end `2026-02-07`) that does not count, so no new fallback test is added.
- Old data, CLI: the `team` fixture's `2026-09-28` keeps `{ points: 10, count: 3 }` in the CLI test of criterion 1 and in `scripts/__goldens__/team/metrics-velocity.txt`.
- Sprint file, `scripts/sprints.test.mjs`:
  - `closeCycle` writes `closed` with the run time and returns it, with `closed` right after `state` in the result's keys.
  - The dry run returns `closed` and leaves the file as it was.
  - A valid `closed`: a file with `closed: 2026-10-26T09:00:00-03:00` reads with that string as written, and a `setCapacity` write keeps the line as written.
  - A missing `closed`: a file without it, and a file with an empty `closed:`, read with no `closed` key and no `extra`.
  - A malformed `closed`: files with `closed: soon`, `2026-10-26`, `2026-10-26T12:00:00`, `2026-10-26 12:00:00Z` and `2026-02-30T12:00:00Z` read with no error, no `closed` key, and the value in `extra.closed`. `listCycles` and `currentCycle` still work, and a `setCapacity` write keeps the line as written.
  - `closeCycle` on an active sprint with a malformed `closed` writes the new `closed` and leaves no `extra.closed`.
  - `updateCycleCapacity` on a closed sprint keeps `closed`.
- Malformed `closed`, `scripts/validate.test.mjs`: a copy of the `team` fixture with `closed: 2026-10-26` added to `sprints/2026-09-28.yaml` lists one problem `{ path: '.issues/sprints/2026-09-28.yaml', code: 'sprint', message: 'closed "2026-10-26" is not a timestamp with a date, a time and a zone (Z or an offset such as -03:00), so velocity uses the end date' }` next to the fixture's conflict problem. The same copy with a valid `closed: 2026-10-12T09:00:00Z` lists only the conflict problem. Today's code lists only the conflict problem for both (checked in a temp project), so the malformed case fails first.
- Malformed `closed`, CLI: on the same copy with `closed: 2026-10-26`, `metrics velocity --json` exits 0 and gives `{ id: '2026-09-28', points: 10, count: 3 }`, the end-date fallback. Today's code gives the same (checked in a temp project). This test guards the "not fatal" rule and does not fail first.
- `npm test` passes.

## How each criterion is proven

| Criterion | Proof |
| --- | --- |
| 1 | The unit tests in `scripts/metrics.test.mjs`, and the CLI test in `scripts/cli.test.mjs` with per-call `PMKIT_NOW`, written first and failing on today's code (velocity gives 3 points and 1 issue for `2026-10-12`). The static test "cycle/close step 8 runs cycle close after every issues link and issues move call" in `scripts/scenarios.test.mjs`, written first and failing on today's `close.md`, proves the command text runs the split before the close. The `cycle-close` scenario shows the `closed` line in the sprint file diff. It does not prove the order, because the harness does not compare the order of calls inside a step. |
| 2 | The after-close and early-close unit tests, and the after-close move in the CLI test. The early-close unit test fails on today's code. |
| 3 | The CLI test's comparison of velocity and the step 8 read. `cycle:plan` step 3 calls `metrics velocity`. `report:status` reads no velocity, which the spec states from `commands/report/status.md`. |
| 4 | The tests above cover before the end, between the end and the close, and after the close, plus the fallback. `npm test` passes after the golden and scenario regeneration below. |

The scenarios run every call at one fixed `PMKIT_NOW` (2026-10-23T12:00:00Z), so the close and the split share a timestamp, and the order cannot change their velocity. That is why the CLI test, not the scenario, proves criterion 1 for the split.

### Tests that change

- `scripts/cli.test.mjs`, "a split in cycle close leaves the remaining work for cycle plan": run the split writes before `cycle close`, to match the new step 8. Replace the comment that says no assertion covers a late close, because the new CLI test covers it. The velocity assertion `{ points: 5, count: 1 }` stays.
- `scripts/__scenarios__/cycle-close.mjs`:
  - Move the `{ step: '8', write: close }` entry after the split's move to `done`, and update the header comment ("Step 8 closes the sprint first" becomes the new order).
  - The move to `done` entry becomes `{ step: '8', write: done }`, because step 8 now names the `issues move` call, and rule 6 needs an entry for it.
  - Add `{ step: '6', read: ['issues', 'get', 'ISS-0G5E'] }` after the step 6 `cycle list` read. The fixture's ISS-2X6D has a `related` link to ISS-0G5E, which is outside the sprint, so the new step 6 check runs. ISS-0G5E is `canceled` with `created` 2026-10-09, before the sprint's start, so it is no split, and the split runs as before. `expect` asserts the saved read's status category is `canceled`.
- `scripts/scenarios.test.mjs`: the new static test of criterion 1.

### Goldens and scenarios to regenerate

Regenerate only with `UPDATE_GOLDENS=1`, then read each diff line by line. The expected diffs:

- `scripts/__goldens__/team/cycle-close.txt`: in `cycle close 2026-10-12 --json` and `--dry-run --json`, the `sprint` object gains `"closed": "2026-10-23T12:00:00Z"` after `"state": "closed"`. The text outputs do not change.
- `scripts/__goldens__/messy-merge/cycle-close.txt`: the same line in the same two JSON outputs.
- `scripts/__scenarios__/cycle-close.after.txt`: a `$ pmkit issues get ISS-0G5E --json  [step 6, read]` line after the step 6 `cycle list` read. The `issues move ISS-2X6D done --json` write shows `[step 8, write]` in place of `[step 7, write]`. The `cycle close` write line moves after it. The diff of `.issues/sprints/2026-10-12.yaml` gains `+closed: 2026-10-23T12:00:00Z` after `+state: closed`.

Unchanged, and a diff in any of them is a bug: every `metrics-velocity.txt` golden (the `team` closed sprint has no `closed`), `team/cycle-list.txt`, `team/cycle-current.txt`, the `basic` and `no-sprints` `cycle-close.txt` (they fail before any write), and `cycle-plan.after.txt`.

## Decisões

| Decision | Reason |
| --- | --- |
| Option A: a move to `done` counts up to the sprint's close time. | It is the only option that meets criteria 1 and 2 for a late close and for an early close. B fails criterion 2 inside any grace that meets criterion 1, and C freezes estimates and duplicates data the issues hold. |
| Store the close time as a `closed` key in the sprint file, not as an event. | Sprints have no event log, and adding one adds files to the format. Older pmkit versions keep an unknown sprint key, so one key needs no migration and no format bump. |
| `closed` is a timestamp with a time, not a date. | `pr sync` and the split run on the same day as the close. A date would count a move made after the close that day. |
| A move in the same second as the close counts (`<=`). | The tests and the scenarios use one fixed clock, so their writes and the close share a timestamp, and the PMK-113 CLI test keeps its 5 points. In real use, step 8 now runs every move before the close, so a tie means the move came first. |
| A closed sprint without `closed` keeps the end-date rule. | Velocity already planned from does not change on upgrade, no file is rewritten, and "count every done issue" would count moves made after the close. Adapters with no close time (GitHub, GitLab and Azure DevOps iterations) use the same rule, which fits sprints that end by date. |
| No backfill of `closed` for old sprints. Decided by the orchestrator. | It would write to user files that are not broken, and pmkit has no reliable source for the old close time: the git commit time of the sprint file exists only with `auto_commit` or a manual commit, and the last event of the sprint's issues is not the close. |
| `close.md` step 8 runs the moves and splits before `cycle close`. Decided by the orchestrator: the reorder is in scope for this issue. | The split's move to `done` must come before the close to count, and it is the only command write in the close flow that comes after it today. Without it, a split after a late close counts 0 and criterion 1 is half met. A failed write now leaves the sprint active, so a second run finds it, where today it leaves a closed sprint with missing moves. |
| A static test on `close.md` checks the step 8 order. | The scenario harness matches each entry to a call of its step and does not compare the order of calls inside a step, and the scenarios run at one fixed clock. Without the static test, the old order passes every test. |
| Step 8 stops at the first failed write, lists what was done and what was not, and does not retry. Step 9 runs only after a successful close. | The stop rule is the one `close.md` has today. The close is the last write, so after any failure the sprint is still active, and a retro would describe a sprint that is not closed. |
| A second run recognizes a split already made from the original's `related` link to a backlog issue created during the sprint, and finishes it with no create. | Moves and finished splits already leave the sprint or reach `done`, so they need no check. The link is the only trace a half-done split leaves that a later session can read. The estimate update and the move are safe to repeat. The check needs `created` on or after the sprint's start, so an older related issue, such as the fixture's ISS-0G5E, is not taken for a split. |
| A malformed `closed` is not fatal. `parseSprint` treats it as missing and keeps it in `extra.closed`, and `validate` lists it as a `sprint` problem. | Today, and in 0.1.0 and 0.2.0, a hand-added `closed` of any value reads with no error. A strict check would make one such file fail every sprint read (`cycle list`, `cycle current`, `metrics velocity`, every `--sprint current` read and write). Velocity is the only reader of `closed`, so the end-date fallback is a safe default, and `validate` and `/pmkit:local:doctor` still report the typo. |
| A valid `closed` is a date, a time and `Z` or an offset, and `parseSprint` keeps it as written. | A date alone cuts off every move made later that day. A time with no zone reads as local time, so the cutoff would depend on the machine. Keeping the string as written means no write rewrites what the user typed. |
| The `cycle:close` report text does not change. | With the reorder, its delivered numbers and velocity agree. |
| `velocity` stays the one shared function, and `issuesBySprint` does not change. | `metrics velocity` is its only caller, and `cycle:plan` reads that command. Putting the cutoff in `velocity` keeps it pure and testable without files. |
| `report:status` needs no change. | It reads no velocity. Its numbers come from `epic progress` and `events`. |
| The sprint object leaves out `closed` when the file has none, instead of giving `null`. | Issues leave out missing optional fields, and the goldens of old sprints stay as they are. |
| `closeCycle` builds the sprint in model order, so `closed` comes right after `state` in the JSON. | The goldens and the scenario snapshot then show `"closed"` next to `"state": "closed"`, where a reader looks for it. |
| The `cycle close` text output does not show `closed`. | The JSON carries it. Leaving the text alone keeps the text goldens and the help as they are. |
| `TRACKER_OPERATIONS` and the contract suite do not change. | No operation changes. `closed` is optional, because some adapters cannot provide it, so the contract suite cannot require it. The Local tracker's behavior is tested in `scripts/sprints.test.mjs`. |
| No changelog entry and no `Tracker format` line in this issue. | The format stays 2. The release that ships the fix writes its changelog line. |

## Open questions

1. **A split whose create ran and whose link failed.** The new issue has no link to the original, so a second run cannot find it, and if the user reruns the close without running the link that step 8 gave, step 6 offers the split again and a second create makes a second remaining-work issue. Step 8 names the case and gives the link command. Closing the gap fully needs a mark on the new issue that a later read can find, such as a description that names the original (`issues list --text <original id> --sprint none` searches titles and descriptions). That changes the issue the PMK-113 split creates, so this spec leaves it out. Decide whether to add it here or in a follow-up.

## Follow-up candidates

1. A done issue whose `issue.md` was edited by hand to `done` and has no `move` event has no `doneAt`. Velocity leaves it out, and the `cycle:close` report counts it. The drift events of the next write fix it, but a closed sprint is rarely written again. A `/pmkit:local:doctor` check could list such issues.
2. `/pmkit:local:doctor` could offer to fill `closed` on old closed sprints from the git log of the sprint file, with a preview and an approval, if the user later wants the backfill this issue leaves out.
3. A teammate's clock that runs behind can date a move before a close that came first. pmkit takes timestamps from each machine's clock. Not worth a fix unless it shows up.
4. When the Linear and Jira adapters land, map `completedAt` and `completeDate` to `closed`. The date-based adapters leave it out.
5. `cycle add` still moves issues into a closed sprint. `cycle add ISS-3F7H --to 2026-10-12` on the closed sprint exits 0 (checked in a temp project). A done issue moved in after the close counts in velocity when its `doneAt` is before `closed`, as it did under the end-date rule. `cycle add --to <closed sprint>` could refuse or warn.
