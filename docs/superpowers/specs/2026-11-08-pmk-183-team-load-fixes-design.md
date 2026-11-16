# PMK-183: team load without an active sprint and on Linear teams

Fixes five defects of `pmkit team load` (PMK-71). Files: `scripts/pmkit.mjs` (`teamLoadReport`, `teamLoadText`), `scripts/lib/team-load.mjs`, `commands/team/load.md`.

## Decisions (made without the user, per the coordinator's brief)

1. **`--sprint current` with no active sprint** behaves as `issues list --sprint current`: no issue is read, the report is empty, and the warning is `there is no active sprint, so --sprint current matches no issues; run pmkit cycle list`. There is no "counted every open issue" note. Without the flag the old fallback (all open work) stays, as `commands/team/load.md` says. A Linear team with cycles off (`currentCycle` is `NOT_SUPPORTED`) is not "no active sprint": it keeps the all-open-work fallback and the cycles note. `team capacity` is unchanged (`requireSprint`).
2. **Reassignment target on Linear** must be a row of the report with `isMember: true` (a member of the configured team). Step 4 of `load.md` says so and drops a move to a `(not a member)` assignee. The CLI proposal already uses `teamMembers`.
3. **Availability 0 with open work** gets a new flag `no_availability` (`load` = its load, `limit` 0). The member stays out of the average and is never a target. `proposeMoves` treats it as a source that gives until its load is 0, and the "target ends above the source" rule does not apply to it. Days off in target choice are not changed (follow-up).
4. **Estimation `conditional`** (t-shirt teams or mixed scales on Linear): when no issue has a numeric estimate but some carry a size, or when numbers and sizes are mixed, the unit is `issues` and the reason is `estimates are sizes or mix scales and do not add up`, not `no issue in scope has an estimate`.
5. **No-move reasons**: a refused move that passes the overload and capacity limits and fails only the "target does not end above the source" rule gets the new reason `would_not_improve` ("every possible move would leave the receiver above the giver, so none evens the load"), not `no_target`. The rule itself stays (it prevents ping-pong; relaxing it is a follow-up). An estimate of 0 gets `zero_estimate` ("the issues in todo that could move have an estimate of 0, so moving them would not change the load"); `unestimated` stays for a missing estimate (it wins when both exist).

## Non-goals
Items of `docs/superpowers/epc-6-follow-ups.md`; days off in target choice; changing the move rule.
