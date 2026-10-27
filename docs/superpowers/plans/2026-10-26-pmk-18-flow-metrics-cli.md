# PMK-18 lead time, throughput and aging in the CLI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Three new read commands, `metrics lead-time`, `metrics throughput` and `metrics aging`, compute their metric from `events.jsonl` for a date range, with the same "done" and "in range" rules as `metrics cycle-time`.

**Architecture:** Pure functions in `scripts/lib/metrics.mjs` (`rangeInstant`, `doneInRange`, `leadTimes`, `throughput`, `aging`) take `tracker.eventsByIssue()` and `tracker.categoryOf`. Each command in `scripts/pmkit.mjs` reads the range flags, calls them and formats the result. `metrics cycle-time` moves to `doneInRange` with the same results. The capability manifest, the goldens, the README and the design spec list the three commands.

**Tech Stack:** Node 18+ ES modules, no dependencies (ADR 0003), `node:test`. Run tests with `npm test`.

**Spec:** `docs/superpowers/specs/2026-10-26-pmk-18-flow-metrics-cli-design.md`

## Global Constraints

### Definitions (from the spec)

- Every metric replays one issue's events in `at` order, as `readEvents` returns them (it drops identical lines and sorts by `at`). The status an event moves the issue into comes from the private `movedTo(event)`: the `to` of a `move` on `status`, or `to.status` of a `create`.
- Done at: `lastEntry(events, 'done', categoryOf)`. `canceled` is not done.
- Created at: the `at` of the earliest `create` event. A log with no `create` uses its earliest `at` by `Date.parse`. (The `messy-merge` fixture has an issue with two `create` lines.)
- Type: replay in `at` order. A `create` sets it to `to.type`. An `update` with `field: 'type'` sets it to `to`. A missing, `null` or `''` value is no type: `type: null` in `issues`, counted under the key `none` in `byType`.
- In work at `asOf`: replay only the events with `Date.parse(at) <= Date.parse(asOf)`. The last status they move into has category `in_progress` or `in_review`, and none of them is an `archive` event. Started at: the `at` of the first of those events that moves the issue into either category.
- Days: `Math.round(((Date.parse(end) - Date.parse(start)) / DAY_MS) * 10) / 10`, as `cycleTimes` does today.

### Range bounds

`rangeInstant(text, { endOfDay = false } = {})` in `metrics.mjs` turns a flag value into epoch milliseconds:

- `YYYY-MM-DD`: `T00:00:00Z` of that day, or `T23:59:59Z` with `endOfDay: true`.
- A value with `T` and no `Z`: append `Z`, so the bound is UTC on every machine, like the `at` values the adapter writes. `endOfDay` does not apply to it.
- Then `Date.parse`. It returns `NaN` when `Date.parse` cannot read the value.

In `pmkit.mjs`, a private `rangeText(name, value)` runs `dateText(name, value)`, then throws ``usageError(`--${name} must be a date as YYYY-MM-DD`)`` when `rangeInstant(value)` is `NaN`, and returns the value. All four metrics commands read `--since` and `--until` through it. `dateText` and the other commands that call it do not change.

`doneInRange` keeps an issue when its done time exists and `Date.parse(doneAt)` is at or after `rangeInstant(since)` and at or before `rangeInstant(until, { endOfDay: true })`. A missing bound leaves that side open.

### Library interfaces (`scripts/lib/metrics.mjs`)

| Export | Returns |
| --- | --- |
| `rangeInstant(text, { endOfDay })` | epoch ms, or `NaN` |
| `doneInRange(eventsByIssue, { categoryOf, since, until })` | a new object with only the issues done in range, keys in the same order, the same event arrays |
| `leadTimes(eventsByIssue, { categoryOf })` | `[{ issue, days }]` for each issue with a done time, in input key order |
| `throughput(eventsByIssue, { categoryOf })` | `{ count, byType, issues: [{ issue, type, doneAt }] }` for each issue with a done time. `issues` sorted by `Date.parse(doneAt)`, then id. `byType` keys sorted by name. `doneAt` as written in the log |
| `aging(eventsByIssue, { categoryOf, asOf })` | `[{ issue, status, startedAt, days }]` for each issue in work at `asOf` (an ISO string). `status` is the status name after the replay. Sorted by `days` descending, then id |

`lastEntry`, `cycleTimes`, `summary` and `velocity` keep their signatures and results.

### Commands (`scripts/pmkit.mjs`)

Add after `metrics cycle-time` in `COMMANDS`, in this order, with no `write`:

| name | summary | usage | flags |
| --- | --- | --- | --- |
| `metrics lead-time` | `median and p85 days from creation to done` | `[--since d] [--until d]` | `['since', 'until']` |
| `metrics throughput` | `issues done in a range, by type` | `[--since d] [--until d]` | `['since', 'until']` |
| `metrics aging` | `days since work started, per issue in progress or in review at a date, oldest first` | `[--until d]` | `['until']` |

- `metrics lead-time`: data `{ ...summary(days), issues }`. Text: the same three `fields` lines as `metrics cycle-time` (`count`, `median: N days`, `p85: N days`, `n/a` when `null`).
- `metrics throughput`: data is the `throughput` result. Text: `count: N`, then, when N > 0, `table(['Type', 'Issues'], Object.entries(byType))`.
- `metrics aging`: `asOf` is `rangeInstant(until, { endOfDay: true })` when `--until` is given, else `ctx.now().getTime()`, formatted as `new Date(ms).toISOString().replace(/\.000Z$/, 'Z')`. Data `{ asOf, ...summary(days), issues }`. Text with issues: `table(['Issue', 'Status', 'Started', 'Days'], rows)`, then the three `fields` lines, then `as of: <asOf>`. Text with none: `no work in progress`, then `as of: <asOf>`.
- `ctx` gains `now` (the `clock(env)` function already built in `main`), so `ctx.now()` returns a `Date` and honors `PMKIT_NOW`.
- `metrics aging --since` fails through the existing unknown-option check: exit 2, `INVALID_INPUT`. No code is needed for it.

### Expected numbers on the `team` fixture (golden clock `2026-10-23T12:00:00Z`)

- Lead time: `ISS-4P8A` 12.3, `ISS-7K3Q` 10.3, `ISS-9T2M` 8.3. Count 3, median 10.3, p85 11.7.
- Throughput: count 3, `byType` `{ bug: 2, feature: 1 }`, issues `ISS-9T2M` bug `2026-10-05T15:00:00Z`, `ISS-7K3Q` bug `2026-10-06T16:00:00Z`, `ISS-4P8A` feature `2026-10-08T17:00:00Z`. With `--since 2026-10-06 --until 2026-10-08`: `ISS-7K3Q`, `ISS-4P8A`.
- Aging: `ISS-2X6D` `in_progress` `2026-10-14T09:00:00Z` 9.1, `ISS-8C4W` `in_review` `2026-10-15T09:00:00Z` 8.1, `ISS-5N1R` `in_progress` `2026-10-22T09:00:00Z` 1.1. Count 3, median 8.1, p85 8.8.
- Aging `--until 2026-10-20`: `asOf` `2026-10-20T23:59:59Z`, `ISS-2X6D` `in_progress` 6.6, `ISS-8C4W` `in_progress` 5.6.
- Aging `--until 2026-10-01`: `ISS-7K3Q` 2.6, `ISS-4P8A` 1.6, `ISS-9T2M` 0.6, all `in_progress` (they reached `done` later).
- `no-sprints` fixture: lead time count 2 (`ISS-2K5P` 12.3, `ISS-6R3N` 20.2, median 16.25), throughput count 2 `{ feature: 2 }`, aging count 1 (`ISS-9B2X`, `in_review`).

### Docs and tables

- `README.md`, CLI table, three rows right after the `metrics cycle-time` row:
  - `` | `metrics lead-time` | median and p85 days from creation to `done` | ``
  - `` | `metrics throughput` | issues done in a range, with a count per type | ``
  - `` | `metrics aging` | days since work started for each issue in `in_progress` or `in_review` at `--until` (default now), oldest first | ``
- `docs/superpowers/specs/2026-10-23-pmkit-design.md`, CLI table, three rows right after the `metrics cycle-time [--since d] [--until d]` row (line 353), with the same text and the usage in the first cell: `` `metrics lead-time [--since d] [--until d]` ``, `` `metrics throughput [--since d] [--until d]` ``, `` `metrics aging [--until d]` ``.
- `scripts/lib/capabilities.mjs`: `SERVED_BY.native_metrics` becomes `['metrics velocity', 'metrics cycle-time', 'metrics lead-time', 'metrics throughput', 'metrics aging', 'events']`.
- Unchanged on purpose: `CHANGELOG.md` (the format does not change, and the release that ships the commands writes its line, as PMK-121 did), `skills/pmkit/SKILL.md` and `commands/help.md` (they list slash commands, and this issue adds none), every file under `commands/`.

### Files

- May change: `scripts/lib/metrics.mjs`, `scripts/pmkit.mjs`, `scripts/lib/capabilities.mjs`, `scripts/metrics.test.mjs`, `scripts/cli.test.mjs`, `scripts/fixtures.test.mjs`, `scripts/goldens.test.mjs`, `README.md`, `docs/superpowers/specs/2026-10-23-pmkit-design.md`, and the new goldens below.
- Must not change: `scripts/lib/local/`, `scripts/__fixtures__/`, `scripts/__scenarios__/`, `schemas/`, `commands/`, `skills/`, `CHANGELOG.md`, `.issues/`.

### Goldens

Never edit a golden by hand. Regenerate only with `UPDATE_GOLDENS=1 node --test scripts/goldens.test.mjs`, then read `git status scripts/__goldens__/` and each new file. The only changes are new files: `metrics-lead-time.txt` (Task 2), `metrics-throughput.txt` (Task 3) and `metrics-aging.txt` (Task 4), each in `basic`, `team`, `messy-merge` and `no-sprints`. Every existing golden stays byte for byte, `metrics-cycle-time.txt` and `capabilities.txt` included. If a regeneration changes an existing file, run `git checkout -- scripts/__goldens__/`, find the cause and fix the code.

### Tests and commits

- Baseline: 1093 tests pass at `a10579f`. The final count must be higher.
- TDD: write the tests of a task first, run them, and see them fail for the reason the task states before writing the code.
- Every task runs its focused tests, then `npm test` in full, before its commit. Every commit leaves `npm test` green.
- Commit subject: `<type>: <subject> (PMK-18)`. The body ends with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- In the new tests in `metrics.test.mjs`, build events with local helpers: `create(at, status, type)` gives `{ at, by: 'fred', op: 'create', to: { status, type } }`, `move(at, to)` gives `{ at, by: 'fred', op: 'move', field: 'status', to }`. Add `canceled: 'canceled'` to the file's `categoryOf` map. No existing test uses that name.
- Straight quotes, no em dashes in prose. No new dependency. Do not run pmkit write commands on this repo's `.issues/`.

## Review Focus

1. A bound with a time and no zone, such as `--since 2026-10-06T16:00:00`, reads as UTC on a machine in another time zone. `Date.parse` alone would read it as local time. Pinned in Tasks 1 and 3.
2. A bound that matches `dateText` but is no date, such as `2026-13-40` or `2026-10-08T1`, exits 2. A `NaN` bound would otherwise return every issue or none without a word. Pinned in Task 1.
3. A done time written with an offset, such as `2026-10-08T22:00:00-03:00`, compares as the instant `2026-10-09T01:00:00Z`, so `--until 2026-10-08` leaves it out. Pinned in Task 1.
4. A log with two `create` lines after a merge. Lead time starts at the first, and the type comes from the last line that sets it. Pinned in Tasks 2 and 3.
5. A move into work at exactly `asOf` counts with 0 days, and a move one second later does not count. Pinned in Task 4.

---

### Task 1: one range rule for every metric

**Files:**
- Modify: `scripts/lib/metrics.mjs`, `scripts/pmkit.mjs` (`metrics cycle-time`, line 525; a new `rangeText` after `dateText`, line 49)
- Test: `scripts/metrics.test.mjs`, `scripts/cli.test.mjs`

**Interfaces:**
- Consumes: `lastEntry` and `movedTo` in `metrics.mjs`.
- Produces: `rangeInstant(text, { endOfDay })`, `doneInRange(eventsByIssue, { categoryOf, since, until })`, and the private `rangeText(name, value)` in `pmkit.mjs`.

- [ ] **Step 1: Write the failing tests** in `scripts/metrics.test.mjs`, after the cycle time test:
  - `rangeInstant reads a date as the start or the end of the day, and a time without a zone as UTC`: `rangeInstant('2026-10-06')` equals `Date.parse('2026-10-06T00:00:00Z')`. `rangeInstant('2026-10-06', { endOfDay: true })` equals `Date.parse('2026-10-06T23:59:59Z')`. `rangeInstant('2026-10-06T16:00:00')` equals `Date.parse('2026-10-06T16:00:00Z')`. `rangeInstant('2026-10-06T16:00', { endOfDay: true })` equals `Date.parse('2026-10-06T16:00Z')`. `rangeInstant('2026-10-08T1')` and `rangeInstant('2026-13-40')` are `NaN`.
  - `doneInRange keeps the issues whose last move into done falls in the range`: `ISS-1` done at `2026-10-05T23:30:00Z`, `ISS-2` at `2026-10-06T00:00:00Z`, `ISS-3` at `2026-10-08T23:59:59Z`, `ISS-4` at `2026-10-09T00:00:00Z`, `ISS-5` with only a move to `todo`. `Object.keys` of the result: `{ since: '2026-10-06', until: '2026-10-08' }` gives `['ISS-2', 'ISS-3']`, `{}` gives `['ISS-1', 'ISS-2', 'ISS-3', 'ISS-4']`, `{ since: '2026-10-09' }` gives `['ISS-4']`, `{ until: '2026-10-05' }` gives `['ISS-1']`. `result['ISS-2']` is the same array as the input (`assert.equal`).
  - `doneInRange compares an offset timestamp as an instant`: `ISS-7` done at `2026-10-08T22:00:00-03:00`. It is not in `{ until: '2026-10-08' }` and is in `{ since: '2026-10-09' }` (Review Focus 3).
  - `doneInRange uses the last move into done after a reopen`: `ISS-8` moves to `done` on `2026-10-02T10:00:00Z`, `doing` on `2026-10-03T10:00:00Z`, `done` on `2026-10-10T10:00:00Z`. It is in `{ since: '2026-10-10' }` and not in `{ until: '2026-10-05' }`.

  In `scripts/cli.test.mjs`, after `metrics cycle-time summarizes done issues in range`, add `metrics cycle-time refuses a bound that is not a date`: `run(root, ['metrics', 'cycle-time', '--since', '2026-13-40', '--json'])` and `run(root, ['metrics', 'cycle-time', '--until', '2026-10-08T1', '--json'])` exit 2, and the second's `JSON.parse(stdout).error` has code `INVALID_INPUT` and a message matching `/--until/` (Review Focus 2). Keep the existing cycle-time test unchanged: its `--until 2026-10-08` count 3 and `--until 2026-10-07` count 2 prove the switch keeps the results.

- [ ] **Step 2: Run to verify they fail**

Run: `node --test scripts/metrics.test.mjs scripts/cli.test.mjs`
Expected: the metrics file fails to load with `does not provide an export named 'doneInRange'` (or `rangeInstant`). The new CLI test FAILS because both runs exit 0 today. Every other CLI test PASSES.

- [ ] **Step 3: Implement** `rangeInstant` and `doneInRange` in `metrics.mjs` as "Range bounds" says. Add `rangeText` to `pmkit.mjs`. In `metrics cycle-time`, read both flags with `rangeText`, replace the inline loop with `doneInRange(tracker.eventsByIssue(), { categoryOf: tracker.categoryOf, since, until })`, and drop `lastEntry` from the import when nothing else in `pmkit.mjs` uses it.

- [ ] **Step 4: Run to verify they pass**

Run: `node --test scripts/metrics.test.mjs scripts/cli.test.mjs`
Expected: PASS.

- [ ] **Step 5: Run the whole suite**

Run: `npm test`
Expected: PASS, 1098 tests. No golden or scenario snapshot differs, `metrics-cycle-time.txt` and `scripts/__scenarios__/cycle-close.after.txt` included.

- [ ] **Step 6: Commit**

```bash
git add scripts/lib/metrics.mjs scripts/pmkit.mjs scripts/metrics.test.mjs scripts/cli.test.mjs
git commit -m "refactor: share the done-in-range rule across metrics (PMK-18)" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: metrics lead-time

**Files:**
- Modify: `scripts/lib/metrics.mjs`, `scripts/pmkit.mjs`, `scripts/lib/capabilities.mjs`, `README.md`, `docs/superpowers/specs/2026-10-23-pmkit-design.md`
- Test: `scripts/metrics.test.mjs`, `scripts/cli.test.mjs`, `scripts/fixtures.test.mjs`, `scripts/goldens.test.mjs`
- Create: `scripts/__goldens__/{basic,team,messy-merge,no-sprints}/metrics-lead-time.txt` (by regeneration)

**Interfaces:**
- Consumes: `doneInRange`, `rangeText` (Task 1), `summary`.
- Produces: `leadTimes(eventsByIssue, { categoryOf })` and the `metrics lead-time` command.

- [ ] **Step 1: Write the failing tests**
  - `scripts/metrics.test.mjs`:
    - `lead time runs from the create to the last done`: `ISS-1` is `create('2026-10-01T08:00:00Z', 'todo')`, moves to `doing` on 10-02, `done` on 10-03, `doing` on 10-04 and `done` on `2026-10-05T20:00:00Z`. `ISS-2` has only a `create`. `leadTimes` deep-equals `[{ issue: 'ISS-1', days: 4.5 }]`.
    - `lead time starts at the earliest event when the log has no create`: `ISS-1` is `move('2026-10-03T08:00:00Z', 'doing')`, `move('2026-10-01T08:00:00Z', 'todo')`, `move('2026-10-06T08:00:00Z', 'done')`. Result `[{ issue: 'ISS-1', days: 5 }]`.
    - `lead time starts at the first create when a merge left two`: `ISS-4` is `create('2026-10-14T09:00:00Z', 'todo', 'bug')`, `create('2026-10-14T11:30:00Z', 'todo', 'bug')`, `move('2026-10-15T09:00:00Z', 'done')`. Result `[{ issue: 'ISS-4', days: 1 }]` (Review Focus 4).
    - `leadTimes on the team fixture gives the spec numbers`: with the `team` tracker, `leadTimes(tracker.eventsByIssue(), { categoryOf })` deep-equals `[{ issue: 'ISS-4P8A', days: 12.3 }, { issue: 'ISS-7K3Q', days: 10.3 }, { issue: 'ISS-9T2M', days: 8.3 }]`, and `summary` of the days deep-equals `{ count: 3, median: 10.3, p85: 11.7 }`.
  - `scripts/cli.test.mjs`, test `metrics lead-time summarizes done issues in range` on `team`: the JSON has `[count, median, p85]` `[3, 10.3, 11.7]` and the issue ids above. `--until 2026-10-07` gives count 2. `--since 2026-10-06 --until 2026-10-08` gives issues `['ISS-4P8A', 'ISS-7K3Q']`. `--since 2030-01-01` gives count 0 and median `null`. `--since 2026-10-6` exits 2. `run(root, ['metrics', 'lead-time']).stdout` equals `'count: 3\nmedian: 10.3 days\np85: 11.7 days\n'`.
  - `scripts/cli.test.mjs`: add `'metrics lead-time'` to the `--help` list and `'metrics lead-time': []` to `READS`.
  - `scripts/fixtures.test.mjs`, test `no-sprints: metrics lead-time gives two issues`: exit 0, `count` 2, `median` 16.25.
  - `scripts/goldens.test.mjs`: `'metrics lead-time': () => [[]]` in `CASES`, after `metrics cycle-time`.

- [ ] **Step 2: Run to verify they fail**

Run: `node --test scripts/metrics.test.mjs scripts/cli.test.mjs scripts/fixtures.test.mjs scripts/goldens.test.mjs`
Expected: the metrics file fails to load (no `leadTimes` export). The CLI and fixture tests FAIL with `unknown command "metrics lead-time"`, and the `READS` key check fails. `CASES covers exactly COMMANDS` FAILS with `CASES entry "metrics lead-time" names no command in COMMANDS`.

- [ ] **Step 3: Implement** `leadTimes` in `metrics.mjs` and the `metrics lead-time` command as "Commands" says. Add it to `SERVED_BY.native_metrics`. Add the README and design spec rows from "Docs and tables".

- [ ] **Step 4: Generate the goldens**

Run: `UPDATE_GOLDENS=1 node --test scripts/goldens.test.mjs`, then `git status --short scripts/__goldens__/`
Expected: four new `metrics-lead-time.txt` files and no modified file. `team/metrics-lead-time.txt` shows the team numbers above in the text and the JSON. `basic` shows `count: 0`, `median: n/a`, `p85: n/a`.

- [ ] **Step 5: Run to verify they pass**

Run: `npm test`
Expected: PASS, 1104 tests.

- [ ] **Step 6: Commit**

```bash
git add scripts/lib/metrics.mjs scripts/pmkit.mjs scripts/lib/capabilities.mjs scripts/metrics.test.mjs scripts/cli.test.mjs scripts/fixtures.test.mjs scripts/goldens.test.mjs scripts/__goldens__ README.md docs/superpowers/specs/2026-10-23-pmkit-design.md
git commit -m "feat: add metrics lead-time (PMK-18)" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: metrics throughput

**Files:**
- Modify: `scripts/lib/metrics.mjs`, `scripts/pmkit.mjs`, `scripts/lib/capabilities.mjs`, `README.md`, `docs/superpowers/specs/2026-10-23-pmkit-design.md`
- Test: `scripts/metrics.test.mjs`, `scripts/cli.test.mjs`, `scripts/fixtures.test.mjs`, `scripts/goldens.test.mjs`
- Create: `scripts/__goldens__/{basic,team,messy-merge,no-sprints}/metrics-throughput.txt` (by regeneration)

**Interfaces:**
- Consumes: `doneInRange`, `rangeText` (Task 1), `table` from `format.mjs`.
- Produces: `throughput(eventsByIssue, { categoryOf })` and the `metrics throughput` command. PMK-19 reads bug rate as `byType.bug / count`.

- [ ] **Step 1: Write the failing tests**
  - `scripts/metrics.test.mjs`:
    - `throughput counts done issues by type and leaves canceled out`: `ISS-1` `create(at, 'todo', 'bug')`, done `2026-10-05T15:00:00Z`. `ISS-2` type `feature`, done `2026-10-03T10:00:00Z`. `ISS-3` type `bug`, moved to `canceled`. `ISS-4` type `bug`, done `2026-10-03T10:00:00Z`. The result deep-equals `{ count: 3, byType: { bug: 2, feature: 1 }, issues: [{ issue: 'ISS-2', type: 'feature', doneAt: '2026-10-03T10:00:00Z' }, { issue: 'ISS-4', type: 'bug', doneAt: '2026-10-03T10:00:00Z' }, { issue: 'ISS-1', type: 'bug', doneAt: '2026-10-05T15:00:00Z' }] }`.
    - `throughput takes the last type and counts no type under none`: `ISS-1` created as `feature`, then `{ op: 'update', field: 'type', from: 'feature', to: 'bug' }`, then done. `ISS-2` created with `to: { status: 'todo' }`, then done. `ISS-3` created as `chore`, then an update of `type` to `null`, then done. `ISS-4` created as `bug`, then created again as `adr` (Review Focus 4), then done. Types in `issues` by id: `ISS-1` `bug`, `ISS-2` `null`, `ISS-3` `null`, `ISS-4` `adr`. `Object.keys(byType)` deep-equals `['adr', 'bug', 'none']` and `byType` deep-equals `{ adr: 1, bug: 1, none: 2 }`.
    - `throughput on the team fixture gives the spec numbers`: on all of `team`, the result deep-equals the throughput in "Expected numbers". After `doneInRange(events, { categoryOf, since: '2026-10-06', until: '2026-10-08' })` the issue ids are `['ISS-7K3Q', 'ISS-4P8A']`.
  - `scripts/cli.test.mjs`:
    - `metrics throughput counts done issues by type in range` on `team`: the JSON deep-equals the team throughput. `--since 2026-10-06 --until 2026-10-08` gives count 2. `--since 2030-01-01` deep-equals `{ count: 0, byType: {}, issues: [] }`. The text output equals `'count: 3\nType    | Issues\n--------|-------\nbug     | 2\nfeature | 1\n'`, and with `--since 2030-01-01` it equals `'count: 0\n'`.
    - `metrics throughput reads a time without a zone as UTC`: with `env: { TZ: 'America/Sao_Paulo' }`, `--since 2026-10-06T16:00:00 --until 2026-10-08T17:00` gives issue ids `['ISS-7K3Q', 'ISS-4P8A']` (Review Focus 1).
    - Add `'metrics throughput'` to the `--help` list and `'metrics throughput': []` to `READS`.
  - `scripts/fixtures.test.mjs`, test `no-sprints: metrics throughput counts two features`: exit 0, `count` 2, `byType` `{ feature: 2 }`.
  - `scripts/goldens.test.mjs`: `'metrics throughput': () => [[]]` after `metrics lead-time`.

- [ ] **Step 2: Run to verify they fail**

Run: `node --test scripts/metrics.test.mjs scripts/cli.test.mjs scripts/fixtures.test.mjs scripts/goldens.test.mjs`
Expected: the metrics file fails to load (no `throughput` export). The CLI and fixture tests FAIL with `unknown command "metrics throughput"`. `CASES covers exactly COMMANDS` FAILS.

- [ ] **Step 3: Implement** `throughput` in `metrics.mjs` and the `metrics throughput` command as "Commands" says. Add it to `SERVED_BY.native_metrics` and add the README and design spec rows.

- [ ] **Step 4: Generate the goldens**

Run: `UPDATE_GOLDENS=1 node --test scripts/goldens.test.mjs`, then `git status --short scripts/__goldens__/`
Expected: four new `metrics-throughput.txt` files and no modified file.

- [ ] **Step 5: Run to verify they pass**

Run: `npm test`
Expected: PASS, 1110 tests.

- [ ] **Step 6: Commit**

```bash
git add scripts/lib/metrics.mjs scripts/pmkit.mjs scripts/lib/capabilities.mjs scripts/metrics.test.mjs scripts/cli.test.mjs scripts/fixtures.test.mjs scripts/goldens.test.mjs scripts/__goldens__ README.md docs/superpowers/specs/2026-10-23-pmkit-design.md
git commit -m "feat: add metrics throughput with a count per type (PMK-18)" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: metrics aging

**Files:**
- Modify: `scripts/lib/metrics.mjs`, `scripts/pmkit.mjs` (the command, and `now` in `ctx` near line 1028), `scripts/lib/capabilities.mjs`, `README.md`, `docs/superpowers/specs/2026-10-23-pmkit-design.md`
- Test: `scripts/metrics.test.mjs`, `scripts/cli.test.mjs`, `scripts/fixtures.test.mjs`, `scripts/goldens.test.mjs`
- Create: `scripts/__goldens__/{basic,team,messy-merge,no-sprints}/metrics-aging.txt` (by regeneration)

**Interfaces:**
- Consumes: `rangeInstant`, `rangeText` (Task 1), `summary`, `table`, `fields`.
- Produces: `aging(eventsByIssue, { categoryOf, asOf })`, `ctx.now`, and the `metrics aging` command.

- [ ] **Step 1: Write the failing tests**
  - `scripts/metrics.test.mjs`, all with `asOf: '2026-10-10T12:00:00Z'` unless a test says otherwise:
    - `aging lists the issues in work at asOf, oldest first`: `ISS-1` created in `todo`, moved to `doing` at `2026-10-02T12:00:00Z`. `ISS-2` created straight into `review` at `2026-10-05T12:00:00Z`. `ISS-3` created in `todo` only. `ISS-4` moved to `doing` on 10-01 and `done` on 10-03. `ISS-5` and `ISS-6` moved to `doing` at `2026-10-06T12:00:00Z`. Result deep-equals `[{ issue: 'ISS-1', status: 'doing', startedAt: '2026-10-02T12:00:00Z', days: 8 }, { issue: 'ISS-2', status: 'review', startedAt: '2026-10-05T12:00:00Z', days: 5 }, { issue: 'ISS-5', status: 'doing', startedAt: '2026-10-06T12:00:00Z', days: 4 }, { issue: 'ISS-6', status: 'doing', startedAt: '2026-10-06T12:00:00Z', days: 4 }]`.
    - `aging starts at the first move into work and leaves out an issue moved back to todo`: `ISS-1` moves to `doing` at `2026-10-01T12:00:00Z`, `review` on 10-03, `doing` on 10-04, so it has `startedAt` `2026-10-01T12:00:00Z`, `status` `doing`, `days` 9. `ISS-2` moves to `doing` on 10-02 and `todo` on 10-04, and is left out.
    - `aging replays only the events on or before asOf`: `ISS-1` moves to `doing` at `2026-10-01T12:00:00Z` and `done` on 10-11, and has `days` 9. `ISS-2` moves to `doing` at `2026-10-10T12:00:00Z` and has `days` 0. `ISS-3` moves to `doing` at `2026-10-10T12:00:01Z` and is left out (Review Focus 5).
    - `aging leaves out an archived issue from its archive event`: `ISS-1` moves to `doing` on 10-01 and has `{ at: '2026-10-05T10:00:00Z', by: 'fred', op: 'archive' }`, and is left out. `ISS-2` moves to `doing` at `2026-10-01T12:00:00Z` and is archived on 10-11, and has `days` 9.
    - `aging on the team fixture gives the spec numbers`: `asOf: '2026-10-23T12:00:00Z'`, the result deep-equals the aging list in "Expected numbers", and `summary` of the days deep-equals `{ count: 3, median: 8.1, p85: 8.8 }`.
  - `scripts/cli.test.mjs`:
    - `metrics aging lists the work in progress at the clock` on `team`: JSON `asOf` `'2026-10-23T12:00:00Z'`, `[count, median, p85]` `[3, 8.1, 8.8]`, issues as in "Expected numbers". The text output matches `/^ISS-2X6D \| in_progress \| 2026-10-14T09:00:00Z \| 9\.1$/m` and ends with `'count: 3\nmedian: 8.1 days\np85: 8.8 days\nas of: 2026-10-23T12:00:00Z\n'`.
    - `metrics aging takes --until as the as-of date`: `--until 2026-10-20` and `--until 2026-10-01` give the `asOf` and the issues in "Expected numbers". `--until 2026-10-20T10:00:00` gives `asOf` `'2026-10-20T10:00:00Z'`. `run(root, ['metrics', 'aging', '--until', '2026-09-20']).stdout` equals `'no work in progress\nas of: 2026-09-20T23:59:59Z\n'`.
    - `PMKIT_NOW sets the as-of date of metrics aging`: with `env: { PMKIT_NOW: '2026-10-24T12:00:00Z' }`, `asOf` is `'2026-10-24T12:00:00Z'` and `ISS-2X6D` has `days` 10.1.
    - `metrics aging refuses --since and a bad --until`: `--since 2026-10-01 --json` exits 2 with `error.code` `INVALID_INPUT` and a message matching `/--since/`. `--until 2026-10-2` exits 2.
    - Add `'metrics aging'` to the `--help` list and `'metrics aging': []` to `READS`.
  - `scripts/fixtures.test.mjs`, test `no-sprints: metrics aging lists one issue in review`: exit 0, `count` 1, the only issue `ISS-9B2X` with status `in_review`.
  - `scripts/goldens.test.mjs`: `'metrics aging': () => [[]]` after `metrics throughput`.

- [ ] **Step 2: Run to verify they fail**

Run: `node --test scripts/metrics.test.mjs scripts/cli.test.mjs scripts/fixtures.test.mjs scripts/goldens.test.mjs`
Expected: the metrics file fails to load (no `aging` export). The CLI and fixture tests FAIL with `unknown command "metrics aging"`. `CASES covers exactly COMMANDS` FAILS.

- [ ] **Step 3: Implement** `aging` in `metrics.mjs`, `now` in `ctx`, and the `metrics aging` command as "Commands" says. Add it to `SERVED_BY.native_metrics` and add the README and design spec rows.

- [ ] **Step 4: Generate the goldens**

Run: `UPDATE_GOLDENS=1 node --test scripts/goldens.test.mjs`, then `git status --short scripts/__goldens__/`
Expected: four new `metrics-aging.txt` files and no modified file. `team/metrics-aging.txt` shows `as of: 2026-10-23T12:00:00Z` and the three team issues. `messy-merge/metrics-aging.txt` lists `ISS-2` 10.1, `ISS-7` 9.1, `ISS-5` 7.1. `basic/metrics-aging.txt` shows `no work in progress`.

- [ ] **Step 5: Run to verify they pass**

Run: `npm test`
Expected: PASS, 1120 tests.

- [ ] **Step 6: Check the acceptance criteria from the CLI**

Run: `node scripts/pmkit.mjs metrics lead-time --since 2026-10-01 --json`, `node scripts/pmkit.mjs metrics throughput --since 2026-10-01 --json`, `node scripts/pmkit.mjs metrics aging --until 2026-10-26 --json`, and `node scripts/pmkit.mjs capabilities --json` on this repo.
Expected: each exits 0 with the shape of "Commands". The manifest's `native_metrics` entry stays `derived` with `detail.source: events`.

- [ ] **Step 7: Commit**

```bash
git add scripts/lib/metrics.mjs scripts/pmkit.mjs scripts/lib/capabilities.mjs scripts/metrics.test.mjs scripts/cli.test.mjs scripts/fixtures.test.mjs scripts/goldens.test.mjs scripts/__goldens__ README.md docs/superpowers/specs/2026-10-23-pmkit-design.md
git commit -m "feat: add metrics aging (PMK-18)" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## Acceptance criteria map

| Criterion | Tasks |
| --- | --- |
| The CLI computes lead time, throughput and aging from the event log | Task 2 (`leadTimes`, `metrics lead-time`), Task 3 (`throughput`, `metrics throughput`), Task 4 (`aging`, `metrics aging`). All three read only `tracker.eventsByIssue()`, and `SERVED_BY.native_metrics` names them. |
| Each metric takes a date range | Task 1 (`rangeInstant`, `doneInRange`, `rangeText`), then `--since` and `--until` on lead time (Task 2) and throughput (Task 3), and `--until` as the as-of date on aging (Task 4, decided question 2 of the spec). |

## Decisions made in this plan

- Task order: the shared range rule first (Task 1), so the three commands use it from the start, then one task per command. Each command task carries its function, its command, its manifest entry, its doc rows and its goldens, so a reviewer can reject one metric and keep the others.
- `rangeText` refuses a bound that `Date.parse` cannot read, for `metrics cycle-time` too. Today `cycle-time --since 2026-13-40` compares strings and returns a result. The spec says a bad date is a usage error, and the move to `Date.parse` would otherwise turn a typo into an empty or full result with exit 0. `dateText` itself and the `issues list` and `events` flags stay as they are.
- A bound with a time and no zone reads as UTC. The spec chose `Date.parse` and did not name this case, and `Date.parse` reads such a value as local time, so the same command would give different results on two machines.
- Created at is the earliest `create` when a merge left two. The spec says "the `create` event". The type still follows the last line that sets it, as the spec's "last value the log gives it" says.
- `ctx.now` exposes the clock `main` already builds, so `metrics aging` honors `PMKIT_NOW` with no second parse.
- Test counts in the "Expected" lines assume one `test()` per bullet. A different count is fine when every listed test exists and passes.
- No task for `CHANGELOG.md`, `skills/pmkit/SKILL.md` or `commands/help.md`: the spec leaves the changelog line to the release, and the other two list slash commands only.

## Self-review

- Spec coverage: the definitions (Global Constraints), the four library functions (Tasks 1 to 4), the three commands with their JSON and text shapes (Tasks 2 to 4), the `cycle-time` switch with unchanged goldens (Task 1), the manifest, README and design spec rows (Tasks 2 to 4), and every test the spec lists. The follow-up candidates stay out.
- Names agree across tasks: `rangeInstant`, `doneInRange`, `rangeText`, `leadTimes`, `throughput`, `aging`, `ctx.now`.
- The expected numbers come from the event logs of `team`, `no-sprints` and `messy-merge`, read with `eventsByIssue()` at `a10579f`.
- No task names a file outside "Files".
