# PMK-37 design: map Linear cycles to sprints

Issue PMK-37, epic EPC-5 (Linear tracker adapter), milestone `linear`. Status: approved. The user answered the open questions on 2026-10-28; see "Open questions". Decisions come from an autonomous brainstorming run on 2026-10-28 with no user dialogue, from the issue, ADR-0001, ADR-0003, ADR-0005, the PMK-33 and PMK-35 specs, the code, and read-only calls to the sandbox workspace. Calls marked **(builder's call)** were made while writing this spec and change no acceptance criterion.

## Problem

The Linear tracker answers `NOT_SUPPORTED` for the whole Cycles family and the Capacity family (`scripts/lib/linear/tracker.mjs` stubs them). Three more places refuse cycles on purpose and name this issue:

- `translateFilter` in `scripts/lib/linear/filter.mjs` throws on `filter.sprint`.
- `toInput` in `scripts/lib/linear/writes.mjs` refuses a `sprint` value on create and update (`LATER.sprint`).
- `toIssue` never sets `issue.sprint`.

So `/pmkit:cycle:plan`, `/pmkit:cycle:close` and `my-tasks` cannot read a Linear cycle, and an issue cannot join one.

Sources:

- Unified model, "Adapter operations contract", Cycles family: `list_cycles`, `current_cycle`, `cycle_issues`, `move_to_cycle`, `open_cycle`, `close_cycle`, with the note "Open and close only where the system has that ritual (Jira)". Capacity family: "Native writes only in Azure DevOps; others use local context". Capabilities table: `cycles` is Native on Linear, `capacity` is Derived. Q5 (local context): a committed repo file for shared settings, the user store for cache.
- Linear tab, domain 5 (Cycles): configuration (duration, cooldown) is read-only, "Cycle issues and scope changes" is R/W, "Rollover of unfinished issues" is R/W, "Historical velocity" is derived.
- The pmkit design spec, "Contract", and the Local tracker (`scripts/lib/local/tracker.mjs`, `sprints.mjs`) as the reference of what each operation returns (ADR-0001).

Acceptance criteria:

1. The adapter lists cycles, finds the current one, lists its issues and moves issues between cycles.
2. Opening or closing a cycle returns `NOT_SUPPORTED` with the reason.
3. Capacity is kept in local context.

Bound decisions from earlier issues:

- Every operation but `discover` and `capabilities` runs through `guarded`, which checks the workspace and then the mappings (PMK-34).
- The client sends a mutation once and never retries it (PMK-30).
- Every write appears in Linear as the key's owner, and the adapter refuses another actor (ADR-0005, PMK-35).
- Search narrows on the server and the adapter finishes in the client (PMK-35, approach 2).

## Facts checked against the Linear API

Read-only calls on 2026-10-28 against the sandbox workspace (Free plan), through `fetch` and a wrapper that refused any document containing `mutation`. No write was sent. The calls ran after a check that `organization.urlKey` equals `PMKIT_LIVE_WORKSPACE`. Introspection reads the schema; it does not prove how a field behaves.

| Call | Result |
|---|---|
| `__type(Mutation)`, fields matching `cycle` | `cycleUpdate`, `cycleArchive`, `cycleShiftAll`, `cycleStartUpcomingCycleToday`, `teamCyclesDelete`. There is no `cycleCreate`. |
| `__type(CycleCreateInput)` | The type exists (`teamId`, `startsAt`, `endsAt`, `name`, `description`, `completedAt`) but no mutation takes it, so the public API cannot open a cycle. |
| `__type(CycleUpdateInput)` | `name`, `description`, `startsAt`, `endsAt`, `completedAt`. |
| `__type(Cycle)` | `id`, `number` (Float), `name` (nullable), `description`, `startsAt`, `endsAt`, `completedAt`, `isActive`, `isFuture`, `isPast`, `isNext`, `isPrevious`, `progress`, `team`, `issues`, `uncompletedIssuesUponClose`. |
| `__type(CycleFilter)` | `id`, `number`, `name`, `startsAt`, `endsAt`, `completedAt`, `isActive`, `isNext`, `isPrevious`, `isFuture`, `isPast`, `isInCooldown`, `team` (a `TeamFilter`), `issues`, `and`, `or`. |
| `__type(Query)`, fields matching `cycle` | `cycles(filter, first, after)` and `cycle(id)`. |
| `__type(Team)`, fields matching `cycle` | `cyclesEnabled`, `cycleDuration`, `cycleCooldownTime`, `cycleStartDay`, `cycleLockToActive`, `cycleIssueAutoAssignStarted`, `cycleIssueAutoAssignCompleted`, `upcomingCycleCount`, `activeCycle`, `cycles`. |
| `__type(IssueFilter)` (PMK-35) | `cycle` takes a `CycleFilter`, so `cycle: { isActive: { eq: true } }`, `cycle: { number: { eq: 12 } }` and `cycle: { null: true }` are valid filters. |
| `teams` | The sandbox team has `cyclesEnabled: false`, `activeCycle: null`, duration 2 weeks, cooldown 0. |
| `cycles(first: 5)` | Empty. The sandbox has no cycle at all. |
| `issues(first: 3, filter: { cycle: { isActive: { eq: true } } })` | Answers with an empty list and no error. |

Consequences for the design:

- A team creates cycles from its schedule (`cycleStartDay`, `cycleDuration`, `upcomingCycleCount`). No API call opens one, so `openCycle` has nothing to call. This is the reason the issue gives for `NOT_SUPPORTED`.
- `cycleUpdate` accepts `completedAt`, but this spec does not use it to close a cycle. See "Closing" and open question 2.
- Cycles are per team. `number` is unique inside a team, so a cycle is identified by `(team, number)`.
- The sandbox cannot exercise any cycle read. Every fact about a cycle's values (the time of day in `startsAt` and `endsAt`, `isPast` during cooldown, `completedAt` on a cycle that ended by date) is unverified until a workspace has cycles. "Risks" lists them.

## Goals

- `listCycles`, `currentCycle` and `cycleIssues` read a Linear team's cycles and return the common `Sprint` shape.
- `moveToCycle` moves issues into a cycle, into the current one, or out of any cycle, with `{ before, after }` per issue and `dryRun`.
- `issue.sprint`, the `sprint` key of `createIssue` and `updateIssue`, and the `sprint` filter of `searchIssues` work on Linear with the Local meanings of `current` and `none`.
- `openCycle` and `closeCycle` answer `NOT_SUPPORTED` with the reason and a next step, after the usual checks, and send no request.
- `getCapacity`, `setCapacity`, `getDaysOff` and `updateCycleCapacity` work on Linear cycles and keep their data in the repository's local context, never in Linear.
- The capability manifest says which cycle operations the adapter lacks.
- The contract suite runs the cycle tests that a hosted adapter can run, against the fake in `npm test` and against the sandbox in PMK-39, and the Local run keeps every test.

## Non-goals

- Cycle changes in an issue's history (PMK-36). This issue only sets `issue.sprint`. History reads whatever Linear records and does not depend on this code.
- Projects as epics (PMK-38).
- Creating, editing, archiving or shifting cycles in Linear (`cycleUpdate`, `cycleArchive`, `cycleShiftAll`, `cycleStartUpcomingCycleToday`, `teamCyclesDelete`). Cycle configuration is Linear administration, and the Linear tab marks it read-only.
- Turning cycles on for a team. That is a team setting in Linear (domain 17, out of write reach).
- Velocity and cycle metrics. `metricEvents` belongs to a later issue.
- The degraded path of `/pmkit:cycle:close` and `/pmkit:cycle:plan` on Linear (PMK-40) and their rewrite for a hosted ritual (PMK-41). This issue only makes the adapter answer correctly.
- The contract suite against the sandbox (PMK-39). This issue prepares the suite for it.

## Anti-goals

- `npm test` opening a socket. Every test injects `fakeLinearFetch`.
- A new dependency (ADR-0003).
- A change to any Local tracker output. Every golden stays byte-identical, and the Local contract runs still run every test.
- The key in any output, error, cache file, capacity file or command line.
- The real workspace URL key or team key in any file. Examples use `acme` and `ACME`.
- A write to Linear from this design work or from `npm test`.
- A mutation that moves part of a list silently. A failure halfway reports what moved.

## Approaches

Two choices shape the work. The first is how much of the ritual the adapter fakes.

### How the adapter treats open and close

1. **Native reads and moves, `NOT_SUPPORTED` for open and close.** The operations that Linear has map one to one. The two it lacks say so. It matches the issue, the Unified model's rule ("only where the system has that ritual") and the API, which has no create.
2. **Best effort open and close.** `openCycle` calls `cycleStartUpcomingCycleToday` (start the next scheduled cycle now), and `closeCycle` calls `cycleUpdate` with `completedAt`. Commands would run to the end on Linear. Both mutations are unverified, the sandbox cannot try them, and they change a team's schedule for everyone. They are also not what `openCycle({ start, end })` means: the caller chooses the dates and Linear would not honor them. It contradicts criterion 2.
3. **Pmkit-owned sprints in local context, with Linear cycles as a view.** pmkit would keep its own sprint files and only mirror cycle membership. Two sources of truth for one time box, and the team's Linear board would not match pmkit.

Chosen: approach 1. Approach 2 stays open as a follow-up if a workspace with cycles proves the mutations (open question 2).

### How a cycle gets its pmkit id

A. **The cycle `number`, as a string** (`"12"`). Short, stable, readable in `cycle add ACME-3 --to 12`, unique inside the scope team.
B. **The cycle UUID.** Unique everywhere, but nobody types it, and it prints as 36 characters in every table.
C. **The start date, like the Local tracker.** Parity with Local ids, but a date depends on a time zone that the sandbox cannot confirm, and two cycles can in principle start the same day after a shift.

Chosen: A **(builder's call)**. Commands treat a sprint id as an opaque string, and `issue.sprint` is the same string. The adapter turns a number into a UUID with one query when a write needs it.

### The contract suite

a. **Split the `cycles` family and add a cycle provider.** The tests that need a cycle ask the setup for one. The Local setup has none to give, so those tests open one as today. The tests that call `openCycle` or `closeCycle` move to a new family that Linear does not list.
b. **Skip every cycle test for Linear.** Simple, but nothing proves `moveToCycle`, the `sprint` filter or capacity on Linear.
c. **Run the cycle tests on Linear in `tracker.test.mjs` only.** The contract suite stays Local-only for cycles, so ADR-0001's promise ("a hosted adapter has to pass the same suite") is not kept for this family.

Chosen: a.

## Design

### Which operations are native, derived or `NOT_SUPPORTED`

| Operation | Linear | How |
|---|---|---|
| `listCycles({ state })` | native | `cycles(filter)` for the scope team. The adapter keeps the cycles whose sprint state is `state`. |
| `currentCycle()` | native | `cycles` with `isActive: { eq: true }`. `null` when the team is between cycles. |
| `cycleIssues(id)` | native | Checks the cycle exists, then `searchIssues({ sprint: id })`. |
| `moveToCycle(ids, to)` | native | `issueUpdate(id, { cycleId })` per issue, `cycleId: null` for `to === null`. |
| `getCapacity`, `getDaysOff`, `setCapacity`, `updateCycleCapacity` | derived | Read and written in the repository's local context. Linear has no field. |
| `openCycle` | `NOT_SUPPORTED` | Linear creates cycles from the team schedule. |
| `closeCycle` | `NOT_SUPPORTED` | Linear ends a cycle on its end date. |

Native here means the data lives in Linear and the operation reads or writes it. Derived means pmkit computes or stores it, as the Linear manifest already says for `capacity` (`derived`, source `local`).

The common `Sprint` shape stays what the Local tracker returns: `id`, `name`, `start`, `end`, `goal`, `state`, `capacity`, `daysOff`, and `closed` for a closed cycle.

| Sprint field | From Linear |
|---|---|
| `id` | `String(number)` |
| `name` | `name`, else `Cycle <number>` |
| `start`, `end` | `start` is the `YYYY-MM-DD` part of `startsAt`, read as UTC **(builder's call)**. `endsAt` is an exclusive boundary (one cycle's `endsAt` is the next one's `startsAt`) and a Local `end` is inclusive, so `end` is the UTC date of `endsAt` minus 1 ms. Consecutive sprints then do not overlap, days off on the next cycle's first day fall outside the sprint, and the weekday count stops before the next cycle. Unverified; see "Risks". |
| `goal` | `description`, `''` when null |
| `state` | `active` when `isActive`, `planned` when `isFuture`, `closed` when `isPast`. A cycle that is none of the three counts as `closed`. |
| `closed` | `completedAt`, set only for a closed cycle that has one |
| `capacity`, `daysOff` | The local context entry for the cycle, `{}` when there is none |

### Files

| File | Change |
|---|---|
| `scripts/lib/linear/cycles.mjs` | New. The cycle documents, `toSprint(node, local)`, `cycleKey(id)`, the state and date mapping. Pure. |
| `scripts/lib/linear/cycle-ops.mjs` | New. `cycleOperations({ client, discovery, issues, config, ... })` returns `listCycles`, `currentCycle`, `cycleIssues`, `moveToCycle`, `openCycle`, `closeCycle`, and the four capacity operations. |
| `scripts/lib/linear/capacity-store.mjs` | New. Reads and writes the local context file for capacity and days off. |
| `scripts/lib/linear/documents.mjs` | `ISSUE_FRAGMENT` gains `cycle { id number }`. New `CYCLES_QUERY` and `CYCLE_BY_NUMBER_QUERY`. |
| `scripts/lib/linear/issues.mjs` | `toIssue` sets `sprint` to `String(cycle.number)` when the node has a cycle. |
| `scripts/lib/linear/writes.mjs` | `toInput` accepts a `sprint` value, using a `cycleNode` that the caller resolved (the way `parentNode` works). `LATER.sprint` goes away. A value with cycles off is `NOT_SUPPORTED`. |
| `scripts/lib/linear/filter.mjs` | The `sprint` key becomes a `cycle` clause. |
| `scripts/lib/linear/issue-ops.mjs` | `createIssue` and `updateIssue` resolve `sprint` to a cycle before `toInput`. `checkFilter` gets a real `sprintExists`. |
| `scripts/lib/linear/tracker.mjs` | Wires the cycle operations through `guarded`. `openCycle` and `closeCycle` keep a stub that is no longer "not implemented yet" but a final answer. |
| `scripts/lib/linear/manifest.mjs` | The `cycles` entry carries `detail` that says open and close are unavailable. |
| `scripts/fake-linear-api.mjs` | `fakeLinearIssues` gains cycles: a store, the `PmkitCycles` documents, the `cycle` issue filter and `cycleId` on update. |
| `scripts/contract-suite.mjs` | The `cycle-lifecycle` family and the cycle provider (below). |
| `scripts/lib/linear/API-VERIFICATION.md` | A row for each fact above, marked `schema` or `read`. |
| Tests | New `cycles.test.mjs`, `cycle-ops.test.mjs`, `capacity-store.test.mjs`. New cases in `filter.test.mjs`, `issues.test.mjs`, `writes.test.mjs`, `manifest.test.mjs`, `tracker.test.mjs`, `contract.test.mjs`, `fake-linear-api.test.mjs`, `cli-linear.test.mjs`. |

### Scope, ids and cycles that are off

Cycles belong to a team. The operations use the scope team (`tracker.scope.team`), which PMK-34's check already requires before any operation. The cycle id is `String(number)`. `cycleKey(id)` accepts `^[1-9][0-9]*$` and anything else is `NOT_FOUND`, before any request, as `isIssueId` does for issues.

When the scope team has `cyclesEnabled: false`:

- Every cycle read (`listCycles`, `currentCycle`, `cycleIssues`) and the capacity operations answer `NOT_SUPPORTED`: `team ACME has cycles turned off`, next step `Turn on cycles in the team's settings in Linear`. This is the `enableHint` the manifest already gives for `cycles`.
- A `sprint` filter value (`current`, a number) answers the same `NOT_SUPPORTED`. `sprint: 'none'` is accepted and matches every issue, because no issue can be in a cycle. **(builder's call)**
- A `sprint` write of `null` is accepted and changes nothing. Any other value is `NOT_SUPPORTED` with the same message.

Commands check the `cycles` capability first, so this answer is the adapter's backstop and not the normal path.

### Reading cycles (criterion 1)

`listCycles({ state })` checks `state` against `planned`, `active`, `closed` (`INVALID_INPUT` otherwise, as Local does), then pages `CYCLES_QUERY` with the team filter and keeps the cycles whose sprint state (the `state` row of the table above) is `state`. The filter runs in the adapter, not as an `isPast` clause, so a cycle with no flag (cooldown) is `closed` in the full list and in the `closed` filter alike:

```graphql
query PmkitCycles($filter: CycleFilter, $first: Int!, $after: String) {
  cycles(filter: $filter, first: $first, after: $after) {
    nodes { id number name description startsAt endsAt completedAt isActive isFuture isPast }
    pageInfo { hasNextPage endCursor }
  }
}
```

The adapter sorts by `number` ascending. That is the Local order (by start date, which is the id). It reads at most the client's page cap (10 pages of 100). A team with more than 1000 cycles loses the cycles past the cap from every list, since the state filter runs after the read.

`currentCycle()` sends the same document with `isActive: { eq: true }` and returns the first node, or `null`. Linear has one active cycle per team.

`cycleIssues(id)` reads the cycle by number first (`CYCLE_BY_NUMBER_QUERY`, filter `number: { eq }` plus the team), so an unknown cycle is `NOT_FOUND` with next step `pmkit cycle list`, as `getSprint` is in Local. It then calls the issue search with `sprint: id`.

The issue filter gets the `sprint` key back:

| `sprint` | Linear `IssueFilter` clause | Notes |
|---|---|---|
| a cycle id | `cycle: { number: { eq: <n> } }` | The scope-team clause already narrows to one team, so the number is unambiguous. An unknown number matches nothing. Local rejects an unknown sprint with `INVALID_INPUT`; the Linear filter cannot check without a request, so `checkFilter` only checks the shape **(builder's call)**. |
| `current` | `cycle: { isActive: { eq: true } }` | Between cycles it matches nothing, as in Local. |
| `none` | `cycle: { null: true }` | |

No client step is needed for `sprint`, so `serverLimit` still applies.

`toIssue` sets `issue.sprint` from the fragment's `cycle`. The fragment grows by `cycle { id number }`, which adds a small constant to a page's cost. PMK-35 measured complexity as charged by returned nodes, so one more single node per issue is cheap.

### Moving issues (criterion 1)

`moveToCycle(ids, to, actor, { dryRun })` follows the Local order of checks:

1. The writer is the viewer (`requireViewer`, ADR-0005).
2. `ids` is a non-empty list, else `INVALID_INPUT`.
3. `to` is resolved once: `null` stays `null`, `'current'` is the active cycle (`INVALID_INPUT`, `there is no active sprint`, next step `pmkit cycle list`, when there is none), a cycle id is read and must exist (`NOT_FOUND`). A closed or past cycle is accepted, as in Local.
4. Every issue is read (`NOT_FOUND` for a missing one). An issue of another team than the cycle's fails with `INVALID_INPUT`, `issue ACME-3 belongs to team OPS, and cycle 12 belongs to ACME`, because Linear refuses it too. All checks run before the first mutation, so a bad id writes nothing.
5. For each issue, in the given order, `issues.updateIssue(id, { sprint })` sends one `issueUpdate` with `cycleId`, and skips the mutation when the issue already has that cycle. The result is the list of `{ before, after }`, one per id, as in Local.

A dry run runs steps 1 to 4, builds each `after` from the same mapping code and sends no mutation.

A mutation that fails after others succeeded stops the loop. The error keeps its code and gains `details.moved`, the ids already moved, and a next step that names them, such as `ACME-1 and ACME-2 were moved; check Linear before you retry`. The client never retries a mutation, and the adapter does not either. Linear has `issueBatchUpdate`, but this spec does not use it: it takes UUIDs, its all-or-nothing behavior is unverified, and PMK-35 chose to send one mutation per record **(builder's call)**.

`createIssue` and `updateIssue` with `sprint` go through the same resolution: `current` and a cycle id become a `cycleNode` before `toInput`, `null` becomes `cycleId: null`, and `toInput` stays free of requests. The contract suite's `sprint current` cases run unchanged: `INVALID_INPUT` with no active cycle, and nothing written.

### Opening and closing (criterion 2)

Both operations run after the usual checks (workspace, mappings, and for a write, the viewer) and then answer, with no request:

| Operation | Error |
|---|---|
| `openCycle` | `NOT_SUPPORTED`, `Linear creates cycles from the team's schedule, so pmkit cannot open one`, next step `Set the schedule in the team's cycle settings in Linear (duration, start day, upcoming cycles)` |
| `closeCycle` | `NOT_SUPPORTED`, `Linear ends a cycle on its end date, so pmkit cannot close one`, next step `Move the unfinished issues with pmkit cycle add --to <cycle|none>; Linear closes the cycle on its end date` |

They run through `guarded` so a missing key, an unset workspace or a broken mapping still show first. Input to `openCycle` is not validated, because the answer does not depend on it. The messages name the reason, as the issue asks. **(builder's call)** Unlike the PMK-33 stubs, these two are final answers and say so; no text says "yet".

`/pmkit:cycle:close` on Linear moves the unfinished issues first (its step 8) and closes last, so it fails at the close with `NOT_SUPPORTED` after the moves ran. The command's text and its degraded path belong to PMK-40 and PMK-41. "Risks" says what they need to know.

### Capacity in local context (criterion 3)

Linear has no capacity or days off, so the four capacity operations keep their data in the repository, in the local context of the Unified model's Q5. Local context there means a committed repo file for shared settings, so a team shares one capacity plan.

**File.** `.pmkit/capacity.yaml`, outside `.issues/` and outside `config.yaml` **(builder's call)**:

```yaml
version: 1
cycles:
  ACME:
    "12":
      capacity:
        4f1c9a2e-0000-0000-0000-000000000001: 8
      days_off:
        4f1c9a2e-0000-0000-0000-000000000001: [2026-11-02]
```

- The first key is the team key and the second the cycle id, so a change of scope team does not mix plans. Member keys are Linear user ids, the `id` that `discover()` returns.
- The file is optional. A read of a cycle with no entry returns `{}`.
- The format is the sprint file's `capacity` and `days_off`, so the validators of the Local tracker apply: `requireCapacity(value, members)` and `requireDaysOff(value, members, sprint)` from `scripts/lib/local/sprints.mjs`, with `members` built from the discovered members and `sprint` from `toSprint`. `member=null` removes a member's days off, as in Local. Dates must fall inside the cycle's `start` and `end`.
- `serializeCapacity` writes the keys in a fixed order, with the cycle ids in numeric order, so two writes of the same data produce the same bytes and git merges stay small.
- A file that does not parse, or has another `version`, fails with `INVALID_INPUT`, `.pmkit/capacity.yaml is not valid: <why>`, next step `Fix or delete the file`. It is never overwritten.
- A write reads the file, changes the one cycle, runs the full read on the new text (as the Local `writeSprint` parses a sprint file), and writes the whole file with the Local `writeFileAtomic`: a temporary file and a rename, with the temporary file removed when either step fails. A text that fails the read is `INVALID_INPUT`, `the capacity file would not read back after this write: <why>`, and nothing is written. A dry run runs the same read and writes nothing.

**Operations.**

- `getCapacity(id)` and `getDaysOff(id)` check the cycle exists (`NOT_FOUND`), then return the entry.
- `setCapacity(id, map, actor, opts)` calls `updateCycleCapacity(id, { capacity: map }, actor, opts)`.
- `updateCycleCapacity(id, { capacity, daysOff }, actor, { dryRun })` checks the viewer, reads the cycle, validates, and returns `{ before, after }` where each side is the `Sprint` with its `capacity` and `daysOff`. Linear is not written, so the viewer check only keeps `--as` honest across trackers.
- `listCycles`, `currentCycle` and the cycle that `openCycle` would return carry `capacity` and `daysOff` from the file, so `cycle capacity` and the planning command see them without a second call. One file read serves a whole list.

**Manifest.** The `capacity` entry stays `derived`, `detail.source = 'local'`, as `buildLinearCapabilities` already says. It gains `detail.file = '.pmkit/capacity.yaml'` so a skill can say where the numbers live. It stays `absent` when the team has cycles off, with the hint `Capacity needs cycles`.

### The manifest and open and close

The `cycles` entry stays `native` when the team has cycles on, the way `teamSetting` decides today. Its `detail` gains:

```json
{ "path": "native", "detail": { "open": false, "close": false, "schedule": "team" } }
```

`open` and `close` say whether the adapter implements the ritual operations. The Local manifest has no `detail` on `cycles`, and a consumer that reads `detail.open` treats a missing value as `true`. `schedule: "team"` says Linear creates the cycles. A `conditional` entry (some teams in scope have cycles on) keeps its `teams` key and gets the same three. This is the "how the manifest reports it" for the unsupported part. Commands read `detail.open` and `detail.close` before they offer an open or a close. Wiring the commands is PMK-40's job; the data is available once this issue lands.

### Contract suite

`FAMILIES` gains `cycle-lifecycle`. The tests move like this:

| Test | Families |
|---|---|
| opens a cycle, adds issues, closes it and lists the unfinished ones | `cycles`, `cycle-lifecycle` |
| `sprint current` without an active sprint fails with `INVALID_INPUT` and writes nothing | `cycles`, `cycle-lifecycle` |
| `sprint current` returns an empty list without an active sprint | `cycles`, `cycle-lifecycle` |
| `createIssue` and `updateIssue` with `sprint current` | `cycles` |
| `moveToCycle` with `current` and `null` | `cycles` |
| `searchIssues` with `sprint current` and `none` | `cycles` |
| sets and reads cycle capacity; sets, reads and clears days off | `cycles` |
| every dry run changes nothing | every family, so it stays skipped on Linear |

A hosted adapter lists `cycles` and leaves out `cycle-lifecycle`. The Local runs list nothing and run all tests, so they stay as they are.

**The cycle provider.** The tests that stay under `cycles` open a cycle today. They now get one through `setup()`:

- `setup()` may return `cycles: { active(), planned() }`, two async functions that return a cycle (an object with `id`, and `start` and `end` when the test needs them) or `null`.
- The test context gets `cycle('active')` and `cycle('planned')`. Without a provider it calls `tracker.openCycle({ start: today })` for `active` and `tracker.openCycle({ start: '2099-01-01' })` for `planned`, the exact calls the tests make today. With a provider it calls the provider. A `null` skips the test with the reason `needs an active cycle` or `needs a planned cycle`, using `t.skip`.
- The Local setup returns no provider, so Local behavior does not change.

The Linear setups:

- `scripts/lib/linear/contract.test.mjs` returns a provider backed by the fake's cycle store: one active cycle that contains `today` and one future cycle. The workspace description turns `cyclesEnabled` on.
- PMK-39 returns a provider that reads the sandbox with `listCycles`. It needs the sandbox team to have cycles on, one active cycle and one upcoming one, which only the user can arrange (open question 1). Without them the tests skip with a reason and the run stays green. That is the precondition: a skipped test says what it lacks, so a green run with skips never reads as full coverage.

The Linear contract run lists `['discovery', 'issues', 'relations', 'cycles']`. Two Linear tests sit beside it in `contract.test.mjs`: `openCycle` and `closeCycle` answer `NOT_SUPPORTED` with a message that names Linear's schedule, and the "no active cycle" case runs on a fake with no active cycle, so the Local suite's lifecycle cases have a Linear counterpart.

**The fake.** `fakeLinearIssues` keeps cycles in memory: `number`, `name`, dates, `isActive`, `isFuture`, `isPast` computed from a clock the test sets, and `team`. It answers `PmkitCycles` and `PmkitCycleByNumber`, evaluates the `cycle` clauses of an issue filter (`isActive`, `number`, `null`), and honors `cycleId` on create and update. It refuses an issue update whose cycle belongs to another team, as Linear does, so the adapter's own check is not the only guard. An unknown cycle clause fails with `GRAPHQL_VALIDATION_FAILED`, as the PMK-35 fake does for unknown issue clauses. The fake's behavior comes from the schema facts above.

## Testing

No test opens a socket. Every tracker test injects `fakeLinearFetch` and sets `PMKIT_HOME` with `userStoreEnv()`.

- `cycles.test.mjs`: `toSprint` for an active, a future and a past cycle, a null name, a null description, dates from `startsAt` and `endsAt` (with `end` the day before `endsAt`), `cycleKey` on good and bad shapes.
- `cycle-ops.test.mjs`: each read against the fake, including `state` filters and the order; `cycleIssues` of an unknown cycle gives `NOT_FOUND`; every `moveToCycle` case (to a number, `current`, `null`, no active cycle, an issue of another team, an unknown issue, a dry run that sends no mutation, a failure halfway that lists the ids moved); `openCycle` and `closeCycle` give `NOT_SUPPORTED` with their next steps and send no request; cycles off gives the `NOT_SUPPORTED` hint for reads and for the `sprint` filter and accepts `none` and `null`.
- `capacity-store.test.mjs`: read with no file, write creates the file, a second cycle keeps the first, `member=null` clears days off, a date outside the cycle is refused, a bad `version` or YAML is refused and left untouched, a dry run writes no file, the output bytes are stable, and no file under the repository holds the key.
- `filter.test.mjs`: the three `sprint` rows. `issues.test.mjs`: `sprint` from the fragment. `writes.test.mjs`: `sprint` on create and update, `null`, and the cycles-off answers.
- `manifest.test.mjs`: `cycles` carries `open: false`, `close: false`, `schedule: 'team'` for native and for conditional, and `capacity` carries `file`.
- `tracker.test.mjs`: `guarded` runs before every cycle operation, so a missing workspace gives `NOT_CONFIGURED`.
- `contract.test.mjs` under `scripts/lib/linear/`: the suite with the four families and the provider, plus the two cases above. `scripts/contract.test.mjs`: the Local runs unchanged.
- `fake-linear-api.test.mjs`: the cycle routes, the cross-team refusal and the unknown-clause error.
- `cli-linear.test.mjs`: `cycle list`, `cycle current`, `cycle issues 12`, `cycle add ACME-1 --to current`, `cycle capacity 12 --set` and `--days-off`, and `cycle open` and `cycle close` exiting with the `NOT_SUPPORTED` code and the reason.
- `scripts/lib/linear/contract.test.mjs` keeps a test that no file under `PMKIT_HOME` or `.pmkit/` holds `FAKE_KEY`.
- An opt-in live read joins `client-live.mjs` behind `PMKIT_LIVE=1`: it lists the cycles of the scope team and the issues of the active one, read-only, and records the time-of-day facts of "Risks" when the team has cycles.

## Acceptance criteria map

| Criterion | Design part |
|---|---|
| 1. The adapter lists cycles, finds the current one, lists its issues and moves issues between cycles | "Reading cycles" (`listCycles`, `currentCycle`, `cycleIssues`, the `sprint` filter, `issue.sprint`), "Moving issues" (`moveToCycle`, `sprint` on create and update), "Scope, ids and cycles that are off", the contract suite's `cycles` family against the fake, `cycle-ops.test.mjs` and `cli-linear.test.mjs` |
| 2. Opening or closing a cycle returns `NOT_SUPPORTED` with the reason | "Opening and closing" (the two errors, with the reason and the next step), "The manifest and open and close" (`detail.open` and `detail.close`), the two Linear cases in `contract.test.mjs`, and the `cycle-lifecycle` family left out of the Linear run |
| 3. Capacity is kept in local context | "Capacity in local context" (`.pmkit/capacity.yaml`, the four operations, the Local validators), the manifest `capacity` entry, `capacity-store.test.mjs`, and the capacity tests of the `cycles` family |

## Open questions

All four are answered.

1. **Cycles for PMK-39.** Answer: PMK-39 creates a dedicated test team with cycles turned on and one cycle, runs the suite there, and deletes the team at the end. The real team is never touched. This issue builds the suite's cycle provider so that PMK-39 can supply that team's cycle. This issue creates no team and changes no Linear setting. The sandbox provider skips with a reason when the team has no cycle. The unverified time-of-day facts in "Risks" are checked in that test team.
2. **`closeCycle`.** Answer: it stays `NOT_SUPPORTED`, as this spec does.
3. **Capacity.** Answer: it lives in the committed `.pmkit/capacity.yaml`, using the Local validators, as this spec does.
4. **Unknown cycle in a filter.** Answer: an empty list, as this spec does.

## Decisions

| Decision | Reason |
|---|---|
| Native reads and moves, `NOT_SUPPORTED` for open and close | The API has no create, the issue asks for it, and the Unified model keeps open and close for systems with that ritual. |
| The cycle `number` is the sprint id | Short, typeable and unique inside the scope team. The UUID is looked up when a write needs it. |
| `sprint` filter as a `cycle` clause on the server | Linear expresses `current`, a number and `none` exactly, so no client step is needed. |
| One `issueUpdate` per issue, checks first, report what moved | The client never retries a mutation, `issueBatchUpdate` is unverified, and the caller must know the state after a failure. |
| Capacity and days off in `.pmkit/capacity.yaml`, with the Local validators | Linear has no such field, the Unified model says local context, and the team shares the plan. |
| A `cycle-lifecycle` family and a cycle provider in the suite | One suite for every adapter (ADR-0001) without weakening the Local run, and a hosted adapter that cannot open a cycle still runs the rest. |
| `detail.open` and `detail.close` in the manifest | A skill reads what the adapter lacks without calling the operation. |

## Risks

- The sandbox has no cycle, so every cycle read here is checked against a fake built from the schema. Four facts are unverified: that `endsAt` is an exclusive boundary equal to the next cycle's `startsAt` (the fixtures and the fake assume it, and the live read checks it), the time of day in `startsAt` and `endsAt` (a UTC date may be one day off for a team in another time zone), the value of `isPast` while a team is in cooldown, and whether `completedAt` is set on a cycle that ended by date. The date rule can be wrong by a day until a workspace with cycles confirms it. The opt-in live read records the answer in `API-VERIFICATION.md`.
- The unfinished-issue rollover of Linear (a team setting) moves issues out of a cycle on its own. `/pmkit:cycle:close` assumes pmkit does the moves. PMK-40 and PMK-41 need to decide how the command behaves when Linear moves them first, and they must not rely on `closeCycle` succeeding.
- `moveToCycle` can stop halfway. The error lists the issues already moved, and the caller sees the rest with `cycle issues`.
- Capacity lives in a file under `.pmkit/`. A team that uses the sandbox or one Linear workspace from several repositories has several capacity files. A repository that changes its scope team keeps the old team's entries under the old key.
- The cycle number is a Float in the schema. The adapter reads it as an integer and treats a fractional value as an unknown cycle. No Linear workspace is known to number cycles that way.
- The `issueBatchUpdate` mutation could replace the loop one day. It is left out for lack of a live check.
- PMK-36 adds cycle changes to history and PMK-38 maps projects. Neither is merged, and this design reads neither. If PMK-36 adds a fragment field, the merge of `ISSUE_FRAGMENT` will conflict by one line.

## Self-review

- Every acceptance criterion maps to a design part and to a test above.
- The native, derived and `NOT_SUPPORTED` operations are listed in one table, and the manifest reports the unsupported two.
- The Local contract run keeps every test, and the suite change is a new family and an optional provider.
- Names in examples are `acme` and `ACME`. The sandbox appears only as "the sandbox workspace".
- No section depends on code from PMK-36 or PMK-38.
