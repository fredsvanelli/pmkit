# PMK-152: decide what `none` and an unknown sprint do in the contract

## Problem

Found in PMK-115. The contract does not say what a sprint value of `none` or an ID no sprint has does in `createIssue`, `updateIssue` and `moveToCycle`. The trackers disagree today:

| | create/update, unknown ID | create/update, `none` | moveToCycle, unknown ID | moveToCycle, `none` |
|---|---|---|---|---|
| Local | `INVALID_INPUT` | `INVALID_INPUT` | `NOT_FOUND` | `NOT_FOUND` |
| Linear | `NOT_FOUND` | `NOT_FOUND` | `NOT_FOUND` | `NOT_FOUND` |
| GitHub | `INVALID_INPUT` | `INVALID_INPUT` | `NOT_FOUND` | `NOT_FOUND` |

The CLI maps `--sprint none` and `--to none` to `null` before it calls the tracker, so a command never sends `none`; a caller of the contract can.

## Decision

1. **An unknown sprint ID in a write is `INVALID_INPUT`, next step `pmkit cycle list`, on every tracker.** It is the rule PMK-153 set for the search filter: a sprint that is a *value* of the operation (a field, a filter, the target of a move) and names no sprint is invalid input; a sprint that is the *subject* (`cycleIssues`, `closeCycle`, `getCapacity`) is `NOT_FOUND`. In `moveToCycle(ids, sprint)` the issues are the subject and the sprint is where they go.
2. **`none` is not a sprint value in a write.** No sprint is `null`, as `updateIssue(id, { sprint: null })` and `moveToCycle(ids, null)` already take. The string `none` is an unknown sprint ID, so rule 1 refuses it. `none` stays an alias in the search filter only, where `null` cannot mean "no sprint" because a filter key left out or `null` means "any sprint".

## Approaches

1. **Rules 1 and 2 (chosen).** One code for every "this sprint does not exist" a caller can fix by changing its input, and no new alias: the CLI already maps `none`.
2. `none` as an alias of `null` in writes too. Symmetric with the filter, but each adapter gains a branch the CLI never reaches, for a caller that can pass `null`.
3. `NOT_FOUND` everywhere. It matches Linear today, but then the same typo is `INVALID_INPUT` in a search (PMK-153) and `NOT_FOUND` in a write, and `/pmkit:issues:bulk` already reads a sprint that does not exist as `INVALID_INPUT`.

## Design

- Local (`scripts/lib/local/tracker.mjs`): `moveToCycle` resolves its target with `requireSprint` (`current`, an existing ID, else `INVALID_INPUT`), as `createIssue` and `updateIssue` do; `null` stays no sprint.
- Linear (`scripts/lib/linear/issue-ops.mjs`): `cycleNodeFor` answers `INVALID_INPUT` (`unknownSprint`, from PMK-153) for a malformed or unknown cycle, so `createIssue`, `updateIssue` and `moveToCycle` agree. The search check of PMK-153 then needs no translation of `NOT_FOUND`.
- GitHub (`scripts/lib/github/cycle-ops.mjs`): `moveTarget` answers `INVALID_INPUT` for a date no iteration has. Create and update already refuse with `INVALID_INPUT`.
- Contract suite, `cycles` family: `a sprint value no sprint has, or none, fails with INVALID_INPUT in createIssue, updateIssue and moveToCycle and writes nothing`, with `unknownSprintLike` from PMK-153 and `none`.
- Design spec, Contract: the Cycles row and the paragraph under the table state rules 1 and 2.
- `commands/issues/bulk.md`: the `NOT_FOUND` bullet drops "a sprint" from what a value can name, since it is now `INVALID_INPUT`, which the bullet above already lists.
- CHANGELOG.

## Interview

- Does a command read `NOT_FOUND` from `cycle add`? `bulk.md` only, fixed above. `team capacity` and `team load` read `NOT_FOUND` for a sprint they report on, the subject; unchanged.
- GitHub's unknown date in create and update is `stale` so the discovery refreshes once; the move reads the iterations fresh (`readSprints`), so it needs no stale hint.
- Closed sprints as a target stay as they are here; PMK-166 decides that.
- New terms: none. ADR: the subject/value rule is easy to change and is stated in the design spec, so no ADR.
- Approval: the issue asks for one rule per case and names where it goes; no product question remains open. pmkit PO approves.
