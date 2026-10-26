# PMK-122: offer in-progress issues sent back to the backlog in cycle plan

## Problem

`/pmkit:cycle:close` steps 6 and 7 let the user move an unfinished issue back to the backlog. Step 7 runs `cycle add <ids> --to none`, which clears the sprint and keeps the status. An issue that was `in_progress` stays `in_progress` with no sprint.

`/pmkit:cycle:plan` step 5 drafts the scope from `issues list --category todo,backlog --sprint none`. The `in_progress` category is not in that list, so plan never offers the issue again. It is open work that no sprint holds and no planning step shows. PMK-113 found this (its spec lists it as follow-up 1).

Acceptance criteria:

1. An issue in an `in_progress` status with no sprint, as `/pmkit:cycle:close` leaves it after a move back to the backlog, is in the list that `/pmkit:cycle:plan` step 5 drafts the scope from.
2. `/pmkit:cycle:plan` still offers the `todo` and `backlog` issues with no sprint, and does not offer an issue that is already in a sprint.
3. A test fails on today's command text and passes after the change, and `npm test` passes.

## Reproduction

Run on a copy of the `team` fixture outside this repo's `.issues/`, with `PMKIT_NOW=2026-10-23T12:00:00Z` and `PMKIT_USER=fred`. `ISS-5N1R` is `in_progress` in the active sprint `2026-10-12`. `p` stands for `node scripts/pmkit.mjs ... --root <copy>`.

```
$ p cycle add ISS-5N1R --to none
ISS-5N1R  Paginate the events API
sprint: 2026-10-12 → (none)

$ p issues get ISS-5N1R          # status: in_progress (in_progress), no sprint line

$ p issues list --category todo,backlog --sprint none          # plan step 5 today
ISS-3F7H | Empty state for the dashboard | backlog |  | 2
ISS-6J0B | Upgrade the build tooling     | backlog |  |

$ p issues list --category todo,backlog,in_progress --sprint none
ISS-5N1R | Paginate the events API       | in_progress | fred | 3
ISS-3F7H | Empty state for the dashboard | backlog     |      | 2
ISS-6J0B | Upgrade the build tooling     | backlog     |      |

$ p issues list --sprint none      # no category filter: also returns canceled and triage
ISS-3F7H, ISS-6J0B, ISS-0G5E (canceled), ISS-1V9Z (triage)
```

Each list also prints `warning: ISS-3Q6T: CONFLICT ...`. The `team` fixture keeps that issue unreadable on purpose, and it is not part of this bug.

The same bug shows in this repo today: `node scripts/pmkit.mjs issues list --category in_progress --sprint none` returns PMK-122, which someone is working on, and plan step 5 does not return it.

The `team` fixture has no in_progress issue without a sprint. The `cycle-close` scenario creates one by moving ISS-5N1R back to the backlog.

## Findings

- `--category` takes a comma list of categories, and `--sprint none` matches issues with no sprint (`issueFilter` in `scripts/pmkit.mjs`, `searchIssues` in the tracker). No CLI change is needed for any approach below.
- `/pmkit:cycle:close` can send back any unfinished issue, not only `in_progress` ones. Step 3 calls everything not in `done` unfinished. An `in_review` issue sent back has the same problem. That is out of this issue (follow-up 1).
- Other commands that filter by category:
  - `backlog:groom` reads `backlog,todo,triage` and means ungroomed work, so an in-progress issue does not belong there.
  - `issues:work`, `issues:pause`, `issues:progress` and `team:standup` read `in_progress` with no sprint filter, so they already see a sprintless in-progress issue.
  - `issues:find` takes whatever the user asks for.
  - `cycle:plan` step 5 is the only reader that combines a sprint-less filter with an open-work meaning, and the only one that misses the issue.
- `scripts/scenario-helpers.mjs` `matchEntry` compares a scenario entry with the command file by flag names only, never by flag values. A scenario that runs `--category todo,backlog,in_progress` passes against today's text too. The test that fails on today's text therefore has to parse `plan.md`, like the existing test "cycle/close step 8 runs cycle close after every issues link and issues move call" in `scripts/scenarios.test.mjs`.

## Options

A. **Plan step 5 adds `in_progress` to the category list.** The command becomes `issues list --category todo,backlog,in_progress --sprint none --json`. Everything else in step 5 stays: creation order, blockers first, skip when the blocker is not done and not in the selection, stop at capacity, flag unestimated issues.

- Other commands: none change. `cycle:close` keeps its behavior, and `cycle add --to none` keeps its meaning (clear the sprint, keep the status). One sentence in close step 6 tells the reader that plan offers the issue again.
- An issue in `in_progress` with no sprint, such as PMK-122 now: plan offers it, whatever way it got there (sent back by close, or started from the backlog). The user can still leave it out in step 8.
- Cost: plan may offer a sprintless in-progress issue with an assignee who is working on it. That is the right information, because the issue needs a sprint.

B. **Close moves the status too.** The backlog moves in close step 7 add `issues move <id> todo` (or `backlog`) for each issue not already in those categories, with a dry run, before the close.

- Other commands: `cycle:close` gets one more write per issue, its preview grows, the `cycle-close` scenario and snapshot change, and the `in_progress` status stops being true while a branch and an assignee stay. Cycle time (`metrics cycle-time`) and `issues:work`, `issues:pause` and `team:standup` read the status, so they see the issue as not started. The `in_progress` event stays in the history, but the current status loses the fact that work began.
- An issue in `in_progress` with no sprint today (PMK-122): not fixed. B acts only inside a close, so an issue that is already in this state stays invisible to plan.
- Criterion 1 says plan must offer the issue "as `/pmkit:cycle:close` leaves it", with the status kept. B changes what close leaves, so it does not meet the criterion as written.

C. **Plan drops the category filter and excludes by text.** Step 5 runs `issues list --sprint none --json` and the text says to skip `done`, `canceled` and `triage`.

- Other commands: none change.
- It moves a filter from the CLI to prose that the agent applies, and the result of the call is no longer the list step 5 drafts from. It returns `canceled` and `triage` issues (see the repro) and invites a mistake. A new category added later would be offered without anyone deciding it. A CLI flag such as `--open` would solve that but changes the CLI, the help and the flag checks for one caller.

| | A | B | C |
| --- | --- | --- | --- |
| Criterion 1 as written | yes | no (status changes) | yes |
| Fixes an in-progress issue with no sprint that never went through close | yes | no | yes |
| Files changed | `plan.md`, one sentence in `close.md`, one scenario, one test | `close.md`, scenario, snapshot, test | `plan.md`, test |
| Other commands change | no | `cycle:close` (writes, preview) | no |
| Keeps the status the user set | yes | no | yes |
| Filter stays in the CLI call | yes | yes | no |

## Decisões

| Decision | Reason |
| --- | --- |
| Choose A: step 5 of `commands/cycle/plan.md` reads `--category todo,backlog,in_progress --sprint none`. | It is the smallest change, it meets criterion 1 as written, and it also fixes in-progress issues that never passed through close. B edits the status of the user's work to hide a gap in a reader, and C moves a filter into prose. |
| Add `in_progress` only. `in_review` stays out. | The issue and its criteria name `in_progress`. A sprintless `in_review` issue is the same gap but a separate decision (a PR waiting for review may belong to no sprint on purpose). Follow-up 1. |
| Add one sentence to close step 6: an issue moved back to the backlog keeps its status, and `/pmkit:cycle:plan` offers it again when its status is `todo`, `backlog` or `in_progress`. | Close and plan now share a rule. A reader of close should find it where the move is described. The sentence has no CLI call, so the parser and rules 3 and 4 do not see it. |
| No change to the blocker rule, the order or the capacity rule of step 5. | PMK-123 owns the blocker rule. Offering an in-progress issue first in creation order is correct, because it is usually the oldest. |
| No CLI, tracker or config change. | `--category` already takes the list. ADR-0003 holds. |
| The failing test parses `plan.md` in `scripts/scenarios.test.mjs`. The scenario carries the behavior check. | `matchEntry` ignores flag values, so a scenario cannot fail on the old text (see Findings). The static test reads the text. |
| The `cycle-plan` scenario gets a `setup` that runs `cycle add ISS-5N1R ISS-4M2S --to none` on the fixture copy. | It reproduces what close leaves: ISS-5N1R is `in_progress`, ISS-4M2S is `todo`, both with no sprint. This is the same move the `cycle-close` scenario makes. The fixture files stay as they are, and no other scenario changes. |
| No CHANGELOG entry. Suggested release line: "`/pmkit:cycle:plan` offers `in_progress` issues with no sprint, such as those `/pmkit:cycle:close` sends back to the backlog." | Earlier PMK specs leave the changelog to the release. |

## Changes

1. `commands/cycle/plan.md` step 5: replace `--category todo,backlog --sprint none` with `--category todo,backlog,in_progress --sprint none`. No other word changes.
2. `commands/cycle/close.md` step 6: after "move it back to the backlog", add the sentence from Decisões. Keep the line parseable (no new fenced call).
3. `scripts/__scenarios__/cycle-plan.mjs`:
   - add `setup: async ({ pmkit }) => { await pmkit(['cycle', 'add', 'ISS-5N1R', 'ISS-4M2S', '--to', 'none']) }` (check the `pmkit` helper signature in `prepareCopy`; it needs `PMKIT_USER`, which `childEnv` sets for the other scenarios that use `setup`);
   - the step 5 read becomes `['issues', 'list', '--category', 'todo,backlog,in_progress', '--sprint', 'none']`;
   - `expect` asserts the scope ids are `['ISS-5N1R', 'ISS-3F7H', 'ISS-6J0B', 'ISS-4M2S']` (creation order, oldest first), and that the four have the new sprint;
   - update the header comment: the scope is every todo, backlog or in_progress issue without a sprint. Capacity 14 covers 3 + 2 + 1 points, and ISS-6J0B has no estimate and is flagged.
4. `scripts/scenarios.test.mjs`: one new test beside the `cycle/close step 8` test.
5. `scripts/__scenarios__/cycle-plan.after.txt`: regenerated.

## Tests per criterion

| Criterion | Test | Where | Why it fails on today's text |
| --- | --- | --- | --- |
| 1 | `cycle/plan step 5 drafts from todo, backlog and in_progress issues with no sprint` | `scripts/scenarios.test.mjs` | It takes the `issues list` call of step 5 from `parseCommandFile` and asserts its `--category` list includes `in_progress`. Today's list is `todo,backlog`. |
| 1, behavior | scenario `cycle-plan`, `expect` | `scripts/__scenarios__/cycle-plan.mjs` | After the `setup` moves, the saved step 5 result must hold ISS-5N1R. It cannot fail on the old text, because the entry supplies its own flags, but it proves the CLI call returns the issue and that sprint 2026-10-26 gets it. |
| 2 | the same static test | `scripts/scenarios.test.mjs` | It also asserts the list includes `todo` and `backlog`, that the call keeps `--sprint none`, and that the list leaves out `done`, `canceled`, `triage` and `in_review`. This part passes today and guards the rest. |
| 2, behavior | scenario `cycle-plan`, `expect` | same file | The scope is exactly the four ids above. It therefore leaves out ISS-2X6D (in_progress, in sprint 2026-10-12), ISS-8C4W (in_review, in sprint) and the `done` and `canceled` issues. ISS-4M2S (todo, no sprint after `setup`) and ISS-3F7H and ISS-6J0B (backlog) are in. |
| 3 | `npm test` | whole suite | The static test is red on today's text and green after step 1 of Changes. The rest stay green. |

The static test, in outline:

```js
test('cycle/plan step 5 drafts from todo, backlog and in_progress issues with no sprint', () => {
  const call = FILES.find((file) => file.rel === 'cycle/plan.md').parsed.calls
    .find((c) => c.step === '5' && c.command === 'issues list' && !c.dryRun)
  assert.ok(call, 'step 5 runs issues list')
  const categories = call.text.match(/--category (\S+)/)?.[1].split(',') ?? []
  for (const name of ['todo', 'backlog', 'in_progress']) assert.ok(categories.includes(name), `step 5 reads ${name}`)
  for (const name of ['done', 'canceled', 'triage', 'in_review']) assert.ok(!categories.includes(name), `step 5 leaves out ${name}`)
  assert.match(call.text, /--sprint none/)
})
```

Verify `call.text` holds the flags in order, as the existing messages (`call.text` in rule 4) suggest.

## Goldens

Only `scripts/__scenarios__/cycle-plan.after.txt` changes. Its trace rows and file changes depend on the scenario, and no other scenario reads plan's step 5. The `cycle-close` snapshot does not change, because the new sentence in close step 6 has no call. Regenerate with `UPDATE_GOLDENS=1 node --test scripts/scenarios.test.mjs`, then read `git diff scripts/__scenarios__/` line by line. Expected diff: the step 5 row shows `--category todo,backlog,in_progress`; the dry run and the write of `cycle add` list `ISS-5N1R ISS-3F7H ISS-6J0B ISS-4M2S`; and the file changes add `sprint: 2026-10-26` and a `sprint` event to ISS-5N1R and ISS-4M2S next to the two issues already there. The setup moves are not in the snapshot, because the baseline is taken after `setup`. Never edit the snapshot by hand.

## Open questions

1. Whether to pin the order `ISS-5N1R, ISS-3F7H, ISS-6J0B, ISS-4M2S` by creation date. The repro shows ISS-5N1R first, so the test follows the CLI order and says so in a comment.

## Follow-up candidates

1. **`in_review` issues sent back by close.** The same gap for a sprintless `in_review` issue. Decide if plan offers it or if close moves it to `in_progress` or `todo`.
2. **`cycle:close` could say what plan will offer.** The preview could mark, per backlog move, whether plan offers the issue. Not needed once plan reads `in_progress`.
3. **The blocker rule (PMK-123).** An `in_progress` blocker that plan now offers can sit in the selection ahead of what it blocks. The rule "skip when the blocker is not done and not in the selection" already handles it, but PMK-123 should confirm.
4. **Generate the plan filter from the category list.** A `--open` flag or a shared constant would stop plan and `backlog:groom` from drifting. It changes the CLI, so it needs its own issue.
