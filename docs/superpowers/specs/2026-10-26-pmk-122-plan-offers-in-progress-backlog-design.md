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
- `/pmkit:cycle:close` step 5 (carry-over) reads the `in_progress` events of the sprints, not plan's query. This change does not touch it, so it is unaffected. An issue sent back and offered again now reaches a second sprint, which is the signal that step 5 looks for.
- `scripts/scenario-helpers.mjs` `matchEntry` compares a scenario entry with the command file by flag names only, never by flag values. A scenario that runs `--category todo,backlog,in_progress` passes against today's text too. The test that fails on today's text therefore has to parse `plan.md`, like the existing test "cycle/close step 8 runs cycle close after every issues link and issues move call" in `scripts/scenarios.test.mjs`.

## Options

A. **Plan step 5 adds `in_progress` to the category list.** The command becomes `issues list --category todo,backlog,in_progress --sprint none --json`. Everything else in step 5 stays: creation order, blockers first, skip when the blocker is not done and not in the selection, stop at capacity, flag unestimated issues.

- Other commands: none change. `cycle:close` keeps its behavior, and `cycle add --to none` keeps its meaning (clear the sprint, keep the status). One sentence in close step 6 tells the reader that plan offers the issue again.
- An issue in `in_progress` with no sprint, such as PMK-122 now: plan offers it, whatever way it got there (sent back by close, or started from the backlog). The user can still leave it out in step 8.
- Cost: plan may offer a sprintless in-progress issue with an assignee who is working on it. The issue needs a sprint, so the offer is correct. Step 8 shows the status (see Decisões), so the user can tell it from a backlog issue. Step 5 keeps creation order and fills to capacity, so a long-lived in-progress issue comes first and can crowd out `todo` issues. That follows step 5 and the conventions, and it is not a bug.

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
| Add `in_progress` only. `in_review` stays out. | The issue and its criteria name `in_progress`. A sprintless `in_review` issue is the same gap but a separate decision, outside this issue. Close step 3 sends back any issue not in `done`, including `in_review`, and plan does not offer it. That gap is known and stays open (follow-up 1, to be filed as its own issue). Review ruling M5. |
| Add one sentence to close step 6: "A move back to the backlog keeps the issue's status and leaves it with no sprint, and `/pmkit:cycle:plan` offers it again." It does not repeat plan's category list and it says "no sprint", not "backlog", as a category. | A reader of close should find the link to plan where the move is described. Repeating the category list would drift the next time plan changes, and "backlog" is also a category (CONTEXT.md) that plan's input no longer equals. The sentence has no CLI call, so the parser and rules 3 and 4 do not see it. Review rulings M4 and M7. |
| No change to the blocker rule, the order or the capacity rule of step 5. | PMK-123 owns the blocker rule. Plan lists the in-progress issue in creation order, oldest first, like every other issue. Follow-up 3 names the case of a blocked in-progress issue. Review ruling M1. |
| Plan step 8's preview table gains a status column. The sentence becomes: "The preview is a table (ID, title, status, estimate, assignee, blocked by) with the committed estimate against capacity and the risks of the Output section." The change stays in `commands/cycle/plan.md`. | Step 5 can now offer an issue that someone is working on, and step 8 is where the user decides. Without a status column an in-progress issue looks like a backlog issue. Conventions "Issue tables" already lists status as a column. Review ruling I2. |
| `scripts/cli.test.mjs` (the PMK-113 test "a split in cycle close leaves the remaining work for cycle plan") copies plan's query. The implementation changes that copy to `--category todo,backlog,in_progress`. | The comment above it says "The query of commands/cycle/plan.md step 5", and it would be false otherwise. The test would then stop guarding what plan runs. Its assertions still hold: the remaining work is offered, and the delivered original (`done`) is not. Review ruling I1. |
| The scenario `setup` runs with `PMKIT_USER=fred` and `PMKIT_NOW=2026-10-23T12:00:00Z`, and `expect` pins the scope order the CLI returns, which is creation order. | `pmkit(args)` in `prepareCopy` runs through `childEnv()`, which sets both variables (and `TZ=UTC`), adds `--json` and throws on a non-zero exit. The repro shows ISS-5N1R first, so the order is pinned. Review ruling M8. |
| `in_review` stays out of the static test's allowed list, and the test says in a comment that it encodes this decision. | The test must change when follow-up 1 lands. Review ruling M3. |
| No CLI, tracker or config change. | `--category` already takes the list. ADR-0003 holds. |
| The failing test parses `plan.md` in `scripts/scenarios.test.mjs`. The scenario carries the behavior check. | `matchEntry` ignores flag values, so a scenario cannot fail on the old text (see Findings). The static test reads the text. |
| The `cycle-plan` scenario gets a `setup` that runs `cycle add ISS-5N1R ISS-4M2S --to none` on the fixture copy. | It reproduces what close leaves: ISS-5N1R is `in_progress`, ISS-4M2S is `todo`, both with no sprint. This is the same move the `cycle-close` scenario makes. The fixture files stay as they are, and no other scenario changes. |
| No CHANGELOG entry. Suggested release line: "`/pmkit:cycle:plan` offers `in_progress` issues with no sprint, such as those `/pmkit:cycle:close` sends back to the backlog." | Earlier PMK specs leave the changelog to the release. |

## Changes

1. `commands/cycle/plan.md`:
   - step 5: replace `--category todo,backlog --sprint none` with `--category todo,backlog,in_progress --sprint none`;
   - step 8: replace "The preview is a table (ID, title, estimate, assignee, blocked by)" with "The preview is a table (ID, title, status, estimate, assignee, blocked by)".
   No other word changes.
2. `commands/cycle/close.md` step 6: after "move it back to the backlog", add this sentence: "A move back to the backlog keeps the issue's status and leaves it with no sprint, and `/pmkit:cycle:plan` offers it again." Keep the line parseable (no new fenced call). Step 5 (carry-over) reads events and does not change.
3. `scripts/__scenarios__/cycle-plan.mjs`:
   - add `setup: async ({ pmkit }) => { await pmkit(['cycle', 'add', 'ISS-5N1R', 'ISS-4M2S', '--to', 'none']) }`. It runs with `PMKIT_USER=fred` and `PMKIT_NOW=2026-10-23T12:00:00Z`, from `childEnv()`;
   - the step 5 read becomes `['issues', 'list', '--category', 'todo,backlog,in_progress', '--sprint', 'none']`;
   - `expect` asserts the scope ids are `['ISS-5N1R', 'ISS-3F7H', 'ISS-6J0B', 'ISS-4M2S']` in the order the CLI returns, which is creation order (10-05, 10-07, 10-08, 10-13), and that the four have the new sprint. A comment says the order is the CLI's;
   - update the header comment: the scope is every todo, backlog or in_progress issue without a sprint. Capacity 14 covers 3 + 2 + 1 points, and ISS-6J0B has no estimate and is flagged.
4. `scripts/scenarios.test.mjs`: two new tests beside the `cycle/close step 8` test (step 5 categories, step 8 table columns).
5. `scripts/cli.test.mjs` near line 498: the query becomes `['issues', 'list', '--category', 'todo,backlog,in_progress', '--sprint', 'none']`. The comment stays "The query of commands/cycle/plan.md step 5." The test then asserts what it did before: the remaining work is offered, and the delivered original is not.
6. `scripts/__scenarios__/cycle-plan.after.txt`: regenerated.

## Tests per criterion

| Criterion | Test | Where | Why it fails on today's text |
| --- | --- | --- | --- |
| 1 | `cycle/plan step 5 drafts from todo, backlog and in_progress issues with no sprint` | `scripts/scenarios.test.mjs` | It takes the `issues list` call of step 5 from `parseCommandFile` and asserts its `--category` list includes `in_progress`. Today's list is `todo,backlog`. |
| 1, behavior | scenario `cycle-plan`, `expect` | `scripts/__scenarios__/cycle-plan.mjs` | After the `setup` moves, the saved step 5 result must hold ISS-5N1R. It cannot fail on the old text, because the entry supplies its own flags, but it proves the CLI call returns the issue and that sprint 2026-10-26 gets it. |
| 2 | the same static test | `scripts/scenarios.test.mjs` | It also asserts the list includes `todo` and `backlog`, that the call keeps `--sprint none`, and that the list leaves out `done`, `canceled`, `triage` and `in_review`. This part passes today and guards the rest. |
| 2, behavior | scenario `cycle-plan`, `expect` | same file | The scope is exactly the four ids above. It therefore leaves out ISS-2X6D (in_progress, in sprint 2026-10-12), ISS-8C4W (in_review, in sprint) and the `done` and `canceled` issues. ISS-4M2S (todo, no sprint after `setup`) and ISS-3F7H and ISS-6J0B (backlog) are in. |
| 1, 2 (preview) | `cycle/plan step 8 shows the status of each offered issue` | `scripts/scenarios.test.mjs` | No scenario or static test checks the columns of step 8's table today (the scenario matches calls and flag names only, and `grep` finds no check of "estimate, assignee" in `scripts/`). The new test reads the step 8 line of `plan.md` and asserts the table lists `status`. It fails on today's text. |
| 2, PMK-113 guard | `a split in cycle close leaves the remaining work for cycle plan` | `scripts/cli.test.mjs` | Passes before and after. It runs the new query, so it keeps guarding what plan runs. |
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
  // `--sprint none` as a whole value: `--sprint none2` must not pass.
  assert.match(call.text, /(?:^|\s)--sprint none(?:\s|$)/)
})
```

The test carries a comment: the `in_review` assertion encodes the PMK-122 decision, and it changes when follow-up 1 lands.

The step 8 test:

```js
test('cycle/plan step 8 shows the status of each offered issue', () => {
  const step8 = fs.readFileSync(path.join(COMMANDS_DIR, 'cycle', 'plan.md'), 'utf8').split('\n').find((line) => line.startsWith('8. '))
  assert.ok(step8, 'plan.md has a step 8')
  assert.match(step8, /table \(ID, title, status, estimate, assignee, blocked by\)/)
})
```

`call.text` is the raw text after `pmkit.mjs" ` up to the closing backtick, flags in file order, ending in `--json` (checked in `readCall`).

## Goldens

Only `scripts/__scenarios__/cycle-plan.after.txt` changes. Its trace rows and file changes depend on the scenario, and no other scenario reads plan's step 5. The step 8 wording change has no call and no scenario reads it. The `cycle-close` snapshot does not change, because the new sentence in close step 6 has no call. `scripts/cli.test.mjs` has no golden. Regenerate with `UPDATE_GOLDENS=1 node --test scripts/scenarios.test.mjs`, then read `git diff scripts/__scenarios__/` line by line. Expected diff: the step 5 row shows `--category todo,backlog,in_progress`; the dry run and the write of `cycle add` list `ISS-5N1R ISS-3F7H ISS-6J0B ISS-4M2S`; and the file changes add `sprint: 2026-10-26` and a `sprint` event to ISS-5N1R and ISS-4M2S next to the two issues already there. The setup moves are not in the snapshot, because the baseline is taken after `setup`. Never edit the snapshot by hand. Any other changed line is a finding to explain before the commit.

## Open questions

None. The setup environment and the scope order are settled (see Decisões).

## Follow-up candidates

1. **`in_review` issues sent back by close.** Close sends back any unfinished issue, including `in_review`, and plan does not offer it. The new sentence in close step 6 says plan offers the issue again, which is false for `in_review`. File this as its own issue: decide if plan offers `in_review` or if close moves it to `in_progress` or `todo`.
2. **`cycle:close` could say what plan will offer.** The preview could mark, per backlog move, whether plan offers the issue. Not needed once plan reads `in_progress`.
3. **The blocker rule (PMK-123).** An `in_progress` blocker that plan now offers can sit in the selection ahead of what it blocks. The rule "skip when the blocker is not done and not in the selection" already handles it. The other case is open: step 5 drops an `in_progress` issue that an open issue outside the selection blocks, though its owner is working on it. That clashes with the Output risk "blocker outside the sprint", which cannot name a skipped issue. PMK-123 decides. This issue does not change the rule.
4. **Generate the plan filter from the category list.** A `--open` flag or a shared constant would stop plan and `backlog:groom` from drifting. It changes the CLI, so it needs its own issue.
