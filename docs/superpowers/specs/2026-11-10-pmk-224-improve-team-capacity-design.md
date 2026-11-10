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

The only formula in the repo is `commands/cycle/plan.md` step 4: capacity = rate x availability x working days, rounded to a whole number. It is linear in the working days, so the CLI does not need the velocity: a member's new capacity is `old x newWorkingDays / oldWorkingDays`, kept to 9 decimals and not rounded to a whole number. **(builder's call, changed after review)**

- Applies in `team capacity` when `--days-off` changes the working days of a member whose capacity is set and who `--set` does not name. `--set member=n` always wins, so `--set member=<old>` keeps the number.
- A member with no capacity is left alone (unknown stays unknown, never 0).
- `oldWorkingDays` 0 cannot scale: the capacity stays and a warning names the member. A new working-days count of 0 gives capacity 0.
- The recomputed value goes through the same single `updateCycleCapacity` call as the rest, so the batch is atomic. `changes` already shows it as capacity before and after. The result gets `recomputed`: `[{ member, workingDays: {before, after}, capacity: {before, after} }]`, and a note says the capacity was scaled by working days and how to keep the number.
- No rounding to a whole number: rounding from the stored value drifted (8 -> 6 -> 9) and trapped a small capacity at 0 (1 -> 0 -> 0). The unrounded value goes back to the original when the same days come back. The text shows two decimals at most; the JSON keeps the number.
- Only the members whose capacity changes are written, through `capacityPatch` (new key of `updateCycleCapacity`, a merge that checks only the keys it names, in Local and Linear). `--set` uses it too, so a stored key of a member who left the team is neither checked nor rewritten, and a change made by someone else to another member is not overwritten.

## 2. `cycle capacity current` and the Linear team check

- `cycle capacity current [--set ..] [--days-off ..]` resolves `current` with `tracker.currentCycle()`. No active sprint is `NOT_FOUND` with the next step `/pmkit:cycle:plan`. The read and the write both accept it.
- The Linear adapter validates members against the users of the scope team (`user.teams` holds team ids) instead of every non-app workspace user. A member outside the team is `INVALID_INPUT` with the team members as the next step. Local is unchanged.

## 3. One load report on the write path

PMK-220 already makes one tracker read. What remains is compute: the write path builds the report twice (before and after) and each build runs `proposeMoves`, whose result `team capacity` never shows. `buildLoadReport` gets a `proposals` option, off for `team capacity`. Output is unchanged, which the existing tests prove.

## Files

`scripts/lib/team-capacity.mjs` (new `recomputeCapacity`), `scripts/pmkit.mjs` (`runTeamCapacity`, `cycle capacity`, `buildLoadReport`), `scripts/lib/linear/cycle-ops.mjs`, `commands/team/capacity.md`, `commands/cycle/capacity.md` if present, README and `skills/pmkit/SKILL.md` where they describe these commands, `CHANGELOG.md`, tests.
