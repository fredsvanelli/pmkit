# PMK-165: treat canceled issues the same way in cycle close and closeCycle

## Root cause

Found in PMK-121 and PMK-122.

1. `/pmkit:cycle:close` step 3 says "the issues in `done` are delivered, and the rest are unfinished", so a `canceled` issue of the sprint is unfinished: step 4 counts it as carry-over and step 6 proposes a move or a split for it. The contract's `closeCycle` (Local `closeCycle` in `scripts/lib/local/tracker.mjs`) returns `unfinished` without the terminal categories (`done` and `canceled`), and velocity (`metrics.mjs`) never counts a canceled issue. The command file and the operation it ends with disagree on the same sprint.
2. Step 6 asks "whether that issue is the remaining work of an earlier split" without naming `AskUserQuestion`, while steps 1 and 7 name it. An agent may ask in prose and go on without the answer.

## Goal

The command file reads a canceled issue as `closeCycle` does, neither delivered nor unfinished, and step 6's question names `AskUserQuestion`.

## Approaches

1. **Three canceled-aware sentences and the tool name (chosen).** Step 3: the issues in `done` are delivered, those in `canceled` are left out (no decision, no carry-over, as `cycle close` leaves them out of `unfinished`), the rest are unfinished. Step 4: carry-over is the unfinished issues, and the report lists the canceled ones apart by count. Step 6: "Ask with `AskUserQuestion` whether ...".
2. Have `closeCycle` return canceled issues as unfinished. It would change velocity's neighbours and every tracker's `closeCycle` for a reading that makes a canceled issue need a decision it cannot use: moving it to the next sprint carries dead work forward.

## Design

- `commands/cycle/close.md` step 3, step 4 (the carry-over bullet and a `Canceled` count in the report), step 6 (the question).
- `scripts/scenarios.test.mjs`: static tests that step 3 leaves `canceled` out of the unfinished issues and that step 6's question names `AskUserQuestion`.
- `scripts/__scenarios__/cycle-close.mjs`: setup adds an issue to the active sprint and cancels it; `expect` checks that it is not in the closed sprint's `unfinished`, keeps its sprint and status, and that no `cycle add` names it. The snapshot changes for the new issue (`UPDATE_GOLDENS=1`).
- CHANGELOG.

## Interview

- Does a canceled issue count in "planned"? Planned is the sprint's issues at its start, whatever their status later; a canceled one stays in planned and is listed apart, so delivered against planned shows the gap honestly.
- Do the trackers agree on canceled? Local `closeCycle` filters `TERMINAL` (`done`, `canceled`); Linear and GitHub do not close cycles (`NOT_SUPPORTED`); the command reads `cycle issues` for its report on all three.
- New terms or ADRs: none.
- Approval: the issue names both gaps; the rule follows `closeCycle`. pmkit PO approves.
