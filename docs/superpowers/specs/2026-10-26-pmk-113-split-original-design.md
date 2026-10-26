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
- `metrics velocity` (`scripts/lib/metrics.mjs`, `velocity`) counts, per closed sprint, the issues whose current sprint is that sprint, whose status is in the `done` category, and whose last move into `done` is on or before the sprint's `end` (`doneAt.slice(0, 10) <= sprint.end`, so the UTC date of the move). `canceled` issues count for nothing. `/pmkit:cycle:plan` step 3 plans from this number.
- `issues create` gives the new issue `default_status`, which is `backlog` in the template and in every fixture, and no sprint. Plan's step 5 query already returns it. Criterion 2 fails today only in the sense that the original never comes back. The remaining work does come back, as the new issue.
- `issues move <id> done` (`moveToCategory`) picks the first status of the `done` category and appends one `move` event. It has no guard for open blockers or open sub-issues.
- `issues link <a> <b> --kind related` writes both issues (`relate` in `tracker.mjs`). The new issue's ID is known only after the real create, so the link cannot have a dry run. `/pmkit:issues:breakdown` step 8 has the same shape: its links run after the creates without a dry run, covered by the approval of the table that showed them.
- `cycle issues <id> --json` returns, per issue, `status` (name and category), `estimate`, `blockedBy`, `children` and `acceptanceCriteria` (`{ text, done }`). It lists the issues whose current sprint is `<id>`, so a read after the backlog moves no longer lists them.
- `cycle add ... --to none` works on an issue of a closed sprint (the scenario does it after `cycle close`), so the CLI has every write the options below need. No option needs a CLI or tracker change.
- `/pmkit:cycle:plan` drafts only from `todo` and `backlog`. An `in_progress` issue sent back to the backlog with `--to none` is not offered either. That is a separate gap (see "Follow-up candidates").

The review checked the sequence on a copy of the team fixture. With `PMKIT_NOW=2026-10-23T12:00:00Z`, plan's step 5 query returns the new issue and not ISS-2X6D, and `metrics velocity` gives `{ id: '2026-10-12', points: 5, count: 1 }`. With `PMKIT_NOW=2026-10-26T12:00:00Z`, the Monday after the sprint's `end` of 2026-10-25, the same sequence gives `{ id: '2026-10-12', points: 0, count: 0 }`.

## Options

A. **The original moves to `done`.** It stays in the closed sprint with the reduced estimate, as the delivered part. The new issue in the backlog takes the remaining work, with a `related` link to the original. Velocity counts the delivered part only when the close runs on or before the sprint's `end`, by the UTC date of the move: ISS-2X6D then adds 5 points to sprint 2026-10-12. A close after the end writes the move after the end, and velocity counts 0 for the original, the same gap `pr sync` in step 1 already has. History stays in one place: the original keeps its events, branch and PR, and the link points from each issue to the other. Plan offers the new issue with no change. The extra writes are one `issues move` with a dry run and one `issues link` without one, both inside the step 7 preview that already asks once. GitHub closes a partly delivered issue as completed and opens a follow-up, and Jira's split action keeps the original and creates a new issue for the rest. Only `cycle:close` changes.

B. **The original moves to `canceled`.** It leaves the open work, but velocity drops the delivered part, so the lowered estimate means nothing. The history says the work was abandoned when part of it shipped. The Local tracker has no "split" resolution, and adding one would change the category list, which every adapter and command reads. Plan offers the new issue. The extra write count equals A's.

C. **Carry over instead of split.** The original leaves the closed sprint (`cycle add <id> --to none`) and no new issue is created. That is the existing "move back to the backlog" option, so the split option disappears and with it the credit for partial work. An `in_progress` original is also not offered by plan's `todo,backlog` query, so criterion 2 needs a status move or a change to `cycle:plan`.

D. **Reverse split.** A new issue in the closed sprint, created and moved to `done`, takes the delivered part, and the original goes to the backlog or the next sprint with the remaining estimate. The original keeps its branch with the open work. It needs a create with `--sprint`, a move of the new issue whose ID is unknown before the create (no dry run), and a status move of the original out of `in_progress` so plan offers it. The delivered record has no history of its own. Its move to `done` also runs in step 8, so a late close gives it 0 velocity, as in A.

E. **A plain `related` link with no status change.** It does not meet criterion 1.

| | A done | B canceled | C carry over | D reverse split |
| --- | --- | --- | --- | --- |
| Original open in the closed sprint | no | no | no (leaves it) | no (leaves it) |
| Velocity counts the delivered part | yes when the close runs on or before the sprint's `end` (the UTC date of the move); after it, no option counts it, which is the gap `pr sync` already has in step 1 | no | no | same condition as A |
| Status says what happened | delivered | abandoned | unfinished, no split | delivered, on a new issue |
| History and links | original keeps events, PR; link both ways | says abandoned | one issue, no split | delivered part has no history |
| What plan offers next | the new issue | the new issue | nothing until its status changes | nothing until its status changes |
| Extra writes in close | move with dry run, link | move with dry run, link | none (the split is gone) | create, move without dry run, status move |
| Commands changed | `cycle:close` | `cycle:close` | `cycle:close`, and `cycle:plan` or a status move | `cycle:close` |
| Deletes data | no | no | no | no |

## Decisões

| Decision | Reason |
| --- | --- |
| Choose option A: after a split, the original moves to `done` and stays in the closed sprint with its reduced estimate. | The split already lowers the estimate to the delivered part, so `done` states what the command meant, and B says the work was abandoned. The original keeps its events, branch and PR. Plan offers the remaining work as the new issue with no change to `cycle:plan`, which C and D need. It deletes nothing and changes only `cycle:close`. Velocity is a conditional gain: it counts the delivered points only when the close runs on or before the sprint's `end`. With a late close, B, C and D also count 0, so A still wins on the other rows. |
| State the velocity benefit as conditional, and leave the late-close gap to a follow-up. | `velocity` compares the UTC date of the last move into `done` with the sprint's `end`, and the move runs in step 8. Fixing it changes `scripts/lib/metrics.mjs`, which `cycle:plan` and `report:status` also read, so it is outside this issue. `pr sync` in step 1 has the same gap today. |
| The original stays in the closed sprint (no `cycle add --to none`). | A done issue in a closed sprint is the normal end state, and velocity reads issues by their current sprint. Moving it out would drop the delivered points from the sprint it was delivered in. |
| Link the new issue to the original with `issues link <new id> <original id> --kind related`. | The issue asks for history between the two. `related` is the existing link kind that writes both issues. `blocks` would be wrong, because the original is done. |
| The link runs without a dry run, after the real create, covered by the step 7 approval. | The new ID exists only after the create. It passes the PMK-10 rules: rule 5 matches the write to the step 8 call without `--dry-run`, and rule 9 asks for a matching dry run only when the write matched one. The live suite asks for a dry run only after a dry run of the same CLI command, and close runs none for `issues link`. Rule 5 of the PMK-10 spec lists these exceptions per command ("the links of `/pmkit:issues:breakdown` and `/pmkit:spec:import`"). The close link is the same exception, so `cycle:close` joins that list. |
| Order of a split's writes in step 8: create, link, lower the estimate, move to `done`. | When the create fails, the original is untouched. When a later write fails, the step 8 rule (stop, list what ran and what did not) leaves a state the user can finish by hand. |
| No new confirmation point. The step 7 preview lists, per split, the new issue, the link, the reduced estimate, the move to `done`, and what stays on the original. | Step 7 already asks once for every write of the close, whatever `write_policy.confirm` says. A second question would ask twice for one bulk change. |
| A split runs only when the user gives the delivered part as an estimate greater than 0 and lower than the original's estimate. An original with no estimate gets no split offer: the command offers the move to a planned sprint or to the backlog, the other choices step 6 has today. | Option A marks the original `done`, so a delivered part of 0 would claim work that did not ship, and a delivered part equal to the estimate is not a split. Without an estimate, the command has no number to lower, and inventing two estimates is a guess. The two move choices and the "close and plan afterward" fallback of "If something is missing" do not change. |
| After step 8's writes, read `cycle issues <sprint id> --json` again. The delivered numbers of the Output and of the retro come from that read. | The step 7 report runs before any write and shows the original as unfinished. A sum the agent keeps in its head from the step 7 decisions can drift from the files. Reading through the CLI follows ADR-0002. Planned stays the step 4 number, because it describes the sprint at its start. |
| The step 7 preview of a split lists the original's open blockers, open sub-issues and unchecked acceptance criteria. Copying them to the new issue is out of scope. | They stay on a `done` issue, where nothing acts on them, so the user should see them before approving. Step 3's `cycle issues` read already returns them, so no new call is needed. Copying the blocker would make plan's step 5 skip the new issue ("Skip an issue whose blocker is not done and not in the selection"), because ISS-5N1R is an `in_progress` issue that plan does not offer, and that would break criterion 2. |
| The failing-first test is the `cycle-close` scenario. The CLI test is a regression guard that passes before the fix. | The CLI test calls the CLI directly, and every call it makes exists today, so it cannot fail on the old command text. The scenario reads `close.md`, so its new entries and `expect` fail until the text changes. |
| No change to `commands/cycle/plan.md`. | Its step 5 query already returns the new issue, which has `default_status` (`backlog`) and no sprint. The CLI test guards it (below). |
| No CLI or tracker change. | `issues move`, `issues link`, `issues update`, `issues create` and `cycle issues` cover every call. ADR-0003 holds. |
| Update `_inputs/retro.md` so the scenario's retro counts the split original as delivered. | The retro is the report a user reads after the run. Keeping "Delivered 1 of 3" next to a done ISS-2X6D would contradict the files. |
| No CHANGELOG entry. Suggested line for the release: "`/pmkit:cycle:close` moves the original of a split issue to done with its reduced estimate and links it to the new issue, so it no longer stays open in the closed sprint." | Earlier PMK specs leave the CHANGELOG to release time. |

## Command text changes

All in `commands/cycle/close.md`. `commands/cycle/plan.md` does not change.

**Step 6**, replace the sentence "A split means creating a new issue for the remaining work and reducing the estimate of the original." with:

> A split is for an issue with an estimate and a delivered part. Ask for the delivered part as an estimate. The split runs only when that number is greater than 0 and lower than the original's estimate. The original keeps the delivered part: its estimate drops to that number, it moves to `done`, and it stays in the closed sprint. A new issue in the backlog takes the remaining work, with a `related` link to the original. Do not offer a split for an issue with no estimate, and say so. When the user gives 0, or a number not lower than the original's estimate, say why no split runs and offer the two moves.

**Step 7**, after "Show the sprint report with the numbers and the proposal", add:

> The report's delivered numbers are those of steps 3 and 4, before any write. Step 8 reads them again after the writes.

Then replace from "Then run `...issues update <id> --estimate <n> --dry-run --json` to reduce the estimate of the original." up to "because the create call sets no sprint." with:

> Then run `node "${CLAUDE_PLUGIN_ROOT}/scripts/pmkit.mjs" issues update <id> --estimate <n> --dry-run --json` to reduce the estimate of the original to the delivered part, and `node "${CLAUDE_PLUGIN_ROOT}/scripts/pmkit.mjs" issues move <id> done --dry-run --json` to mark it delivered. The original stays in the closed sprint as done, and the new issue goes to the backlog, because the create call sets no sprint. The preview names the `related` link of step 8 between the two. It also lists what stays on the original once it is done, from the step 3 read: the IDs in its `blockedBy` and `children` whose status category is not `done`, and its acceptance criteria with `done: false`. A blocker or sub-issue outside the sprint is not in that read, so list its ID and say its status was not read. The close does not move or copy them.

The rest of step 7 stays (the `cycle close` dry run, one full preview, one question, declining changes nothing).

**Step 8**, replace with:

> 8. After the approval, run `node "${CLAUDE_PLUGIN_ROOT}/scripts/pmkit.mjs" cycle close <sprint id> --json`, then the same moves and splits without `--dry-run`. For each split, run the create first and note the new ID. Then run `node "${CLAUDE_PLUGIN_ROOT}/scripts/pmkit.mjs" issues link <new id> <original id> --kind related --json`, then the estimate update and the move to `done` of the original. The approval of step 7 covers the link, because the preview showed it. When one fails, stop, list what was done and what was not, and do not retry it. After the last write, run `node "${CLAUDE_PLUGIN_ROOT}/scripts/pmkit.mjs" cycle issues <sprint id> --json` again. Delivered is the issues of this read whose status category is `done`: their count, and the sum of their `estimate`. Throughput is the same count. Planned stays the step 4 number, with the estimates of the step 3 read. Scope added and removed and cycle time keep the numbers of steps 4 and 5. Carry-over keeps the step 4 list, with the decision applied to each unfinished issue and the new ID of each split.

**Step 9**, the first sentence becomes "Offer a retro document. Draft it from the numbers of step 8 and the retro prompts (what slipped and why, based on the data)."

**Confirmation points**, the step 7 bullet becomes:

> - Step 7: the decision per unfinished issue, then one full preview of the moves, the splits (the new issue, its link, the reduced estimate, the move of the original to `done`, and the open blockers, sub-issues and criteria that stay on it) and the close, always asked because it holds scope moves. Declining changes nothing.

**Output**, add at the start: "The delivered numbers and throughput come from the `cycle issues` read of step 8, after the writes." Add after "the moves applied": "For each split, the new issue's ID and the original's delivered estimate."

**If something is missing**, add:

> - A split of an issue with no estimate, or with a delivered part of 0 or not lower than its estimate: offer a move to a planned sprint or to the backlog instead, because a split moves the original to `done` with a lower estimate.

The "No planned sprint" bullet stays. Its "or a split" applies only to an issue a split is allowed for.

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
| 8 | `cycle issues 2026-10-12` | read, saved as `after` (new) |

Rule 9 holds: every write follows the second `Step 7` confirm, and each write that repeats a dry run follows it. The link matches the step 8 call without `--dry-run` (rule 5), like the links of `/pmkit:issues:breakdown`. The step 8 read matches the new `cycle issues` call of step 8.

## Scenario and golden changes

`scripts/__scenarios__/cycle-close.mjs`:

- Header comment: the split moves ISS-2X6D to `done` with 5 points in the closed sprint, and links the new issue to it. Step 8 reads the sprint's issues again for the delivered numbers.
- Add `const done = ['issues', 'move', 'ISS-2X6D', 'done']`, a link entry `{ step: '8', write: ({ remaining }) => ['issues', 'link', remaining.after.id, 'ISS-2X6D', '--kind', 'related'] }` and `{ step: '8', read: ['cycle', 'issues', '2026-10-12'], save: 'after' }`, in the order of the table above. Add `{ step: '7', dryRun: done }` after the `shrink` dry run.
- `expect`:
  - replace the "stays in the closed sprint" check with `original.status === 'done'` and `original.sprint === '2026-10-12'`;
  - `original.related` includes the new ID, and `remaining.related` includes `ISS-2X6D`;
  - `remaining.status === 'backlog'` and `remaining.sprint === undefined`, the two facts plan's step 5 query reads;
  - criterion 1 directly: every issue in `saved.after` (the issues still in the sprint after the writes) has status category `done` or `canceled`;
  - the delivered numbers: the issues of `saved.after` in category `done` are `ISS-2X6D` and `ISS-8C4W`, ISS-2X6D has estimate 5, and their estimates sum to 10;
  - the retro regex becomes `/Delivered 2 of 3 planned issues, 10 of 16 points/`.
- `_inputs/retro.md`: the numbers line becomes "Delivered 2 of 3 planned issues, 10 of 16 points. ISS-8C4W moved to done when its pull request merged, and ISS-2X6D moved to done with the 5 points it delivered." The carry-over line becomes "ISS-2X6D was split: its 5 delivered points are done, and its remaining 3 points are a new issue in the backlog, linked to it."
- Regenerate `cycle-close.after.txt` with `UPDATE_GOLDENS=1 node --test scripts/scenarios.test.mjs`. The expected diff: the new trace rows, a `move` event and `status: done` in ISS-2X6D, a `link` event and `related:` in both ISS-2X6D and the new issue, and the new retro text. Read `git diff scripts/__scenarios__/` before committing it.
- `cycle-plan.mjs` and its snapshot do not change. It runs on a fresh team fixture.
- `scripts/__goldens__/` does not change. No CLI output changes.

## Tests

1. The failing-first test is the scenario (`scripts/scenarios.test.mjs`), with the changes above. Write the scenario changes first and run it against the old `close.md`. Rule 5 fails on the `dryRun` entry of `issues move`, the `write` entry of `issues link` and the step 8 `read` of `cycle issues`, because the old text has none of those calls, and the `expect` fails on `original.status === 'done'`. Then change `close.md` and regenerate the snapshot. Rules 3 to 6 also check the new command text: `issues move` and `issues link --kind` exist, every call ends with `--json`, and the scenario uses each new call.
2. A regression guard for plan's query, in `scripts/cli.test.mjs`: "a split in cycle close leaves the remaining work for cycle plan". It passes before and after the fix, because it calls the CLI directly and every call exists today. A comment says so. On the team fixture with `PMKIT_NOW=2026-10-23T12:00:00Z`, run the step 8 writes of the scenario (close, create, link, update, move). Then:
   - `issues list --category todo,backlog --sprint none --json`, the query of `commands/cycle/plan.md` step 5 (a comment says so), returns the new ID and not `ISS-2X6D`;
   - `cycle issues 2026-10-12 --json` lists `ISS-2X6D` in category `done`;
   - `metrics velocity --json` gives `{ id: '2026-10-12', points: 5, count: 1 }` for the closed sprint. ISS-2X6D is the only one, because the test runs no `pr sync` and ISS-8C4W stays in `in_review`. A comment says that `PMKIT_NOW` 2026-10-23 falls before the sprint's `end` of 2026-10-25, so this proves only a close on time. The test adds no assertion for a late close, because one would lock in the gap that the velocity follow-up fixes.
3. `npm test` passes.

## Acceptance criteria to design

| Criterion | Design part |
| --- | --- |
| 1. After a split, the original no longer stays open in the closed sprint | Step 7 dry run and step 8 write of `issues move <id> done`; the scenario `expect` that every issue of the step 8 `cycle issues` read is `done` or `canceled`, and that ISS-2X6D is `done`. The CLI test's `cycle issues` check guards it. |
| 2. `/pmkit:cycle:plan` can offer the remaining work of a split issue | The new issue in `backlog` with no sprint, linked to the original; the scenario `expect` on its status and sprint; the CLI test that runs plan's step 5 query after a split. When the close runs on or before the sprint's `end`, velocity also counts the delivered part for plan's step 3. |

## Open questions

None left. The review answered the questions of the first draft, and the ones outside this issue are follow-up candidates.

## Follow-up candidates

None changes this issue's design, and none deletes data. Create each at delivery as a new issue, `related` to PMK-113.

1. **`in_progress` issues sent to the backlog are never offered by plan.** `cycle add <id> --to none` keeps the status, and plan's step 5 reads only `todo,backlog`. ISS-5N1R in the scenario is one. The fix changes `commands/cycle/plan.md` step 5 to `--category todo,backlog,in_progress` (and the `cycle-plan` scenario's read), or adds an `issues move <id> todo` to the backlog moves of `cycle:close`.
2. **Velocity counts issues moved to done during cycle close after the end date.** Today it does not: `velocity` counts a done issue only when the UTC date of its last move into `done` is on or before the sprint's `end`. A close run after the end leaves out the split original and every issue `pr sync` moves in step 1. The fix touches `scripts/lib/metrics.mjs` (for example, count moves up to the sprint's close event), which `cycle:plan` and `report:status` also read.
3. **Copy the original's open blockers, open sub-issues and unchecked criteria to the new issue.** This issue only lists them in the step 7 preview. Copying the blocker needs one more `issues link --kind blocks` per blocker, and it would make plan's step 5 skip the new issue while the blocker is not done and not in the selection. In the scenario, ISS-5N1R blocks ISS-2X6D and plan does not offer it (follow-up 1), so the copy would break criterion 2 until follow-up 1 lands. Moving the sub-issues to the new parent is a product decision. Carrying the criteria needs a `--criteria-file` built from them in step 7.

## Risks and non-goals

- A team whose `default_status` is `triage` gets the new issue in `triage`, and plan offers it only after triage. Every created issue works that way, and this issue does not change it.
- The step 7 preview cannot show the new ID in the link, because the create has not run. It shows "the new issue" and the original's ID, as `/pmkit:issues:breakdown` does.
- A split of an issue in `in_review` with an open PR marks it `done` before the merge. The split rule (a delivered part above 0 and below the estimate) leaves that call to the user in the preview.
- Cycle time keeps the step 5 numbers, read before the writes, so it leaves out the split original's move to `done`.
- No change to `cycle close` in the CLI, to the tracker, or to any command other than `cycle:close`.

## Left to the builder

- The exact wording of the preview rows for a split.
- Where the CLI test sits in `cli.test.mjs`, next to "cycle close prints the unfinished issues".
