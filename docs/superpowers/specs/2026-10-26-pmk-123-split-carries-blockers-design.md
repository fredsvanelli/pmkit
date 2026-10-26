# PMK-123: carry blockers, sub-issues and criteria over to the new issue of a split

## Problem

`/pmkit:cycle:close` can split an unfinished issue (PMK-113). The original keeps the delivered part: its estimate drops, it moves to `done` and it stays in the closed sprint. A new issue in the backlog takes the remaining work, with a `related` link to the original.

The original's open blockers, open sub-issues and unchecked acceptance criteria stay on the done original. Step 7 lists them in the preview and says "The close does not move or copy them." Nothing acts on a done issue, so this work drops out of view: the new issue starts with no blocker, no sub-issue and no criteria, and `/pmkit:cycle:plan` offers it as if it could start at once.

Copying the blocker raises a second question. Plan step 5 says "Skip an issue whose blocker is not done and not in the selection." A new issue that carries an open blocker would then drop out of the draft with no word to the user.

Acceptance criteria:

1. After a split in `/pmkit:cycle:close`, the original's open blockers, open sub-issues and unchecked acceptance criteria go to the new issue as the spec decides for each kind, and the step 7 preview shows every one of those writes before it runs.
2. `/pmkit:cycle:plan` offers the new issue of a split that carries an open blocker, or says why it leaves it out, by the blocker rule the spec decides.
3. Tests fail on today's command text and pass after the change, and `npm test` passes.

This issue owns the product decision for each of the three kinds and for plan's blocker rule.

## Reproduction

A copy of the `team` fixture in the session scratchpad, outside this repo's `.issues/`. Code at `5614307`. Every call runs as `PMKIT_USER=fred PMKIT_NOW=2026-10-26T12:00:00Z TZ=UTC node scripts/pmkit.mjs ... --root <copy>`. The fixture's unreadable ISS-3Q6T prints a `CONFLICT` warning on each call, filtered out below. The copy runs no `pr sync`, so ISS-8C4W stays `in_review`.

In the fixture, ISS-2X6D (in_progress, 8 points) is blocked by ISS-5N1R (in_progress) and is the parent of ISS-4M2S (todo). All three are in the active sprint `2026-10-12`. ISS-2X6D has no criteria, so setup adds one checked and one unchecked:

```
$ issues update ISS-2X6D --criteria-file setup-criteria.md
acceptance criteria: (none) → - [x] Export invoices for a date range; - [ ] Totals row at the bottom
```

The step 3 read (`cycle issues 2026-10-12 --json`) gives for ISS-2X6D `blockedBy: ["ISS-5N1R"]`, `children: ["ISS-4M2S"]`, `related: ["ISS-0G5E"]` and both criteria with `done`. The issue JSON has no computed `blocked` field. Its keys are `id, title, status, labels, blockedBy, blocks, related, duplicateOf, children, archived, description, acceptanceCriteria, created, updated, body, type, priority, estimate, assignee, parent, sprint, due`.

Then the step 8 writes in the order `close.md` gives today (the backlog moves of the `cycle-close` scenario, the split, the close):

```
$ cycle add ISS-4M2S ISS-5N1R --to none
$ issues create --title "Finish the billing export to CSV" --type feature --estimate 3 --parent EPC-2M9D --priority high --label billing,backend
ISS-SFM2
$ issues link ISS-SFM2 ISS-2X6D --kind related
$ issues update ISS-2X6D --estimate 5
$ issues move ISS-2X6D done
$ cycle close 2026-10-12
unfinished issues: ISS-8C4W (in_review, no pr sync in this copy)
```

What the two issues and the sub-issue hold afterward:

```
$ issues get ISS-2X6D
status: done (done)
estimate: 5
sprint: 2026-10-12
blocked_by: ISS-5N1R
related: ISS-0G5E, ISS-SFM2
children: ISS-4M2S
acceptance criteria:
- [x] Export invoices for a date range
- [ ] Totals row at the bottom

$ issues get ISS-SFM2
status: backlog (backlog)
estimate: 3
parent: EPC-2M9D
related: ISS-2X6D
(no blocked_by, no children, no acceptance criteria)

$ issues get ISS-4M2S
status: todo (todo)
parent: ISS-2X6D
```

Plan step 5's call:

```
$ issues list --category todo,backlog,in_progress --sprint none
ISS-5N1R | Paginate the events API          | in_progress | fred | 3
ISS-3F7H | Empty state for the dashboard    | backlog     |      | 2
ISS-6J0B | Upgrade the build tooling        | backlog     |      |
ISS-4M2S | Fix CSV column order             | todo        | fred | 1
ISS-SFM2 | Finish the billing export to CSV | backlog     |      | 3
```

So today plan offers ISS-SFM2 with no blocker, though ISS-5N1R still blocks the work it holds. ISS-4M2S stays a sub-issue of a done issue. The unchecked criterion is only on the done original.

The carry-over writes this spec proposes, on the same copy:

```
$ issues link ISS-5N1R ISS-SFM2 --kind blocks
blocks: ISS-2X6D → ISS-2X6D, ISS-SFM2
$ issues link ISS-5N1R ISS-SFM2 --kind blocks        (again)
no change                                            (events.jsonl of ISS-SFM2: 3 lines before and after)
$ issues parent ISS-4M2S ISS-SFM2
parent: ISS-2X6D → ISS-SFM2
$ issues parent ISS-4M2S ISS-SFM2                    (again)
no change                                            (no new event)
$ issues create --title "Finish the billing export to CSV" ... --criteria-file carry-criteria.md --dry-run
acceptance criteria:
- [ ] Totals row at the bottom
```

The repeated writes return `{ before, after }` with `before` equal to `after` in `--json`. The tracker tests "linking twice is a no-op that writes no event" and "setParent twice to the same parent is a no-op, and dry run writes nothing" (`scripts/tracker-relations.test.mjs`) already cover this.

Plan's step 5 call after the carry-over returns `ISS-SFM2 backlog blockedBy=["ISS-5N1R"] children=["ISS-4M2S"]`, and ISS-5N1R (in_progress, no sprint) comes first in the list.

Two dry runs show what the "move" options below would remove:

```
$ issues link ISS-5N1R ISS-2X6D --kind blocks --remove --dry-run
blocks: ISS-2X6D, ISS-SFM2 → ISS-SFM2
$ issues update ISS-2X6D --criteria-file kept.md --dry-run
acceptance criteria: - [x] Export invoices for a date range; - [ ] Totals row at the bottom → - [x] Export invoices for a date range
```

One more finding: `issues list --blocked` lists the done ISS-2X6D next to ISS-SFM2, because the CLI's blocked filter ignores the issue's own status. That holds today too, with or without a carry-over.

## Findings

- `issues create` takes `--criteria-file f` and `--description-file f`. `parseCriteria` in `scripts/pmkit.mjs` reads one criterion per line, with an optional `- ` and `[ ]` or `[x]`.
- `issues update` takes `--criteria-file` (replaces the whole list), `--check n` and `--uncheck n`.
- `issues link <from> <to> --kind blocks` writes `<from>` into the `blocked_by` of `<to>`. Only the blocked issue's file changes, because `blocks` is computed. `--remove` unlinks. A link to a missing issue fails, because `relate` calls `knownIssue` on both ends.
- `issues parent <id> <parent|none>` writes only the sub-issue's `parent`. The parent's `children` is computed. It checks for loops.
- No CLI command has an ID filter other than `issues get <id>`. `issues list --parent <id>` returns the sub-issues of one parent.
- The new issue's ID exists only after the real create. A dry run of the create returns a different random ID (the repro's dry run gave ISS-744H). Every write that names the new issue therefore has no dry run. PMK-113 set this rule for the `related` link, and `/pmkit:issues:breakdown` step 8 and `/pmkit:spec:import` step 9 do the same for their `blocks` links.
- The scenario harness matches an entry to a call by step and command name, and checks flag names only (`matchEntry` in `scripts/scenario-helpers.mjs`). Rule 6 counts calls by `<step> <command>`. A second `issues link` call in close step 8 shares the key `8 issues link` with the `related` link, so no scenario can fail on it alone. `issues parent` in step 8 is a new key, and `--criteria-file` on the step 7 create is a new flag, so both make the `cycle-close` scenario fail on today's text.
- `/pmkit:issues:work` step 1 and step 3, `/pmkit:issues:mine` step 4, `/pmkit:issues:summary` and `/pmkit:issues:move` step 2 call a blocker open when it is not in `done` or `canceled`. Plan step 5 says "not done", so it treats a canceled blocker as open (PMK-122 note).
- `/pmkit:issues:move` step 2 warns before a move to `done` when a sub-issue or a blocker is open. Close runs `issues move` through the CLI, so it shows no such warning today.
- Plan step 5 today names no read for a blocker outside its list. The step 5 list holds only `todo`, `backlog` and `in_progress` issues with no sprint, so a blocker in a sprint, in `in_review`, in `triage` or in a terminal category is not in it, and the agent cannot tell its status without a read.

## Options for each kind

The split's writes in step 8 run in this order today: create, `related` link, estimate update, move of the original to `done`. Step 6 of a second run finds a half-done split through the original's `related` link to a backlog issue created during the sprint, but only while the original is still unfinished (PMK-121). Every option below that adds writes puts them after the `related` link and before the estimate update, so the move to `done` stays the last write of a split.

### Open blockers

B1. **Copy.** For each open blocker, `issues link <blocker id> <new id> --kind blocks`. Writes the new issue's `blocked_by`. Removes nothing: the done original keeps its `blocked_by`. A rerun after a failure among these links finds the split through the `related` link and runs the links again. A link that ran prints `no change` and writes nothing. Commands changed: close's split only. Cost: the done original still lists an open blocker, which only `issues list --blocked` shows (see the finding above). The commands that read blockers (`work`, `mine`, `standup`, `report:status`) drop done issues first.

B2. **Move.** B1, then `issues link <blocker id> <original id> --kind blocks --remove` for each. **This removes user data from the done original**: the `blocked_by` entries go, and only the event log keeps them. A rerun runs both again. Each one that ran is a no-op, and the link runs before the unlink, so a blocker removed from the original is already on the new issue. Commands changed: close's split only. Gain: the original no longer shows in `issues list --blocked`, and it would pass the open-blocker check of `/pmkit:issues:move`. Cost: one more write per blocker, and the record loses the fact that this work was once blocked.

B3. **List only** (today). Writes nothing and removes nothing. A rerun has nothing to redo. Commands changed: none. The new issue looks free to start, so plan can draft it into a sprint ahead of its blocker, and the user must link it by hand.

### Open sub-issues

An issue has one parent, so a sub-issue cannot be copied.

S1. **Move.** For each open sub-issue, `issues parent <sub-issue id> <new id>`. Writes the sub-issue's `parent`. **It removes the sub-issue from the done original's computed `children`.** No file of the original changes, no field is deleted, and the sub-issue's event log keeps the old parent. A rerun reads the original's `children` again, so a sub-issue already moved is no longer there, and the rest move. A parent change that ran prints `no change`. Commands changed: close's split only. The epic chain does not change, because the new issue takes the original's parent. The new issue's `children` now shows the open work, and the done original has no open sub-issue left, which the `issues:move` check expects of a done issue.

S2. **Relate.** For each open sub-issue, `issues link <new id> <sub-issue id> --kind related`. Writes the `related` lists of both issues. Removes nothing. A rerun repeats the links as no-ops. Commands changed: close's split only. The sub-issue stays under a done parent, so `/pmkit:issues:work` step 2, `/pmkit:issues:breakdown` and `epic progress` still see it as part of the delivered work. It also adds one more `related` link from the new issue, which step 6 of a second run reads for a half-done split. That check filters by `created`, so a sub-issue made during the sprint and sent to the backlog could match it.

S3. **List only** (today). Writes nothing and removes nothing. Commands changed: none. Open work stays under a done parent.

### Unchecked acceptance criteria

C1. **Copy in the create.** Step 7 writes the criteria with `done: false` to a temporary file, one `- [ ] <text>` line each, and the create gets `--criteria-file <file>`. Writes the new issue's criteria in the same write that creates it. Removes nothing: the original keeps every criterion with its check. A rerun has nothing to redo: the create either ran with the criteria or did not run. The create's dry run shows the criteria in the preview. Commands changed: close's split only.

C2. **Move.** C1, then `issues update <original id> --criteria-file <file of the checked ones>`. **This removes user data from the done original**: the unchecked criteria text goes, and only the event log keeps it. One more write with a dry run. A rerun runs it again as a no-op. Checking them on the original (`--check n`) instead would mark unmet criteria as met, so it is not an option.

C3. **List only** (today). Writes nothing and removes nothing. The new issue has no criteria, so `/pmkit:issues:work` step 3 flags it as not ready, and the text of the unmet criteria sits on a done issue.

### Comparison

| Kind | Option | Writes | Removes from the done original | Rerun after a failure in the new writes | Commands beyond the split |
| --- | --- | --- | --- | --- | --- |
| Blockers | B1 copy | 1 link per blocker | nothing | step 6 finds the split, links repeat as no-ops | none |
| Blockers | B2 move | 2 per blocker | `blocked_by` entries (user data) | same, link before unlink | none |
| Blockers | B3 list | none | nothing | nothing to redo | none |
| Sub-issues | S1 move | 1 parent change per sub-issue | the sub-issue from its computed `children`, old parent kept in the sub-issue's events | step 6 finds the split, moves the rest | none |
| Sub-issues | S2 relate | 1 link per sub-issue | nothing | links repeat as no-ops | none |
| Sub-issues | S3 list | none | nothing | nothing to redo | none |
| Criteria | C1 copy in create | none extra | nothing | nothing to redo | none |
| Criteria | C2 move | 1 update | unchecked criteria text (user data) | update repeats as a no-op | none |
| Criteria | C3 list | none | nothing | nothing to redo | none |

## Options for plan's blocker rule

An open blocker is a `blockedBy` issue not in `done` or `canceled`. Each rule fixes the canceled case, which is a word change. Step 5 reads the status of each blocker that is not in its own list with `issues get <blocker id> --json`. Plan writes nothing in step 5, so no rule removes data and none has a rerun case.

R1. **Skip and say why.** Keep the skip: an issue with an open blocker that is not in the selection stays out of the draft. Step 5 keeps a list of the issues it left out, each with its open blockers' IDs and status categories. Step 8 shows that list under the scope table, and the user can add any of them back. The Output risk "issues with a blocker outside the sprint" then names exactly the issues the user added back. For a split, the new issue is offered when its blocker is in the selection (ISS-5N1R in the repro, because plan offers `in_progress` issues since PMK-122 and moves a blocker before what it blocks). Otherwise the new issue is named in the list with its blocker. Commands changed: plan steps 5 and 8 and its Output.

R2. **Offer and flag.** Never skip for a blocker. A blocked issue is drafted and counts toward capacity, and step 8 and the risks flag it. The new issue of a split is always offered. Commands changed: plan steps 5 and 8 and its Output. Cost: the draft commits capacity to work that cannot start, and the user must remove it by hand. That reverses today's rule for every blocked issue, not only the new issue of a split.

R3. **Skip unless in progress.** R1, but an `in_progress` issue is drafted even when its blocker is open and outside the selection, because someone works on it (PMK-122 note). The new issue of a split is in `backlog`, so R3 treats it as R1 does. Commands changed: the same as R1. It adds a second rule for one status, and a blocked in-progress issue reaches the sprint without the user seeing it named.

| | R1 skip and say why | R2 offer and flag | R3 skip unless in progress |
| --- | --- | --- | --- |
| New issue of a split, blocker selected | offered | offered | offered |
| New issue of a split, blocker outside | left out, named with its blocker | offered, flagged | left out, named |
| In-progress issue, blocker outside | left out, named | offered, flagged | offered |
| Capacity spent on blocked work | only if the user adds it | yes | for in-progress issues |
| Canceled blocker | closed | closed | closed |

## Decisões

| Decision | Reason |
| --- | --- |
| Blockers: B1, copy each open blocker to the new issue with `issues link <blocker id> <new id> --kind blocks`. The original keeps its `blocked_by`. | The blocker holds back the remaining work, which is now the new issue. B2 removes user data from the done original to hide it from one CLI filter (`--blocked`), which also lists done issues in other cases and is better fixed in the filter (follow-up 4). B3 is today's gap. |
| Sub-issues: S1, move each open sub-issue to the new issue with `issues parent <sub-issue id> <new id>`. Sub-issues in `done` or `canceled` stay with the original. | An open sub-issue is part of the remaining work, and a done parent with open sub-issues is the state `/pmkit:issues:move` warns about. S1 changes one field of the sub-issue and keeps the old value in its event log. It deletes no record or field. It does take the sub-issue out of the original's computed `children`, and the step 7 preview says so before the user approves. S2 leaves open work under a done parent and adds a `related` link that step 6 of a second run could misread. |
| Criteria: C1, copy the unchecked criteria into the create with `--criteria-file`, unchecked and in the original's order. The original keeps every criterion with its check. | It needs no extra write and leaves no half-done state, because the create carries them. The create's dry run already shows them in the preview. C2 removes user text from the done original. |
| Plan: R1, skip an issue whose open blocker is not in the selection, and list it with its blocker in step 8 and in the Output. A blocker is open when it is not in `done` or `canceled`. | It meets criterion 2 by naming the reason. It keeps today's behavior that the draft holds only work that can start, and the user can add a left-out issue in step 8, which step 8 already allows. R2 spends capacity on blocked work for every blocked issue, not only splits. R3 adds a second rule for one status and drafts blocked work without naming it. |
| PMK-122 note on the canceled blocker: in scope. Step 5 counts a canceled blocker as closed. | It is the same rule this issue decides, it is one word, and it matches `work`, `mine`, `summary` and `issues:move`. |
| PMK-122 note on an in-progress issue blocked outside the selection: in scope as far as R1 goes. Plan leaves it out and names it with its blocker, and the user can add it back in step 8. No special rule for `in_progress` (R3 is not chosen). | The note's complaint is that the issue drops out with no word, and that the Output risk "blocker outside the sprint" can never name it. R1 names it, and the risk then names the issues the user adds back. |
| Plan step 5 runs `issues get <blocker id> --json` for each `blockedBy` ID that is not in its list. A blocker that `issues get` does not find (`NOT_FOUND`) counts as open and is named as missing. | The rule needs the blocker's status, and no read gives it today. A missing blocker counts as open, as the Blocked entry of `CONTEXT.md` says. |
| The open blockers and open sub-issues of a split are those whose status category is not `done` or `canceled`. Today's step 7 says "not `done`". | The same definition as plan step 5 and `issues:work`. A canceled blocker holds nothing back, and a canceled sub-issue is no remaining work. |
| Close step 7 reads the status of a blocker or sub-issue outside the sprint with `issues get <id> --json`. A missing one (`NOT_FOUND`) is named in the preview and left out of the writes. | Today's step 7 lists such an ID and says its status was not read. The carry-over needs the status to pick the open ones. `issues link` fails on a missing issue, so it cannot be carried. |
| Order of a split's writes in step 8: create (with the criteria), `related` link, blocker links, sub-issue parent changes, estimate update, move of the original to `done`. | The move to `done` stays last, so a split that stops anywhere before it is still unfinished, and step 6 of a second run finds it through the `related` link. The carry-over writes come after the `related` link, so a failure in them leaves that link in place. |
| The finish path of a half-done split (step 6) runs the blocker links, the sub-issue parent changes, the estimate update and the move. It does not repeat the create or the `related` link. | Each link and parent change that already ran writes nothing (repro, and the tracker tests). The sub-issues already moved are no longer in the original's `children`. The criteria came with the create, so there is nothing to redo for them. |
| The blocker links and parent changes have no dry run. The step 7 preview lists them, and its approval covers them. | They name the new issue, whose ID exists only after the create. This is the rule PMK-113 set for the `related` link, and the one `/pmkit:issues:breakdown` and `/pmkit:spec:import` use for their links. The finish path keeps the same rule for one shape of preview. |
| PMK-121's origin mark on the new issue (a description naming the original) is not part of this issue. It is follow-up 1. | It fixes a failure between the create and the `related` link, before any carry-over write runs, so the carry-over neither causes nor widens it. Adding it needs a second search in step 6 (`issues list --text`) and a finish path that also runs the `related` link, which is a change to the rerun logic, not to what the split carries. |
| No CLI, tracker or config change. | `issues create --criteria-file`, `issues link --kind blocks`, `issues parent` and `issues get` cover every call. ADR-0003 holds. |
| The PMK-122 follow-up on close step 3 counting canceled issues as unfinished stays out. | It is about which issues close offers to move, not about the blocker rule or the split. |
| No CHANGELOG entry. Suggested release line: "`/pmkit:cycle:close` gives the new issue of a split the original's open blockers, open sub-issues and unchecked criteria, and `/pmkit:cycle:plan` names the issues it leaves out for an open blocker." | Earlier PMK specs leave the changelog to the release. |

## Command text changes

### `commands/cycle/close.md`

**Step 6, first paragraph.** After "A new issue in the backlog takes the remaining work, with a `related` link to the original." add:

> It also takes the original's open blockers, its open sub-issues and its unchecked acceptance criteria, as step 7 lists them.

**Step 6, second paragraph.** Replace "step 7 asks for the delivered part, and step 8 runs only the estimate update and the move to `done` of the original." with:

> step 7 asks for the delivered part, and step 8 runs only the blocker links, the sub-issue moves, the estimate update and the move to `done` of the original.

**Step 7.** The first paragraph keeps its text up to "and the original's estimate becomes the delivered part." From there to the end of the step, the text becomes:

```markdown
   When the original has acceptance criteria with `done: false`, write them to a temporary file outside `.issues/`, one `- [ ] <text>` line each, in the original's order. Run `node "${CLAUDE_PLUGIN_ROOT}/scripts/pmkit.mjs" issues create --title "<title>" --type <original type> --estimate <remaining> --parent <original parent> [--priority <original priority>] [--label <original labels>] [--criteria-file <file>] --dry-run --json`. Leave out `--parent` when the original issue has no parent. Add `--priority` and `--label` when the original has them, with the labels comma-separated, and `--criteria-file` when the original has unchecked criteria. Then run `node "${CLAUDE_PLUGIN_ROOT}/scripts/pmkit.mjs" issues update <id> --estimate <delivered> --dry-run --json` to reduce the estimate of the original to the delivered part, and `node "${CLAUDE_PLUGIN_ROOT}/scripts/pmkit.mjs" issues move <id> done --dry-run --json` to mark it delivered.
   - The original stays in the closed sprint as done, and the new issue goes to the backlog, because the create call sets no sprint.
   - Find the original's open blockers and open sub-issues: the IDs in its `blockedBy` and `children` whose status category is not `done` or `canceled`. Take the status from the step 3 read. For an ID that is not in that read, run `node "${CLAUDE_PLUGIN_ROOT}/scripts/pmkit.mjs" issues get <id> --json`. When it fails with `NOT_FOUND`, the issue is missing: name it, and leave it out of the writes.
   - Show the writes that step 8 runs after the create, in order: the `related` link between the two, a `blocks` link from each open blocker to the new issue, and a parent change that moves each open sub-issue from the original to the new issue. They have no dry run, because the new issue's ID exists only after the create. Show the carried criteria from the create's dry run.
   - Say what stays on the original: its `blockedBy` list, every criterion with its check, and its sub-issues in `done` or `canceled`. The split writes only the estimate and the status of the original. A moved sub-issue leaves the original's `children`, and its event log keeps the old parent.

   For a split that a failed step 8 started (step 6), run only the estimate update and the move dry runs above. In place of a create, show the new issue's ID, its `related` link, and the blocker links and sub-issue moves that step 8 runs. The new issue already holds the criteria its create carried.

   Run `node "${CLAUDE_PLUGIN_ROOT}/scripts/pmkit.mjs" cycle close <sprint id> --dry-run --json` as well. Its `unfinished` list is the list before the moves and splits. Step 8 runs them before the close, so the real close leaves no issue unfinished. Moving issues between sprints is a scope move and closing ends the sprint, so show one full preview of all of it and ask once, whatever `write_policy.confirm` says. When the user declines, change nothing.
```

The step 7 bullets name the carry-over writes without a `pmkit.mjs` call, so the parser finds no step 7 `issues link` or `issues parent` call. Step 7 gains one call, `issues get`.

**Step 8, first paragraph** becomes:

```markdown
8. After the approval, run the same moves and splits without `--dry-run`, and close the sprint last. Velocity counts a move to `done` only up to the moment the sprint closes, so every write that moves an issue runs before the close. For each split, run the create first and note the new ID. Then run `node "${CLAUDE_PLUGIN_ROOT}/scripts/pmkit.mjs" issues link <new id> <original id> --kind related --json`. Then, for each open blocker of step 7, run `node "${CLAUDE_PLUGIN_ROOT}/scripts/pmkit.mjs" issues link <blocker id> <new id> --kind blocks --json`, and for each open sub-issue, `node "${CLAUDE_PLUGIN_ROOT}/scripts/pmkit.mjs" issues parent <sub-issue id> <new id> --json`. Then run the estimate update, then `node "${CLAUDE_PLUGIN_ROOT}/scripts/pmkit.mjs" issues move <original id> done --json`. The move to `done` is the last write of a split, because step 6 of a second run finds a split only while its original is unfinished. For a split that a failed step 8 started, run the blocker links, the sub-issue moves, the estimate update and the move. A link or parent change that already ran writes nothing. The approval of step 7 covers the links and the parent changes, because the preview showed them. After the last move and split, run `node "${CLAUDE_PLUGIN_ROOT}/scripts/pmkit.mjs" cycle close <sprint id> --json`. When its `unfinished` list is not empty, those issues joined the sprint after step 3. Name each one and say it stays in the closed sprint.
```

The second and third paragraphs of step 8 stay. "For a split whose create ran, give the new ID and the commands of that split that did not run" already covers the carry-over writes.

**Confirmation points**, the step 7 bullet becomes:

```markdown
- Step 7: the decision per unfinished issue, then one full preview of the moves, the splits (the new issue with the carried criteria, its `related` link, the blocker links and sub-issue moves, the reduced estimate, the move of the original to `done`, and what stays on it) and the close, always asked because it holds scope moves. Declining changes nothing.
```

**Output**, the sentence "For each split, give the new issue's ID and the original's delivered estimate." becomes:

> For each split, give the new issue's ID, the original's delivered estimate, and the blockers, sub-issues and criteria the new issue took over.

Steps 1 to 5, 9 and 10 and "If something is missing" do not change.

### `commands/cycle/plan.md`

**Step 5** becomes:

```markdown
5. Draft the scope. Run `node "${CLAUDE_PLUGIN_ROOT}/scripts/pmkit.mjs" issues list --category todo,backlog,in_progress --sprint none --json`. Keep the issues in creation order, oldest first, as the CLI returns them, and move each blocker before what it blocks. An open blocker is a `blockedBy` issue not in `done` or `canceled`. For each `blockedBy` ID that is not in this list, run `node "${CLAUDE_PLUGIN_ROOT}/scripts/pmkit.mjs" issues get <blocker id> --json` for its status. A blocker that `issues get` does not find (`NOT_FOUND`) is missing, and counts as open. Skip an issue with an open blocker that is not in the selection, and keep it in a list of issues left out for an open blocker, with each such blocker's ID and status category. Add issues until the total estimate reaches the team capacity. Flag every issue with no estimate and leave it out of the total. Draft a goal from the selected issues, or use the one given.
```

**Step 8**, after "with the committed estimate against capacity and the risks of the Output section." add:

> Below the table, list the issues step 5 left out for an open blocker, each with the blocker's ID and status category, so the user can add one back.

The table sentence stays as it is, so the PMK-122 test "cycle/plan step 8 shows the status of each offered issue" still passes.

**Output**, "They are the unestimated issues, the issues with a blocker outside the sprint, and any member whose assigned estimate is above their capacity." becomes:

> They are the unestimated issues, the issues the user added back in step 8 whose open blocker is outside the sprint, and any member whose assigned estimate is above their capacity. Then list the issues left out for an open blocker, each with its blocker's ID and status category.

Steps 1 to 4, 6, 7 and 9, the confirmation points and "If something is missing" do not change. `commands/issues/work.md` does not change: its step 1 already uses the definition plan now uses.

## Scenarios

### `scripts/__scenarios__/cycle-close.mjs`

- Header comment: the split gives the new issue the blocker ISS-5N1R, the sub-issue ISS-4M2S and the unchecked criterion of ISS-2X6D.
- New inputs: `_inputs/split-criteria.md` (`- [x] Export invoices for a date range` and `- [ ] Totals row at the bottom`) and `_inputs/remaining-criteria.md` (`- [ ] Totals row at the bottom`).
- `setup` also runs `['issues', 'update', 'ISS-2X6D', '--criteria-file', <split-criteria.md>]`. The fixture's ISS-2X6D has no criteria, and the snapshot baseline comes after setup.
- The `split` args gain `'--criteria-file', <remaining-criteria.md>`.
- `skip: { '7 issues get': 'ISS-5N1R and ISS-4M2S, the blocker and the sub-issue of ISS-2X6D, are in the sprint, so the step 3 read gives their status' }`.
- After the `related` link entry, in this order:
  - `{ step: '8', write: ({ remaining }) => ['issues', 'link', 'ISS-5N1R', remaining.after.id, '--kind', 'blocks'] }`
  - `{ step: '8', write: ({ remaining }) => ['issues', 'parent', 'ISS-4M2S', remaining.after.id] }`
- `expect` adds:
  - `remaining.blocked_by` deep-equals `['ISS-5N1R']`;
  - `repo.issue('ISS-4M2S').parent` equals the new ID;
  - the new issue's file matches `/## Acceptance criteria\n\n- \[ \] Totals row at the bottom\n?$/m` and has no `[x]` line;
  - the original keeps what it had: `original.blocked_by` deep-equals `['ISS-5N1R']`, and its file still has both criteria with their checks.

On today's text, rule 5 fails twice: the step 7 create call has no `--criteria-file`, and step 8 has no `issues parent` call.

### `scripts/__scenarios__/cycle-plan.mjs`

- `setup` adds two links after the existing `cycle add`: `['issues', 'link', 'ISS-5N1R', 'ISS-6J0B', '--kind', 'blocks']` (a blocker in the selection, as ISS-5N1R blocks the new issue of the close scenario) and `['issues', 'link', 'ISS-8C4W', 'ISS-3F7H', '--kind', 'blocks']` (ISS-8C4W is `in_review` in the active sprint, so it is open and outside the selection).
- After the step 5 `issues list` entry: `{ step: '5', read: ['issues', 'get', 'ISS-8C4W'], save: 'blocker' }`.
- `add` leaves out ISS-3F7H: `saved.scope.issues.map((issue) => issue.id).filter((id) => id !== 'ISS-3F7H')`, with a comment that step 5 leaves it out for its open blocker.
- `expect`: the scope order assertion stays (`['ISS-5N1R', 'ISS-3F7H', 'ISS-6J0B', 'ISS-4M2S']`, the CLI's list). `saved.blocker.status.category` is `in_review`. `repo.issue('ISS-3F7H').sprint` is `undefined`. ISS-5N1R, ISS-6J0B and ISS-4M2S have sprint `2026-10-26`.
- Header comment: capacity 14 covers 3 + 1 points. ISS-6J0B has no estimate and is flagged. ISS-3F7H is left out because ISS-8C4W blocks it.

On today's text, rule 5 fails: step 5 has no `issues get` call.

## Tests per criterion

| Criterion | Test | Where | Why it fails on today's text |
| --- | --- | --- | --- |
| 1 | `cycle/close carries a split's open blockers, open sub-issues and unchecked criteria to the new issue` | `scripts/scenarios.test.mjs`, beside the PMK-121 step 8 test | Today's step 7 create call has no `criteria-file` flag, step 8 has no `issues parent` call and no `issues link` call with `--kind blocks`, and step 7 says "whose status category is not `done`". |
| 1 | scenario `cycle-close` | `scripts/__scenarios__/cycle-close.mjs` | Rule 5 on the create entry with `--criteria-file` and on the `issues parent` entry. Its `expect` then proves the writes land on the right issues. |
| 2 | `cycle/plan step 5 reads blockers outside its list, counts canceled as closed and names what it leaves out` | `scripts/scenarios.test.mjs` | Today's step 5 has no `issues get` call and says "not done", and step 8 does not mention issues left out. |
| 2 | scenario `cycle-plan` | `scripts/__scenarios__/cycle-plan.mjs` | Rule 5 on the step 5 `issues get` entry. |
| 1, 2 guard | `a split in cycle close leaves the remaining work for cycle plan`, extended | `scripts/cli.test.mjs` | Passes before and after, because it calls the CLI directly. It runs the carry-over writes after the `related` link and asserts that plan's step 5 query returns the new issue with `blockedBy: ['ISS-5N1R']` and `children: ['ISS-4M2S']`, and that `issues get` gives it the unchecked criterion. A comment says it guards the data and does not fail first. |
| 3 | `npm test` | whole suite | The four tests above are red on today's text and green after the change. |

A check in the session scratchpad applied the new text of steps 7 and 8, the step 7 confirmation point and plan steps 5 and 8 to temp copies of `close.md` and `plan.md` and parsed them with `parseCommandFile`. No loose flag, no unknown flag, and every call ends with `--json`. Close step 7 gains `7 issues get`, and step 8 gives `issues link`, `issues link`, `issues parent`, `issues move`, `cycle close`, `cycle issues`. Plan step 5 gives `issues list`, `issues get`. The two outlines below fail on today's files and pass on the copies, and the PMK-121 step 8 test and the PMK-122 step 5 and step 8 tests pass on both.

The criterion 1 static test, in outline:

```js
test('cycle/close carries a split\'s open blockers, open sub-issues and unchecked criteria to the new issue', () => {
  const calls = FILES.find((file) => file.rel === 'cycle/close.md').parsed.calls
  const create = calls.find((c) => c.step === '7' && c.command === 'issues create' && c.dryRun)
  assert.ok(create?.flags.includes('criteria-file'), 'the step 7 create carries the unchecked criteria')
  const step8 = calls.filter((c) => c.step === '8' && !c.dryRun)
  const move = step8.findIndex((c) => c.command === 'issues move')
  const blocks = step8.findIndex((c) => c.command === 'issues link' && /--kind blocks(?:\s|$)/.test(c.text))
  const parent = step8.findIndex((c) => c.command === 'issues parent')
  assert.ok(blocks >= 0 && blocks < move, 'step 8 links each open blocker to the new issue before the move to done')
  assert.ok(parent >= 0 && parent < move, 'step 8 moves each open sub-issue to the new issue before the move to done')
  const text = fs.readFileSync(path.join(COMMANDS_DIR, 'cycle', 'close.md'), 'utf8')
  assert.match(text, /`blockedBy` and `children` whose status category is not `done` or `canceled`/)
})
```

The criterion 2 static test, in outline:

```js
test('cycle/plan step 5 reads blockers outside its list, counts canceled as closed and names what it leaves out', () => {
  const calls = FILES.find((file) => file.rel === 'cycle/plan.md').parsed.calls
  assert.ok(calls.some((c) => c.step === '5' && c.command === 'issues get' && !c.dryRun), 'step 5 reads each blocker outside its list')
  const lines = fs.readFileSync(path.join(COMMANDS_DIR, 'cycle', 'plan.md'), 'utf8').split('\n')
  assert.match(lines.find((line) => line.startsWith('5. ')), /An open blocker is a `blockedBy` issue not in `done` or `canceled`/)
  assert.match(lines.find((line) => line.startsWith('8. ')), /left out for an open blocker/)
})
```

## Snapshots

Two snapshots change: `scripts/__scenarios__/cycle-close.after.txt` and `scripts/__scenarios__/cycle-plan.after.txt`. Regenerate them with `UPDATE_GOLDENS=1 node --test scripts/scenarios.test.mjs`, never by hand, then read `git diff scripts/__scenarios__/` line by line before the commit.

Expected diff of `cycle-close.after.txt`:

- The create rows (dry run and write) gain `--criteria-file <inputs>/remaining-criteria.md`.
- Two new `[step 8, write]` rows after the `related` link: `issues link ISS-5N1R <new id> --kind blocks --json` and `issues parent ISS-4M2S <new id> --json`.
- The new issue's `issue.md` gains `blocked_by: [ISS-5N1R]` and an `## Acceptance criteria` section with `- [ ] Totals row at the bottom`, and its `events.jsonl` gains a `link` event.
- ISS-4M2S's `issue.md` changes `parent: ISS-2X6D` to the new ID, and its `events.jsonl` gains an `update` event on `parent`.
- ISS-5N1R's files do not change, because `blocks` is computed.
- The new issue's ID may differ from today's ISS-M0GZ. Any other changed line is a finding to explain before the commit.

Expected diff of `cycle-plan.after.txt`:

- A new `issues get ISS-8C4W --json  [step 5, read]` row.
- The `cycle add` dry run and write list `ISS-5N1R ISS-6J0B ISS-4M2S`, without ISS-3F7H.
- The file changes no longer touch ISS-3F7H. The setup links come before the baseline, so they are not in the snapshot.

No file under `scripts/__goldens__/` changes, because no CLI output changes. No other scenario changes.

## Risks and non-goals

- A sub-issue that is split in the same close is open in the step 3 read, so the parent's split moves it to the parent's new issue, and its own split then moves it to `done` there. A blocker split in the same close gets linked to the parent's new issue, then moves to `done`, so its own new issue does not block the parent's new issue. Nothing is lost, and the preview shows both. Follow-up 3 orders such splits.
- A half-done split from a pmkit before this change has no carried criteria. Its finish path runs the blocker links and sub-issue moves, and does not add the criteria.
- The issues the original blocks (its `blocks` list) are not carried. They become unblocked when the original moves to `done`. The issue names three kinds, and this is a fourth (follow-up 2).
- The done original still lists its open blocker, so `issues list --blocked` lists it, as it does today (follow-up 4).
- No change to the CLI, the tracker, `commands/issues/work.md` or any command other than `cycle:close` and `cycle:plan`.

## Open questions

1. S1 changes the `parent` of each open sub-issue and so takes it out of the done original's computed `children`. No record or field is deleted, the sub-issue's event log keeps the old parent, and the step 7 preview shows the move before the user approves it. The orchestrator should confirm it does not count this as a removal of user data that needs the user's say before the plan stage. If it does, S2 (relate) is the fallback: it removes nothing and leaves the sub-issue under the done original.

## Follow-up candidates

None changes this design, and none deletes data. Each would be a new issue, `related` to PMK-123.

1. **Mark the new issue of a split with its origin** (PMK-121 open question 1). A create that ran with a `related` link that did not leaves no trace a second run can read. A description line naming the original, and a step 6 search with `issues list --text <original id> --sprint none`, would let a second run finish that split.
2. **Carry the original's `blocks` list.** The issues the original blocks lose their blocker when it moves to `done`, though the remaining work is open. A split could add `issues link <new id> <blocked id> --kind blocks` for each.
3. **Order nested splits in one close.** When a blocker or a sub-issue of a split is split too, run its split first, and carry its new issue in its place.
4. **`issues list --blocked` lists done issues.** The CLI's blocked filter ignores the issue's own status. `/pmkit:issues:find` passes it on, so a user asking for blocked work sees done issues with an open blocker.
5. **Close step 3 counts canceled issues as unfinished** (PMK-122 note). `closeCycle` leaves them out.

## Left to the builder

- The wording of the preview rows for the carry-over writes.
- Where the two static tests sit in `scripts/scenarios.test.mjs`, next to the PMK-121 and PMK-122 tests.
- The exact assertions that read the criteria from the new issue's file in the `cycle-close` `expect`.
