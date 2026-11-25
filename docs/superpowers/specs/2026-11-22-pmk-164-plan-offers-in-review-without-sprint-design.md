# PMK-164: offer in-review issues sent back to no sprint in cycle plan

## Root cause

Found in PMK-122 (its follow-up 1). `/pmkit:cycle:close` sends any unfinished issue back with `cycle add --to none`, which keeps its status, so an `in_review` issue can end up with no sprint. `/pmkit:cycle:plan` step 5 drafts the scope from `issues list --category todo,backlog,in_progress --sprint none`, so it never offers that issue again: it waits for review with no sprint, and nothing plans it. PMK-122 left `in_review` out on purpose as a separate decision, and its static test says it must change when this follow-up lands. `/pmkit:cycle:close` step 6 says plan offers a sent-back issue "when its status category is `todo`, `backlog` or `in_progress`".

## Goal

Plan's step 5 offers a sprintless `in_review` issue like the other open categories, and close's step 6 says so.

## Approaches

1. **Add `in_review` to step 5's two `issues list` calls (chosen).** The review still needs someone's time in the next sprint (the reviewer's, and the author's fixes), so it belongs in the draft, shown with its status (step 8's preview has a status column since PMK-122).
2. Have close move an `in_review` issue to the next sprint by default instead of to no sprint. It changes close's proposal and still leaves a sprintless `in_review` issue unplanned when the user picks the backlog.
3. Leave it out and say so in close step 6. The issue asks for the issue to be offered.

## Design

- `commands/cycle/plan.md` step 5: both calls read `--category todo,backlog,in_progress,in_review --sprint none` (the plain one and the `--blocked` one).
- `commands/cycle/close.md` step 6: plan offers it again when its status category is `todo`, `backlog`, `in_progress` or `in_review`.
- `scripts/scenarios.test.mjs`: the PMK-122 static test moves `in_review` from the left-out list to the read list, and its name says so.
- `scripts/__scenarios__/cycle-plan.mjs`: setup creates `Review the retry policy` (estimate 2) with no sprint and moves it to `in_review`; the step 5 calls take the new category; `expect` checks that the scope lists it last (creation order) and that it lands in the new sprint. The snapshot changes (`UPDATE_GOLDENS=1`).
- CHANGELOG.

## Interview

- Does a blocker in `in_review` count as open? Yes, as before: open means not in `done` or `canceled`; a sprintless `in_review` blocker in the first list can now be selected, which is what close's moves aim for.
- Does capacity count an `in_review` issue's estimate? Yes, as for an `in_progress` one: the estimate is the issue's, and the preview shows its status, so the user can drop it.
- Other readers of the same filter: `/pmkit:issues:mine` and `/pmkit:backlog:groom` have their own filters; unchanged.
- New terms or ADRs: none.
- Approval: the issue states the change; PMK-122 left it as this follow-up. pmkit PO approves.
