# PMK-116 no active sprint in issues list Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `issues list --sprint current` with no active sprint still exits 0 with an empty list, and prints a warning line on stderr that says there is no active sprint.

**Architecture:** The `issues list` handler in `scripts/pmkit.mjs` calls `ctx.tracker().currentCycle()` only when `--sprint current` returned no issues. When that returns `null`, the handler adds one line to `warnings`. The runner already prints warnings to stderr as `warning: <line>`, so stdout and the `--json` data do not change.

**Tech Stack:** Node 18+ ES modules, no dependencies, `node:test`. Run tests with `npm test`.

**Spec:** `docs/superpowers/specs/2026-10-26-pmk-116-list-no-active-sprint-design.md`

## Global Constraints

- Warning text, exactly: `there is no active sprint, so --sprint current matches no issues; run pmkit cycle list`. The runner prefixes it, so stderr shows `warning: there is no active sprint, so --sprint current matches no issues; run pmkit cycle list`.
- It prints on stderr only, in human and `--json` mode. Stdout never carries it.
- It prints when `ctx.opt('sprint') === 'current'`, `found.issues.length === 0` and `ctx.tracker().currentCycle() === null`. It prints whatever other filters are set. A planned sprint does not count as active, so it still prints.
- It prints after the lines built from `found.problems`.
- It does not print with `--sprint none`, a sprint id, no `--sprint`, an active sprint, or a non-empty result.
- Exit code stays 0. Stdout stays `no issues` (human) or `{ "issues": [], "problems": [] }` (`--json`), as today. The `data` and `text` the handler returns do not change.
- Files that may change: `scripts/pmkit.mjs` (the `issues list` handler only), `scripts/cli.test.mjs` (append tests), `scripts/__goldens__/basic/issues-list.txt` and `scripts/__goldens__/no-sprints/issues-list.txt` (regenerated only).
- Goldens that change: four `stderr` sections, from `(empty)` to the warning line, for `issues list --sprint current` and `issues list --sprint current --json` in `basic` and `no-sprints`. Goldens that must not change: `team`, `messy-merge`, every file in `scripts/__scenarios__/`.
- No change to `scripts/lib/`, `scripts/contract-suite.mjs`, `commands/` or `skills/`. No adapter change. No `searchIssues` change.
- No em dash and no colon connector in the message. Straight quotes.
- Never edit a golden by hand. Regenerate with `UPDATE_GOLDENS=1 node --test scripts/goldens.test.mjs` only.
- Every commit message ends with `(PMK-116)` in the subject and the trailer `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`. Every task ends with `npm test` green.

## Review Focus

1. `--sprint current` with only a planned sprint prints the warning, because no sprint is active. Pinned in Task 1.
2. `--sprint current` on `team` with a text filter that matches nothing does not print the warning, because a sprint exists. Pinned in Task 1.
3. `--json` stdout stays parseable and equals `{ issues: [], problems: [] }`. Pinned in Task 1.
4. `--sprint none`, a planned sprint id and no flag print nothing on stderr in `basic`. Pinned in Task 1.
5. Other warnings on `team` (the ISS-3Q6T conflict line) still print and are not mistaken for the sprint warning. Pinned in Task 1.

---

### Task 1: Warn from the handler, with tests and regenerated goldens

The tests, the handler and the goldens go in one task and one commit. Once the handler changes, four golden sections differ and `goldens.test.mjs` fails until they are regenerated, so a commit with the handler and without the goldens would leave the suite red.

**Files:**
- Modify: `scripts/pmkit.mjs` (the `issues list` handler, `run: (ctx) => {` near line 253)
- Test: `scripts/cli.test.mjs` (append at the end; it has `run(cwd, args)`, `json(cwd, args)` and imports `makeRepo`)
- Regenerate: `scripts/__goldens__/basic/issues-list.txt`, `scripts/__goldens__/no-sprints/issues-list.txt`

**Interfaces:**
- Consumes: `ctx.opt(name)`, `ctx.tracker().searchIssues(filter)` returning `{ issues, problems }`, and `ctx.tracker().currentCycle()` returning the active sprint or `null`.
- Produces: no new function. The handler's return shape `{ data, text, warnings }` stays.

- [ ] **Step 1: Write the failing tests.** Append three tests to `scripts/cli.test.mjs`, with this constant above them:

```js
const NO_SPRINT_WARNING = 'warning: there is no active sprint, so --sprint current matches no issues; run pmkit cycle list'
```

  - `issues list --sprint current says there is no active sprint and still lists nothing`: `makeRepo('basic')`, `issues create --title First`. Then:

```js
const result = run(root, ['issues', 'list', '--sprint', 'current'])
assert.equal(result.status, 0)
assert.equal(result.stdout, 'no issues\n')
assert.equal(result.stderr, `${NO_SPRINT_WARNING}\n`)
assert.equal(json(root, ['issues', 'list']).issues.length, 1)
```

  - `issues list --sprint current --json keeps parseable stdout and puts the reason in a warning line`: same setup.

```js
const result = run(root, ['issues', 'list', '--sprint', 'current', '--json'])
assert.equal(result.status, 0)
assert.deepEqual(JSON.parse(result.stdout), { issues: [], problems: [] })
assert.equal(result.stderr, `${NO_SPRINT_WARNING}\n`)
```

  - `issues list --sprint current gives no warning when a sprint is active, and none or an id never warn`. Three parts.
    - `team`: `issues list --sprint current --json` has status 0, its sorted issue ids equal `['ISS-2X6D', 'ISS-4M2S', 'ISS-5N1R', 'ISS-8C4W']`, and `stderr` does not match `/no active sprint/`. `issues list --sprint current --text zzzzzz --json` has status 0, an empty `issues` list, and `stderr` does not match `/no active sprint/`. Do not assert empty stderr on `team`, the ISS-3Q6T conflict warning always prints.
    - `basic`, no sprint: `issues list --sprint none --json` and `issues list --json` each have status 0, `stderr === ''` and an empty `issues` list.
    - `basic` with a planned sprint: `cycle open --start 2026-10-26` (status 0, no `cycle close`). Then `issues list --sprint 2026-10-26 --json` has status 0, `stderr === ''`, an empty `issues` list. Then `issues list --sprint current` has status 0, stdout `no issues\n` and `stderr === \`${NO_SPRINT_WARNING}\n\``.

  Wrap each repo in `try/finally` with `fs.rmSync(root, { recursive: true, force: true })`, as the neighboring tests do.

- [ ] **Step 2: Run to verify they fail for the right reason**

Run: `node --test scripts/cli.test.mjs`
Expected: tests 1 and 2 FAIL on the stderr assertion (actual `''`, expected the warning line). Test 3 FAILS only on its last assertion (the planned-sprint `--sprint current` call, actual stderr `''`); every earlier assertion in it passes. Every other test in the file passes. A failure for another reason (a thrown error, a bad `cycle open`) means the test is wrong, so fix the test first.

- [ ] **Step 3: Change the handler** in `scripts/pmkit.mjs`. After `const warnings = found.problems.map(problemLine)` and before the `return`, add:

```js
      if (ctx.opt('sprint') === 'current' && found.issues.length === 0 && ctx.tracker().currentCycle() === null) {
        warnings.push('there is no active sprint, so --sprint current matches no issues; run pmkit cycle list')
      }
```

  Leave the `return` line as it is.

- [ ] **Step 4: Run to verify the focused tests pass**

Run: `node --test scripts/cli.test.mjs`
Expected: all PASS.

- [ ] **Step 5: Confirm the goldens now fail for the expected reason**

Run: `node --test scripts/goldens.test.mjs`
Expected: FAIL for `basic` and `no-sprints` only, with the diff showing the warning line in a `stderr` section. If `team` or `messy-merge` fails, the handler warns when it should not. Stop and fix the handler.

- [ ] **Step 6: Regenerate the goldens**

Run: `UPDATE_GOLDENS=1 node --test scripts/goldens.test.mjs`
Expected: PASS and the two files rewritten.

- [ ] **Step 7: Read the golden diff line by line**

Run: `git diff scripts/__goldens__` and `git status --short`
Expected, and nothing more:
  - `git status` lists only `scripts/pmkit.mjs`, `scripts/cli.test.mjs`, `scripts/__goldens__/basic/issues-list.txt` and `scripts/__goldens__/no-sprints/issues-list.txt`.
  - The diff has four hunks. Each one changes a `stderr` section from `(empty)` to the warning line, under `issues list --sprint current` (two hunks) or `issues list --sprint current --json` (two hunks), in `basic` and `no-sprints`.
  - The `stdout` and `exit` lines around each hunk are unchanged. No `team` or `messy-merge` file appears.

  Any other changed line is a bug in the handler, not a golden to accept. Revert the golden files with `git checkout scripts/__goldens__`, fix the handler and redo Step 6.

- [ ] **Step 8: Check the scenarios do not change**

Run: `node --test scripts/scenarios.test.mjs` and `git status --short scripts/__scenarios__`
Expected: PASS and no output from `git status`. Do not set `UPDATE_GOLDENS` for this run.

- [ ] **Step 9: Run the full suite**

Run: `npm test`
Expected: all PASS.

- [ ] **Step 10: Commit**

```bash
git add scripts/pmkit.mjs scripts/cli.test.mjs scripts/__goldens__/basic/issues-list.txt scripts/__goldens__/no-sprints/issues-list.txt
git commit -m "fix: say there is no active sprint in issues list --sprint current (PMK-116)" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

Complexidade: média
