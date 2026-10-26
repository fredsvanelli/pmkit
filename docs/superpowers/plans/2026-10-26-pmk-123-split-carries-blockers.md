# PMK-123 split carries blockers, sub-issues and criteria Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A split in `/pmkit:cycle:close` gives the new issue the original's open blockers (copied), open sub-issues (moved) and unchecked criteria (copied in the create), the step 7 preview lists those writes, and `/pmkit:cycle:plan` step 5 names each issue it leaves out for an open blocker.

**Architecture:** A text-only change to `commands/cycle/close.md` and `commands/cycle/plan.md`. No CLI, tracker or config change: `issues create --criteria-file`, `issues link --kind blocks`, `issues parent`, `issues list --blocked` and `issues get` already exist. Four static tests in `scripts/scenarios.test.mjs` and the two scenarios `cycle-close` and `cycle-plan` fail on today's text. Their snapshots are regenerated. A CLI guard in `scripts/cli.test.mjs` checks the data the split leaves for plan.

**Tech Stack:** Node 18+ ES modules, no dependencies (ADR 0003), `node:test`. Run the suite with `npm test` (`node scripts/run-tests.mjs`).

**Spec:** `docs/superpowers/specs/2026-10-26-pmk-123-split-carries-blockers-design.md` (latest commit e614dd5). The spec is the authority. Where this plan and the spec differ, the spec wins, and the implementer reports the difference.

## Global Constraints

Every value below was checked on a scratch copy of the repo at e614dd5. The plan author applied G1 to G6 there. The four static tests and both scenarios failed on today's text as G8 says, then passed, and the snapshot diffs came out exactly as G7 shows. `npm test` then reported 1093 tests, all passing.

### G1. The new text of `commands/cycle/close.md`

Edit only these places. Steps 1 to 5, 9 and 10, the second and third paragraphs of step 8, the Step 1 and Step 9 confirmation points and "If something is missing" stay byte for byte.

**G1.1 Step 6, first paragraph.** After this sentence

```text
A new issue in the backlog takes the remaining work, with a `related` link to the original.
```

insert one space and this sentence, on the same line:

```text
It also takes the original's open blockers, its open sub-issues and its unchecked acceptance criteria, as step 7 lists them.
```

**G1.2 Step 6, second paragraph.** Replace

```text
step 7 asks for the delivered part, and step 8 runs only the estimate update and the move to `done` of the original.
```

with

```text
step 7 asks for the delivered part, and step 8 runs only the blocker links, the sub-issue moves, the estimate update and the move to `done` of the original.
```

**G1.3 Step 7.** The line that starts with `7. ` keeps its text up to and including `and the original's estimate becomes the delivered part.` Everything after that sentence, to the line before `8. `, is replaced by the block below. Its first line (`When the original has acceptance criteria ...`) joins the `7. ` line after one space, without the three leading spaces, so the step's first paragraph stays one line. Every later line of the block is a line of its own, with its leading spaces as shown. The blank lines stay.

```markdown
   When the original has acceptance criteria with `done: false`, write them to a temporary file outside `.issues/`, one `- [ ] <text>` line each, in the original's order. Keep the file until step 10, because step 8 passes the same path. Run `node "${CLAUDE_PLUGIN_ROOT}/scripts/pmkit.mjs" issues create --title "<title>" --type <original type> --estimate <remaining> --parent <original parent> [--priority <original priority>] [--label <original labels>] [--criteria-file <file>] --dry-run --json`. Leave out `--parent` when the original issue has no parent. Add `--priority` and `--label` when the original has them, with the labels comma-separated, and `--criteria-file` when the original has unchecked criteria. The dry run returns an ID that the real create does not reuse, so the preview calls the created issue "the new issue" and does not show that ID. Then run `node "${CLAUDE_PLUGIN_ROOT}/scripts/pmkit.mjs" issues update <id> --estimate <delivered> --dry-run --json` to reduce the estimate of the original to the delivered part, and `node "${CLAUDE_PLUGIN_ROOT}/scripts/pmkit.mjs" issues move <id> done --dry-run --json` to mark it delivered.
   - The original stays in the closed sprint as done, and the new issue goes to the backlog, because the create call sets no sprint.
   - Find the original's open blockers and open sub-issues: the IDs in its `blockedBy` and `children` whose status category is not `done` or `canceled`. Take the status from the step 3 read. For an ID that is not in that read, run `node "${CLAUDE_PLUGIN_ROOT}/scripts/pmkit.mjs" issues get <id> --json`. When that read fails, for example with `NOT_FOUND` for a missing issue, name the ID and the error, and leave it out of the writes. For a blocker, say that the split does not copy it, so the new issue will not show as blocked by it.
   - Show the writes that step 8 runs after the create, in order: the `related` link between the two, a `blocks` link from each open blocker to the new issue, and a parent change that moves each open sub-issue from the original to the new issue. They have no dry run, because the new issue's ID exists only after the create. Show the carried criteria from the create's dry run.
   - When a blocker or a sub-issue that the split carries is itself split in this close, name it and say what the new issue ends up pointing to. A carried blocker moves to `done` in its own split. The new issue is then blocked only by a done issue and looks free to start, and the blocker's own new issue does not block it. A carried sub-issue moves under the new issue and then to `done` in its own split. The new issue's sub-issue then holds only the delivered part, and the sub-issue's own new issue lands under the done original, because its create takes the parent from the step 3 read. Say that the user can add those links by hand after the close.
   - Say what stays on the original: its `blockedBy` list, every criterion with its check, and its sub-issues in `done` or `canceled`. The split writes only the estimate and the status of the original. A moved sub-issue leaves the original's `children`, and its event log keeps the old parent.

   For a split that a failed step 8 started (step 6), run only the estimate update and the move dry runs above. In place of a create, show the new issue's ID, its `related` link, and the blocker links and sub-issue moves that step 8 runs. The new issue already holds the criteria its create carried.

   Run `node "${CLAUDE_PLUGIN_ROOT}/scripts/pmkit.mjs" cycle close <sprint id> --dry-run --json` as well. Its `unfinished` list is the list before the moves and splits. Step 8 runs them before the close, so the real close leaves no issue unfinished. Moving issues between sprints is a scope move and closing ends the sprint, so show one full preview of all of it and ask once, whatever `write_policy.confirm` says. When the user declines, change nothing.
```

**G1.4 Step 8, first paragraph.** The whole line that starts with `8. ` becomes:

```markdown
8. After the approval, run the same moves and splits without `--dry-run`, and close the sprint last. Velocity counts a move to `done` only up to the moment the sprint closes, so every write that moves an issue runs before the close. For each split, run the create first, with the arguments of its step 7 dry run, the same criteria file path included, and note the new ID. Then run `node "${CLAUDE_PLUGIN_ROOT}/scripts/pmkit.mjs" issues link <new id> <original id> --kind related --json`. Then, for each open blocker of step 7, run `node "${CLAUDE_PLUGIN_ROOT}/scripts/pmkit.mjs" issues link <blocker id> <new id> --kind blocks --json`, and for each open sub-issue, `node "${CLAUDE_PLUGIN_ROOT}/scripts/pmkit.mjs" issues parent <sub-issue id> <new id> --json`. Then run the estimate update, then `node "${CLAUDE_PLUGIN_ROOT}/scripts/pmkit.mjs" issues move <original id> done --json`. The move to `done` is the last write of a split, because step 6 of a second run finds a split only while its original is unfinished. For a split that a failed step 8 started, run the blocker links, the sub-issue moves, the estimate update and the move. A link or parent change that already ran writes nothing. The approval of step 7 covers the links and the parent changes, because the preview showed them. After the last move and split, run `node "${CLAUDE_PLUGIN_ROOT}/scripts/pmkit.mjs" cycle close <sprint id> --json`. When its `unfinished` list is not empty, those issues joined the sprint after step 3. Name each one and say it stays in the closed sprint.
```

**G1.5 Confirmation points.** The line that starts with `- Step 7: ` becomes:

```markdown
- Step 7: the decision per unfinished issue, then one full preview of the moves, the splits (the new issue with the carried criteria, its `related` link, the blocker links and sub-issue moves, the warnings for a carried issue that is split in the same close or cannot be read, the reduced estimate, the move of the original to `done`, and what stays on it) and the close, always asked because it holds scope moves. Declining changes nothing.
```

**G1.6 Output.** Replace `For each split, give the new issue's ID and the original's delivered estimate.` with:

```text
For each split, give the new issue's ID, the original's delivered estimate, and the blockers, sub-issues and criteria the new issue took over.
```

Parser rule (spec, "Command text changes"): a backticked flag in a step's prose joins the last call before it in that step. Do not add a backticked `--parent`, `--criteria-file` or any other flag to the new prose of steps 7 and 8. Rule 3 (`every flag of every command file exists in the CLI`) fails if one lands after `issues get` or `issues link`.

### G2. The new text of `commands/cycle/plan.md`

Edit only these places. Steps 1 to 4, 6, 7 and 9, the confirmation points and "If something is missing" stay byte for byte.

**G2.1 Step 5.** The whole line that starts with `5. ` becomes:

```markdown
5. Draft the scope. Run `node "${CLAUDE_PLUGIN_ROOT}/scripts/pmkit.mjs" issues list --category todo,backlog,in_progress --sprint none --json`. Keep the issues in creation order, oldest first, as the CLI returns them, and move each blocker before what it blocks. An open blocker is a `blockedBy` issue not in `done` or `canceled`, or one that is missing. Run `node "${CLAUDE_PLUGIN_ROOT}/scripts/pmkit.mjs" issues list --category todo,backlog,in_progress --sprint none --blocked --json` for the issues of the first list that have an open blocker. For each `blockedBy` ID of those issues that is not in the first list, run `node "${CLAUDE_PLUGIN_ROOT}/scripts/pmkit.mjs" issues get <blocker id> --json` once, for its status category and its `sprint`. A blocker that `issues get` cannot read, for example with `NOT_FOUND`, counts as open. A blocker counts as selected when it is in the selection, or when step 1 chose an existing `planned` sprint and the blocker's `sprint` is that sprint's ID, for example because `/pmkit:cycle:close` moved it there. Skip an issue with an open blocker that is not selected, and keep it in a list of issues left out for an open blocker, with each such blocker's ID and its status category or read error. Add issues until the total estimate reaches the team capacity. Flag every issue with no estimate and leave it out of the total. Draft a goal from the selected issues, or use the one given.
```

**G2.2 Step 8.** After `with the committed estimate against capacity and the risks of the Output section.` insert one space and this sentence, on the same line. The table sentence before it does not change, so the PMK-122 test `cycle/plan step 8 shows the status of each offered issue` still passes.

```text
Below the table, list the issues step 5 left out for an open blocker, each with the blocker's ID and status category, so the user can add one back.
```

**G2.3 Output.** Replace `They are the unestimated issues, the issues with a blocker outside the sprint, and any member whose assigned estimate is above their capacity.` with:

```text
They are the unestimated issues, every issue in the scope whose open blocker is not in the sprint, and any member whose assigned estimate is above their capacity. Then list the issues left out for an open blocker, each with its blocker's ID and status category.
```

### G3. Static tests in `scripts/scenarios.test.mjs`

All four go inside `describe('scenarios', ...)`, with the two-space indent shown.

**G3.1 The close tests (criterion 1 and review finding I2).** Insert after the test `cycle/close step 8 runs cycle close after every issues link and issues move call` and before the comment line `// The in_review assertion encodes the PMK-122 decision ...`, with one blank line before and after:

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

  test('cycle/close step 7 previews the blocker links and sub-issue moves of a split', () => {
    const lines = fs.readFileSync(path.join(COMMANDS_DIR, 'cycle', 'close.md'), 'utf8').split('\n')
    const step7 = lines.slice(lines.findIndex((line) => line.startsWith('7. ')), lines.findIndex((line) => line.startsWith('8. '))).join('\n')
    assert.match(step7, /a `blocks` link from each open blocker to the new issue/, 'the step 7 preview shows the blocker links')
    assert.match(step7, /a parent change that moves each open sub-issue from the original to the new issue/, 'the step 7 preview shows the sub-issue moves')
    assert.doesNotMatch(step7, /The close does not move or copy them/, 'step 7 no longer says the close leaves them on the original')
    const point = lines.find((line) => line.startsWith('- Step 7: '))
    assert.match(point, /the blocker links and sub-issue moves/, 'the Step 7 confirmation point names the carry-over writes')
  })
```

**G3.2 The plan tests (criterion 2 and the orchestrator's I1 ruling).** Insert after the test `cycle/plan step 8 shows the status of each offered issue` and before the `for (const { name, entries } of LOADED)` loop, with one blank line before and after. The first test is the spec's outline. The second is the I1 check the orchestrator asked for: the spec has no I1 scenario (the `team` fixture has no planned sprint, follow-up 6), so this test pins the whole rule sentence of G2.1 and fails on its own on today's text.

```js
  test('cycle/plan step 5 reads blockers outside its list, counts canceled as closed and names what it leaves out', () => {
    const calls = FILES.find((file) => file.rel === 'cycle/plan.md').parsed.calls
    assert.ok(calls.some((c) => c.step === '5' && c.command === 'issues list' && c.flags.includes('blocked') && !c.dryRun), 'step 5 lists the candidates with an open blocker')
    assert.ok(calls.some((c) => c.step === '5' && c.command === 'issues get' && !c.dryRun), 'step 5 reads each blocker outside its list')
    const lines = fs.readFileSync(path.join(COMMANDS_DIR, 'cycle', 'plan.md'), 'utf8').split('\n')
    const step5 = lines.find((line) => line.startsWith('5. '))
    assert.match(step5, /An open blocker is a `blockedBy` issue not in `done` or `canceled`/)
    assert.match(step5, /the blocker's `sprint` is that sprint's ID/, 'a blocker already in the planned sprint counts as selected')
    assert.match(lines.find((line) => line.startsWith('8. ')), /left out for an open blocker/)
    assert.match(lines.find((line) => line.startsWith('The sprint plan.')), /every issue in the scope whose open blocker is not in the sprint/)
  })

  // The orchestrator's ruling on I1: no scenario covers a blocker already in the planned sprint (follow-up 6 of the
  // spec), so this test pins the whole rule sentence.
  test('cycle/plan step 5 counts a blocker already in the planned sprint as selected', () => {
    const step5 = fs.readFileSync(path.join(COMMANDS_DIR, 'cycle', 'plan.md'), 'utf8').split('\n').find((line) => line.startsWith('5. '))
    assert.ok(step5, 'plan.md has a step 5')
    assert.ok(step5.includes("A blocker counts as selected when it is in the selection, or when step 1 chose an existing `planned` sprint and the blocker's `sprint` is that sprint's ID"), 'step 5 counts a blocker in the planned sprint as selected')
  })
```

### G4. Scenario `scripts/__scenarios__/cycle-close.mjs`

Two new input files, each ending with one newline:

- `scripts/__scenarios__/_inputs/split-criteria.md`:

  ```text
  - [x] Export invoices for a date range
  - [ ] Totals row at the bottom
  ```

- `scripts/__scenarios__/_inputs/remaining-criteria.md`:

  ```text
  - [ ] Totals row at the bottom
  ```

The module changes, as a diff against e614dd5 (header comment, the two input paths, the `split` args, the setup write, the two step 8 entries after the `related` link, the `skip`, and the `expect` assertions):

```diff
diff --git a/scripts/__scenarios__/cycle-close.mjs b/scripts/__scenarios__/cycle-close.mjs
index c7393db..eae16eb 100644
--- a/scripts/__scenarios__/cycle-close.mjs
+++ b/scripts/__scenarios__/cycle-close.mjs
@@ -3,7 +3,9 @@
 // The active sprint 2026-10-12 then has one done issue and three unfinished ones. No sprint is planned, so the
 // user sends ISS-4M2S and ISS-5N1R back to the backlog and splits ISS-2X6D: a new issue under EPC-2M9D takes the
 // remaining 3 points in the backlog, with a related link to ISS-2X6D, and ISS-2X6D moves to done with 5 points
-// instead of 8 and stays in the closed sprint.
+// instead of 8 and stays in the closed sprint. The split gives the new issue the blocker ISS-5N1R, the sub-issue
+// ISS-4M2S and the unchecked criterion of ISS-2X6D. Setup gives ISS-2X6D one checked and one unchecked criterion,
+// because the fixture's ISS-2X6D has none.
 // Step 6 reads ISS-0G5E, the issue outside the sprint that the related list of ISS-2X6D names. It is canceled and
 // older than the sprint, so it is no half-done split. Step 8 runs the moves and the split, closes the sprint last,
 // then reads the sprint's issues again for the delivered numbers.
@@ -16,9 +18,12 @@ const merged = {
   isDraft: false, headRefName: 'feat-dlq', author: { login: 'ana' }, mergedAt: '2026-10-22T15:00:00Z',
 }
 const retro = path.join(import.meta.dirname, '_inputs', 'retro.md')
+const splitCriteria = path.join(import.meta.dirname, '_inputs', 'split-criteria.md')
+const remainingCriteria = path.join(import.meta.dirname, '_inputs', 'remaining-criteria.md')
 const toBacklog = ['cycle', 'add', 'ISS-4M2S', 'ISS-5N1R', '--to', 'none']
-// The split keeps the type, priority and labels of ISS-2X6D (feature, high, billing and backend).
-const split = ['issues', 'create', '--title', 'Finish the billing export to CSV', '--type', 'feature', '--estimate', '3', '--parent', 'EPC-2M9D', '--priority', 'high', '--label', 'billing,backend']
+// The split keeps the type, priority and labels of ISS-2X6D (feature, high, billing and backend), and carries its
+// unchecked criterion.
+const split = ['issues', 'create', '--title', 'Finish the billing export to CSV', '--type', 'feature', '--estimate', '3', '--parent', 'EPC-2M9D', '--priority', 'high', '--label', 'billing,backend', '--criteria-file', remainingCriteria]
 const shrink = ['issues', 'update', 'ISS-2X6D', '--estimate', '5']
 const done = ['issues', 'move', 'ISS-2X6D', 'done']
 const close = ['cycle', 'close', '2026-10-12']
@@ -31,6 +36,7 @@ export default {
   gh: { [`pr view feat-dlq --json ${VIEW}`]: { stdout: JSON.stringify(merged) } },
   async setup({ pmkit }) {
     await pmkit(['issues', 'update', 'ISS-8C4W', '--branch', 'feat-dlq'])
+    await pmkit(['issues', 'update', 'ISS-2X6D', '--criteria-file', splitCriteria])
   },
   prompt: '/pmkit:cycle:close',
   answers: ['Yes', 'Split ISS-2X6D, move ISS-4M2S and ISS-5N1R to the backlog', 'Yes', 'Yes'],
@@ -54,10 +60,13 @@ export default {
     { step: '7', dryRun: done },
     { step: '7', dryRun: close },
     { confirm: 'Step 7' },
-    // Step 8: the same moves and the split without --dry-run (create, link, estimate, move), then the close.
+    // Step 8: the same moves and the split without --dry-run (create, related link, blocker link, sub-issue move,
+    // estimate, move), then the close.
     { step: '7', write: toBacklog },
     { step: '7', write: split, save: 'remaining' },
     { step: '8', write: ({ remaining }) => ['issues', 'link', remaining.after.id, 'ISS-2X6D', '--kind', 'related'] },
+    { step: '8', write: ({ remaining }) => ['issues', 'link', 'ISS-5N1R', remaining.after.id, '--kind', 'blocks'] },
+    { step: '8', write: ({ remaining }) => ['issues', 'parent', 'ISS-4M2S', remaining.after.id] },
     { step: '7', write: shrink },
     { step: '8', write: done },
     { step: '8', write: close },
@@ -68,7 +77,7 @@ export default {
     { confirm: 'Step 9' },
     { step: '9', write: writeRetro },
   ],
-  skip: {},
+  skip: { '7 issues get': 'ISS-5N1R and ISS-4M2S, the blocker and the sub-issue of ISS-2X6D, are in the sprint, so the step 3 read gives their status' },
   notHit: {},
   expect(repo, saved) {
     assert.equal(repo.sprint('2026-10-12').state, 'closed')
@@ -94,6 +103,16 @@ export default {
     assert.deepEqual(remaining.labels, original.labels, 'the split keeps the labels')
     assert.ok(original.related.includes(saved.remaining.after.id), 'the original links to the new issue')
     assert.ok(remaining.related.includes('ISS-2X6D'), 'the new issue links to the original')
+    // The carry-over: the open blocker is copied, the open sub-issue moves, and the unchecked criterion is copied.
+    assert.deepEqual(remaining.blocked_by, ['ISS-5N1R'], 'the new issue is blocked by the original\'s open blocker')
+    assert.equal(repo.issue('ISS-4M2S').parent, saved.remaining.after.id, 'the open sub-issue moves to the new issue')
+    const remainingFile = repo.file(`.issues/issues/${saved.remaining.after.id}/issue.md`)
+    assert.match(remainingFile, /## Acceptance criteria\n\n- \[ \] Totals row at the bottom\n?$/m)
+    assert.doesNotMatch(remainingFile, /\[x\]/, 'the new issue takes only the unchecked criterion')
+    assert.deepEqual(original.blocked_by, ['ISS-5N1R'], 'the original keeps its blocker')
+    const originalFile = repo.file('.issues/issues/ISS-2X6D/issue.md')
+    assert.match(originalFile, /^- \[x\] Export invoices for a date range$/m, 'the original keeps its checked criterion')
+    assert.match(originalFile, /^- \[ \] Totals row at the bottom$/m, 'the original keeps its unchecked criterion')
     // Criterion 1: no issue stays open in the closed sprint.
     const open = saved.after.filter((issue) => !['done', 'canceled'].includes(issue.status.category)).map((issue) => issue.id)
     assert.deepEqual(open, [], 'every issue left in the closed sprint is done or canceled')
```

### G5. Scenario `scripts/__scenarios__/cycle-plan.mjs`

The module changes, as a diff against e614dd5 (header comment, the `scope` helper that leaves out ISS-3F7H, the two setup links, the two step 5 entries, and the `expect` assertions). The scope order assertion stays, because `saved.scope` is the CLI's first list.

```diff
diff --git a/scripts/__scenarios__/cycle-plan.mjs b/scripts/__scenarios__/cycle-plan.mjs
index ad4d83c..5cde824 100644
--- a/scripts/__scenarios__/cycle-plan.mjs
+++ b/scripts/__scenarios__/cycle-plan.mjs
@@ -1,14 +1,18 @@
 // /pmkit:cycle:plan on the team fixture. No sprint is planned, so step 1 does not ask. The active sprint 2026-10-12
 // ends on 2026-10-25, so the next one runs from Monday 2026-10-26 to 2026-11-08 (14 days). The formula of step 4
 // gives fred=6 and ana=4 (velocity 10, 10 working days, availability 1 and 0.8); in step 6 the user raises them to
-// fred=8 and ana=6. The scope is every todo, backlog or in_progress issue without a sprint. Capacity 14 covers
-// 3 + 2 + 1 points, and ISS-6J0B has no estimate and is flagged as a risk. The sprint ID comes from the saved
-// result of cycle open.
+// fred=8 and ana=6. The scope is every todo, backlog or in_progress issue without a sprint. Setup links two
+// blockers: ISS-5N1R blocks ISS-6J0B and is in the selection, and ISS-8C4W (in_review, in the active sprint)
+// blocks ISS-3F7H. Step 5 reads ISS-8C4W, the one blocker outside its list, and leaves ISS-3F7H out because
+// ISS-8C4W is open and not selected. Capacity 14 covers 3 + 1 points, and ISS-6J0B has no estimate and is flagged
+// as a risk. The sprint ID comes from the saved result of cycle open.
 import assert from 'node:assert/strict'
 
 const goal = 'Dashboard empty state and build tooling'
 const open = ['cycle', 'open', '--start', '2026-10-26', '--end', '2026-11-08', '--goal', goal]
-const add = (saved) => ['cycle', 'add', ...saved.scope.issues.map((issue) => issue.id), '--to', saved.sprint.after.id]
+// Step 5 leaves ISS-3F7H out for its open blocker ISS-8C4W.
+const scope = (saved) => saved.scope.issues.map((issue) => issue.id).filter((id) => id !== 'ISS-3F7H')
+const add = (saved) => ['cycle', 'add', ...scope(saved), '--to', saved.sprint.after.id]
 
 export default {
   command: 'cycle/plan',
@@ -16,7 +20,11 @@ export default {
   prompt: `/pmkit:cycle:plan ${goal}`,
   answers: ['No days off for anyone', 'Change the capacity to fred=8 and ana=6, then yes', 'Yes'],
   // A sprint close sends ISS-5N1R (in_progress) and ISS-4M2S back to no sprint.
-  async setup({ pmkit }) { await pmkit(['cycle', 'add', 'ISS-5N1R', 'ISS-4M2S', '--to', 'none']) },
+  async setup({ pmkit }) {
+    await pmkit(['cycle', 'add', 'ISS-5N1R', 'ISS-4M2S', '--to', 'none'])
+    await pmkit(['issues', 'link', 'ISS-5N1R', 'ISS-6J0B', '--kind', 'blocks'])
+    await pmkit(['issues', 'link', 'ISS-8C4W', 'ISS-3F7H', '--kind', 'blocks'])
+  },
   steps: [
     // Step 1: the sprints and the members.
     { step: '1', read: ['cycle', 'list'] },
@@ -25,6 +33,9 @@ export default {
     { step: '3', read: ['metrics', 'velocity', '--window', '3'], save: 'velocity' },
     // Step 5: the draft scope.
     { step: '5', read: ['issues', 'list', '--category', 'todo,backlog,in_progress', '--sprint', 'none'], save: 'scope' },
+    { step: '5', read: ['issues', 'list', '--category', 'todo,backlog,in_progress', '--sprint', 'none', '--blocked'], save: 'blocked' },
+    // ISS-8C4W blocks ISS-3F7H and is not in the first list. ISS-5N1R blocks ISS-6J0B but is in the first list.
+    { step: '5', read: ['issues', 'get', 'ISS-8C4W'], save: 'blocker' },
     // Steps 6 and 7: approve the capacity inputs, then open the sprint and set the capacity.
     { confirm: 'Step 6' },
     { step: '7', dryRun: open },
@@ -45,6 +56,9 @@ export default {
     assert.equal(saved.velocity.average, 10, 'the plan says the velocity comes from one closed sprint')
     // The order is the CLI's creation order (10-05, 10-07, 10-08, 10-13).
     assert.deepEqual(saved.scope.issues.map((issue) => issue.id), ['ISS-5N1R', 'ISS-3F7H', 'ISS-6J0B', 'ISS-4M2S'])
-    for (const id of ['ISS-5N1R', 'ISS-3F7H', 'ISS-6J0B', 'ISS-4M2S']) assert.equal(repo.issue(id).sprint, '2026-10-26')
+    assert.deepEqual(saved.blocked.issues.map((issue) => issue.id), ['ISS-3F7H', 'ISS-6J0B'])
+    assert.equal(saved.blocker.status.category, 'in_review', 'ISS-8C4W is open, so ISS-3F7H stays out')
+    assert.equal(repo.issue('ISS-3F7H').sprint, undefined, 'step 5 leaves out ISS-3F7H for its open blocker')
+    for (const id of ['ISS-5N1R', 'ISS-6J0B', 'ISS-4M2S']) assert.equal(repo.issue(id).sprint, '2026-10-26')
   },
 }
```

### G6. Guard in `scripts/cli.test.mjs`

The test `a split in cycle close leaves the remaining work for cycle plan` (line 489) changes as below. It passes before and after the command change, because it calls the CLI directly. It uses `--criteria-file -` with `{ input }`, which the `run` helper passes to stdin, so it needs no temp file. The velocity assertion stays `{ id: '2026-10-12', points: 5, count: 1 }`.

```diff
diff --git a/scripts/cli.test.mjs b/scripts/cli.test.mjs
index 69c48ad..c2b6102 100644
--- a/scripts/cli.test.mjs
+++ b/scripts/cli.test.mjs
@@ -484,20 +484,34 @@ test('cycle close prints the unfinished issues', () => {
   assert.match(run(makeRepo('team'), ['cycle', 'close', '2026-10-12']).stdout, /state: active → closed/)
 })
 
-// A regression guard for PMK-113, not a failing-first test: it calls the CLI directly, and every call it makes
-// existed before the change to commands/cycle/close.md, so it passes before and after it.
+// A regression guard for PMK-113 and PMK-123, not a failing-first test: it calls the CLI directly, and every call it
+// makes existed before the changes to commands/cycle/close.md and commands/cycle/plan.md, so it passes before and
+// after them. It guards the data the split leaves for plan.
 test('a split in cycle close leaves the remaining work for cycle plan', () => {
   const root = makeRepo('team')
-  // The step 8 writes of the cycle-close scenario: create, link, lower the estimate, move to done, then close.
-  const { after: remaining } = json(root, ['issues', 'create', '--title', 'Finish the billing export to CSV', '--type', 'feature', '--estimate', '3', '--parent', 'EPC-2M9D', '--priority', 'high', '--label', 'billing,backend'])
+  // The setup of the cycle-close scenario: ISS-2X6D gets one checked and one unchecked criterion.
+  json(root, ['issues', 'update', 'ISS-2X6D', '--criteria-file', '-'], { input: '- [x] Export invoices for a date range\n- [ ] Totals row at the bottom\n' })
+  // The step 8 writes of the cycle-close scenario: create with the unchecked criterion, related link, blocker link,
+  // sub-issue move, lower the estimate, move to done, then close.
+  const { after: remaining } = json(root, ['issues', 'create', '--title', 'Finish the billing export to CSV', '--type', 'feature', '--estimate', '3', '--parent', 'EPC-2M9D', '--priority', 'high', '--label', 'billing,backend', '--criteria-file', '-'], { input: '- [ ] Totals row at the bottom\n' })
   json(root, ['issues', 'link', remaining.id, 'ISS-2X6D', '--kind', 'related'])
+  json(root, ['issues', 'link', 'ISS-5N1R', remaining.id, '--kind', 'blocks'])
+  json(root, ['issues', 'parent', 'ISS-4M2S', remaining.id])
   json(root, ['issues', 'update', 'ISS-2X6D', '--estimate', '5'])
   json(root, ['issues', 'move', 'ISS-2X6D', 'done'])
   json(root, ['cycle', 'close', '2026-10-12'])
   // The query of commands/cycle/plan.md step 5.
-  const offered = json(root, ['issues', 'list', '--category', 'todo,backlog,in_progress', '--sprint', 'none']).issues.map((issue) => issue.id)
+  const list = json(root, ['issues', 'list', '--category', 'todo,backlog,in_progress', '--sprint', 'none']).issues
+  const offered = list.map((issue) => issue.id)
   assert.ok(offered.includes(remaining.id), 'plan offers the remaining work')
   assert.ok(!offered.includes('ISS-2X6D'), 'plan does not offer the delivered original')
+  const carried = list.find((issue) => issue.id === remaining.id)
+  assert.deepEqual(carried.blockedBy, ['ISS-5N1R'], 'the new issue carries the open blocker')
+  assert.deepEqual(carried.children, ['ISS-4M2S'], 'the new issue carries the open sub-issue')
+  // The second query of commands/cycle/plan.md step 5.
+  const blocked = json(root, ['issues', 'list', '--category', 'todo,backlog,in_progress', '--sprint', 'none', '--blocked']).issues
+  assert.deepEqual(blocked.map((issue) => issue.id), [remaining.id])
+  assert.deepEqual(json(root, ['issues', 'get', remaining.id]).acceptanceCriteria, [{ text: 'Totals row at the bottom', done: false }])
   const inSprint = json(root, ['cycle', 'issues', '2026-10-12'])
   assert.equal(inSprint.find((issue) => issue.id === 'ISS-2X6D').status.category, 'done')
   // ISS-2X6D is the only done issue of the sprint: the test runs no pr sync, so ISS-8C4W stays in in_review.
```

### G7. Expected snapshot diffs

Regenerate with `UPDATE_GOLDENS=1 node --test scripts/scenarios.test.mjs`. The variable is checked at `scripts/scenarios.test.mjs:43` (`const UPDATE = process.env.UPDATE_GOLDENS === '1'`), and the command is the file's `REGENERATE` constant. The run rewrites every snapshot, so only the snapshot named for the task may change. Never edit a snapshot by hand.

In a snapshot, a line with two leading spaces is a context line of a changed file, and `+` or `-` in the first column marks a line the run added or removed. In the diffs below, the first column is git's and the second is the snapshot's. A line that starts with a space is unchanged in the snapshot. A line that starts with `+` is new in the snapshot, and one that starts with `-` is gone from it. For example, `++parent: ISS-M0GZ` is a new `+` line of the snapshot, and `+  updated: ...` is a new context line.

**G7.1 `scripts/__scenarios__/cycle-close.after.txt`** (Task 1). `git diff scripts/__scenarios__/cycle-close.after.txt` shows these hunks and no others:

```diff
@@ -18,7 +18,7 @@ exit 0
 ? Step 7  [confirmed]
 $ pmkit cycle add ISS-4M2S ISS-5N1R --to none --dry-run --json  [step 7, dry run]
 exit 0
-$ pmkit issues create --title 'Finish the billing export to CSV' --type feature --estimate 3 --parent EPC-2M9D --priority high --label billing,backend --dry-run --json  [step 7, dry run]
+$ pmkit issues create --title 'Finish the billing export to CSV' --type feature --estimate 3 --parent EPC-2M9D --priority high --label billing,backend --criteria-file <inputs>/remaining-criteria.md --dry-run --json  [step 7, dry run]
 exit 0
 $ pmkit issues update ISS-2X6D --estimate 5 --dry-run --json  [step 7, dry run]
 exit 0
@@ -29,10 +29,14 @@ exit 0
 ? Step 7  [confirmed]
 $ pmkit cycle add ISS-4M2S ISS-5N1R --to none --json  [step 7, write]
 exit 0
-$ pmkit issues create --title 'Finish the billing export to CSV' --type feature --estimate 3 --parent EPC-2M9D --priority high --label billing,backend --json  [step 7, write]
+$ pmkit issues create --title 'Finish the billing export to CSV' --type feature --estimate 3 --parent EPC-2M9D --priority high --label billing,backend --criteria-file <inputs>/remaining-criteria.md --json  [step 7, write]
 exit 0
 $ pmkit issues link ISS-M0GZ ISS-2X6D --kind related --json  [step 8, write]
 exit 0
+$ pmkit issues link ISS-5N1R ISS-M0GZ --kind blocks --json  [step 8, write]
+exit 0
+$ pmkit issues parent ISS-4M2S ISS-M0GZ --json  [step 8, write]
+exit 0
 $ pmkit issues update ISS-2X6D --estimate 5 --json  [step 7, write]
 exit 0
 $ pmkit issues move ISS-2X6D done --json  [step 8, write]
@@ -71,6 +75,7 @@ exit 0
   {"at":"2026-10-09T10:00:00Z","by":"fred","op":"link","field":"blocked_by","to":"ISS-5N1R"}
   {"at":"2026-10-09T10:10:00Z","by":"ana","op":"link","field":"related","to":"ISS-0G5E"}
   {"at":"2026-10-14T09:00:00Z","by":"ana","op":"move","field":"status","from":"todo","to":"in_progress"}
+  {"at":"2026-10-23T12:00:00Z","by":"fred","op":"update","field":"acceptance_criteria"}
 +{"at":"2026-10-23T12:00:00Z","by":"fred","op":"link","field":"related","to":"ISS-M0GZ"}
 +{"at":"2026-10-23T12:00:00Z","by":"fred","op":"update","field":"estimate","from":8,"to":5}
 +{"at":"2026-10-23T12:00:00Z","by":"fred","op":"move","field":"status","from":"in_progress","to":"done"}
@@ -93,18 +98,23 @@ exit 0
   sprint: 2026-10-12
   due: 2026-10-23
   created: 2026-10-05T09:00:00Z
--updated: 2026-10-14T09:00:00Z
-+updated: 2026-10-23T12:00:00Z
+  updated: 2026-10-23T12:00:00Z
   ---
 
   ## Description
 
   Finance needs a CSV of all invoices for a date range.
+
+  ## Acceptance criteria
+
+  - [x] Export invoices for a date range
+  - [ ] Totals row at the bottom
 --- changed .issues/issues/ISS-4M2S/events.jsonl
   {"at":"2026-10-13T09:00:00Z","by":"fred","op":"create","to":{"id":"ISS-4M2S","title":"Fix CSV column order","type":"task","status":"todo","priority":"medium","estimate":1,"labels":["billing"],"blocked_by":[],"related":[],"duplicate_of":[],"sprint":"2026-10-12","created":"2026-10-13T09:00:00Z","updated":"2026-10-13T09:00:00Z"}}
   {"at":"2026-10-13T09:10:00Z","by":"fred","op":"update","field":"parent","from":null,"to":"ISS-2X6D"}
   {"at":"2026-10-13T09:20:00Z","by":"fred","op":"assign","field":"assignee","from":null,"to":"fred"}
 +{"at":"2026-10-23T12:00:00Z","by":"fred","op":"update","field":"sprint","from":"2026-10-12","to":null}
++{"at":"2026-10-23T12:00:00Z","by":"fred","op":"update","field":"parent","from":"ISS-2X6D","to":"ISS-M0GZ"}
 --- changed .issues/issues/ISS-4M2S/issue.md
   ---
   id: ISS-4M2S
@@ -115,8 +125,9 @@ exit 0
   estimate: 1
   assignee: fred
   labels: [billing]
-  parent: ISS-2X6D
+-parent: ISS-2X6D
 -sprint: 2026-10-12
++parent: ISS-M0GZ
   created: 2026-10-13T09:00:00Z
 -updated: 2026-10-13T09:20:00Z
 +updated: 2026-10-23T12:00:00Z
@@ -181,6 +192,7 @@ exit 0
 --- added .issues/issues/ISS-M0GZ/events.jsonl
 +{"at":"2026-10-23T12:00:00Z","by":"fred","op":"create","to":{"id":"ISS-M0GZ","title":"Finish the billing export to CSV","type":"feature","status":"backlog","priority":"high","estimate":3,"labels":["billing","backend"],"parent":"EPC-2M9D","blocked_by":[],"related":[],"duplicate_of":[],"created":"2026-10-23T12:00:00.000Z","updated":"2026-10-23T12:00:00Z"}}
 +{"at":"2026-10-23T12:00:00Z","by":"fred","op":"link","field":"related","to":"ISS-2X6D"}
++{"at":"2026-10-23T12:00:00Z","by":"fred","op":"link","field":"blocked_by","to":"ISS-5N1R"}
 --- added .issues/issues/ISS-M0GZ/issue.md
 +---
 +id: ISS-M0GZ
@@ -191,11 +203,15 @@ exit 0
 +estimate: 3
 +labels: [billing, backend]
 +parent: EPC-2M9D
++blocked_by: [ISS-5N1R]
 +related: [ISS-2X6D]
 +created: 2026-10-23T12:00:00.000Z
 +updated: 2026-10-23T12:00:00Z
 +---
 +
++## Acceptance criteria
++
++- [ ] Totals row at the bottom
 --- changed .issues/sprints/2026-10-12.yaml
   name: Sprint 2026-10-12
   start: 2026-10-12
```

In words: the two create rows gain `--criteria-file <inputs>/remaining-criteria.md`. Two new `[step 8, write]` rows follow the `related` link. ISS-2X6D gains the setup's criteria event and its criteria section as context lines, and its `updated` pair becomes one context line. ISS-4M2S gains a `parent` event and its `parent` line moves from ISS-2X6D to ISS-M0GZ. ISS-M0GZ gains a `blocked_by` event, a `blocked_by` line and its criteria section. ISS-5N1R's files do not change, because `blocks` is computed. The new ID stays ISS-M0GZ.

**G7.2 `scripts/__scenarios__/cycle-plan.after.txt`** (Task 2). `git diff scripts/__scenarios__/cycle-plan.after.txt` shows these hunks and no others:

```diff
@@ -6,6 +6,10 @@ $ pmkit metrics velocity --window 3 --json  [step 3, read]
 exit 0
 $ pmkit issues list --category todo,backlog,in_progress --sprint none --json  [step 5, read]
 exit 0
+$ pmkit issues list --category todo,backlog,in_progress --sprint none --blocked --json  [step 5, read]
+exit 0
+$ pmkit issues get ISS-8C4W --json  [step 5, read]
+exit 0
 ? Step 6  [confirmed]
 $ pmkit cycle open --start 2026-10-26 --end 2026-11-08 --goal 'Dashboard empty state and build tooling' --dry-run --json  [step 7, dry run]
 exit 0
@@ -13,34 +17,12 @@ $ pmkit cycle open --start 2026-10-26 --end 2026-11-08 --goal 'Dashboard empty s
 exit 0
 $ pmkit cycle capacity 2026-10-26 --set fred=8,ana=6 --json  [step 7, write]
 exit 0
-$ pmkit cycle add ISS-5N1R ISS-3F7H ISS-6J0B ISS-4M2S --to 2026-10-26 --dry-run --json  [step 8, dry run]
+$ pmkit cycle add ISS-5N1R ISS-6J0B ISS-4M2S --to 2026-10-26 --dry-run --json  [step 8, dry run]
 exit 0
 ? Step 8  [confirmed]
-$ pmkit cycle add ISS-5N1R ISS-3F7H ISS-6J0B ISS-4M2S --to 2026-10-26 --json  [step 8, write]
+$ pmkit cycle add ISS-5N1R ISS-6J0B ISS-4M2S --to 2026-10-26 --json  [step 8, write]
 exit 0
 
---- changed .issues/issues/ISS-3F7H/events.jsonl
-  {"at":"2026-10-07T14:00:00Z","by":"fred","op":"create","to":{"id":"ISS-3F7H","title":"Empty state for the dashboard","type":"feature","status":"backlog","priority":"low","estimate":2,"labels":["frontend"],"blocked_by":[],"related":[],"duplicate_of":[],"created":"2026-10-07T14:00:00Z","updated":"2026-10-07T14:00:00Z"}}
-  {"at":"2026-10-22T17:00:00Z","by":"fred","op":"update","field":"priority","from":"low","to":"medium"}
-+{"at":"2026-10-23T12:00:00Z","by":"fred","op":"update","field":"sprint","from":null,"to":"2026-10-26"}
---- changed .issues/issues/ISS-3F7H/issue.md
-  ---
-  id: ISS-3F7H
-  title: Empty state for the dashboard
-  type: feature
-  status: backlog
-  priority: medium
-  estimate: 2
-  labels: [frontend]
-+sprint: 2026-10-26
-  created: 2026-10-07T14:00:00Z
--updated: 2026-10-22T17:00:00Z
-+updated: 2026-10-23T12:00:00Z
-  ---
-
-  ## Description
-
-  A new account sees a blank dashboard. Show a short guide instead.
 --- changed .issues/issues/ISS-4M2S/events.jsonl
   {"at":"2026-10-13T09:00:00Z","by":"fred","op":"create","to":{"id":"ISS-4M2S","title":"Fix CSV column order","type":"task","status":"todo","priority":"medium","estimate":1,"labels":["billing"],"blocked_by":[],"related":[],"duplicate_of":[],"sprint":"2026-10-12","created":"2026-10-13T09:00:00Z","updated":"2026-10-13T09:00:00Z"}}
   {"at":"2026-10-13T09:10:00Z","by":"fred","op":"update","field":"parent","from":null,"to":"ISS-2X6D"}
@@ -91,6 +73,7 @@ exit 0
   The export reads events in pages of 500.
 --- changed .issues/issues/ISS-6J0B/events.jsonl
   {"at":"2026-10-08T09:00:00Z","by":"fred","op":"create","to":{"id":"ISS-6J0B","title":"Upgrade the build tooling","type":"chore","status":"backlog","priority":"low","labels":[],"blocked_by":[],"related":[],"duplicate_of":[],"due":"2026-11-30","created":"2026-10-08T09:00:00Z","updated":"2026-10-08T09:00:00Z"}}
+  {"at":"2026-10-23T12:00:00Z","by":"fred","op":"link","field":"blocked_by","to":"ISS-5N1R"}
 +{"at":"2026-10-23T12:00:00Z","by":"fred","op":"update","field":"sprint","from":null,"to":"2026-10-26"}
 --- changed .issues/issues/ISS-6J0B/issue.md
   ---
@@ -99,11 +82,11 @@ exit 0
   type: chore
   status: backlog
   priority: low
+  blocked_by: [ISS-5N1R]
 +sprint: 2026-10-26
   due: 2026-11-30
   created: 2026-10-08T09:00:00Z
--updated: 2026-10-08T09:00:00Z
-+updated: 2026-10-23T12:00:00Z
+  updated: 2026-10-23T12:00:00Z
   ---
 
   ## Description
```

In words: two new `[step 5, read]` rows, the `cycle add` rows without ISS-3F7H, the two ISS-3F7H sections gone, and ISS-6J0B's setup link as context lines (`blocked_by` event and line, and one `updated` context line). ISS-8C4W's files do not change, because `blocks` is computed.

No other file under `scripts/__scenarios__/` and no file under `scripts/__goldens__/` changes.

### G8. Failures on today's text

Measured on the scratch copy with G3, G4 and G5 in place and today's command files.

- `cycle/close carries a split's open blockers, open sub-issues and unchecked criteria to the new issue` fails with `the step 7 create carries the unchecked criteria`.
- `cycle/close step 7 previews the blocker links and sub-issue moves of a split` fails with `the step 7 preview shows the blocker links`.
- `cycle/plan step 5 reads blockers outside its list, counts canceled as closed and names what it leaves out` fails with `step 5 lists the candidates with an open blocker`.
- `cycle/plan step 5 counts a blocker already in the planned sprint as selected` fails with `step 5 counts a blocker in the planned sprint as selected`.
`scenario cycle-close` reports exactly these five problems. The real output shows absolute paths where this shows `...`.

```text
rule 5: dryRun [step 7] issues create --title Finish the billing export to CSV --type feature --estimate 3 --parent EPC-2M9D --priority high --label billing,backend --criteria-file .../scripts/__scenarios__/_inputs/remaining-criteria.md: the call `issues create --title "<title>" --type <original type> --estimate <remaining> --parent <original parent> [--priority <original priority>] [--label <original labels>] --dry-run --json` has no --criteria-file
rule 5: write [step 7] issues create --title Finish the billing export to CSV --type feature --estimate 3 --parent EPC-2M9D --priority high --label billing,backend --criteria-file .../scripts/__scenarios__/_inputs/remaining-criteria.md: the call `issues create --title "<title>" --type <original type> --estimate <remaining> --parent <original parent> [--priority <original priority>] [--label <original labels>] --dry-run --json` has no --criteria-file
rule 5: write [step 8] issues parent ISS-4M2S ISS-M0GZ: step 8 has no call of `issues parent`
rule 6: call `7 issues create` is not used by any entry and not in skip
rule 6: skip `7 issues get` matches no call of the command file
```

`scenario cycle-plan` reports exactly these two problems:

```text
rule 5: read [step 5] issues list --category todo,backlog,in_progress --sprint none --blocked: the call `issues list --category todo,backlog,in_progress --sprint none --json` has no --blocked
rule 5: read [step 5] issues get ISS-8C4W: step 5 has no call of `issues get`
```

After the command change and before the regeneration, each scenario reports only `rule 12: <name>.after.txt differs from the run`.

### G9. Files

- Task 1 may change: `commands/cycle/close.md`, `scripts/scenarios.test.mjs`, `scripts/__scenarios__/cycle-close.mjs`, `scripts/__scenarios__/_inputs/split-criteria.md` (new), `scripts/__scenarios__/_inputs/remaining-criteria.md` (new), and by regeneration only `scripts/__scenarios__/cycle-close.after.txt`.
- Task 2 may change: `commands/cycle/plan.md`, `scripts/scenarios.test.mjs`, `scripts/__scenarios__/cycle-plan.mjs`, and by regeneration only `scripts/__scenarios__/cycle-plan.after.txt`.
- Task 3 may change: `scripts/cli.test.mjs`.
- Every task may append to `.superpowers/state/PMK-123-state.md`, which git ignores and nobody commits.
- No task changes: `scripts/pmkit.mjs`, `scripts/scenario-helpers.mjs`, `scripts/lib/`, `scripts/__fixtures__/`, `scripts/__goldens__/`, `CHANGELOG.md`, `CONTEXT.md`, `skills/pmkit/references/conventions.md`, `commands/issues/work.md`, any other command file, any other snapshot, the spec, or this plan. Nobody writes to this repo's `.issues/`.

### G10. Tests and commits

- Baseline: `npm test` at e614dd5 reports `# tests 1089`, `# pass 1089`, `# fail 0`.
- Expected after each task: Task 1 `# tests 1091`, Task 2 `# tests 1093`, Task 3 `# tests 1093`, each with `# fail 0`. Each static test adds one; the scenarios and the guard already exist.
- Each commit leaves `npm test` green. Task 1 regenerates only `cycle-close.after.txt` and Task 2 only `cycle-plan.after.txt`. No two tasks touch the same snapshot, so the order of the regenerations does not matter, but the tasks run in order 1, 2, 3.
- Every commit message carries `(PMK-123)` and ends with a trailer that names the implementer's real model: `Co-Authored-By: <real model name> <noreply@anthropic.com>`. The plan author's trailer is `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Stage files by name. No `git add -A`, no `git stash`, no branch switch.

## Review Focus

These inputs follow from the spec, and no scenario exercises them. Each is pinned by a static test or by a `grep -F` check in the owning task.

1. A canceled blocker or canceled sub-issue. Close must not carry it, and plan must count it as closed. Pinned by the canceled clause of the last regex in the G3.1 criterion 1 test (Task 1) and of the first regex on step 5 in the G3.2 criterion 2 test (Task 2).
2. A blocker of the original that step 7 cannot read (`NOT_FOUND`, `CONFLICT`). Close must name it, not carry it, and say the new issue will not show as blocked. Plan must count an unreadable blocker as open. Pinned by `grep -F` in Task 1 Step 6 and Task 2 Step 6.
3. A rerun after a failed step 8 (the finish path). It must run the blocker links and sub-issue moves and not the create. Pinned by `grep -F` in Task 1 Step 6. The no-op on a repeat is covered by `scripts/tracker-relations.test.mjs`.
4. A carried blocker or sub-issue that is split in the same close. The preview must warn and say what the new issue ends up pointing to. Pinned by `grep -F` in Task 1 Step 6.
5. A blocker already in the planned sprint being filled (I1). Plan must count it as selected. Pinned by the G3.2 test `cycle/plan step 5 counts a blocker already in the planned sprint as selected` (Task 2).

---

### Task 1: close carries a split's blockers, sub-issues and criteria

Uses: G1 (all), G3.1, G4, G7.1, G8 (the two close tests and `scenario cycle-close`), G9 (Task 1 line), G10.

**Files:**
- Modify: `scripts/scenarios.test.mjs` (G3.1)
- Create: `scripts/__scenarios__/_inputs/split-criteria.md`, `scripts/__scenarios__/_inputs/remaining-criteria.md` (G4)
- Modify: `scripts/__scenarios__/cycle-close.mjs` (G4)
- Modify: `commands/cycle/close.md` (G1)
- Regenerate: `scripts/__scenarios__/cycle-close.after.txt` (G7.1)

**Interfaces:**
- Consumes: `FILES`, `COMMANDS_DIR`, `fs`, `path` and `assert` in `scripts/scenarios.test.mjs`. Each parsed call has `step`, `command`, `dryRun`, `flags` (names without `--`) and `text`. The scenario `setup({ pmkit })` hook runs a CLI call and throws on a non-zero exit. `repo.issue(id)` returns the issue's front matter, and `repo.file(rel)` returns a file's text.
- Produces: nothing that Task 2 or Task 3 reads.

- [ ] **Step 1: Add the two close tests.** Insert G3.1 exactly, at the place it names.
- [ ] **Step 2: Prove they fail on today's text.**
  Run: `node --test --test-name-pattern='carries a split|previews the blocker links' scripts/scenarios.test.mjs`
  Expected: 2 failing tests, with the messages G8 gives.
- [ ] **Step 3: Write the scenario change.** Create the two input files and apply the G4 diff to `cycle-close.mjs`.
- [ ] **Step 4: Prove the scenario fails on today's text.**
  Run: `node --test --test-name-pattern='scenario cycle-close' scripts/scenarios.test.mjs`
  Expected: FAIL with exactly the five rule 5 and rule 6 problems of G8.
- [ ] **Step 5: Edit `commands/cycle/close.md`** with G1.1 to G1.6, word for word.
- [ ] **Step 6: Prove the text passes.**
  Run: `node --test --test-name-pattern='carries a split|previews the blocker links|cycle/close step 8 runs cycle close|every flag|every call ends' scripts/scenarios.test.mjs`
  Expected: PASS.
  Run each of these. Each prints `1`:
  ```bash
  grep -F -c 'For a blocker, say that the split does not copy it, so the new issue will not show as blocked by it.' commands/cycle/close.md
  grep -F -c 'For a split that a failed step 8 started, run the blocker links, the sub-issue moves, the estimate update and the move.' commands/cycle/close.md
  grep -F -c 'When a blocker or a sub-issue that the split carries is itself split in this close, name it and say what the new issue ends up pointing to.' commands/cycle/close.md
  grep -F -c 'so the preview calls the created issue "the new issue" and does not show that ID.' commands/cycle/close.md
  ```
  Run: `grep -F -c 'The close does not move or copy them.' commands/cycle/close.md`. Expected: `0`.
  Run: `node --test --test-name-pattern='scenario cycle-close' scripts/scenarios.test.mjs`. Expected: FAIL with only `rule 12: cycle-close.after.txt differs from the run`. Any rule 3 to 11 problem means the text or the module differs from G1 or G4.
- [ ] **Step 7: Regenerate and read the diff.**
  Run: `UPDATE_GOLDENS=1 node --test scripts/scenarios.test.mjs`, then `git status --short`. Expected: only the six paths of the Task 1 line of G9.
  Run: `git diff scripts/__scenarios__/cycle-close.after.txt` and compare it with G7.1 line by line, context lines included. The report lists every changed line. A line that is not in G7.1 is a finding: explain it before the commit, and do not commit until it is explained.
- [ ] **Step 8: Run the suite.**
  Run: `npm test`. Expected: `# tests 1091`, `# pass 1091`, `# fail 0`.
- [ ] **Step 9: Commit.**
  ```bash
  git add commands/cycle/close.md scripts/scenarios.test.mjs scripts/__scenarios__/cycle-close.mjs scripts/__scenarios__/cycle-close.after.txt scripts/__scenarios__/_inputs/split-criteria.md scripts/__scenarios__/_inputs/remaining-criteria.md
  git commit -m "feat(cycle): close carries a split's open blockers, sub-issues and criteria (PMK-123)" -m "Co-Authored-By: <real model name> <noreply@anthropic.com>"
  ```

Complexidade: média

### Task 2: plan names the issues it leaves out for an open blocker

Uses: G2 (all), G3.2, G5, G7.2, G8 (the two plan tests and `scenario cycle-plan`), G9 (Task 2 line), G10.

**Files:**
- Modify: `scripts/scenarios.test.mjs` (G3.2)
- Modify: `scripts/__scenarios__/cycle-plan.mjs` (G5)
- Modify: `commands/cycle/plan.md` (G2)
- Regenerate: `scripts/__scenarios__/cycle-plan.after.txt` (G7.2)

**Interfaces:**
- Consumes: the same test-file names as Task 1. `saved.<name>` holds the parsed JSON of an entry with `save`. `issues list --json` returns `{ issues: [...] }`, and `issues get --json` returns the issue with `status.category`.
- Produces: nothing that Task 3 reads.

- [ ] **Step 1: Add the two plan tests.** Insert G3.2 exactly, at the place it names.
- [ ] **Step 2: Prove they fail on today's text.**
  Run: `node --test --test-name-pattern='reads blockers outside its list|planned sprint as selected' scripts/scenarios.test.mjs`
  Expected: 2 failing tests, with the messages G8 gives.
  Also run: `grep -F -c "and the blocker's \`sprint\` is that sprint's ID" commands/cycle/plan.md`. Expected: `0`.
- [ ] **Step 3: Write the scenario change.** Apply the G5 diff to `cycle-plan.mjs`.
- [ ] **Step 4: Prove the scenario fails on today's text.**
  Run: `node --test --test-name-pattern='scenario cycle-plan' scripts/scenarios.test.mjs`
  Expected: FAIL with exactly the two rule 5 problems of G8.
- [ ] **Step 5: Edit `commands/cycle/plan.md`** with G2.1 to G2.3, word for word.
- [ ] **Step 6: Prove the text passes.**
  Run: `node --test --test-name-pattern='reads blockers outside its list|planned sprint as selected|step 5 drafts from|step 8 shows the status|every flag|every call ends' scripts/scenarios.test.mjs`
  Expected: PASS. The two PMK-122 tests still pass.
  Run each of these. Each prints `1`:
  ```bash
  grep -F -c "and the blocker's \`sprint\` is that sprint's ID" commands/cycle/plan.md
  grep -F -c 'A blocker that `issues get` cannot read, for example with `NOT_FOUND`, counts as open.' commands/cycle/plan.md
  ```
  Run: `grep -F -c 'Skip an issue whose blocker is not done and not in the selection.' commands/cycle/plan.md`. Expected: `0`.
  Run: `node --test --test-name-pattern='scenario cycle-plan' scripts/scenarios.test.mjs`. Expected: FAIL with only `rule 12: cycle-plan.after.txt differs from the run`.
- [ ] **Step 7: Regenerate and read the diff.**
  Run: `UPDATE_GOLDENS=1 node --test scripts/scenarios.test.mjs`, then `git status --short`. Expected: only the four paths of the Task 2 line of G9. `cycle-close.after.txt` must not change again.
  Run: `git diff scripts/__scenarios__/cycle-plan.after.txt` and compare it with G7.2 line by line, context lines included. The report lists every changed line. A line that is not in G7.2 is a finding: explain it before the commit.
- [ ] **Step 8: Run the suite.**
  Run: `npm test`. Expected: `# tests 1093`, `# pass 1093`, `# fail 0`.
- [ ] **Step 9: Commit.**
  ```bash
  git add commands/cycle/plan.md scripts/scenarios.test.mjs scripts/__scenarios__/cycle-plan.mjs scripts/__scenarios__/cycle-plan.after.txt
  git commit -m "feat(cycle): plan names the issues it leaves out for an open blocker (PMK-123)" -m "Co-Authored-By: <real model name> <noreply@anthropic.com>"
  ```

Complexidade: média

### Task 3: the split guard checks the carried data

Uses: G6, G9 (Task 3 line), G10.

**Files:**
- Modify: `scripts/cli.test.mjs` (G6)

**Interfaces:**
- Consumes: `makeRepo`, `json(root, args, { input })` and `run` in `scripts/cli.test.mjs`. `issues list --json` items carry `blockedBy` and `children`, and `issues get --json` carries `acceptanceCriteria` as `{ text, done }` objects.
- Produces: nothing.

This test is a guard, not a failing-first test, as the spec's "Tests per criterion" table says. It calls the CLI directly, so it passes before and after the command changes. Its failing-first counterparts are the Task 1 and Task 2 tests.

- [ ] **Step 1: Apply the G6 diff** to the test `a split in cycle close leaves the remaining work for cycle plan`.
- [ ] **Step 2: Prove it passes.**
  Run: `node --test --test-name-pattern='a split in cycle close leaves' scripts/cli.test.mjs`
  Expected: `# tests 1`, `# pass 1`.
- [ ] **Step 3: Prove each new assertion bites.** Change `['ISS-5N1R']` in the `carried.blockedBy` assertion to `[]` and run the same command. Expected: FAIL with `the new issue carries the open blocker`. Undo the change, run it again, and expect PASS. `git diff scripts/cli.test.mjs` must then equal G6.
- [ ] **Step 4: Run the suite.**
  Run: `npm test`. Expected: `# tests 1093`, `# pass 1093`, `# fail 0`. Run `git status --short` and expect only `scripts/cli.test.mjs`.
- [ ] **Step 5: Commit.**
  ```bash
  git add scripts/cli.test.mjs
  git commit -m "test(cli): split guard checks the carried blocker, sub-issue and criterion (PMK-123)" -m "Co-Authored-By: <real model name> <noreply@anthropic.com>"
  ```

Complexidade: baixa

## Decisions made in this plan

- Three tasks. All of `close.md` goes in one task and all of `plan.md` in another, because rule 6 fails a scenario when the command file gains a call (`7 issues get`, `8 issues parent`, `5 issues get`) that no entry uses. A smaller split would leave a red commit.
- The orchestrator's I1 ruling is a separate fourth static test (G3.2, second test). It pins the whole I1 sentence. The spec's criterion 2 test also checks one clause of it, but that test fails on today's text for other reasons first, so it does not show the I1 rule on its own. A `grep -F` would not stay in the suite.
- G1.3 joins the new step 7 text to the `7. ` line, because the spec says the first paragraph "keeps its text up to" the sentence and the step's first paragraph is one line today.
- The close tests sit after the PMK-121 step 8 test, and the plan tests after the PMK-122 step 8 test, as the spec's "Left to the builder" allows.
- The `cycle-close` `expect` checks the criteria with the spec's regex, a `doesNotMatch` on `[x]` for the new issue, and one line regex per criterion for the original (the spec leaves these to the builder).
- The guard feeds criteria through `--criteria-file -` and stdin, so it writes no temp file.
- Review Focus items 2 to 4 are pinned by `grep -F` checks in the task steps and not by new test assertions, so the static test code stays the spec's.

## Self-review

- Spec coverage: close steps 6, 7, 8, the Step 7 point and the Output (Task 1, G1). Plan steps 5 and 8 and the Output (Task 2, G2). Both scenarios (Tasks 1 and 2). The three spec tests plus the I1 test (G3). The guard (Task 3). Both snapshot diffs (G7). Follow-ups 1 to 6 stay out.
- Each commit leaves `npm test` green: 1089, then 1091, 1093 and 1093.
- No task names a file outside G9.
