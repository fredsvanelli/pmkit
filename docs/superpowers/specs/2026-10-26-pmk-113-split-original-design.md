# PMK-113: keep the original of a split issue out of the closed sprint

## Problem

`/pmkit:cycle:close` offers three outcomes for an unfinished issue: move it to a planned sprint, move it back to the backlog, or split it. Step 7 of `commands/cycle/close.md` describes the split as two writes. `issues create` makes a new issue for the remaining work, and `issues update <id> --estimate <n>` lowers the estimate of the original. Nothing changes the original's status or sprint. It keeps its status, often `in_progress`, in a sprint whose state is now `closed`.

`/pmkit:cycle:plan` step 5 drafts the scope from `issues list --category todo,backlog --sprint none`. The original has a sprint, so the query never returns it again, and nothing else moves it. It stays open forever in a closed sprint. PMK-10 found this and wrote today's behavior into step 7 and into the `cycle-close` scenario (`assert.equal(original.sprint, '2026-10-12', 'the original stays in the closed sprint')`).

Acceptance criteria:

1. After a split in `/pmkit:cycle:close`, the original issue no longer stays open in the closed sprint.
2. `/pmkit:cycle:plan` can offer the remaining work of a split issue.

The open product question is what the original becomes after a split.

## Findings

- The split already lowers the original's estimate to the part delivered, and the new issue takes the rest (`cycle-close` scenario: 8 points become 5 on ISS-2X6D and 3 on the new issue). The command treats the original as the delivered part, but never says that it is delivered.
- `metrics velocity` (`scripts/lib/metrics.mjs`, `velocity`) counts, per closed sprint, the issues whose current sprint is that sprint, whose status is in the `done` category, and whose last move into `done` is on or before the sprint's `end`. `canceled` issues count for nothing. `/pmkit:cycle:plan` step 3 plans from this number.
- `issues create` gives the new issue `default_status`, which is `backlog` in the template and in every fixture, and no sprint. Plan's step 5 query already returns it. Criterion 2 fails today only in the sense that the original never comes back. The remaining work does come back, as the new issue.
- `issues move <id> done` (`moveToCategory`) picks the first status of the `done` category and appends one `move` event. It has no guard for open blockers or open sub-issues.
- `issues link <a> <b> --kind related` writes both issues (`relate` in `tracker.mjs`). The new issue's ID is known only after the real create, so the link cannot have a dry run. `/pmkit:issues:breakdown` step 8 has the same shape: its links run after the creates without a dry run, covered by the approval of the table that showed them. The scenario rules allow it (rule 5 matches a write to a call without `--dry-run` in the same step, and rule 9 asks for a dry run only when the write repeats one).
- `cycle add ... --to none` works on an issue of a closed sprint (the scenario does it after `cycle close`), so the CLI has every write the options below need. No option needs a CLI or tracker change.
- `/pmkit:cycle:plan` drafts only from `todo` and `backlog`. An `in_progress` issue sent back to the backlog with `--to none` is not offered either. That is a separate gap (see "Open questions").

## Options

A. **The original moves to `done`.** It stays in the closed sprint with the reduced estimate, as the delivered part. The new issue in the backlog takes the remaining work, with a `related` link to the original. Velocity counts the delivered part (ISS-2X6D adds 5 points to sprint 2026-10-12). History stays in one place: the original keeps its events, branch and PR, and the link points from each issue to the other. Plan offers the new issue with no change. The extra writes are one `issues move` with a dry run and one `issues link` without one, both inside the step 7 preview that already asks once. GitHub closes a partly delivered issue as completed and opens a follow-up, and Jira's split action keeps the original and creates a new issue for the rest. Only `cycle:close` changes.

B. **The original moves to `canceled`.** It leaves the open work, but velocity drops the delivered part, so the lowered estimate means nothing. The history says the work was abandoned when part of it shipped. The Local tracker has no "split" resolution, and adding one would change the category list, which every adapter and command reads. Plan offers the new issue. The extra write count equals A's.

C. **Carry over instead of split.** The original leaves the closed sprint (`cycle add <id> --to none`) and no new issue is created. That is the existing "move back to the backlog" option, so the split option disappears and with it the credit for partial work. An `in_progress` original is also not offered by plan's `todo,backlog` query, so criterion 2 needs a status move or a change to `cycle:plan`.

D. **Reverse split.** A new issue in the closed sprint, created and moved to `done`, takes the delivered part, and the original goes to the backlog or the next sprint with the remaining estimate. The original keeps its branch with the open work. It needs a create with `--sprint`, a move of the new issue whose ID is unknown before the create (no dry run), and a status move of the original out of `in_progress` so plan offers it. The delivered record has no history of its own.

E. **A plain `related` link with no status change.** It does not meet criterion 1.

| | A done | B canceled | C carry over | D reverse split |
| --- | --- | --- | --- | --- |
| Original open in the closed sprint | no | no | no (leaves it) | no (leaves it) |
| Velocity counts the delivered part | yes | no | no | yes |
| History and links | original keeps events, PR; link both ways | says abandoned | one issue, no split | delivered part has no history |
| What plan offers next | the new issue | the new issue | nothing until its status changes | nothing until its status changes |
| Extra writes in close | move with dry run, link | move with dry run, link | none (the split is gone) | create, move without dry run, status move |
| Commands changed | `cycle:close` | `cycle:close` | `cycle:close`, and `cycle:plan` or a status move | `cycle:close` |
| Deletes data | no | no | no | no |

## Decisões

| Decision | Reason |
| --- | --- |
| Choose option A: after a split, the original moves to `done` and stays in the closed sprint with its reduced estimate. | The split already lowers the estimate to the delivered part, so `done` states what the command meant. The sprint and velocity keep the delivered points, which is the reason to split instead of carrying over. Plan offers the remaining work as the new issue with no change. It deletes nothing and changes only `cycle:close`. |
| The original stays in the closed sprint (no `cycle add --to none`). | A done issue in a closed sprint is the normal end state, and velocity reads issues by their current sprint. Moving it out would drop the delivered points from the sprint it was delivered in. |
| Link the new issue to the original with `issues link <new id> <original id> --kind related`. | The issue asks for history between the two. `related` is the existing link kind that writes both issues. `blocks` would be wrong, because the original is done. |
| The link runs without a dry run, after the real create, covered by the step 7 approval. | The new ID exists only after the create. `/pmkit:issues:breakdown` step 8 does the same, and scenario rules 5 and 9 accept it. |
| Order of a split's writes in step 8: create, link, lower the estimate, move to `done`. | When the create fails, the original is untouched. When a later write fails, the step 8 rule (stop, list what ran and what did not) leaves a state the user can finish by hand. |
| No new confirmation point. The step 7 preview lists, per split, the new issue, the link, the reduced estimate and the move to `done`. | Step 7 already asks once for every write of the close, whatever `write_policy.confirm` says. A second question would ask twice for one bulk change. |
| A split is offered only for an issue with a delivered part. With nothing delivered, the command offers a move instead. | Option A marks the original `done`. Without a delivered part, that would claim work that did not ship. |
| No change to `commands/cycle/plan.md`. | Its step 5 query already returns the new issue, which has `default_status` (`backlog`) and no sprint. A test proves it (below). |
| No CLI or tracker change. | `issues move`, `issues link`, `issues update` and `issues create` cover every write. ADR-0003 holds. |
| Update `_inputs/retro.md` so the scenario's retro counts the split original as delivered. | The retro is the report a user reads after the run. Keeping "Delivered 1 of 3" next to a done ISS-2X6D would contradict the files. |
| No CHANGELOG entry. Suggested line for the release: "`/pmkit:cycle:close` moves the original of a split issue to done with its reduced estimate and links it to the new issue, so it no longer stays open in the closed sprint." | Earlier PMK specs leave the CHANGELOG to release time. |

## Command text changes

All in `commands/cycle/close.md`. `commands/cycle/plan.md` does not change.

**Step 6**, replace the sentence "A split means creating a new issue for the remaining work and reducing the estimate of the original." with:

> A split is for an issue with a delivered part. The original keeps the delivered part: its estimate drops to that part, it moves to `done`, and it stays in the closed sprint. A new issue in the backlog takes the remaining work, with a `related` link to the original.

**Step 7**, replace from "Then run `...issues update <id> --estimate <n> --dry-run --json` to reduce the estimate of the original." up to "because the create call sets no sprint." with:

> Then run `node "${CLAUDE_PLUGIN_ROOT}/scripts/pmkit.mjs" issues update <id> --estimate <n> --dry-run --json` to reduce the estimate of the original to the delivered part, and `node "${CLAUDE_PLUGIN_ROOT}/scripts/pmkit.mjs" issues move <id> done --dry-run --json` to mark it delivered. The original stays in the closed sprint as done, and the new issue goes to the backlog, because the create call sets no sprint. The preview names the `related` link of step 8 between the two.

The rest of step 7 stays (the `cycle close` dry run, one full preview, one question, declining changes nothing).

**Step 8**, replace with:

> 8. After the approval, run `node "${CLAUDE_PLUGIN_ROOT}/scripts/pmkit.mjs" cycle close <sprint id> --json`, then the same moves and splits without `--dry-run`. For each split, run the create first and note the new ID. Then run `node "${CLAUDE_PLUGIN_ROOT}/scripts/pmkit.mjs" issues link <new id> <original id> --kind related --json`, then the estimate update and the move to `done` of the original. The approval of step 7 covers the link, because the preview showed it. When one fails, stop, list what was done and what was not, and do not retry it.

**Confirmation points**, the step 7 bullet becomes:

> - Step 7: the decision per unfinished issue, then one full preview of the moves, the splits (the new issue, its link, the reduced estimate and the move of the original to `done`) and the close, always asked because it holds scope moves. Declining changes nothing.

**Output**, add after "the moves applied": "For each split, the new issue's ID and the original's delivered estimate. The delivered numbers count a split original as delivered, with its reduced estimate."

**If something is missing**, add:

> - A split of an issue with nothing delivered: offer a move to a planned sprint or to the backlog instead, because a split moves the original to `done`.

## Confirmation points and dry runs

The confirmation keys stay `Step 1`, `Step 7` and `Step 9`. The scenario's trace for a split becomes:

| Step | Call | Kind |
| --- | --- | --- |
| 7 | `issues create --title ... --dry-run` | dry run |
| 7 | `issues update ISS-2X6D --estimate 5 --dry-run` | dry run |
| 7 | `issues move ISS-2X6D done --dry-run` | dry run (new) |
| 7 | `cycle close 2026-10-12 --dry-run` | dry run |
| | `Step 7` | confirm |
| 8 | `cycle close 2026-10-12` | write |
| 7 | `cycle add ISS-4M2S ISS-5N1R --to none` | write |
| 7 | `issues create --title ...` | write, saved as `remaining` |
| 8 | `issues link <remaining id> ISS-2X6D --kind related` | write, no dry run (new) |
| 7 | `issues update ISS-2X6D --estimate 5` | write |
| 7 | `issues move ISS-2X6D done` | write (new) |

Rule 9 holds: every write follows the second `Step 7` confirm, and each write that repeats a dry run follows it. The link matches the step 8 call without `--dry-run` (rule 5), like the links of `/pmkit:issues:breakdown`.

## Scenario and golden changes

`scripts/__scenarios__/cycle-close.mjs`:

- Header comment: the split moves ISS-2X6D to `done` with 5 points in the closed sprint, and links the new issue to it.
- Add `const done = ['issues', 'move', 'ISS-2X6D', 'done']` and a link entry `{ step: '8', write: ({ remaining }) => ['issues', 'link', remaining.after.id, 'ISS-2X6D', '--kind', 'related'] }`, in the order of the table above. Add `{ step: '7', dryRun: done }` after the `shrink` dry run.
- `expect`:
  - replace the "stays in the closed sprint" check with `original.status === 'done'` and `original.sprint === '2026-10-12'`;
  - `original.related` includes the new ID, and `remaining.related` includes `ISS-2X6D`;
  - `remaining.status === 'backlog'` and `remaining.sprint === undefined`, the two facts plan's step 5 query reads;
  - criterion 1 directly: every ID in `saved.issues` (the sprint's issues from step 3) whose `sprint` is still `2026-10-12` has status `done` or `canceled`;
  - the retro regex becomes `/Delivered 2 of 3 planned issues/`.
- `_inputs/retro.md`: the numbers line becomes "Delivered 2 of 3 planned issues, 10 of 16 points. ISS-8C4W moved to done when its pull request merged, and ISS-2X6D moved to done with the 5 points it delivered." The carry-over line becomes "ISS-2X6D was split: its 5 delivered points are done, and its remaining 3 points are a new issue in the backlog, linked to it."
- Regenerate `cycle-close.after.txt` with `UPDATE_GOLDENS=1 node --test scripts/scenarios.test.mjs`. The expected diff: the new trace rows, a `move` event and `status: done` in ISS-2X6D, a `link` event and `related:` in both ISS-2X6D and the new issue, and the new retro text. Read `git diff scripts/__scenarios__/` before committing it.
- `cycle-plan.mjs` and its snapshot do not change. It runs on a fresh team fixture.
- `scripts/__goldens__/` does not change. No CLI output changes.

## Tests

1. Scenario (`scripts/scenarios.test.mjs`): the changes above. Rules 3 to 6 also check the new command text: `issues move` and `issues link --kind` exist, every call ends with `--json`, and both new calls are used by the scenario.
2. Criterion 2, in `scripts/cli.test.mjs`: "a split in cycle close leaves the remaining work for cycle plan". On the team fixture with `PMKIT_NOW=2026-10-23T12:00:00Z`, run the step 8 writes of the scenario (close, create, link, update, move). Then:
   - `issues list --category todo,backlog --sprint none --json`, the query of `commands/cycle/plan.md` step 5 (a comment says so), returns the new ID and not `ISS-2X6D`;
   - `cycle issues 2026-10-12 --json` lists `ISS-2X6D` in category `done`;
   - `metrics velocity --json` gives `{ id: '2026-10-12', points: 5, count: 1 }` for the closed sprint, so the delivered part counts. ISS-2X6D is the only one, because the test runs no `pr sync` and ISS-8C4W stays in `in_review`.
3. `npm test` passes. Test-first: write the scenario `expect` changes and the CLI test, see them fail on the old command text, then change `close.md` and the scenario steps.

## Acceptance criteria to design

| Criterion | Design part |
| --- | --- |
| 1. After a split, the original no longer stays open in the closed sprint | Step 7 dry run and step 8 write of `issues move <id> done`; the scenario `expect` that every issue still in the closed sprint is `done` or `canceled`; the CLI test's `cycle issues` check |
| 2. `/pmkit:cycle:plan` can offer the remaining work of a split issue | The new issue in `backlog` with no sprint, linked to the original; the CLI test that runs plan's step 5 query after a split; velocity counts the delivered part, so plan's step 3 sees it |

## Open questions

These are outside this issue, or they would change a command other than `cycle:close`. None deletes data.

1. **Unfinished `in_progress` issues sent to the backlog are not offered by plan.** `cycle add <id> --to none` keeps the status, and plan's step 5 reads only `todo,backlog`. ISS-5N1R in the scenario is one. The fix changes `commands/cycle/plan.md` step 5 to `--category todo,backlog,in_progress` (and the `cycle-plan` scenario's read), or adds an `issues move <id> todo` to the backlog moves of `cycle:close`. Suggest a new issue.
2. **Velocity misses a split closed after the sprint's end.** `velocity` counts a done issue only when its move to `done` is on or before the sprint's `end`. A close run on the Monday after a sprint that ended on Sunday writes the move after the end, so the delivered part is left out. `pr sync` in step 1 has the same gap today. The fix changes `scripts/lib/metrics.mjs` (for example, count moves up to the sprint's close event), which changes `metrics velocity` for `cycle:plan` and `report:status`. Suggest a new issue.
3. **Open blockers and sub-issues of the original.** The new issue copies type, priority, labels and parent, but not the original's open `blocked_by` links, so plan's step 5 may order it before its blocker (ISS-2X6D is blocked by ISS-5N1R). The original's open sub-issues (ISS-4M2S) keep a `done` parent. Copying open blockers means one more `issues link --kind blocks` per blocker in step 8.
4. **Unchecked acceptance criteria.** The original moves to `done` with its unchecked criteria. Carrying them into the new issue needs a `--criteria-file` built from them in step 7.

## Risks and non-goals

- A team whose `default_status` is `triage` gets the new issue in `triage`, and plan offers it only after triage. Every created issue works that way, and this issue does not change it.
- The step 7 preview cannot show the new ID in the link, because the create has not run. It shows "the new issue" and the original's ID, as `/pmkit:issues:breakdown` does.
- A split of an issue in `in_review` with an open PR marks it `done` before the merge. The new guard (split only with a delivered part) leaves that call to the user in the preview.
- No change to `cycle close` in the CLI, to the tracker, or to any command other than `cycle:close`.

## Left to the builder

- The exact wording of the preview rows for a split.
- Where the CLI test sits in `cli.test.mjs`, next to "cycle close prints the unfinished issues".
