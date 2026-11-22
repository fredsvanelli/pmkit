# PMK-153: cover the remaining sprint and assignee aliases in the contract suite

## Problem

Found in PMK-115. Four gaps:

1. The design spec's Cycles row lists `moveToCycle(ids, sprint, actor)` without saying that `sprint` takes `null` for no sprint (and `current` for the active one).
2. `scripts/contract-suite.mjs` never runs `current` with `{ dryRun: true }` on `createIssue`, `updateIssue` or `moveToCycle`.
3. It never searches with the assignee aliases `me` and `none`.
4. It never searches with an unknown sprint ID. Running it shows the trackers disagree: Local refuses with `INVALID_INPUT` (`checkFilter` asks `sprintExists`), while Linear treats any well-formed cycle number as existing (`sprintExists: (id) => cycleKey(id) !== null`) and GitHub any valid date (`sprintExists: () => true`), and both answer an empty list. A typo in `--sprint` then reads as "no issues in that sprint".

## Goal

The contract suite covers the four cases on every tracker that runs it (Local, Linear fake, GitHub fake, and the live runs), and every tracker passes.

## Approaches for case 4

1. **Every tracker refuses an unknown sprint ID in the search filter with `INVALID_INPUT` (chosen).** Local already does, and it is the reference implementation (ADR 0001). GitHub checks the ID against the iterations of the mapped field, which `sprintStep` already holds. Linear looks the cycle up by number in the scope team (`CYCLE_BY_NUMBER_QUERY`, one request, only when the filter names a cycle number). An empty list would be a conclusion drawn from a read that cannot tell "no issues" from "no such sprint".
2. Every tracker answers an empty list. Local would lose its typo check, and the reference implementation would move toward the weaker answer.
3. The contract allows either. The suite could only check that no issue comes back, and a command could not tell the two answers apart.

## Design

- Spec, `docs/superpowers/specs/2026-10-23-pmkit-design.md`, Contract: the Cycles row reads `moveToCycle(ids, sprint, actor)` with `sprint` a sprint id, `current` or `null` for no sprint. The paragraph on `searchIssues` adds that an unknown sprint ID fails with `INVALID_INPUT`.
- Contract suite, `cycles` family:
  - `sprint current with dryRun returns the active sprint id and writes nothing`: `createIssue`, `updateIssue` and `moveToCycle` with `current` and `{ dryRun: true }` give `after.sprint` the active sprint's id, and `cycleIssues` and `getIssue` show nothing changed.
  - `searchIssues with an unknown sprint id fails with INVALID_INPUT`: the ID is one the tracker's own format accepts but no sprint has. The suite derives it from the active sprint's ID, so no setup changes: a cycle number gives the number plus 100000, a date gives `2099-12-31`, anything else skips the test. A malformed ID (`not-a-sprint`) fails with `INVALID_INPUT` too, on every tracker already.
- Contract suite, `issues` family: `searchIssues with assignee me returns the issues assigned to the actor, and none the unassigned ones`: `assign(a, 'me', actor)`, `b` stays unassigned; `me` gives `[a]` and `none` gives `[b]` among the two (the test filters to its own IDs, since a live workspace may hold other issues).
- Linear (`scripts/lib/linear/issue-ops.mjs`, `searchIssues`): when the filter's sprint is a cycle number and a scope team is set, look the cycle up with `cycleNodeFor`; a missing cycle is `INVALID_INPUT` with next step `pmkit cycle list`. Without a scope team the check is skipped, as cycle numbers belong to teams.
- GitHub (`scripts/lib/github/filter.mjs`, `sprintStep`): a sprint that is not `current` or `none` must be the ID of one of `sprintsOf(configuration).sprints`, else `INVALID_INPUT` with the same message as Local.
- CHANGELOG line.

## Interview

- Does `me` mean the same in `assign` and `searchIssues`? Local resolves `me` in search from the git user and in `assign` from the actor argument; the CLI passes the git user as the actor, so they agree. The suite's Local setup uses `fred` for both. On Linear and GitHub `me` is the viewer in both.
- Live Linear: assigning `me` assigns the key owner, which the suite already does (`assignee` is the key owner on a shared workspace).
- Linear with cycles off: the filter keeps its `NOT_SUPPORTED` answer, since `cycleNodeFor` returns nothing for a team without cycles and `cycleClause` then refuses as today.
- A Linear cycle of another team with the same number: the lookup is scoped to the team, as `cycleIssues` is.
- Cost: one extra Linear request per search that names a cycle number. `cycleIssues` already pays the same request before its search; it is acceptable for a read the user typed.
- The writes' rule (`createIssue` and `updateIssue` refuse an unknown sprint with `INVALID_INPUT` on Local but `NOT_FOUND` on Linear, `moveToCycle` gives `NOT_FOUND`) and what the string `none` does as a write value are PMK-152's decision, done right after this one.
- New terms or ADRs: none. The rule follows the reference implementation, and it is easy to change.
- Approval: the issue states the coverage; the search rule follows ADR 0001. pmkit PO approves.
