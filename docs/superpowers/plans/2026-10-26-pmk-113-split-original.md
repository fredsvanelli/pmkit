# PMK-113 Split Original Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** After a split in `/pmkit:cycle:close`, the original issue moves to `done` with its reduced estimate and stays in the closed sprint, the new issue in the backlog gets a `related` link to it, and `/pmkit:cycle:plan` offers the new issue.

**Architecture:** Only command text changes: `commands/cycle/close.md` steps 6 to 9 and its closing sections. The `cycle-close` scenario is the failing-first test, because it reads `close.md`. A new test in `scripts/cli.test.mjs` guards plan's step 5 query after a split, and it passes before the fix. No CLI, tracker or `commands/cycle/plan.md` change.

**Tech Stack:** Node 22 (floor in ADR-0003 is Node 18), `node:test`, no dependencies.

**Spec:** `docs/superpowers/specs/2026-10-26-pmk-113-split-original-design.md`

## Global Constraints

- No dependencies (ADR-0003). No change to `scripts/pmkit.mjs`, `scripts/lib/**`, `commands/cycle/plan.md`, `scripts/__scenarios__/cycle-plan.*` or `scripts/__goldens__/`.
- Do not edit `CHANGELOG.md` (release writes it) or anything under `.issues/`. Do not run `git stash`.
- The split rule: a split runs only when the user gives the delivered part as an estimate greater than 0 and lower than the original's estimate. An original with no estimate gets no split offer. The command offers the move to a planned sprint or to the backlog instead.
- Write order of one split in step 8: `issues create`, then `issues link <new id> <original id> --kind related --json`, then `issues update <id> --estimate <n>`, then `issues move <id> done`. `cycle close <sprint id> --json` runs before every move and split, as today.
- New dry run in step 7: `node "${CLAUDE_PLUGIN_ROOT}/scripts/pmkit.mjs" issues move <id> done --dry-run --json`. The link has no dry run, because the new ID exists only after the real create. The step 7 approval covers it.
- New read after the last write of step 8: `node "${CLAUDE_PLUGIN_ROOT}/scripts/pmkit.mjs" cycle issues <sprint id> --json`. Delivered (count and sum of `estimate` of the issues in category `done`) and throughput come from it. Planned stays the step 4 number.
- The step 7 preview of a split lists the new issue, the `related` link, the reduced estimate, the move of the original to `done`, and what stays on the original: IDs in `blockedBy` and `children` whose status category is not `done`, and acceptance criteria with `done: false`, from the step 3 read. No new confirmation point. The keys stay `Step 1`, `Step 7` and `Step 9`.
- Exception list: rule 5 of `docs/superpowers/specs/2026-10-25-pmk-10-command-scenarios-design.md` gains the close link: "the links of `/pmkit:issues:breakdown`, `/pmkit:spec:import` and `/pmkit:cycle:close`".
- Snapshots: regenerate with `UPDATE_GOLDENS=1 node --test scripts/scenarios.test.mjs`, then read `git diff scripts/__scenarios__/` and check every changed line against the expected diff in the task. Never edit a snapshot by hand, and never regenerate to make a failure go away without reading the diff.
- Every commit message carries `(PMK-113)` and ends with `Co-Authored-By: <the implementer's model> <noreply@anthropic.com>`.

## Review Focus

These come from the command text and no scenario exercises them, because the scenario plays one path of the agent. Task 2's static checks pin the sentences, and the reviewer reads the text for each:

- An original with no estimate: step 6 says no split is offered and why, and "If something is missing" offers the two moves.
- A delivered part of 0, or one not lower than the original's estimate: step 6 says why no split runs and offers the two moves.
- A write that fails in the middle of a split (say the link after the create): step 8 still says to stop, list what ran and what did not, and not retry. The create runs first, so a failed create leaves the original untouched.
- A close run after the sprint's `end`: velocity counts 0 for the original. The CLI test in Task 3 must not assert that case, because the assertion would lock in the gap that follow-up 2 of the spec fixes.
- The live suite (`scripts/scenarios-live.mjs`, `stopProblems`): the link write has no earlier dry run of `issues link`, so its check passes. The new `issues move` write repeats its dry run with the same args.

---

### Task 1: Split moves the original to done, in the scenario and in steps 6 to 8 of close.md

**Files:**
- Modify: `scripts/__scenarios__/cycle-close.mjs`
- Modify: `commands/cycle/close.md` (steps 6, 7 and 8, lines 27 to 29)
- Modify: `scripts/__scenarios__/_inputs/retro.md` (lines 7 and 9)
- Regenerate: `scripts/__scenarios__/cycle-close.after.txt`

**Interfaces:**
- Produces: the step 8 calls `issues link` and `cycle issues` and the step 7 dry run `issues move` in `close.md`. Task 2 edits the other sections of the same file and must leave these three calls as they are.

- [ ] **Step 1: Change the scenario first.** In `scripts/__scenarios__/cycle-close.mjs`:

  Replace the header comment (lines 1 to 6) with:

  ```js
  // /pmkit:cycle:close on the team fixture, with GitHub. Setup records the branch feat-dlq on ISS-8C4W (in review),
  // and gh answers that its pull request #12 is merged, so step 1 previews, confirms and writes pr sync.
  // The active sprint 2026-10-12 then has one done issue and three unfinished ones. No sprint is planned, so the
  // user sends ISS-4M2S and ISS-5N1R back to the backlog and splits ISS-2X6D: a new issue under EPC-2M9D takes the
  // remaining 3 points in the backlog, with a related link to ISS-2X6D, and ISS-2X6D moves to done with 5 points
  // instead of 8 and stays in the closed sprint.
  // Step 8 closes the sprint first, then runs the moves and the split, then reads the sprint's issues again for
  // the delivered numbers.
  ```

  Add after `const shrink = ...`:

  ```js
  const done = ['issues', 'move', 'ISS-2X6D', 'done']
  ```

  In `steps`, add `{ step: '7', dryRun: done }` right after `{ step: '7', dryRun: shrink }`, and make the step 8 block:

  ```js
    // Step 8: close the sprint, then the same moves and the split without --dry-run: create, link, estimate, move.
    { step: '8', write: close },
    { step: '7', write: toBacklog },
    { step: '7', write: split, save: 'remaining' },
    { step: '8', write: ({ remaining }) => ['issues', 'link', remaining.after.id, 'ISS-2X6D', '--kind', 'related'] },
    { step: '7', write: shrink },
    { step: '7', write: done },
    // Step 8 reads the sprint's issues again, after the writes, for the delivered numbers.
    { step: '8', read: ['cycle', 'issues', '2026-10-12'], save: 'after' },
  ```

  In `expect`, replace the `original` and `remaining` checks and the retro match (lines 72 to 81) with:

  ```js
    const original = repo.issue('ISS-2X6D')
    assert.equal(original.estimate, 5)
    assert.equal(original.status, 'done', 'the split moves the original to done')
    assert.equal(original.sprint, '2026-10-12', 'the original stays in the closed sprint as the delivered part')
    const remaining = repo.issue(saved.remaining.after.id)
    assert.equal(remaining.estimate, 3)
    assert.equal(remaining.parent, 'EPC-2M9D')
    // The two facts plan's step 5 query reads: a status in todo or backlog, and no sprint.
    assert.equal(remaining.status, 'backlog')
    assert.equal(remaining.sprint, undefined, 'the new issue goes to the backlog')
    for (const field of ['type', 'priority']) assert.equal(remaining[field], original[field], `the split keeps the ${field}`)
    assert.deepEqual(remaining.labels, original.labels, 'the split keeps the labels')
    assert.ok(original.related.includes(saved.remaining.after.id), 'the original links to the new issue')
    assert.ok(remaining.related.includes('ISS-2X6D'), 'the new issue links to the original')
    // Criterion 1: no issue stays open in the closed sprint.
    const open = saved.after.filter((issue) => !['done', 'canceled'].includes(issue.status.category)).map((issue) => issue.id)
    assert.deepEqual(open, [], 'every issue left in the closed sprint is done or canceled')
    const delivered = saved.after.filter((issue) => issue.status.category === 'done')
    assert.deepEqual(delivered.map((issue) => issue.id).sort(), ['ISS-2X6D', 'ISS-8C4W'])
    assert.equal(delivered.find((issue) => issue.id === 'ISS-2X6D').estimate, 5)
    assert.equal(delivered.reduce((sum, issue) => sum + issue.estimate, 0), 10)
    assert.match(repo.file('.issues/docs/retros/2026-10-12.md'), /Delivered 2 of 3 planned issues, 10 of 16 points/)
  ```

- [ ] **Step 2: Run it against the old `close.md`.**

  Run: `node --test --test-name-pattern="scenario cycle-close" scripts/scenarios.test.mjs`
  Expected: FAIL with exactly these problems:

  ```
  rule 5: dryRun [step 7] issues move ISS-2X6D done: step 7 has no call of `issues move`
  rule 5: write [step 8] issues link ISS-M0GZ ISS-2X6D --kind related: step 8 has no call of `issues link`
  rule 5: write [step 7] issues move ISS-2X6D done: step 7 has no call of `issues move`
  rule 5: read [step 8] cycle issues 2026-10-12: step 8 has no call of `cycle issues`
  rule 11: expect failed: The input did not match the regular expression /Delivered 2 of 3 planned issues, 10 of 16 points/. ...
  ```

  The runner still runs a write whose entry fails rule 5, so the `status === 'done'` check passes here. The failing checks are rule 5 and the retro match.

- [ ] **Step 3: Change steps 6, 7 and 8 of `commands/cycle/close.md`.** The text is fixed by the spec ("Command text changes").

  Step 6: replace "A split means creating a new issue for the remaining work and reducing the estimate of the original." with:

  > A split is for an issue with an estimate and a delivered part. Ask for the delivered part as an estimate. The split runs only when that number is greater than 0 and lower than the original's estimate. The original keeps the delivered part: its estimate drops to that number, it moves to `done`, and it stays in the closed sprint. A new issue in the backlog takes the remaining work, with a `related` link to the original. Do not offer a split for an issue with no estimate, and say so. When the user gives 0, or a number not lower than the original's estimate, say why no split runs and offer the two moves.

  The sentence "Say when no planned sprint exists." stays at the end of step 6.

  Step 7: replace "Show the sprint report with the numbers and the proposal, then ask with" with "Show the sprint report with the numbers and the proposal. The report's delivered numbers are those of steps 3 and 4, before any write. Step 8 reads them again after the writes. Then ask with". Then replace from "Then run `node \"${CLAUDE_PLUGIN_ROOT}/scripts/pmkit.mjs\" issues update <id> --estimate <n> --dry-run --json` to reduce the estimate of the original." up to "because the create call sets no sprint." with:

  > Then run `node "${CLAUDE_PLUGIN_ROOT}/scripts/pmkit.mjs" issues update <id> --estimate <n> --dry-run --json` to reduce the estimate of the original to the delivered part, and `node "${CLAUDE_PLUGIN_ROOT}/scripts/pmkit.mjs" issues move <id> done --dry-run --json` to mark it delivered. The original stays in the closed sprint as done, and the new issue goes to the backlog, because the create call sets no sprint. The preview names the `related` link of step 8 between the two. It also lists what stays on the original once it is done, from the step 3 read: the IDs in its `blockedBy` and `children` whose status category is not `done`, and its acceptance criteria with `done: false`. A blocker or sub-issue outside the sprint is not in that read, so list its ID and say its status was not read. The close does not move or copy them.

  The rest of step 7 stays (the `cycle close` dry run, one full preview, one question, declining changes nothing).

  Step 8: replace the whole item with:

  > 8. After the approval, run `node "${CLAUDE_PLUGIN_ROOT}/scripts/pmkit.mjs" cycle close <sprint id> --json`, then the same moves and splits without `--dry-run`. For each split, run the create first and note the new ID. Then run `node "${CLAUDE_PLUGIN_ROOT}/scripts/pmkit.mjs" issues link <new id> <original id> --kind related --json`, then the estimate update and the move to `done` of the original. The approval of step 7 covers the link, because the preview showed it. When one fails, stop, list what was done and what was not, and do not retry it. After the last write, run `node "${CLAUDE_PLUGIN_ROOT}/scripts/pmkit.mjs" cycle issues <sprint id> --json` again. Delivered is the issues of this read whose status category is `done`: their count, and the sum of their `estimate`. Throughput is the same count. Planned stays the step 4 number, with the estimates of the step 3 read. Scope added and removed and cycle time keep the numbers of steps 4 and 5. Carry-over keeps the step 4 list, with the decision applied to each unfinished issue and the new ID of each split.

  Each step stays one line of the numbered list, as today.

- [ ] **Step 4: Run the scenario again.**

  Run: `node --test --test-name-pattern="scenario cycle-close" scripts/scenarios.test.mjs`
  Expected: FAIL with only the `rule 11` retro problem. No `rule 3` to `rule 6` problem.

- [ ] **Step 5: Change `scripts/__scenarios__/_inputs/retro.md`.** Line 7 becomes:

  ```
  - Delivered 2 of 3 planned issues, 10 of 16 points. ISS-8C4W moved to done when its pull request merged, and ISS-2X6D moved to done with the 5 points it delivered.
  ```

  Line 9 becomes:

  ```
  - Carry-over: ISS-5N1R and ISS-4M2S went back to the backlog. ISS-2X6D was split: its 5 delivered points are done, and its remaining 3 points are a new issue in the backlog, linked to it.
  ```

- [ ] **Step 6: Run the scenario.**

  Run: `node --test --test-name-pattern="scenario cycle-close" scripts/scenarios.test.mjs`
  Expected: FAIL with `rule 12: cycle-close.after.txt differs from the run` only.

- [ ] **Step 7: Regenerate the snapshot and read the diff.**

  Run: `UPDATE_GOLDENS=1 node --test scripts/scenarios.test.mjs`, then `git diff scripts/__scenarios__/`.
  Expected: the only changed snapshot is `cycle-close.after.txt`, and its diff holds only:
  - trace rows `$ pmkit issues move ISS-2X6D done --dry-run --json  [step 7, dry run]` after the `issues update` dry run; `$ pmkit issues link ISS-M0GZ ISS-2X6D --kind related --json  [step 8, write]` after the create write; `$ pmkit issues move ISS-2X6D done --json  [step 7, write]` and `$ pmkit cycle issues 2026-10-12 --json  [step 8, read]` after the `issues update` write, each followed by `exit 0`;
  - in `ISS-2X6D/events.jsonl`, a `link` event (`"field":"related","to":"ISS-M0GZ"`) and then a `move` event (`"from":"in_progress","to":"done"`);
  - in `ISS-2X6D/issue.md`, `status: in_progress` becomes `status: done`, and `related: [ISS-0G5E]` becomes `related: [ISS-0G5E, ISS-M0GZ]`;
  - in `ISS-M0GZ`, a `link` event (`"to":"ISS-2X6D"`) and `related: [ISS-2X6D]` in its `issue.md`;
  - the two retro lines of Step 5 in the added `retros/2026-10-12.md`.

  Any other change (another snapshot, a different new ID, a write before the second `Step 7` confirm) is a bug to fix in the scenario or in `close.md`, not something to regenerate.

- [ ] **Step 8: Run the scenario suite.**

  Run: `node --test scripts/scenarios.test.mjs`
  Expected: PASS, every test.

- [ ] **Step 9: Commit**

  ```bash
  git add scripts/__scenarios__/cycle-close.mjs scripts/__scenarios__/cycle-close.after.txt scripts/__scenarios__/_inputs/retro.md commands/cycle/close.md
  git commit -m "fix: move the original of a split issue to done in cycle close (PMK-113)"
  ```

  End the message with the `Co-Authored-By` trailer of Global Constraints.

Complexidade: média

---

### Task 2: The rest of close.md and the PMK-10 exception list

**Files:**
- Modify: `commands/cycle/close.md` (step 9, "Confirmation points", "Output", "If something is missing")
- Modify: `docs/superpowers/specs/2026-10-25-pmk-10-command-scenarios-design.md:158` (rule 5)

**Interfaces:**
- Consumes: the step 6 to 8 text of Task 1. Do not change it.

- [ ] **Step 1: Write the static check and see it fail.**

  Run:

  ```bash
  for s in 'Draft it from the numbers of step 8 and the retro prompts' \
    'the splits (the new issue, its link, the reduced estimate, the move of the original to `done`, and the open blockers, sub-issues and criteria that stay on it)' \
    'The delivered numbers and throughput come from the `cycle issues` read of step 8, after the writes.' \
    "For each split, the new issue's ID and the original's delivered estimate." \
    '- A split of an issue with no estimate, or with a delivered part of 0 or not lower than its estimate:'; do
    grep -qF -- "$s" commands/cycle/close.md && echo "found: $s" || echo "MISSING: $s"; done
  grep -qF 'the links of `/pmkit:issues:breakdown`, `/pmkit:spec:import` and `/pmkit:cycle:close`' docs/superpowers/specs/2026-10-25-pmk-10-command-scenarios-design.md && echo found || echo MISSING
  ```

  Expected: six `MISSING` lines.

- [ ] **Step 2: Edit `commands/cycle/close.md`.**

  Step 9: the first sentence becomes "Offer a retro document. Draft it from the numbers of step 8 and the retro prompts (what slipped and why, based on the data)." The rest of step 9 stays.

  "Confirmation points": the `Step 7` bullet becomes:

  > - Step 7: the decision per unfinished issue, then one full preview of the moves, the splits (the new issue, its link, the reduced estimate, the move of the original to `done`, and the open blockers, sub-issues and criteria that stay on it) and the close, always asked because it holds scope moves. Declining changes nothing.

  "Output": the paragraph becomes:

  > The delivered numbers and throughput come from the `cycle issues` read of step 8, after the writes. The sprint report. Lead with delivered against planned (count and estimate), then scope added and removed, carry-over, cycle time (median and p85) and throughput. Then the retro prompts from the data and the moves applied. For each split, the new issue's ID and the original's delivered estimate. Then the path of the retro document, if written.

  "If something is missing": add this bullet after the "No planned sprint" bullet, which stays as it is:

  > - A split of an issue with no estimate, or with a delivered part of 0 or not lower than its estimate: offer a move to a planned sprint or to the backlog instead, because a split moves the original to `done` with a lower estimate.

- [ ] **Step 3: Edit rule 5 of the PMK-10 spec** (line 158). Replace "and the links of `/pmkit:issues:breakdown` and `/pmkit:spec:import`." with "and the links of `/pmkit:issues:breakdown`, `/pmkit:spec:import` and `/pmkit:cycle:close`." Nothing else in that spec changes.

- [ ] **Step 4: Run the static check of Step 1 again.**

  Expected: six `found` lines.

- [ ] **Step 5: Run the command file tests.**

  Run: `node --test scripts/scenarios.test.mjs scripts/plugin.test.mjs`
  Expected: PASS. `git status --short scripts/__scenarios__/` prints nothing: prose changes do not change the snapshot. The `Step 7` label of the confirmation bullet still parses, so rule 7 and rule 10 hold.

- [ ] **Step 6: Commit**

  ```bash
  git add commands/cycle/close.md docs/superpowers/specs/2026-10-25-pmk-10-command-scenarios-design.md
  git commit -m "docs: describe the split outcome in the cycle close output and checks (PMK-113)"
  ```

  End the message with the `Co-Authored-By` trailer of Global Constraints.

Complexidade: baixa

---

### Task 3: CLI regression guard for plan's query after a split

**Files:**
- Modify: `scripts/cli.test.mjs` (new test right after `cycle close prints the unfinished issues`, line 427)

**Interfaces:**
- Consumes: `makeRepo` from `scripts/test-helpers.mjs` and the file's own `json(cwd, args)` helper, which adds `--json` and asserts exit 0. `baseEnv()` already sets `PMKIT_NOW: '2026-10-23T12:00:00Z'`.

- [ ] **Step 1: Add the test.**

  ```js
  // A regression guard for PMK-113, not a failing-first test: it calls the CLI directly, and every call it makes
  // existed before the change to commands/cycle/close.md, so it passes before and after it.
  test('a split in cycle close leaves the remaining work for cycle plan', () => {
    const root = makeRepo('team')
    // The step 8 writes of the cycle-close scenario: close, create, link, lower the estimate, move to done.
    json(root, ['cycle', 'close', '2026-10-12'])
    const { after: remaining } = json(root, ['issues', 'create', '--title', 'Finish the billing export to CSV', '--type', 'feature', '--estimate', '3', '--parent', 'EPC-2M9D', '--priority', 'high', '--label', 'billing,backend'])
    json(root, ['issues', 'link', remaining.id, 'ISS-2X6D', '--kind', 'related'])
    json(root, ['issues', 'update', 'ISS-2X6D', '--estimate', '5'])
    json(root, ['issues', 'move', 'ISS-2X6D', 'done'])
    // The query of commands/cycle/plan.md step 5.
    const offered = json(root, ['issues', 'list', '--category', 'todo,backlog', '--sprint', 'none']).issues.map((issue) => issue.id)
    assert.ok(offered.includes(remaining.id), 'plan offers the remaining work')
    assert.ok(!offered.includes('ISS-2X6D'), 'plan does not offer the delivered original')
    const inSprint = json(root, ['cycle', 'issues', '2026-10-12'])
    assert.equal(inSprint.find((issue) => issue.id === 'ISS-2X6D').status.category, 'done')
    // ISS-2X6D is the only done issue of the sprint: the test runs no pr sync, so ISS-8C4W stays in in_review.
    // PMKIT_NOW 2026-10-23 falls before the sprint's end of 2026-10-25, so this proves only a close on time.
    // No assertion covers a late close, because it would lock in the gap that the velocity follow-up fixes.
    const velocity = json(root, ['metrics', 'velocity'])
    assert.deepEqual(velocity.perSprint.find((sprint) => sprint.id === '2026-10-12'), { id: '2026-10-12', points: 5, count: 1 })
  })
  ```

- [ ] **Step 2: Run it.**

  Run: `node --test --test-name-pattern="a split in cycle close" scripts/cli.test.mjs`
  Expected: PASS (`# pass 1`, `# fail 0`). It passes before any close.md change too, which is why it is a guard and not the red test. If it fails, the CLI changed under it: stop and report, do not change the CLI.

- [ ] **Step 3: Run the whole suite.**

  Run: `npm test`
  Expected: PASS, and no "tests left N entries in the temp folder" line. `git status --short` shows only `scripts/cli.test.mjs`.

- [ ] **Step 4: Commit**

  ```bash
  git add scripts/cli.test.mjs
  git commit -m "test: guard plan's query after a split in cycle close (PMK-113)"
  ```

  End the message with the `Co-Authored-By` trailer of Global Constraints.

Complexidade: baixa
