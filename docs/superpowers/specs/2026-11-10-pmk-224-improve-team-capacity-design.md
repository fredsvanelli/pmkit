# PMK-224 design: improve team capacity

Source: the three follow-ups of PMK-72 (`docs/superpowers/epc-6-orchestration/epc-6-log.md`, PMK-72 entry).

This design was written without a round of questions (the coordinator opted out). The calls the builder made are marked **(builder's call)** and each can change in review.

## Goal

1. `team capacity --days-off` recomputes the capacity of a member whose working days change.
2. `cycle capacity <id>` accepts `current`, and on Linear it refuses a member outside the configured team.
3. The write path of `team capacity` builds each load report once, with no move proposal nobody reads.

## Non-goals

- No change to `availability`, to the velocity formula or to `/pmkit:cycle:plan`.
- No new flag and no new command, so no new scenario and no capability change.
- `cycle capacity --days-off` stays a plain write: it never recomputes (the low-level command keeps its contract; `cycle:plan` passes the numbers it computed).

## 1. Recompute on days off

The only formula in the repo is `commands/cycle/plan.md` step 4: capacity = rate x availability x working days. It is linear in the working days, so the CLI does not need the velocity: a member's capacity for `w` working days is `base x w / baseDays`. **(builder's call)**

- Applies in `team capacity` when `--days-off` changes the working days of a member whose capacity is set and who `--set` does not name. `--set member=n` always wins, so `--set member=<old>` keeps the number.
- Every scaled value derives from a **base**, `{ capacity, workingDays }`: the capacity the user gave and the working days it was for. The first scaling creates it from the stored capacity and the old working days. A base is kept while the stored capacity still equals what it gives for the member's current working days; otherwise (a number typed since, `cycle capacity --set`) it is ignored and a new one is made. When the days come back to the base's working days the capacity is the base itself and the base is dropped, so the file holds the number the user wrote. No scaled value is derived from another, so nothing drifts (8 -> 6 -> 9 with rounding, 5 -> 6 day by day, and 1 -> 0 -> 0 are gone), and the same days off and back are exact by construction. Checked over 3600 capacity and working-day pairs.
- A value is kept to 6 decimals (float noise only, never compounding) and is not rounded to a whole number, so it can be a decimal. Text shows two decimals at most; the JSON keeps the number.
- Storage: `capacity_base` in the Local sprint file and in the Linear entry of `.pmkit/capacity.yaml`: member to `[capacity, working days]`. It is left out when empty, so files without scaling are unchanged. A malformed entry is ignored on read.
- A member with no capacity is left alone (unknown stays unknown, never 0). All working days off gives 0, and the base brings the capacity back when the days return. With no working days and no base to scale from, the capacity stays and a warning names the member.
- Only the members this call changes are written, through `capacityPatch` and `capacityBasePatch` of `updateCycleCapacity` (merges that check only the keys they name, in Local and Linear; a `null` for a name that is no member is refused like a number). A stored key of a member who left the team is neither checked nor rewritten, and a change by someone else to another member is not overwritten.
- `cycle capacity --days-off` stays a plain write with no scaling (follow-up). The result gets `recomputed` and a note.

## 2. `cycle capacity current` and the Linear team check

- `cycle capacity current [--set ..] [--days-off ..]` resolves `current` with `tracker.currentCycle()`. No active sprint is `NOT_FOUND` with the next step `/pmkit:cycle:plan`. The read and the write both accept it.
- The Linear adapter validates members against the users of the scope team (`user.teams` holds team ids) instead of every non-app workspace user. A member outside the team is `INVALID_INPUT` with the team members as the next step. Local is unchanged.

## 3. One load report on the write path

PMK-220 already makes one tracker read. What remains is compute: the write path builds the report twice (before and after) and each build runs `proposeMoves`, whose result `team capacity` never shows. `buildLoadReport` gets a `proposals` option, off for `team capacity`. Output is unchanged, which the existing tests prove.

## Files

`scripts/lib/team-capacity.mjs` (new `recomputeCapacity`), `scripts/pmkit.mjs` (`runTeamCapacity`, `cycle capacity`, `buildLoadReport`), `scripts/lib/linear/cycle-ops.mjs`, `commands/team/capacity.md`, `commands/cycle/capacity.md` if present, README and `skills/pmkit/SKILL.md` where they describe these commands, `CHANGELOG.md`, tests.
