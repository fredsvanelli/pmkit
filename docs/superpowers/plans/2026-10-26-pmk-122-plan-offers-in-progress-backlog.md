# PMK-122 plan offers in-progress issues with no sprint Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `/pmkit:cycle:plan` step 5 drafts the scope from `todo`, `backlog` and `in_progress` issues with no sprint, step 8 shows each issue's status, and `/pmkit:cycle:close` step 6 says that plan offers a sent-back issue again.

**Architecture:** Text-only change to two command files. No CLI, tracker or config change (`--category` already takes a list). A static test parses `plan.md` and fails on today's text. The `cycle-plan` scenario proves the CLI call returns the sent-back issue, and its snapshot is regenerated.

**Tech Stack:** Node 18+ ES modules, no dependencies (ADR 0003), `node:test`. Run tests with `npm test`.

**Spec:** `docs/superpowers/specs/2026-10-26-pmk-122-plan-offers-in-progress-backlog-design.md` (latest commit 20d949c, which holds the orchestrator ruling on the close sentence). The spec is the authority.

## Global Constraints

### Exact texts

- `commands/cycle/plan.md` step 5: replace `--category todo,backlog --sprint none` with `--category todo,backlog,in_progress --sprint none`. The full call stays `node "${CLAUDE_PLUGIN_ROOT}/scripts/pmkit.mjs" issues list --category todo,backlog,in_progress --sprint none --json`. No other word of step 5 changes (creation order, blockers first, skip rule, capacity, unestimated flag).
- `commands/cycle/plan.md` step 8: replace `The preview is a table (ID, title, estimate, assignee, blocked by)` with `The preview is a table (ID, title, status, estimate, assignee, blocked by)`. The sentence continues "with the committed estimate against capacity and the risks of the Output section." No other word changes.
- `commands/cycle/close.md` step 6: insert this sentence after "or split it." and before "A split is for an issue with an estimate": `A move back to the backlog keeps the issue's status and leaves it with no sprint, and `/pmkit:cycle:plan` offers it again unless it is in an `in_review` status.` No fenced call, no category list. Nothing else in close.md changes.

### Static tests (in `scripts/scenarios.test.mjs`, inside `describe('scenarios')`, after the test `cycle/close step 8 runs cycle close after every issues link and issues move call`)

```js
// The in_review assertion encodes the PMK-122 decision (follow-up 1 of the spec). Change it when that issue lands.
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

test('cycle/plan step 8 shows the status of each offered issue', () => {
  const step8 = fs.readFileSync(path.join(COMMANDS_DIR, 'cycle', 'plan.md'), 'utf8').split('\n').find((line) => line.startsWith('8. '))
  assert.ok(step8, 'plan.md has a step 8')
  assert.match(step8, /table \(ID, title, status, estimate, assignee, blocked by\)/)
})
```

### Scenario `scripts/__scenarios__/cycle-plan.mjs`

- Setup env: `PMKIT_USER=fred`, `PMKIT_NOW=2026-10-23T12:00:00Z` (set by `childEnv()` in `prepareCopy`, which also sets `TZ=UTC` and adds `--json`). Add `async setup({ pmkit }) { await pmkit(['cycle', 'add', 'ISS-5N1R', 'ISS-4M2S', '--to', 'none']) }`.
- Step 5 entry: `{ step: '5', read: ['issues', 'list', '--category', 'todo,backlog,in_progress', '--sprint', 'none'], save: 'scope' }`.
- Pinned scope order, the CLI's creation order (10-05, 10-07, 10-08, 10-13): `['ISS-5N1R', 'ISS-3F7H', 'ISS-6J0B', 'ISS-4M2S']`. A comment says the order is the CLI's. All four have `sprint === '2026-10-26'`.
- Header comment: the scope is every todo, backlog or in_progress issue without a sprint. Capacity 14 covers 3 + 2 + 1 points, and ISS-6J0B has no estimate and is flagged.

### `scripts/cli.test.mjs` (near line 498)

The query line becomes `const offered = json(root, ['issues', 'list', '--category', 'todo,backlog,in_progress', '--sprint', 'none']).issues.map((issue) => issue.id)`. The comment "The query of commands/cycle/plan.md step 5." stays. The assertions do not change.

### Files

- May change: `commands/cycle/plan.md`, `commands/cycle/close.md`, `scripts/scenarios.test.mjs`, `scripts/__scenarios__/cycle-plan.mjs`, `scripts/cli.test.mjs`, `.superpowers/state/PMK-122-state.md` (not committed), and by regeneration only `scripts/__scenarios__/cycle-plan.after.txt`.
- Must not change: `scripts/pmkit.mjs`, `scripts/scenario-helpers.mjs`, `scripts/lib/`, `scripts/__fixtures__/`, `scripts/__goldens__/`, `CHANGELOG.md`, `CONTEXT.md`, `skills/pmkit/references/conventions.md`, every other command file and snapshot.

### Snapshot

Never edit a snapshot by hand. Regenerate with `UPDATE_GOLDENS=1 node --test scripts/scenarios.test.mjs` (the `REGENERATE` constant in `scripts/scenarios.test.mjs`). Then run `git diff scripts/__scenarios__/` and read it line by line. The implementer's report lists every changed line. Expected changes in `scripts/__scenarios__/cycle-plan.after.txt`, and no others:

- the step 5 row reads `$ pmkit issues list --category todo,backlog,in_progress --sprint none --json  [step 5, read]`;
- the step 8 dry run and write rows read `cycle add ISS-5N1R ISS-3F7H ISS-6J0B ISS-4M2S --to 2026-10-26`;
- the file changes add `sprint: 2026-10-26` and one `sprint` event (`"from":null,"to":"2026-10-26"`) to ISS-5N1R and ISS-4M2S, beside the two issues already there. The `setup` moves are not in the snapshot, because the baseline is taken after `setup`.

Any other changed line is a finding to explain before the commit. Every other snapshot, including `cycle-close.after.txt`, stays byte for byte.

### Tests and commits

- Baseline: `npm test` at HEAD f84ae6e (before the spec ruling commit, which changes no code) passes with `# tests 1087`, `# pass 1087`, `# fail 0`.
- Expected `# tests` after each task: Task 1 = 1088, Task 2 = 1088, Task 3 = 1089, Task 4 = 1089. The count counts one `test()` per bullet; a different count is fine only when every listed test exists and passes.
- Every commit message carries `(PMK-122)` and ends with the implementer's real model trailer, in this format: `Co-Authored-By: <real model name> <noreply@anthropic.com>`. The plan author's trailer is `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`.

## Review Focus

1. A sprintless `in_review` issue. Plan must not offer it (follow-up 1). Pinned in Task 1 by the `in_review` assertion.
2. An `in_progress` issue that already has a sprint (ISS-2X6D). Plan must not offer it. Pinned in Task 2 by the exact scope.
3. `canceled` and `triage` issues with no sprint (ISS-0G5E, ISS-1V9Z). Plan must not offer them. Pinned in Task 1 (category list) and Task 2 (exact scope).
4. A look-alike value such as `--sprint none2` or `--category todo,backlog,in_progress_x`. Pinned in Task 1 by the whole-value regex and the exact category split.
5. The unestimated ISS-6J0B stays in the scope, so step 5 can still flag it. Pinned in Task 2.

---

### Task 1: plan step 5 reads in_progress

**Files:**
- Modify: `scripts/scenarios.test.mjs` (new test, text in Global Constraints)
- Modify: `commands/cycle/plan.md` (step 5)

**Interfaces:**
- Consumes: `FILES` and `parseCommandFile` results already in `scripts/scenarios.test.mjs` (`call.step`, `call.command`, `call.dryRun`, `call.text`).
- Produces: the step 5 call text that Task 2's scenario entry and `cli.test.mjs` copy.

- [ ] **Step 1: Add the test `cycle/plan step 5 drafts from todo, backlog and in_progress issues with no sprint`** exactly as in Global Constraints.
- [ ] **Step 2: Prove it fails on today's text.**
  Run: `node --test --test-name-pattern='step 5 drafts from' scripts/scenarios.test.mjs`
  Expected: FAIL with `step 5 reads in_progress`.
- [ ] **Step 3: Edit `commands/cycle/plan.md` step 5** with the exact replacement in Global Constraints.
- [ ] **Step 4: Prove it passes.**
  Run: `node --test --test-name-pattern='step 5 drafts from' scripts/scenarios.test.mjs` (expect PASS), then `grep -F -c -- '--category todo,backlog,in_progress --sprint none --json' commands/cycle/plan.md` (expect `1`), then `npm test` (expect `# tests 1088`, `# fail 0`; no snapshot differs, because the scenario matches flag names only).
- [ ] **Step 5: Commit.** `git add scripts/scenarios.test.mjs commands/cycle/plan.md` and `git commit -m "feat(cycle): plan step 5 reads in_progress issues with no sprint (PMK-122)"` plus the trailer.

Complexidade: baixa

### Task 2: the cycle-plan scenario and the PMK-113 guard use the new query

**Files:**
- Modify: `scripts/__scenarios__/cycle-plan.mjs`
- Modify: `scripts/cli.test.mjs` (near line 498)
- Regenerate: `scripts/__scenarios__/cycle-plan.after.txt`

**Interfaces:**
- Consumes: Task 1's step 5 text. The scenario `setup({ pmkit })` hook runs `pmkit(args)` through `childEnv()` and throws on a non-zero exit.
- Produces: the regenerated snapshot.

- [ ] **Step 1: Write the failing check first.** In `cycle-plan.mjs`, add the `setup` and replace the `expect` scope assertions with the pinned order and the sprint loop over all four ids (Global Constraints). Update the header comment. Leave the step 5 entry flags as they are.
- [ ] **Step 2: Prove it fails.**
  Run: `node --test --test-name-pattern='scenario cycle-plan' scripts/scenarios.test.mjs`
  Expected: FAIL. The entry still lists `todo,backlog`, so the saved scope lacks ISS-5N1R and the `deepEqual` of the four ids fails (the snapshot differs as well).
- [ ] **Step 3: Change the step 5 entry flags** to `--category todo,backlog,in_progress` (Global Constraints). In `scripts/cli.test.mjs`, change the query of the test `a split in cycle close leaves the remaining work for cycle plan` the same way.
- [ ] **Step 4: Regenerate and read the diff.**
  Run: `UPDATE_GOLDENS=1 node --test scripts/scenarios.test.mjs`, then `git status --short` (only the four files of this task show) and `git diff scripts/__scenarios__/`. Compare each changed line with the expected list in Global Constraints and list every changed line in the report.
- [ ] **Step 5: Prove it passes.**
  Run: `node --test scripts/scenarios.test.mjs scripts/cli.test.mjs` (expect PASS), then `npm test` (expect `# tests 1088`, `# fail 0`).
- [ ] **Step 6: Commit.** `git add scripts/__scenarios__/cycle-plan.mjs scripts/__scenarios__/cycle-plan.after.txt scripts/cli.test.mjs`, message `test(cycle): cycle-plan scenario offers the issues close sends back (PMK-122)`, plus the trailer.

Complexidade: média

### Task 3: plan step 8 shows the status

**Files:**
- Modify: `scripts/scenarios.test.mjs`
- Modify: `commands/cycle/plan.md` (step 8)

**Interfaces:**
- Consumes: `COMMANDS_DIR`, `fs` and `path`, already imported in the test file.
- Produces: nothing for later tasks.

- [ ] **Step 1: Add the test `cycle/plan step 8 shows the status of each offered issue`** exactly as in Global Constraints, after the Task 1 test.
- [ ] **Step 2: Prove it fails on today's text.**
  Run: `node --test --test-name-pattern='step 8 shows the status' scripts/scenarios.test.mjs`
  Expected: FAIL (the regex finds `table (ID, title, estimate, ...`).
- [ ] **Step 3: Edit step 8 of `commands/cycle/plan.md`** with the exact replacement in Global Constraints.
- [ ] **Step 4: Prove it passes.**
  Run: `node --test --test-name-pattern='step 8 shows the status' scripts/scenarios.test.mjs` (expect PASS), then `npm test` (expect `# tests 1089`, `# fail 0`, and `git status --short scripts/__scenarios__` empty, since no scenario reads the wording).
- [ ] **Step 5: Commit.** `git add scripts/scenarios.test.mjs commands/cycle/plan.md`, message `feat(cycle): plan step 8 preview shows the status column (PMK-122)`, plus the trailer.

Complexidade: baixa

### Task 4: close step 6 links to plan

**Files:**
- Modify: `commands/cycle/close.md` (step 6)

**Interfaces:**
- Consumes: nothing. Produces: nothing. The sentence has no CLI call, so the parser and the `cycle-close` snapshot do not see it. The sentence is prose, so no new test is added (the spec lists none). The failing check is a `grep -F`.

- [ ] **Step 1: Prove the sentence is missing.**
  Run: `grep -F -c "offers it again unless it is in an \`in_review\` status." commands/cycle/close.md`
  Expected: `0`.
- [ ] **Step 2: Insert the sentence** at the place and with the text in Global Constraints.
- [ ] **Step 3: Prove it is there and breaks nothing.**
  Run: the same `grep -F -c` (expect `1`), `git diff --stat` (expect `commands/cycle/close.md | 2 +-` or 1 line changed, and no other file), then `npm test` (expect `# tests 1089`, `# fail 0`; `cycle-close.after.txt` unchanged).
- [ ] **Step 4: Commit.** `git add commands/cycle/close.md`, message `docs(cycle): close step 6 says plan offers a sent-back issue again (PMK-122)`, plus the trailer.

Complexidade: baixa

## Self-review

- Spec coverage: Changes 1 (Tasks 1 and 3), 2 (Task 4), 3 (Task 2), 4 (Tasks 1 and 3), 5 (Task 2), 6 (Task 2). The criteria tests table maps to Tasks 1 to 3.
- Task order: the static test and text first (Task 1), then the scenario and the guard that copy the query (Task 2), then the step 8 column, then the close sentence. Each commit leaves `npm test` green.
- Follow-ups 1 to 4 of the spec are out of this plan.
