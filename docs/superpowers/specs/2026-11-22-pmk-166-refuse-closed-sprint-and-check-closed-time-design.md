# PMK-166: refuse cycle add into a closed sprint and check `closed` in adapters

## Root cause

Found in PMK-121.

1. **`cycle add` accepts a closed sprint.** Local `moveToCycle` resolves its target with `requireSprint`, which checks that the sprint file exists and nothing else; Linear `cycleNodeFor` checks that the cycle number exists; GitHub `moveTarget` says outright "a closed sprint is a target as on Local". A closed sprint's velocity is fixed at its close (PMK-121 counts only moves to `done` up to `closed`), so an issue added afterwards never counts there and drops out of the planning of the sprints that are still open. `commands/issues/bulk.md` already reads `CONFLICT` as "the state of the target does not allow the change (a closed sprint, for example)", which no tracker answers today. The same resolvers serve `issues create --sprint` and `issues update --sprint`, which have the same hole.
2. **An unparsable `closed` drops every issue from velocity.** `velocity` in `scripts/lib/metrics.mjs`, shared by every tracker, compares `Date.parse(issue.doneAt) <= Date.parse(sprint.closed)` whenever `closed` is set. Local's `parseSprint` keeps `closed` only when `validTimestamp` accepts it, but Linear passes `completedAt` through as it comes and any other source could too; `Date.parse` of a bad value is `NaN`, every comparison is false, and the sprint shows 0 done.

## Goal

A write that puts an issue into a closed sprint fails with `CONFLICT` on Local, Linear and GitHub and writes nothing, and velocity never drops a sprint's issues because its `closed` time does not parse.

## Approaches

For 1:

1. **Refuse in each tracker's sprint resolver (chosen).** The resolver is the one place `moveToCycle`, `createIssue` and `updateIssue` share per tracker, so the three writes agree: Local `requireSprint` reads the sprint's state, Linear `cycleNodeFor` uses `cycleState` of the node it already reads, GitHub `iterationOf` and `moveTarget` use the state `sprintsOf` gives. `CONFLICT`, `sprint <id> is closed`, next step `pmkit cycle list --state planned`.
2. Refuse in `moveToCycle` only. `issues update --sprint <closed>` would still do what `cycle add` refuses.
3. Refuse in the CLI's `cycle add`. A contract caller would still get through, and each tracker would still disagree.

For 2:

1. **Guard in `velocity` (chosen).** Use `closed` only when `Date.parse` gives a number, else fall back to the end-date rule the function already has for a sprint with no `closed`. One guard where every tracker routes.
2. A check in each adapter. Three places for one comparison.

## Design

- `scripts/lib/local/tracker.mjs`, `requireSprint`: after the existence check, `readSprint(...).state === 'closed'` → `CONFLICT`. `current` resolves the active sprint, never a closed one.
- `scripts/lib/linear/issue-ops.mjs`, `cycleNodeFor`: `cycleState(found) === 'closed'` → `CONFLICT`.
- `scripts/lib/github/writes.mjs`, `iterationOf`, and `scripts/lib/github/cycle-ops.mjs`, `moveTarget`: a target whose sprint state is `closed` → `CONFLICT`. The comment that said a closed sprint is a target goes.
- One `closedSprint(id)` error in `scripts/lib/issue-filter.mjs` next to `unknownSprint` (PMK-153), used by the three trackers.
- `scripts/lib/metrics.mjs`, `velocity`: `const closedAt = Date.parse(sprint.closed)`; the cut-off is `closedAt` when `Number.isFinite(closedAt)`, else the end date.
- Contract suite, `cycle-lifecycle` family (Local opens and closes sprints): `a closed sprint as the target of createIssue, updateIssue and moveToCycle fails with CONFLICT and writes nothing`. Linear and GitHub, which cannot close a cycle through the contract, get the same case in their adapter tests over the fake (a past cycle, a completed iteration).
- `scripts/metrics.test.mjs` (or the file holding `velocity`'s tests): a closed sprint with `closed: 'not a time'` counts its done issues by the end date.
- CHANGELOG; `commands/issues/bulk.md` already names the closed sprint under `CONFLICT`.

## Interview

- Does `/pmkit:cycle:close` write into the sprint it closes after the close? No: step 8 runs every move before `cycle close`, and a split's original keeps the sprint it has (no sprint write).
- Does an import set a closed sprint? `local-migrate import` writes the files directly (`migrate-writer.mjs`), not through the contract writes.
- An update that does not name the sprint leaves an issue of a closed sprint as it is; only a write that sets the sprint is refused. Setting `null` (out of the sprint) stays allowed, since it does not add to the closed sprint.
- New terms or ADRs: none. `CONTEXT.md`'s Sprint entry already says velocity counts moves to `done` only up to the close.
- Approval: the issue names both defects; `bulk.md` already expects `CONFLICT`. pmkit PO approves.
