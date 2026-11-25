# PMK-162: cover a blocker already in the planned sprint in the cycle-plan scenario

## Problem

Found in PMK-123. `/pmkit:cycle:plan` step 5 counts a blocker as selected "when step 1 chose an existing `planned` sprint and the blocker's `sprint` is that sprint's ID, for example because `/pmkit:cycle:close` moved it there". Only the static test `cycle/plan step 5 counts a blocker already in the planned sprint as selected` pins that sentence. The one cycle-plan scenario runs on the team fixture, which has no planned sprint, so step 1 never asks and the rule never runs.

## Goal

A scenario runs the rule: an existing planned sprint, chosen in step 1, holds an open blocker, and the issue it blocks stays in the scope and lands in that sprint.

## Approaches

1. **A second scenario in `scripts/__scenarios__/cycle-plan.mjs` (chosen).** Its setup creates the planned sprint with the CLI (`cycle open --start 2026-10-26 --end 2026-11-08`, planned because a sprint is active), sends ISS-5N1R and ISS-4M2S back to no sprint as a close would, links ISS-5N1R to block ISS-6J0B, and moves ISS-5N1R into the planned sprint. Step 1 asks and the user plans that sprint; step 5 reads ISS-5N1R (not in the list, since it has a sprint), finds it in the chosen sprint and keeps ISS-6J0B; step 7 sets the capacity of the existing sprint without `cycle open`; steps 8 and 9 add the scope to it.
2. A new fixture with a planned sprint. Every golden of every command would gain a fixture run for one rule.

## Design

- `cycle-plan.mjs` exports `[scenario0, scenario1]`; scenario 0 stays as it is. Scenario 1 confirms `Step 1`, `Step 6` and `Step 8`, uses no `cycle open` (its sibling does, rule 6 per command file since PMK-355), and its `expect` checks that `ISS-6J0B` is in the scope and not left out, that the blocker read gave `sprint: 2026-10-26` with an open status, and that `ISS-6J0B` ends in `2026-10-26` next to `ISS-5N1R`.
- Snapshots: `cycle-plan.after.txt` becomes `cycle-plan.0.after.txt`, and `cycle-plan.1.after.txt` is new.
- A mutation check: with the step 5 sentence removed from `plan.md`, the static test fails; with scenario 1's `expect` reversed (ISS-6J0B left out), the scenario fails. The scenario itself checks the CLI facts the rule reads.
- CHANGELOG.

## Interview

- Does the harness let a scenario skip step 7's `cycle open`? Yes since PMK-355: a call a sibling scenario uses counts as used.
- Is `2026-10-26` planned? The active sprint `2026-10-12` ends on 2026-10-25, so a sprint opened on 2026-10-26 is planned (`openCycle` makes it active only when no sprint is active).
- New terms or ADRs: none.
- Approval: the issue asks for a scenario or a fixture; a scenario is the smaller one. pmkit PO approves.
