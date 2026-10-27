# PMK-24 triage command Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `/pmkit:backlog:triage` reads the `triage` queue, proposes one decision per issue (accept, duplicate, decline or needs info), and applies the accepted ones after one full preview.

**Architecture:** One new command file, `commands/backlog/triage.md`, built only from CLI calls that exist (ADR 0002: judgment stays in the command, no CLI change). The command table, README, `plugin.test.mjs`, a static test and a scenario module with three entries follow it. The version bump and the changelog entry are left to the release, as in the other EPC-3 issues.

**Tech Stack:** Node 18+ ES modules, no dependencies (ADR 0003), `node:test`. Run the suite with `npm test`.

**Spec:** `docs/superpowers/specs/2026-10-26-pmk-24-triage-command-design.md`. The spec is the authority. Where this plan and the spec differ, the spec wins, and the implementer reports the difference.

## Global Constraints

- Name and home: `/pmkit:backlog:triage`, file `commands/backlog/triage.md`, scenario `scripts/__scenarios__/backlog-triage.mjs`.
- Accept moves the issue to `backlog`. Decline moves it to `canceled` and posts a comment with the reason, shown in the preview. A duplicate is proposed for any match, with the original's status in the table, then `issues link <dup> <kept> --kind duplicate` and `issues move <dup> canceled`.
- No CLI, schema, tracker or capability change. Labels come only from `discover`. `--label` replaces the list, so the command sends the existing labels plus the accepted ones.
- The preview is always full and asked once, whatever `write_policy.confirm` says.
- Frontmatter: `description`, `argument-hint: ""`, `disable-model-invocation: true`. Sections in order: Parameters, Steps, Confirmation points, Output, If something is missing. The first step line is the conventions read.
- Every `pmkit.mjs` call in the command ends with `--json`. Use the call form `node "${CLAUDE_PLUGIN_ROOT}/scripts/pmkit.mjs" <command> ... --json`.
- Parser rule (`scripts/scenario-helpers.mjs`): a backticked flag in a step's prose joins the last call before it in that step, and rule 3 fails when the CLI command does not take it. Put a flag in prose only right after a call that takes it.
- All repo text is English and follows `/home/fred/.claude/skills/unslop/SKILL.md`: no em dashes, no colon connectors, active voice.
- Every commit message ends with `(PMK-24)` in the subject and the trailer `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

- The accepted issue already has labels. The write sends the union, so `[webhooks]` plus `backend` gives `backend,webhooks`, not `backend`. Task 2 asserts it.
- The queue is empty (`basic` fixture). The command says so, reads nothing else and writes nothing. Task 3 covers it.
- The user stops or accepts nothing at step 5. Nothing changes. Task 3 covers the one-by-one path with skipped issues, which must stay in `triage`.
- `discover` lists no labels, a proposed original cannot be read, or a CLI call fails mid-batch. The command text names each case (Task 1 static test checks the wording), and no scenario can force them.
- The user declines at step 7. The `Step 7` confirmation point is covered in Task 2 only as a yes, so the static test in Task 1 asserts the text "When the user declines, change nothing".

## Acceptance criteria map

- AC1, "Lists the issues in the triage category with a suggested priority, labels, duplicate or decline for each": steps 1 to 4 of the command. Task 1 static test asserts the table columns and the three proposal kinds. Task 2 reads the queue (`issues list --category triage`) and checks the four proposals.
- AC2, "Applies the accepted decisions in bulk or one by one, after a preview": steps 5 to 8. Task 1 asserts a dry run per write command in step 6. Task 2 covers apply-all, Task 3 covers one by one. Both check the tracker after the run.

## File structure

- Create `commands/backlog/triage.md`: the procedure.
- Create `scripts/__scenarios__/backlog-triage.mjs` and its snapshots `backlog-triage.0.after.txt`, `.1.after.txt`, `.2.after.txt`.
- Modify `skills/pmkit/SKILL.md`, `README.md`: one line each, after the `groom` line.
- Modify `scripts/plugin.test.mjs` (the `COMMANDS` map), `scripts/scenarios.test.mjs` (file count and a static test). `CHANGELOG.md`, `.claude-plugin/plugin.json` and `scripts/changelog.test.mjs` do not change.
- `commands/help.md` reads the command files at run time. `scripts/__scenarios__/help.after.txt` lists no command, so neither changes.

---

### Task 1: Command file, tables and static tests

**Files:**
- Create: `commands/backlog/triage.md`
- Modify: `scripts/plugin.test.mjs:93`, `scripts/scenarios.test.mjs` (count test at line 64, new test after the `cycle/close` tests), `skills/pmkit/SKILL.md`, `README.md`

**Interfaces:**
- Produces: step ids the scenario in Tasks 2 and 3 matches by `callKey` (`<step> <command>`): `1 issues list`, `2 discover`, `3 issues get`, `3 issues list`, `6 issues update`, `6 issues move`, `6 issues link`, `6 issues comment`. Confirmation points `Step 5` and `Step 7`. Step 9 holds no call, because it says "run step 1 again".

- [ ] **Step 1: Write the failing tests**

In `scripts/plugin.test.mjs` change `backlog: ['groom']` to `backlog: ['groom', 'triage']`. In `scripts/scenarios.test.mjs` change `there are 24 command files` and its `24` to `25`, and add this test inside `describe('scenarios')` after the `cycle/close` tests. It reads `commands/backlog/triage.md` the way the neighbouring tests read `close.md`.

```js
test('backlog/triage proposes four kinds of decision and previews every write with a dry run', () => {
  const file = FILES.find((f) => f.rel === 'backlog/triage.md')
  assert.ok(file, 'commands/backlog/triage.md exists')
  const lines = fs.readFileSync(path.join(COMMANDS_DIR, 'backlog', 'triage.md'), 'utf8').split('\n')
  const step = (n) => lines.find((line) => line.startsWith(`${n}. `)) ?? ''
  const has = (step_, command, dry) => file.parsed.calls.some((c) => c.step === step_ && c.command === command && c.dryRun === dry)
  assert.ok(has('1', 'issues list', false) && has('2', 'discover', false), 'steps 1 and 2 read the queue and the allowed values')
  assert.match(file.parsed.calls.find((c) => c.step === '1').text, /--category triage/)
  assert.match(step(4), /proposal.*priority.*labels/s, 'step 4 shows proposal, priority and labels')
  for (const kind of ['accept', 'duplicate of', 'decline', 'needs info']) assert.ok(step(4).includes(kind), `step 4 names ${kind}`)
  for (const command of ['issues update', 'issues move', 'issues link', 'issues comment']) assert.ok(has('6', command, true), `step 6 dry-runs ${command}`)
  assert.ok(!file.parsed.calls.some((c) => c.step === '6' && !c.dryRun && ['issues update', 'issues move', 'issues link', 'issues comment'].includes(c.command)), 'step 6 has no write without --dry-run')
  assert.match(step(8), /without `--dry-run`/, 'step 8 runs the step 6 commands as writes')
  assert.match(step(7), /whatever `write_policy.confirm` says/)
  assert.match(step(7), /When the user declines, change nothing/)
  assert.match(step(3), /is a guess/, 'a duplicate match is called a guess')
  const text = lines.join('\n')
  for (const needle of ['`discover` lists no labels', 'A proposed original cannot be read']) assert.ok(text.includes(needle), `the missing-cases section names: ${needle}`)
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test scripts/plugin.test.mjs scripts/scenarios.test.mjs 2>&1 | grep -E "^# (pass|fail)|not ok" | head`
Expected: FAIL on the command-file count, the new test, and `plugin.test.mjs` (SKILL.md and README do not name `triage`).

- [ ] **Step 3: Write `commands/backlog/triage.md`**

Follow the "Steps", "Confirmation points", "Output" and "If something is missing" sections of the spec, in the groom file's style (`commands/backlog/groom.md` is the template for headings, `Arguments: \`$ARGUMENTS\``, and the step wording). Pinned values:
  - Frontmatter `description: Triage the issues nobody has looked at yet and apply the decisions you accept`.
  - Title `# Triage the backlog`. Parameters: `None. Every issue in the \`triage\` category is in scope.`
  - Step 1: `issues list --category triage --json`. Step 2: `discover --json`. Step 3: `issues get <id> --comments --json`, and `issues list --text "<key words from the title>" --json` for the duplicate search; the sentence on a duplicate says the match "is a guess" and that the table shows the original's status.
  - Step 4 names the table columns `ID, title, status, assignee, estimate` plus `proposal`, `priority` and `labels` after them, and the proposal values `accept`, `duplicate of <id>`, `decline` and `needs info`.
  - Step 5 asks with `AskUserQuestion` (apply all, one group, one by one, stop). Step 6 holds one bullet per decision with the dry-run calls of the spec (`issues update <id> --priority <p> --label <existing,new> --dry-run --json`, `issues move <id> backlog --dry-run --json`, `issues link <dup> <kept> --kind duplicate --dry-run --json`, `issues move <dup> canceled --dry-run --json`, `issues move <id> canceled --dry-run --json`, `issues comment <id> --body-file <file> --dry-run --json`) and the bullet "Skip a write whose `before` equals `after`".
  - Step 7 contains "whatever `write_policy.confirm` says" and "When the user declines, change nothing." Step 8 says "run the same commands without `--dry-run`, issue by issue, in the order of step 6", and stops on the first failure without a retry. Step 9 says "Run step 1 again and compare the count", then removes the temporary files, and holds no call line.
  - Confirmation points: `- Step 5: ...` and `- Step 7: ...`, as the spec lists them.
  - "If something is missing" has the four bullets of the spec, starting `An empty queue`, `` `discover` lists no labels``, `A proposed original cannot be read` and `An error from the CLI`.

- [ ] **Step 4: Add the two table lines**

`skills/pmkit/SKILL.md`, after the `groom` row: `| triage the issues nobody has looked at and apply the decisions the user accepts | \`/pmkit:backlog:triage\` | \`${CLAUDE_PLUGIN_ROOT}/commands/backlog/triage.md\` |`. `README.md`, after the `groom` line: `` - `/pmkit:backlog:triage`: Triage the issues nobody has looked at and apply the decisions the user accepts. ``

- [ ] **Step 5: Run the tests**

Run: `node --test scripts/plugin.test.mjs scripts/scenarios.test.mjs 2>&1 | grep -E "^# (pass|fail)|not ok"`
Expected: `plugin.test.mjs` passes, and in `scenarios.test.mjs` the count test and the new static test pass, rules 3, 4 and 13 pass for `triage.md`. The only failures left are `every command file has a scenario` and the scenario run for `backlog/triage`, which Task 2 fixes. The suite is green again after Task 2.

- [ ] **Step 6: Commit**

```bash
git add commands/backlog/triage.md skills/pmkit/SKILL.md README.md scripts/plugin.test.mjs scripts/scenarios.test.mjs
git commit -m "feat(backlog): add the triage command (PMK-24)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Scenario, apply all proposals

**Files:**
- Create: `scripts/__scenarios__/backlog-triage.mjs`, `scripts/__scenarios__/backlog-triage.0.after.txt`

**Interfaces:**
- Consumes: the step ids and confirmation points of Task 1. Template: `scripts/__scenarios__/backlog-groom.mjs` (steps `read`, `dryRun`, `write`, `confirm`, `save`) and `issues-comment.mjs` (a comment through `--body-file -` with `stdin`).
- Produces: `export default [applyAll, oneByOne, emptyQueue]`. This task writes the first entry and exports the array with one element. Task 3 adds the others.

- [ ] **Step 1: Write the scenario (the failing test)**

Entry `applyAll`: `command: 'backlog/triage'`, `fixture: 'team'`, `prompt: '/pmkit:backlog:triage'`, `answers: ['Apply all proposals', 'Yes']`. The `setup({ pmkit })` creates, with `issues create ... --description-file -` and a `stdin` text as in `backlog-groom.mjs`, then `issues move <id> triage` for the three that must be in triage (create files into `backlog`, the fixture's `default_status`):
  - `Webhook deliveries are not retried` (bug, `--label webhooks`): the accept case.
  - `Login is slow after I press submit` (bug): the duplicate case.
  - `Rewrite the CLI in Rust` (feature): the decline case.
  - `Login form hangs for ten seconds` (bug), left in `backlog`: the original of the duplicate.
  The fixture's own `ISS-1V9Z` ("Investigate slow login") is the fourth triage issue and the "needs info" case. The new IDs are random but fixed by the test environment. Run the scenario once, read them from the failure output, and name them in the header comment and the steps as `ACCEPT`, `DUP`, `DECLINE`, `ORIGINAL` constants.
  Steps, in order: `{ step: '1', read: ['issues','list','--category','triage'], save: 'queueBefore' }`, `{ step: '2', read: ['discover'] }`, `{ step: '3', read: ['issues','get', ISS-1V9Z, '--comments'] }`, `{ step: '3', read: ['issues','list','--text','login'] }`, `{ confirm: 'Step 5' }`, then `dryRun` entries in step `6` for: `issues update ACCEPT --priority high --label backend,webhooks`, `issues move ACCEPT backlog`, `issues link DUP ORIGINAL --kind duplicate`, `issues move DUP canceled`, `issues move DECLINE canceled`, `issues comment DECLINE --body-file -` (with `stdin` the reason: `pmkit ships Node scripts with no dependencies (ADR 0003), so a Rust rewrite is out of scope.`), then `{ confirm: 'Step 7' }`, the same six as `write` entries (step `'6'`, as `backlog-groom.mjs` does), then `{ step: '1', read: [...], save: 'queueAfter' }`. Use `skip: {}` and `notHit: {}`, and fill them only with reasons for the keys rule 6 reports.
  `expect(repo, saved)` asserts:
  - `saved.queueBefore` holds the four IDs; `saved.queueAfter` holds only `ISS-1V9Z`.
  - `ACCEPT` has status `backlog`, priority `high`, and `labels` equal to `['backend', 'webhooks']` (the union).
  - `DUP` is `canceled` with `duplicate_of` equal to `[ORIGINAL]`.
  - `DECLINE` is `canceled`, and `repo.newEvents(DECLINE)` holds one `comment` event.
  - `ISS-1V9Z` is still `triage`.

- [ ] **Step 2: Run it to see it fail, then settle the IDs**

Run: `node --test scripts/scenarios.test.mjs 2>&1 | grep -E "triage|rule" | head -20`
Expected: FAIL with the snapshot missing and, on the first run, the real IDs. Fix the constants and any rule 5 to 11 message (a flag the call does not carry, an unused call key that needs a `skip` reason, an order problem).

- [ ] **Step 3: Generate and read the snapshot**

Run: `UPDATE_GOLDENS=1 node --test scripts/scenarios.test.mjs 2>&1 | grep -E "^# (pass|fail)"`, then read `scripts/__scenarios__/backlog-triage.after.txt`. The file name is `backlog-triage.after.txt` while the module exports one entry, and Task 3 renames it to `backlog-triage.0.after.txt` when it exports an array. Check that the order is: reads, `? Step 5`, six dry runs, `? Step 7`, six writes, the final read.

- [ ] **Step 4: Run the whole suite**

Run: `npm test 2>&1 | tail -8`
Expected: all pass. This is the first green point since Task 1.

- [ ] **Step 5: Commit**

```bash
git add scripts/__scenarios__/backlog-triage.mjs scripts/__scenarios__/backlog-triage.after.txt
git commit -m "test(backlog): add the triage scenario for apply all (PMK-24)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Scenario, one by one and empty queue

**Files:**
- Modify: `scripts/__scenarios__/backlog-triage.mjs`
- Create: `backlog-triage.1.after.txt`, `backlog-triage.2.after.txt`; rename `backlog-triage.after.txt` to `backlog-triage.0.after.txt` (`git mv`)

**Interfaces:**
- Consumes: `applyAll` and its `setup` from Task 2. Move the shared setup into a `const setup = ...` used by entries 0 and 1.
- Produces: `export default [applyAll, oneByOne, emptyQueue]`. The helpers name snapshots `<name>.<index>.after.txt` for an array (see `snapshotFile` in `scripts/scenario-helpers.mjs`).

- [ ] **Step 1: Write the two entries (the failing test)**

Entry `oneByOne`, same fixture and setup, `answers: ['Go through them one by one', 'Accept with priority medium', 'Skip', 'Skip', 'Skip', 'Yes']`. The user changes the priority of `ACCEPT` to `medium` and skips the other three. Steps: the reads of Task 2 (with `save: 'queueBefore'` and `save: 'queueAfter'`), `confirm: 'Step 5'`, `dryRun` of `issues update ACCEPT --priority medium --label backend,webhooks` and `issues move ACCEPT backlog` in step `'6'`, `confirm: 'Step 7'`, the two writes. Put a reason in `skip` for every step 6 call key the entry does not use (`6 issues link`, `6 issues comment`), for example `this path accepts one issue and skips the rest`. `expect`: `ACCEPT` is in `backlog` with priority `medium`; `DUP`, `DECLINE` and `ISS-1V9Z` are all still `triage`; `saved.queueAfter` holds those three IDs; `repo.newEvents(DUP)` and `repo.newEvents(DECLINE)` are empty.
Entry `emptyQueue`: `fixture: 'basic'`, `prompt: '/pmkit:backlog:triage'`, `answers: []`, one step `{ step: '1', read: ['issues','list','--category','triage'] }`. `skip` gives a reason for every other call key (`2 discover`, `3 issues get`, `3 issues list`, and the four step 6 keys: `the queue is empty, so the command stops after step 1`). `notHit` gives that reason for `Step 5` and `Step 7`. `expect(repo)` asserts the tree is unchanged: `repo.newEvents` is not needed, assert `repo.changes?.length ?? 0` is 0, using the helper the `help` scenario family already uses; if `makeRepoView` has no such field, assert nothing here, because rule 8 already fails any write on a no-write entry.
Export `[applyAll, oneByOne, emptyQueue]`.

- [ ] **Step 2: Run to see it fail**

Run: `node --test scripts/scenarios.test.mjs 2>&1 | grep -E "triage|rule" | head -20`
Expected: FAIL with missing snapshots for index 0, 1 and 2, and the stale `backlog-triage.after.txt`.

- [ ] **Step 3: Rename and regenerate**

Run: `git mv scripts/__scenarios__/backlog-triage.after.txt scripts/__scenarios__/backlog-triage.0.after.txt && UPDATE_GOLDENS=1 node --test scripts/scenarios.test.mjs 2>&1 | grep -E "^# (pass|fail)"`, then `git diff --stat` and read the two new snapshots. Entry 0 must be unchanged. Entry 1 has two dry runs and two writes. Entry 2 has one read and no confirm line.

- [ ] **Step 4: Run the whole suite**

Run: `npm test 2>&1 | tail -8`
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add scripts/__scenarios__
git commit -m "test(backlog): cover triage one by one and an empty queue (PMK-24)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Final check

**Files:** none.

- [ ] **Step 1: Verify the whole change**

Run: `npm test 2>&1 | tail -8`
Expected: all pass. Then run `node scripts/pmkit.mjs validate --json` and confirm no problem names triage. Tick the issue's acceptance criteria only after the delivery step of `/pmkit:issues:work`, not here. This task makes no commit.

---

## Self-review

- Spec coverage: command (Task 1), supporting changes (Task 1), tests (Tasks 1 to 3), all four anti-goals have a test or a text assertion. `help.md` and the `help` snapshot stay unchanged on purpose.
- The version bump and the changelog entry are not part of this issue. The release adds them, as in the other EPC-3 issues.
- Deviation from the spec text: the static test checks a dry-run form for each write command in step 6, and that step 8 says "without `--dry-run`", instead of explicit step 8 calls. This is the form `backlog/groom.md` uses and the scenario helpers expect.
