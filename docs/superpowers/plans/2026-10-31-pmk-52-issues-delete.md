# PMK-52 issues delete Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans (inline) to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `pmkit issues delete <id>` removes an issue, refuses when other issues reference it, and the command file previews and asks first.

**Architecture:** A new contract operation `delete` on both trackers. Local removes `issues/<ID>/` after checking inbound references from a full scan. Linear checks the references in the issue node and sends `issueDelete`. The CLI prints the preview and puts the references in the JSON error body.

**Tech Stack:** Node ESM, `node:test`, no dependencies (ADR-0003).

**Spec:** `docs/superpowers/specs/2026-10-31-pmk-52-issues-delete-design.md`

## Global Constraints

- Every commit message carries `(PMK-52)` and ends with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Only inbound references block: `blockedBy`, `related`, `duplicateOf`, `parent` of other issues. Everything else is a warning or not scanned.
- A refusal is `CONFLICT`, with `references: [{ id, kind }]` in the JSON error body. An unreadable issue file refuses with `problems` and writes nothing.
- A delete always asks, whatever `write_policy.confirm` says.
- PMK-46 edits `scripts/lib/local/tracker.mjs` for customers and requests. Keep the changes to the issue functions.
- Never run the CLI inside `scripts/__fixtures__/`. Copy a fixture to a temp directory.

## Review Focus

- A referrer that is archived still blocks. Test: an archived child blocks.
- One issue that references through two kinds is listed twice. Test: related and parent from one issue.
- An issue that names the target only in its own `blockedBy` does not block. Test.
- ID prefix collision: `PMK-5` mentions do not match `PMK-52`. Test with mentions.
- A dry run of a refused delete still refuses and writes nothing (not even the index).

---

### Task 1: Local delete

**Files:**
- Modify: `scripts/lib/local/tracker.mjs` (add `deleteIssue`, export as `delete`)
- Test: `scripts/tracker-delete.test.mjs` (new)

**Interfaces:**
- Produces: `tracker.delete(id: string, actor: string, { dryRun?: boolean }) => { before: Issue, after: null, removes: { dir: string, files: string[], events: number, comments: number }, references: [], mentions: { id: string, in: 'description' | 'comment' }[], warnings: string[], unchecked: string[] }`. A refusal throws `PmkitError('CONFLICT', ..., nextStep, { references })`. Unreadable issues throw `PmkitError('INVALID_INPUT', ..., nextStep, { problems })`.

- [ ] **Step 1: Write the failing tests** in `scripts/tracker-delete.test.mjs`: deletes the folder and search forgets it; a dry run leaves the folder and the index file untouched; refusal for blockedBy, related, duplicateOf, parent, archived referrer; own links do not block; unreadable issue refuses with `problems`; warnings for sprint, released release, agent assignee, logged time, todo-key, view with `parent`, branch; mentions in a description and in a comment; `PMK-5` does not match `PMK-52`; `writtenFiles()` lists the folder; a second delete is `NOT_FOUND`.
- [ ] **Step 2: Run** `node --test scripts/tracker-delete.test.mjs`. Expected: FAIL, `tracker.delete is not a function`.
- [ ] **Step 3: Implement** `deleteIssue` after `archive`: `requireWriter`, `readIssue`, one `readAll({ save: false })`, collect references and mentions, build warnings, then `fs.rmSync(paths.dir, { recursive: true })`, `writtenPaths.add(paths.dir)` and refresh the index with `indexedRead(true)` when the index is on.
- [ ] **Step 4: Run** the same command. Expected: PASS.
- [ ] **Step 5: Commit** `feat(tracker): delete an issue from the Local tracker (PMK-52)`.

### Task 2: Contract operation

**Files:**
- Modify: `scripts/lib/contract.mjs`, `scripts/contract-suite.mjs`
- Test: `scripts/contract.test.mjs`

**Interfaces:**
- Consumes: Task 1. Produces: `'delete'` in `TRACKER_OPERATIONS` right after `'archive'`.

- [ ] **Step 1: Write the failing test**: `TRACKER_OPERATIONS.indexOf('delete') === indexOf('archive') + 1`, and a suite case "deletes an issue and refuses while another issue references it" for the `issues` group.
- [ ] **Step 2: Run** `node --test scripts/contract.test.mjs`. Expected: FAIL.
- [ ] **Step 3: Add** the name to the list. Add a stub in the Linear contract wiring so `assertTracker` passes until Task 3.
- [ ] **Step 4: Run** the test. Expected: PASS for the Local run.
- [ ] **Step 5: Commit** `feat(contract): add the delete operation (PMK-52)`.

### Task 3: Linear delete

**Files:**
- Modify: `scripts/lib/linear/issue-ops.mjs`, `scripts/lib/linear/tracker.mjs`
- Test: `scripts/lib/linear/tracker.test.mjs`

**Interfaces:**
- Consumes: `ISSUE_DELETE` from `documents.mjs`. Produces: `issues.delete(id, actor, { dryRun })` with the Task 1 result shape, `removes: { trash: true }`, and `unchecked` naming the other issues' text, views and local code.

- [ ] **Step 1: Write the failing tests**: refusal for a `blocks` out of the issue, a `related` in each direction, a `duplicate` into the issue and a child; own `blockedBy` does not block; a dry run sends no mutation; delete sends one `PmkitIssueDelete`; afterwards `getIssue` is `NOT_FOUND`.
- [ ] **Step 2: Run** `node --test scripts/lib/linear/tracker.test.mjs`. Expected: FAIL.
- [ ] **Step 3: Implement** with `requireViewer`, `readNode` (complete nested lists), the reference rules above, then `client.request(ISSUE_DELETE, { id: node.id })`. A `success: false` answer is `UPSTREAM`.
- [ ] **Step 4: Run** the tests plus `node --test scripts/contract.test.mjs`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(linear): delete an issue with issueDelete (PMK-52)`.

### Task 4: CLI command

**Files:**
- Modify: `scripts/pmkit.mjs` (command `issues delete`, error body fields `references` and `problems`)
- Test: `scripts/cli-delete.test.mjs` (new)

**Interfaces:**
- Consumes: `tracker.delete`. Produces: `pmkit issues delete <id> [--dry-run] [--json]`.

- [ ] **Step 1: Write the failing tests** on a temp copy of the `basic` fixture: dry-run text and JSON show the record, files, warnings and the archive alternative; refusal exits 2 with `error.references` in JSON and the unlink command in `nextStep`; the real run removes the folder; with `auto_commit: true` in a temp git repo the commit holds the removal and `git status --porcelain` is empty; a Linear run through the existing fake.
- [ ] **Step 2: Run** `node --test scripts/cli-delete.test.mjs`. Expected: FAIL.
- [ ] **Step 3: Implement** the command with a custom text writer (the shared `writeText` treats `before: null`-style results as creates). Commit id is the issue id.
- [ ] **Step 4: Run** the test. Expected: PASS.
- [ ] **Step 5: Commit** `feat(issues): add issues delete (PMK-52)`.

### Task 5: Command file, scenario and docs

**Files:**
- Create: `commands/issues/delete.md`, `scripts/__scenarios__/issues-delete.mjs` and its `.after.txt`
- Modify: `scripts/scenarios.test.mjs`, `scripts/scenarios-live.mjs`, `scripts/plugin.test.mjs` (`COMMANDS`), `scripts/cli.test.mjs` lists as needed, `scripts/golden-cases.mjs` if required, `skills/pmkit/references/conventions.md`, `README.md`, `skills/pmkit/SKILL.md`, `CHANGELOG.md`

- [ ] **Step 1: Write** the command file and register the scenario and counts so `npm test` fails on the missing pieces first.
- [ ] **Step 2: Run** `npm test`. Expected: FAIL only on the new registrations.
- [ ] **Step 3: Add** the scenario, goldens, docs and changelog line.
- [ ] **Step 4: Run** `npm test`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(issues): add /pmkit:issues:delete (PMK-52)`.

### Task 6: Delivery

- [ ] Tick the criteria, commit `.issues/`, run `npm test`, open the PR through the pmkit CLI.
