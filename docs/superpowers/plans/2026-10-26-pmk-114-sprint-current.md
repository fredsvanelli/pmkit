# PMK-114 sprint current Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `issues create --sprint current` and `issues update --sprint current` put the issue in the active sprint, and fail with a clear error when no sprint is active.

**Architecture:** The tracker resolves `current` in the `requireSprint` normalizer, through a new helper `requireActiveSprintId()` that `moveToCycle` also calls. The CLI passes the flag through unchanged, so only its usage strings change. The two command texts get the new error behavior.

**Tech Stack:** Node 18+ ES modules, no dependencies (ADR 0003), `node:test`. Run tests with `npm test`.

**Spec:** `docs/superpowers/specs/2026-10-26-pmk-114-sprint-current-design.md`

## Global Constraints

- Error code `INVALID_INPUT` (exit code 2), message `there is no active sprint`, next step `pmkit cycle list`. Same as `cycle add --to current`.
- The helper is `requireActiveSprintId()` in `scripts/lib/local/tracker.mjs`, declared next to `activeSprintId` (around line 400). Nothing moves.
- `requireSprint(value)` checks `value === 'current'` before the file lookup. `NORMALIZE.sprint` stays `requireSprint`.
- The resolved id (for example `2026-10-12`), never the word `current`, is stored and written to the event log.
- `--dry-run` resolves `current` like a real run and fails the same way.
- `searchIssues` with `sprint: 'current'` and no active sprint still returns an empty list. Do not touch `search()`.
- Usage strings in `scripts/pmkit.mjs` for `issues create` and `issues update` show `[--sprint id|current|none]`.
- No CHANGELOG entry. No change to `scripts/contract-suite.mjs`. No tracker format change.
- `commands/issues/create.md` line 40: `NOT_FOUND` becomes `INVALID_INPUT` for a missing parent, sprint or member.
- No new dependency. Straight quotes, no em dashes in prose.
- Fixtures: `team` has the active sprint `2026-10-12` and the issue `ISS-3F7H` (status backlog, no sprint). `basic` has no sprint.
- Every commit message ends with `(PMK-114)` and the trailer `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`. Every task ends with the whole suite green.

## Review Focus

1. `--sprint current` on a repo with only a closed sprint: it fails like "no active sprint". Pinned in Task 1.
2. A failed `current` leaves no new issue folder and no event line. Pinned in Task 1.
3. `--dry-run` with `current` shows the real sprint id and writes nothing. Pinned in Task 1.
4. `--sprint none` and an explicit id still work after the change. Pinned in Task 2.
5. `cycle add --to current` with no active sprint keeps its exact message and next step after the helper refactor. Pinned in Task 2.

---

### Task 1: Resolve `current` in the tracker

**Files:**
- Modify: `scripts/lib/local/tracker.mjs` (`requireSprint` at line 177, `activeSprintId` at line 400, `moveToCycle` at lines 740-747)
- Test: `scripts/sprints.test.mjs` (append; it already has `setup(fixture)`, `code(expected, pattern)` and imports `hashTree`)

**Interfaces:**
- Produces: `requireActiveSprintId(): string` (private to the tracker). It returns the id of the single active sprint, or throws `invalid('there is no active sprint', 'pmkit cycle list')`.
- Consumes: `activeSprintId(): string | null`, `invalid(message, nextStep)`, `createIssue(fields, actor, { dryRun })`, `updateIssue(id, fields, actor, { dryRun })`.

- [ ] **Step 1: Write the failing tests** in `scripts/sprints.test.mjs`, each using `setup('team')` or `setup('basic')` and actor `'fred'`:
  - `createIssue({ title: 'T', sprint: 'current' })` on `team`: `after.sprint === '2026-10-12'`, and the issue's `events.jsonl` first line has `op: 'create'` and carries `2026-10-12` (read the file under `<root>/.issues/issues/<id>/events.jsonl`).
  - `updateIssue('ISS-3F7H', { sprint: 'current' })` on `team`: `after.sprint === '2026-10-12'`, and the last event line has `op: 'update'`, `field: 'sprint'`, `to: '2026-10-12'`.
  - `createIssue` and `updateIssue` with `{ sprint: 'current' }` on `basic` (create the issue first for update) throw with `code('INVALID_INPUT', /^there is no active sprint$/)`, and `error.nextStep === 'pmkit cycle list'` (check the property name used by `PmkitError` in `scripts/lib/errors.mjs`). `hashTree(root)` is identical before and after.
  - `dryRun: true` on `team` for both operations: `after.sprint === '2026-10-12'` and `hashTree(root)` is unchanged. On `basic` the same call throws the same error.
  - After `tracker.closeCycle('2026-10-12', 'fred')` on `team`, `createIssue({ title: 'T', sprint: 'current' })` throws `INVALID_INPUT` `there is no active sprint`.

- [ ] **Step 2: Run to verify they fail**

Run: `node --test scripts/sprints.test.mjs`
Expected: the new tests FAIL with `sprint current does not exist`; the old tests pass.

- [ ] **Step 3: Implement.** In `tracker.mjs`:
  - Next to `activeSprintId`, add `const requireActiveSprintId = () => { const id = activeSprintId(); if (id === null) throw invalid('there is no active sprint', 'pmkit cycle list'); return id }`.
  - In `requireSprint(value)`, first line: `if (value === 'current') return requireActiveSprintId()`.
  - In `moveToCycle`, replace the two lines that compute `sprint` and throw with `const sprint = to === 'current' ? requireActiveSprintId() : to`. Keep `if (sprint !== null) getSprint(sprint)`.

- [ ] **Step 4: Run to verify they pass**

Run: `npm test`
Expected: all tests PASS.

- [ ] **Step 5: Commit**

```bash
git add scripts/lib/local/tracker.mjs scripts/sprints.test.mjs
git commit -m "fix: resolve --sprint current in issue create and update (PMK-114)"
```

Complexidade: média

---

### Task 2: CLI behavior and usage strings

**Files:**
- Modify: `scripts/pmkit.mjs` (usage at lines 265 and 275 only)
- Test: `scripts/cli.test.mjs` (add after the test at line 582; it has `run(cwd, args)` and `json(cwd, args)`)

**Interfaces:**
- Consumes: Task 1 behavior of `requireSprint`. `issuePatch` stays unchanged.

- [ ] **Step 1: Write the tests** (they pass once Task 1 is in, so this task proves the CLI end to end; to see them fail, run them with Task 1's `tracker.mjs` change stashed):
  - `issues create --title T --sprint current` on `team`: `after.sprint === '2026-10-12'`, exit 0.
  - `issues update ISS-3F7H --sprint current` on `team`: `after.sprint === '2026-10-12'`.
  - Both commands on `basic` (create an issue first for update) with `--json`: `status === 2`, `error.code === 'INVALID_INPUT'`, `error.message === 'there is no active sprint'`.
  - On `team`, `issues update ISS-3F7H --sprint 2026-10-12` sets the sprint, then `--sprint none` makes `after.sprint` null or absent (match how `cycle add --to none` is asserted in the existing tests).
  - Extend the existing `cycle add --to current` test on `basic` (line 589 onward): assert `error.message === 'there is no active sprint'` and, if the JSON error exposes a next step field, that it equals `pmkit cycle list`.

- [ ] **Step 2: Update the usage strings.** In the `issues create` entry change `[--sprint]` to `[--sprint id|current|none]`; in the `issues update` entry the same.

- [ ] **Step 3: Verify help output**

Run: `node scripts/pmkit.mjs issues create --help` and `node scripts/pmkit.mjs issues update --help`
Expected: each shows `[--sprint id|current|none]`.

- [ ] **Step 4: Run the suite**

Run: `npm test`
Expected: PASS. If a golden fails on the usage string, regenerate with `UPDATE_GOLDENS=1 npm test` and review the diff; the spec found none that contains it.

- [ ] **Step 5: Commit**

```bash
git add scripts/pmkit.mjs scripts/cli.test.mjs
git commit -m "test: cover --sprint current end to end and show it in usage (PMK-114)"
```

Complexidade: média

---

### Task 3: Command texts

**Files:**
- Modify: `commands/issues/create.md` (lines 15, 24-25, 40)
- Modify: `commands/issues/update.md` (line 16 area, "If something is missing" at the end)

**Interfaces:**
- Consumes: the error behavior from Task 1. `scripts/scenarios.test.mjs` parses these files, so the suite is the check.

- [ ] **Step 1: Edit `create.md`.**
  - Line 40: replace `NOT_FOUND` with `INVALID_INPUT`.
  - Add this bullet under "If something is missing", after line 40: `- \`--sprint current\` with no active sprint: the dry run in step 4 answers \`INVALID_INPUT\` "there is no active sprint" before the confirmation question. Say so, show no preview, and offer \`/pmkit:cycle:plan\` or creating the issue without a sprint.`
  - Where `--sprint` is listed (line 24), add one clause: the value is a sprint id, `current` or `none`.

- [ ] **Step 2: Edit `update.md`.**
  - Add under "If something is missing" the same bullet, ending "or updating the issue without a sprint". Add that `--sprint current` is accepted.
  - Where `--sprint` is described (line 34), add one clause: the value is a sprint id, `current` or `none`.

- [ ] **Step 3: Run the suite**

Run: `npm test`
Expected: PASS, no golden changes. Confirm with `git status` that only the two `.md` files changed.

- [ ] **Step 4: Commit**

```bash
git add commands/issues/create.md commands/issues/update.md
git commit -m "docs: document --sprint current and its error in issues create and update (PMK-114)"
```

Complexidade: baixa
