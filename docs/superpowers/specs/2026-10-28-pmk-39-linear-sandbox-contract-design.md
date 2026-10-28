# PMK-39 design: run the contract suite against a Linear sandbox

Issue PMK-39, epic EPC-5 (Linear tracker adapter), milestone `linear`. Status: draft, waiting for the user's approval. Decisions come from an autonomous brainstorming run on 2026-10-28 with no user dialogue, from the issue, ADR-0001, ADR-0003, ADR-0005, the Technical spec, the specs of PMK-30 and PMK-33 to PMK-38, the code, and read-only calls to the sandbox workspace. Calls marked **(builder's call)** were made while writing this spec and change no acceptance criterion.

## Problem

ADR-0001 says "a hosted adapter such as Linear later has to pass the same suite", and the Technical spec, Testing item 2, says "future adapters run it against sandboxes". Today the Linear adapter runs the contract suite only against the stateful fake (`scripts/lib/linear/contract.test.mjs`). Every write the adapter sends (`issueCreate`, `issueUpdate`, `issueArchive`, the relation and comment mutations, `projectCreate`, `projectUpdateCreate`, the cycle moves) is proven only on that fake, and the fake was built from introspection. The specs of PMK-35 to PMK-38 each leave a list of facts for this issue to check against Linear.

The issue's open point ("where the sandbox workspace and its credential live") has an answer from earlier decisions. The sandbox workspace is the workspace whose URL key the user puts in `PMKIT_LIVE_WORKSPACE`, and the key is `LINEAR_API_KEY` in the user's environment (ADR-0005). pmkit reads no `.env` file. The user loads it in the shell for the run.

Acceptance criteria:

1. The contract suite passes against a Linear sandbox workspace.
2. `npm test` still runs the Local suite with no network.

Decisions the user made before this spec, which bind it:

- The run writes only in the sandbox workspace. It checks `organization.urlKey` against `$PMKIT_LIVE_WORKSPACE` before the first write.
- Each run creates a new dedicated test team with cycles on, so the suite's cycle tests run, and deletes or archives everything it created at the end, the team included.
- The run never writes to an existing team or project.
- The key comes from `LINEAR_API_KEY`. `npm test` never runs the live suite. The live suite runs only behind an explicit environment variable.

Bound decisions from earlier issues:

- The suite calls `setup()` once per test and expects a tracker with every status category, at least one member, at least one type and no issues (`scripts/contract-suite.mjs`, header).
- A hosted adapter lists the families it implements. The Linear run lists `discovery`, `issues`, `relations`, `history`, `cycles`, `deliverables`, `milestones` and `documents`, and leaves out `cycle-lifecycle`, `time`, `releases`, `milestone-writes` and `document-writes` (PMK-37, PMK-38).
- `openCycle` and `closeCycle` answer `NOT_SUPPORTED` on Linear, so the suite gets its cycles from a cycle provider (`setup().cycles`, PMK-37).
- The client sends a mutation once and never retries it (PMK-30). Every write appears as the key's owner, and the adapter refuses another actor (ADR-0005).
- Live checks are opt-in files whose names do not end in `.test.mjs`, gated by `PMKIT_LIVE=1` and `PMKIT_LIVE_WORKSPACE` (`client-live.mjs`, `scenarios-live.mjs`).
- No dependency joins `package.json` (ADR-0003).

## Facts checked against the Linear API

Read-only calls on 2026-10-28 against the sandbox workspace, through `createLinearClient` and a fetch wrapper that refused any mutation. The session pinned to `$PMKIT_LIVE_WORKSPACE` before any other call. The output held counts and schema names only. Introspection reads the schema; it does not prove how a field behaves.

| Call | Result |
|---|---|
| `__type(Mutation)`, team fields | `teamCreate(input, copySettingsFromTeamId)`, `teamUpdate`, `teamDelete(id) -> DeletePayload`, `teamUnarchive`, `teamCyclesDelete`, `teamKeyDelete`, `teamMembershipCreate`, `teamMembershipUpdate`, `teamMembershipDelete`. There is no `teamArchive`. `teamUnarchive` suggests that `teamDelete` keeps the team for a while. |
| `__type(TeamCreateInput)` | 40 fields, among them `id` (client-chosen), `name` (required), `key`, `description`, `private`, `timezone`, `triageEnabled`, `cyclesEnabled`, `cycleStartDay` (Float), `cycleDuration` (Int), `cycleCooldownTime`, `upcomingCycleCount` (Float), `cycleIssueAutoAssignStarted`, `cycleIssueAutoAssignCompleted`, `cycleLockToActive`, `groupIssueHistory`, `inheritWorkflowStatuses`, `parentId`. |
| `__type(Mutation)`, cycle fields | `cycleUpdate`, `cycleArchive`, `cycleShiftAll`, `cycleStartUpcomingCycleToday(id)`. No `cycleCreate` (PMK-37). |
| `__type(Mutation)`, delete fields | `issueDelete(id, permanentlyDelete) -> IssueArchivePayload`, `issueArchive(id, trash)`, `projectDelete(id) -> ProjectArchivePayload`, `projectUnarchive`, `commentDelete`, `issueRelationDelete`, `documentDelete`, `projectMilestoneDelete`. |
| `__type(WorkflowStateCreateInput)` | `teamId`, `type`, `name`, `color` (all required), `id`, `description`, `position`. |
| `__type(Team)` | `createdAt`, `archivedAt`, `description`, `timezone`, the cycle settings, `activeCycle`, `cycles(filter, includeArchived)`, `states(filter, includeArchived)`, `triageIssueState`. |
| `__type(TeamFilter)` | `name`, `key`, `description` and `createdAt` comparators, so a name prefix can be searched on the server. |
| `__type(Issue)`, `__type(Project)` | Both have `archivedAt` and `trashed`. |
| `viewer` | The key's owner is an admin of the workspace, so `teamCreate` and `teamDelete` are allowed for it. |
| `organization.subscription` | `null`, the Free plan (PMK-29). Linear's pricing page (read 2026-10-28) gives Free "2 teams" and "250 issues", and does not say whether archived or trashed issues count. |
| `teams(includeArchived: true)` | One team, not archived. So the workspace has room for exactly one test team. No team key starts with `PKT`. |
| Workflow states of the existing team | Types `backlog`, `unstarted`, five `started`, `completed`, `canceled`, `duplicate`, a state named "In Review", and no `triage` state. A new team's default states are unverified. |
| `issueLabels` | Five workspace labels, among them "Bug", "Feature" and "Improvement". A type mapping to "Bug" and "Feature" needs no label write. |
| `issues`, with and without `includeArchived` | 122 issues, none archived and none trashed. The run's peak adds about 25. |
| Rate-limit headers | `x-ratelimit-requests-limit: 2500` and `x-ratelimit-complexity-limit: 3000000`, each reset hourly. A simple query cost 22 to 60 complexity points. |

Linear's cycle docs (`https://linear.app/docs/use-cycles`, read 2026-10-28) say cycles begin at 12:01 AM on the chosen start day in the team's time zone, at most 15 future cycles exist, and "Start cycle today" starts the next cycle at 12:00 AM and marks a running cycle complete. That menu entry is the `cycleStartUpcomingCycleToday` mutation.

Consequences for the design:

- The test team gets its cycles from its schedule. `cycleStartDay` set to today's weekday may make the first cycle start today. When it does not, `cycleStartUpcomingCycleToday` on the next cycle makes one active today. `upcomingCycleCount: 2` leaves a planned cycle after that.
- On Free, a leftover test team blocks the next run, because the workspace holds at most two teams. Cleanup is part of the design, and the run checks for leftovers before it creates anything.
- The suite's `archived: true` searches see archived issues, so archiving is not enough to give the next test an empty tracker. Trashed issues are hidden by the adapter (`toIssue` returns null for `trashed`, `readNode` answers `NOT_FOUND`, `metricEvents` drops them), so the sweep between tests trashes them with `issueDelete`.

## Goals

- One command runs the contract suite against a new test team in the sandbox workspace, and every test of the eight Linear families passes.
- The run writes only in its own team and in the projects it created, and refuses any other mutation before it is sent.
- The run removes everything it created, after a failure and after Ctrl-C too. A leftover team can be found and removed later with one command.
- The run counts its requests and complexity, stays well under Linear's hourly limits, and stops before the first write when too little is left.
- A second run works the same as the first: no state carries over between runs.
- The run checks the facts that the PMK-35 to PMK-38 specs left for this issue and records the answers in `API-VERIFICATION.md`.
- `npm test` keeps running the Local suite and the fake Linear suite, and opens no socket.

## Non-goals

- New contract tests, or changes to the existing ones. The suite stays as it is for every adapter.
- New adapter features. A live failure that shows a bug gets a fix in the adapter and in the fake, with a fake-based test, and nothing else.
- Running the live suite in CI. See open question 4.
- Plan-gated writes (releases, triage responsibility, initiatives). The Free sandbox cannot prove them.
- The degraded paths of each command on Linear (PMK-40).

## Anti-goals

- Any write to a team, project, label, state or setting that existed before the run.
- Any write in a workspace whose URL key is not exactly `$PMKIT_LIVE_WORKSPACE`, including a match on `previousUrlKeys` only.
- Weakening a suite assertion so that Linear passes. If an assertion holds for Local and cannot hold for any hosted tracker, that is a user decision, not a builder's call.
- A green run that hides missing coverage. A cycle test that cannot get its cycle fails; it does not skip.
- The key, the real workspace URL key or the real team key in any file, log line, commit or command line.

## Approaches

### How each test gets an empty tracker

1. **One team per run, swept between tests (chosen).** The run creates one team. Each test's `teardown` trashes the issues and deletes the projects the test left, and the next `setup` checks that the team is empty. It costs one `teamCreate` and one `teamDelete` per run, and the cycles are set up once.
2. **One team per test.** The cleanest isolation, but 20 `teamCreate` and `teamDelete` calls, a cycle wait for each team, and the Free limit of two teams. If a deleted team still counts while Linear keeps it, the second test cannot start. Rejected.
3. **One team per run, with tests that tolerate earlier issues.** Each test would compare only the ids it created. That changes the suite for every adapter and weakens the Local run. Rejected by the brief.

### Where the live run lives

1. **A new opt-in file `scripts/lib/linear/contract-live.mjs`, plus a module `scripts/lib/linear/sandbox.mjs` with the team lifecycle and the write guard (chosen).** The file name keeps it out of `npm test`, and the module gets unit tests with a scripted fetch.
2. **New tests inside `client-live.mjs`.** That file promises to stay read-only and refuses every mutation. Mixing writes into it breaks that promise. Rejected.
3. **A `pmkit` CLI command.** It would ship test machinery to users. Rejected.

### How the run gets an active and a planned cycle

1. **Cycles on at `teamCreate` with a start day of today, then `cycleStartUpcomingCycleToday` when no cycle is active (chosen).** It uses only the team's own schedule and one documented mutation.
2. **`cycleUpdate` to move an existing cycle's dates onto today.** It edits a cycle's dates by hand and depends on behavior the docs do not describe. Kept as a fallback only if approach 1 fails live, and then a user decision.
3. **No cycles, cycle tests skip.** Fails the user's decision that cycle tests run. Rejected.

## Design

### Files

| File | Change |
|---|---|
| `scripts/lib/linear/sandbox.mjs` | New. The test team's name, key and marker, `preflight`, `createTestTeam`, `waitForCycles`, `sweepTeam`, `deleteTestTeam`, `findLeftovers` and `writeGuard`. Every function takes a client or a fetch, so tests inject one. |
| `scripts/lib/linear/sandbox.test.mjs` | New. Unit tests over a scripted fetch, in `npm test`. |
| `scripts/lib/linear/contract-live.mjs` | New. The opt-in entry: the run's `before` and `after` hooks, the per-test `setup`, the live cycle provider, the live probes, the `cleanup` mode and the signal handlers. |
| `scripts/run-tests.mjs` | Removes `LINEAR_API_KEY` and `PMKIT_LIVE` from the environment it passes to `node --test` **(builder's call)**. |
| `scripts/run-tests.test.mjs` | Tests that removal. |
| `scripts/lib/linear/API-VERIFICATION.md` | A "Live writes (PMK-39)" section with the run command, the request budget, the results of the probes, and the cycle facts that PMK-37 left `unverified`. |
| Adapter files and `scripts/fake-linear-api.mjs` | Only the fixes a live failure shows, each with a fake-based test first. |
| `CHANGELOG.md` | One entry. |

### Running it

```
set -a; . ./.env; set +a; PMKIT_LIVE=1 PMKIT_LIVE_WORKSPACE=<url key> node scripts/lib/linear/contract-live.mjs
set -a; . ./.env; set +a; PMKIT_LIVE=1 PMKIT_LIVE_WORKSPACE=<url key> node scripts/lib/linear/contract-live.mjs cleanup
set -a; . ./.env; set +a; PMKIT_LIVE=1 PMKIT_LIVE_WORKSPACE=<url key> node scripts/lib/linear/contract-live.mjs cleanup --yes
```

The file runs with `node`, not `node --test`, so the tests and the signal handlers share one process **(builder's call)**. `node:test` runs the tests in that process. Without `PMKIT_LIVE=1`, a set `PMKIT_LIVE_WORKSPACE` and a usable `LINEAR_API_KEY`, every test is skipped with one reason and nothing is sent, as in `client-live.mjs`. `cleanup` without `--yes` lists leftovers and writes nothing.

### The test team

`createTestTeam` sends one `teamCreate` with these inputs:

| Field | Value | Why |
|---|---|---|
| `id` | a UUID the run chooses | The run can find the team even when the answer to `teamCreate` never arrives. |
| `name` | `pmkit-contract-<run id>` | The fixed prefix `pmkit-contract-` is how cleanup finds leftovers. The run id is the start time as `YYYYMMDDHHMMSS` plus four random hex characters. |
| `key` | `PKT` plus two random capital letters, checked against the workspace's keys | A fixed prefix lets the guard check the key. Linear's key length limit is unverified; a refusal names the input. |
| `description` | `pmkit contract run <run id>, started <ISO time>. Safe to delete with contract-live.mjs cleanup.` | The marker. Cleanup deletes a team only when its name, key prefix and description marker all match. |
| `timezone` | `Etc/UTC` | Cycle dates then match the adapter's UTC date rule. |
| `triageEnabled` | `true` | Gives a `triage` state, which the suite needs. |
| `cyclesEnabled`, `cycleDuration`, `cycleCooldownTime`, `cycleStartDay`, `upcomingCycleCount` | `true`, `1`, `0`, today's UTC weekday (`getUTCDay()`), `2` | One-week cycles, no cooldown, the first starting today if Linear allows it, and a planned cycle after the active one. Whether `0` means Sunday is unverified; the fallback below covers a wrong guess. |
| `cycleIssueAutoAssignStarted`, `cycleIssueAutoAssignCompleted` | `false` | Linear would otherwise put an issue into the active cycle when it moves to a started or done state, and the cycle tests would see issues they did not add. |
| `groupIssueHistory` | `false` | The history test expects `create`, `update` and `comment` as separate events. |

`private` stays unset **(builder's call)**. Private teams may need a paid plan, and the team lives for minutes.

After the create, the run reads the team's states once. If no `started` state is named "In Review", it sends one `workflowStateCreate` (`teamId` of the test team, `type: started`, `name: In Review`, a fixed color). If no `triage` state exists, the run stops with "the test team has no triage state" and cleans up. The suite needs a status in each of the seven categories.

`waitForCycles` reads `team(id) { activeCycle cycles(first: 10) }` every 2 seconds, up to 10 reads. When a planned cycle exists and no cycle is active, it sends one `cycleStartUpcomingCycleToday` with the id of the next cycle and reads up to 10 more times. When the team still lacks an active or a planned cycle, the run stops before the suite with a message that says which one, and cleans up.

### The run's configuration

The run builds one config for every test:

```
tracker: { system: linear, scope: { workspace: $PMKIT_LIVE_WORKSPACE, team: <test team key> } }
git_host: { system: none }
mappings: { status: { in_review: In Review }, types: { bug: Bug, feature: Feature } }
```

The type mapping names the workspace labels "Bug" and "Feature". The run checks that both exist before the first write and stops if either is missing, so it never creates a label **(builder's call)**.

One temporary `PMKIT_HOME`, `HOME`, `XDG_CONFIG_HOME` and repository root serve the whole run, as `client-live.mjs` builds them. After the team is ready, the run calls `discover({ refresh: true })` once, which fills the discovery cache for the run. Each test's tracker then reads discovery from the cache and sends only its own session query. The cache's one-hour TTL is longer than the run.

### Setup and teardown of each test

`setup()` returns:

- `tracker`, a new `createLinearTracker(config, { env, fetch: guardedFetch })`.
- `actor`, the viewer's id from the session.
- `today`, the UTC date of the run's start.
- `cycles: { active, planned }`, which read `tracker.listCycles({ state })` and return `{ id, start, end }` of the first match. When none matches, they throw "the test team has no <state> cycle" instead of returning null **(builder's call)**. The live team always has both, so a missing cycle is a setup failure and must fail the test.
- `teardown`, which runs `sweepTeam` and removes `.pmkit/capacity.yaml` from the shared root, so the capacity tests start from an empty file.

Before it returns, `setup` checks with one query that the team has no issue that is not trashed, archived ones included, and that no project the run created is still open. If either check fails, the test fails with "the test team is not empty", which points at a sweep bug.

`sweepTeam` reads the team's issues with `includeArchived: true` and sends `issueDelete` (without `permanentlyDelete`) for each one that is not trashed, then `projectDelete` for each project the run created and has not yet deleted. The suite calls `teardown` in a `finally`, so a failing test is swept too.

### The write guard

`guardedFetch` wraps the global fetch for every client of the run, the trackers' and the run's own. It reads each request's document with `isMutation` and `operationName` from `client.mjs`:

- A query passes.
- Before `preflight` succeeds, every mutation is refused.
- A mutation passes only when its root field is on the list below and its ids belong to the run. The guard records the ids the run chooses: the team id, the UUIDs in `issueCreate`, `projectCreate`, `commentCreate` and `issueRelationCreate` inputs (the adapter sends a client `id` for each), the state ids of the test team and the cycle ids read from it.
- Any other mutation throws `refusing <name>: not in the live run's list` before the request leaves the process. The adapter turns it into a failed test.

| Root field | Sent by | Id checks |
|---|---|---|
| `teamCreate` | `createTestTeam`, once | `input.name` and `input.key` carry the prefixes, `input.description` the marker, no `copySettingsFromTeamId`, no `parentId` |
| `workflowStateCreate` | `createTestTeam`, at most once | `input.teamId` is the test team |
| `cycleStartUpcomingCycleToday` | `waitForCycles`, at most once | `id` is a cycle read from the test team |
| `issueCreate` | `createIssue` | `input.teamId` is the test team; `input.projectId`, `input.parentId`, `input.cycleId` and `input.stateId`, when set, belong to the run; `input.labelIds`, when set, hold only the ids of the "Bug" and "Feature" labels, which the issue uses and the run never changes |
| `issueUpdate` | `updateIssue`, `moveToCategory`, `assign`, `setParent`, `moveToCycle` | `id` is an issue the run created; the same input checks as `issueCreate`; `input.assigneeId` is the viewer or null |
| `issueArchive` | `archive` | `id` is an issue the run created |
| `issueRelationCreate` | `link` | `input.issueId` and `input.relatedIssueId` are issues the run created |
| `issueRelationDelete` | `unlink` | `id` is a relation the run created |
| `commentCreate` | `comment` | `input.issueId` is an issue the run created; `input.parentId`, when set, is a comment the run created |
| `commentResolve` | `resolveThread` | `id` is a comment the run created |
| `projectCreate` | `createDeliverable` | `input.teamIds` is exactly the test team |
| `projectUpdateCreate` | `publishStatusUpdate` | `input.projectId` is a project the run created |
| `issueDelete` | `sweepTeam` | `id` is an issue the run created, and `permanentlyDelete` is unset |
| `projectDelete` | `sweepTeam`, `deleteTestTeam` | `id` is a project the run created, or in `cleanup` a project whose only team is a leftover test team |
| `teamDelete` | `deleteTestTeam` | `id` is the test team, or in `cleanup` a team that passes the leftover check |

The run sends no other mutation: no `teamUpdate`, `teamCyclesDelete`, `cycleUpdate`, `cycleArchive`, `cycleShiftAll`, `issueLabelCreate`, `documentCreate`, `projectMilestoneCreate`, `projectUpdate` or `teamMembership*`, and nothing at the workspace level. If the adapter sends a mutation the table lacks, the run fails and the table needs a user-approved change.

### Preflight

`preflight` runs before any mutation and stops the run, with nothing written, when any check fails:

1. `PMKIT_LIVE` is `1`, `PMKIT_LIVE_WORKSPACE` is set, and `linearCredential(process.env)` accepts the key.
2. The session's `organization.urlKey` equals `$PMKIT_LIVE_WORKSPACE` exactly, and the session has no warning. A match on `previousUrlKeys` only stops the run.
3. `findLeftovers` finds no team with the name prefix. When it finds one, the run stops with "a test team from an earlier run is still there; run contract-live.mjs cleanup" **(see open question 1)**.
4. The workspace has fewer than two teams, or the plan is not Free. On Free with two teams, the run stops before `teamCreate` would fail.
5. The workspace labels "Bug" and "Feature" exist.
6. The rate-limit headers of the preflight answers show at least 1,700 requests and 1,500,000 complexity points left in the current window. Otherwise the run stops and names the reset time.

### Request budget

Linear's observed limits for a personal key are 2,500 requests and 3,000,000 complexity points per hour. The run aims at under 1,000 requests and sets a hard cap of 1,200.

| Part | Requests (estimate) | Writes among them |
|---|---|---|
| Preflight: session, teams, labels | 4 | 0 |
| Team setup: `teamCreate`, states read, `workflowStateCreate`, cycle reads, `cycleStartUpcomingCycleToday` | up to 24 | up to 3 |
| Discovery once for the run | 8 | 0 |
| The 20 contract tests that run (session, operations, emptiness check) | about 450 | about 56 |
| Sweeps after each test (issue read, deletes) | about 65 | about 22 |
| Live probes | about 40 | about 10 |
| End: last sweep, `teamDelete` | about 5 | 1 |
| Total | about 600 | about 90 |

The 56 suite writes come from counting the operations of the 20 tests the Linear families run. The test that moves an issue through every category sends 12 of them. The suite creates 20 issues and 2 projects in total, and the probes 4 more issues, so the workspace's count of open issues never grows by more than about 25 and returns to its start after each sweep.

`guardedFetch` counts every request and sums `x-complexity`. At the cap it refuses further suite requests with "the live run used its request budget", which fails the remaining tests, and keeps 100 requests for cleanup, which the cap does not count. The run prints the totals with `t.diagnostic`: requests, writes, complexity, and the remaining requests and complexity from the last headers. The implementation records the measured numbers in `API-VERIFICATION.md`.

### Cleanup

| When | What happens |
|---|---|
| After each test | `teardown` runs `sweepTeam`. |
| After the last test | The `after` hook runs `sweepTeam` once more and `deleteTestTeam`, which deletes any project the run created and then sends `teamDelete`. It reads `teams` afterwards and reports whether the team is gone or kept as archived. |
| A test or setup throws | The suite's `finally` runs `teardown`. A failure in `before` still runs the `after` hook, which deletes the team if it exists. |
| Ctrl-C or SIGTERM | The handler sets a stopping flag, so the guard refuses new suite mutations, then runs the `after` steps and exits with code 130. A second signal exits at once and leaves the team for `cleanup`. |
| Crash, `kill -9` or lost network | The team stays, with its name prefix, key prefix and marker. The next run's preflight finds it and stops. `contract-live.mjs cleanup` lists it, and `cleanup --yes` sweeps it and deletes it. |
| An unconfirmed `teamCreate` | The run looks the team up by the id it chose. If the team exists, cleanup proceeds as usual. |

`findLeftovers` sends `teams(filter: { name: { startsWith: "pmkit-contract-" } })` and keeps a team only when its key starts with `PKT` and its description holds the marker. Cleanup never touches a team that fails any of the three checks, and prints the name of a team that matched the prefix only, so the user can look at it. Running `cleanup` during a live run deletes that run's team. The header comment of the file says so.

### Live probes

The PMK-35 to PMK-38 specs left facts for this issue. After the contract tests, `contract-live.mjs` runs these extra tests in the same team **(builder's call; see open question 2)**. Each asserts only what pmkit relies on, prints the rest with `t.diagnostic`, and is swept like a contract test.

| Probe | Source | What the run asserts or records |
|---|---|---|
| `issueCreate` with a client `id` returns that id, and an archived issue reads back with `includeArchived` | PMK-35 | Asserted, through the contract tests. |
| A description with an acceptance-criteria list round-trips through `updateIssue` and `getIssue` | PMK-35 | Asserted: the parsed description and criteria are equal. The raw Markdown Linear returns is recorded. |
| A comment with a `<!-- pmkit` marker line, a checklist and a code fence | PMK-36 | Recorded: which of the three survive in `body`. |
| The history relation codes for `blocks`, `duplicate` and a removed relation | PMK-36 | Recorded: the raw codes and directions, so PMK-36's code table can grow. |
| A new comment moves `updatedAt` | PMK-36 | Recorded, for `metricEvents({ since })`. |
| Cycle dates: time of day, `endsAt` equal to the next `startsAt`, `isPast` and `completedAt` | PMK-37 | Asserted: the boundary rule the adapter uses. Recorded: the time of day. |
| `projectCreate` and `projectUpdateCreate` on Free | PMK-38 | Asserted, through the contract tests. |

`issueUpdate` with a cycle of another team stays unverified: the Free limit leaves room for one test team only.

### The `npm test` side (criterion 2)

- The live file's name does not end in `.test.mjs`, so the `scripts/**/*.test.mjs` glob of `run-tests.mjs` never loads it.
- `run-tests.mjs` removes `LINEAR_API_KEY` and `PMKIT_LIVE` from the child environment. A test that reached a live client by mistake would then fail with `AUTH` before any request.
- `sandbox.test.mjs` runs in `npm test` with a scripted fetch and no socket.
- `scripts/contract.test.mjs` (Local) and `scripts/lib/linear/contract.test.mjs` (fake) stay as they are, with the same families and the same tests.

## Testing

TDD for every code change. No test in `npm test` opens a socket.

- `sandbox.test.mjs`, over a scripted fetch that records each request:
  - `preflight` stops with no mutation sent when the URL key differs, when it matches only `previousUrlKeys`, when a leftover exists, when the Free workspace has two teams, when a type label is missing, and when the headers show too little budget.
  - `writeGuard` refuses a mutation before preflight, a root field off the list, an `issueUpdate` on an issue the run did not create, a `projectCreate` with a second team, an `issueDelete` with `permanentlyDelete`, and a `teamDelete` of a team without the marker. It passes each listed mutation with the run's ids.
  - `createTestTeam` sends the inputs in the table, adds "In Review" only when the team lacks it, and stops when there is no triage state.
  - `waitForCycles` returns at once when both cycles exist, sends `cycleStartUpcomingCycleToday` once when none is active, and fails with the missing state after its reads.
  - `sweepTeam` deletes only issues that are not trashed and only the run's projects. `findLeftovers` keeps a team only when all three checks match.
  - The request counter stops suite requests at the cap and still lets cleanup through.
- `run-tests.test.mjs`: the child environment has no `LINEAR_API_KEY` and no `PMKIT_LIVE`.
- In `sandbox.test.mjs`, a test that spawns `node scripts/lib/linear/contract-live.mjs` with no `PMKIT_LIVE` and no key, and checks that every test is skipped with one reason. With the gate closed the file builds no client, so nothing is sent.
- The live run itself, by hand, after `npm test` passes. Its output goes into the PR description and `API-VERIFICATION.md`, with counts and no names.

## Acceptance criteria map

| Criterion | Design part |
|---|---|
| 1. The contract suite passes against a Linear sandbox workspace | "The test team" (every category, members, types, cycles), "Setup and teardown of each test" (an empty tracker per test, the live cycle provider), "The run's configuration", "Preflight", "The write guard", "Cleanup", the live run of `contract-live.mjs` with the eight Linear families, every test passing and the other families skipped with their family reason, and the "Live probes" for the facts earlier specs left open |
| 2. `npm test` still runs the Local suite with no network | "The `npm test` side": the file name outside the glob, the cleaned child environment, `sandbox.test.mjs` over a scripted fetch, and the Local and fake contract runs unchanged |

## Open questions

1. **A leftover team at preflight.** Options: (a) stop and ask the user to run `cleanup`; (b) delete a leftover that passes all three checks and go on; (c) delete only leftovers older than one hour and stop on a younger one. Recommendation: (a). A leftover means an earlier run broke, and the user should see it. It also avoids deleting the team of a run in another terminal.
2. **The live probes.** Options: (a) run them in this issue, as this spec does; (b) run only the contract suite here and file a follow-up for the probes. Recommendation: (a). The earlier specs name PMK-39 for each fact, the probes reuse the same team, and they cost about 40 requests.
3. **A deleted team still counts toward the Free limit.** `teamUnarchive` suggests `teamDelete` keeps the team for a while. If Linear counts it, the next run cannot create a team until it is purged. Options: (a) report it and let the user wait; (b) keep one persistent test team with the prefix and marker, swept before and after each run, which goes against "a new team per run"; (c) run on a trial or paid workspace. Recommendation: (a) for now. Measure it in the first two runs, and ask again with the numbers if the second run is blocked.
4. **CI.** Options: (a) by hand only; (b) a manual GitHub Actions workflow with the key as a repository secret. Recommendation: (a). The repository is public, and a workflow with the key needs its own review of who can trigger it.

## Decisions

| Decision | Reason |
|---|---|
| One team per run, trashed between tests | One `teamCreate` per run, one cycle setup, and room under Free's two-team limit, while each test still starts empty. |
| `issueDelete` (trash) between tests, not `issueArchive` | The suite's `archived: true` searches see archived issues. The adapter hides trashed ones. |
| Cycles from the team's schedule, with `cycleStartUpcomingCycleToday` as the fallback | No `cycleCreate` exists, and both calls use documented behavior. |
| The live cycle provider throws instead of returning null | The live team always has both cycles, so a missing one is a setup failure and must not read as a pass. |
| A write guard with a list of mutations and the run's ids | The brief forbids any write outside the test team. The guard enforces it in code before a request leaves the process. |
| Fixed name prefix, key prefix and description marker | Cleanup must find leftovers without a state file and must never match another team. |
| Run with `node`, not `node --test` | One process, so the signal handler can clean up. |
| One discovery for the run, through the cache | Saves about 150 requests and keeps each test's tracker new. |
| Remove the key and `PMKIT_LIVE` from the `npm test` environment | A test that reaches a live path fails with `AUTH` and sends nothing. |
| No ADR | The brief asks for none, and the choices follow ADR-0001 and ADR-0005. |

## Risks

- **Default states of a new team.** Unverified. The run adds "In Review" when missing and stops when triage gives no triage state. If Linear names its done or todo states differently, discovery still maps them by type.
- **Cycle start.** Whether `cycleStartDay` uses 0 for Sunday, and whether Linear creates the cycles at once or later, are unverified. The fallback and the bounded wait cover both, at the cost of up to 40 seconds.
- **Deleted teams and trashed issues on Free.** Whether they count toward the limits is unverified (open question 3). The workspace has 122 open issues, so 25 more stay under 250 even if trashed ones count.
- **`issueDelete` on an archived issue.** Unverified. If Linear refuses it, the sweep sends `issueArchive(trash: true)` instead, and the guard table gains that field after the user approves.
- **Live failures of the suite.** The fake was built from introspection, so the first live run will likely fail some tests (history entries on create, relation codes, comment threads). Each failure gets a fix in the adapter and the fake, test first. A fix that would change a suite assertion goes back to the user.
- **Rate limits.** The estimates come from counting operations, not from a run. The cap and the preflight check keep a bad estimate from using the hourly budget, and the first run records the real numbers.
- **The team's visibility.** The team is not private, so other members of the sandbox workspace can see it while the run lasts.
- **Linear's key length limit.** A five-character key is assumed to be valid. `teamCreate` refusing it stops the run before any other write, and the message names the field.

## Self-review

- Each acceptance criterion maps to a design part and to tests above.
- The list of mutations is exact, and the guard refuses anything else before the request is sent.
- The Local and fake contract runs do not change. The live run adds a setup, not a test change.
- Cleanup covers a normal end, a failed test, a failed setup, Ctrl-C, a crash and an unconfirmed create.
- The request budget, the cap and the preflight check are stated with numbers.
- Examples use `acme` and `ACME`, live commands use `$PMKIT_LIVE_WORKSPACE` or `<url key>`, and the sandbox appears only as "the sandbox workspace". The private-name check passes on this file.
