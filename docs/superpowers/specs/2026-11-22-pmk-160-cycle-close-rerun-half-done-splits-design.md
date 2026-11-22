# PMK-160: let a cycle close rerun find and finish every half-done split

## Root cause

Found in PMK-121 and PMK-123. `/pmkit:cycle:close` step 8 writes a split in this order: create the new issue, `related` link, blocker links, sub-issue moves, estimate update of the original, move of the original to `done` (last, so a second run finds the split while the original is still unfinished). A failure stops the command, and a second run is the way to finish. Two failures leave a split a second run cannot finish:

1. **The create ran, the `related` link did not.** Step 6 finds a half-done split only through the original's `related` list: "For each unfinished issue whose `related` list in the step 3 read names an issue that is not in that read". Nothing else ties the new issue to its original, so the rerun offers a fresh split, and its create makes a second remaining-work issue. Step 8 only tells the user to run the link by hand first.
2. **The estimate update ran, the move to `done` did not.** The original's estimate is already the delivered part. The rerun's step 7 asks for the delivered part again, and step 6's rule "the split runs only when that number is greater than 0 and lower than the original's estimate" refuses the same number, so the split cannot finish.

## Goal

After any failed write of a split, a second run of `/pmkit:cycle:close` finds the split and finishes it with the writes that did not run, and makes no second remaining-work issue.

## Approaches

For 1:

1. **The create carries its origin (chosen).** Step 7 writes a description file for the new issue, `Remaining work of <original id>, split when sprint <sprint id> closed.`, and the create passes `--description-file`. Step 6 runs one search, `issues list --text "split when sprint <sprint id> closed" --json`, and a hit whose description names an unfinished issue of the sprint is that issue's remaining work, linked or not. One write (the create) carries the mark, so no later failure can lose it. Text search covers the description on Local, Linear and GitHub.
2. Create with the `related` link in the same call. `issues create` has no `--related` flag, and adding one to every tracker's `createIssue` is a contract change for this one recovery.
3. A label on the new issue. Labels are configured per project, and setup may not have one to spare.

For 2:

1. **Finishing a split skips the estimate update when the estimate already is the delivered part (chosen).** When step 6 found an earlier split, step 7 shows the original's current estimate and the remaining-work issue's estimate, and asks for the delivered part with the current estimate as the default; the bound is greater than 0 and not above the current estimate. Step 8 runs the estimate update only when the number differs.
2. Move the original to `done` before the estimate update. Then a failure of the update leaves a `done` original that step 6 no longer looks at, which is the order step 8 avoids on purpose.

## Design

- `commands/cycle/close.md` step 6: the earlier-split search, in two parts. The `related` lookup stays. Before it, run `issues list --text "split when sprint <sprint id> closed" --json` once; each hit whose description starts `Remaining work of <id>` with `<id>` an unfinished issue of the sprint is a candidate for that issue, even with no `related` link. Then the question with `AskUserQuestion` as today.
- Step 6: the split bound applies to a new split; finishing an earlier split takes a delivered part greater than 0 and not above the current estimate.
- Step 7: write the description file with the marker line, one per split, kept until step 10, and add `--description-file <file>` to the create dry run. For a split to finish, the `related` link is in the preview when the step 3 read of the original does not list the new issue; the estimate update dry run runs only when the delivered part differs from the current estimate.
- Step 8: for a split to finish, run the `related` link when it is missing, then the blocker links, the sub-issue moves, the estimate update when step 7 kept it, then the move to `done`. The sentence that told the user to run the link by hand before a rerun goes: the rerun finds the split by its marker.
- `scripts/scenarios.test.mjs`: static tests that the create passes the marker `--description-file`, that step 6 searches for the marker, and that the estimate update of a split to finish is conditional.
- `scripts/__scenarios__/cycle-close.mjs`: a third scenario, `finishHalfDoneSplit`. Setup leaves the worst half-done split: ISS-2X6D's estimate already dropped to 5, and a remaining-work issue created with the marker description, no `related` link, no blocker link, no sub-issue move. The rerun finds it through the search, the user says it is the remaining work and gives 5, and step 8 runs the `related` link, the blocker link, the sub-issue move and the move to `done`, with no second create and no estimate update. The first scenario's create gains `--description-file`, and its snapshot changes.
- CHANGELOG.

## Interview

- Can the marker match an unrelated issue? It names the sprint ID and the original's ID; a hit is used only when its `<id>` is an unfinished issue of this sprint, and the user confirms it with the same question as today.
- A split made by a pmkit before this change has no marker: the `related` lookup still finds it when its link ran; when it did not, the rerun offers a fresh split as before, and the CHANGELOG says so.
- New terms or ADRs: none ("Split" is a step of close, not a domain term in `CONTEXT.md`).
- Approval: the issue names both failures; the fixes stay inside the command file and use existing CLI flags. pmkit PO approves.
