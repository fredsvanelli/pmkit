# PMK-367 Check the Jira issue flows live Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Jira branches keep the work-item key upper case, and an opt-in live test runs the PMK-77 issue flows on the throwaway space.

**Architecture:** `branchName` takes an option to keep the key's case; the Jira descriptor's `settings` turns it on and `issues branch` passes it. The live test is one more test in `scripts/lib/jira/client-live.mjs` that runs the real CLI in a temporary repository, checks each answer against Jira's raw item, and deletes what it made.

**Tech Stack:** Node 18+ ES modules, `node:test`, no dependencies (ADR 0003).

**Spec:** `docs/superpowers/specs/2026-11-24-pmk-367-check-jira-issue-flows-live-design.md`

## Global Constraints

- No dependency added (ADR 0003).
- Writes to Jira only in `PMKIT_LIVE_JIRA_SPACE`; everything created is deleted, Kudos left empty.
- The site host, the email and the token never reach the repository, the PR, the issue or test output (`scrub`, `hostless`, `assertNoSecret`).
- `npm test` must not load the live file (its name does not end in `.test.mjs`).
- Commit messages carry `(PMK-367)`.

## Review Focus

- A Jira key with digits in the prefix (`AB2-7`): `branchName` keeps it as given, `AB2-7-slug`. Pinned in Task 1's test.
- A title that slugs to nothing on Jira: the branch is the key alone, upper case (`KAN-3`). Pinned in Task 1's test.
- Local, Linear and GitHub keep lower case: the existing `ids.test.mjs` and CLI tests stay unchanged and pass.
- A live step that fails midway leaves no work item in Kudos: the `finally` deletes by recorded key, children first, and prints each key as it is created.
- Jira's search index trails a create: the `--text` step retries for up to 10 s before failing.

---

### Task 1: Jira branches keep the key upper case

**Files:**
- Modify: `scripts/lib/ids.mjs` (`branchName`)
- Modify: `scripts/lib/jira/adapter.mjs:26` (`settings`)
- Modify: `scripts/lib/adapters.mjs:15-17` (typedef line for the new setting)
- Modify: `scripts/pmkit.mjs:2228` (`issues branch`)
- Modify: `docs/runbooks/issues-jira.md` step 9
- Test: `scripts/ids.test.mjs`, `scripts/lib/jira/adapter.test.mjs`, `scripts/runbook-issues-jira.test.mjs:141-144`

**Interfaces:**
- Produces: `branchName(id: string, title: string, { keepKeyCase = false } = {}): string`; Jira `settings()` returns `keepKeyCase: true`.

- [ ] **Step 1: Write the failing tests**

`ids.test.mjs`, test `branchName keeps the key's case when asked`:
```js
assert.equal(branchName('KAN-12', 'Ship it', { keepKeyCase: true }), 'KAN-12-ship-it')
assert.equal(branchName('AB2-7', 'Fix!', { keepKeyCase: true }), 'AB2-7-fix')
assert.equal(branchName('KAN-3', '!!!', { keepKeyCase: true }), 'KAN-3')
assert.equal(branchName('KAN-12', 'Ship it'), 'kan-12-ship-it')
```
`adapter.test.mjs`: `assert.equal(descriptor.settings({}).keepKeyCase, true)`.
`runbook-issues-jira.test.mjs` step 9: every `eng-1-ship-it` becomes `ENG-1-ship-it`.

- [ ] **Step 2: Run them to see them fail**

Run: `node --test scripts/ids.test.mjs scripts/lib/jira/adapter.test.mjs scripts/runbook-issues-jira.test.mjs`
Expected: FAIL on the new assertions only.

- [ ] **Step 3: Implement**

`branchName`: `const base = keepKeyCase ? id : id.toLowerCase()`. Jira `settings`: add `keepKeyCase: true`. `pmkit.mjs`: `branchName(issue.id, issue.title, { keepKeyCase: ctx.settings().keepKeyCase === true })`. Typedef: `keepKeyCase says issues branch keeps the issue key's case (Jira, ADR 0015)`. Runbook step 9: `ENG-1-ship-it` and one line on why (ADR 0015).

- [ ] **Step 4: Run them to see them pass**, then `npm test` and `npm run lint`. Expected: all pass.

- [ ] **Step 5: Commit** `fix: keep the work-item key upper case in Jira branch names (PMK-367)`

### Task 2: the live issue-flows test

**Files:**
- Modify: `scripts/lib/jira/client-live.mjs` (header comment; a shared repo-and-init helper taken out of the setup test; the new test)

**Interfaces:**
- Consumes: Task 1's upper-case branch name.
- Produces: `test('issue flows on the throwaway space', { skip: NEEDS_SPACE })`.

- [ ] **Step 1: Take the setup test's temporary repository, `cli` runner and every-recommendation `init` into a helper** `liveRepo(t, { gitHost })` returning `{ root, repo, cli, cleanup }`. The setup test uses it unchanged in behavior. The issue test needs a repository with one commit on `main` and `git_host` `github` (`--git-host github --repo acme/widgets --default-branch main`; nothing is pushed).

- [ ] **Step 2: Write the test**, steps 1 to 11 of the design's "Live test" exactly, with these pinned assertions:
  - A's raw `fields.description` holds a `taskList` of two `taskItem`s, states `['TODO','TODO']`, then `['DONE','TODO']` after `issues update A --check 1`.
  - Raw A `issuelinks` has `{ type.name: 'Blocks', outwardIssue.key: B }`; raw B has `{ type.name: 'Blocks', inwardIssue.key: A }`; `issues get B` `blockedBy` `[A]`; `issues list --blocked` ids include B, exclude A.
  - `related`: A lists C and C lists A. `duplicate` (`link C A`): raw C `{ type.name: 'Duplicate', outwardIssue.key: A }`; `issues get C` `duplicateOf` `[A]`; `issues get A` `duplicateOf` `[]`.
  - Parent: after `issues parent B E`, raw B `fields.parent.key === E`; after `issues parent B none`, raw B `fields.parent` absent and `issues get B` has no `parent`.
  - `issues branch A`: `branch` matches `^KAN-\d+-` (the space key, upper case); raw property equals it; `issues list` item A has the same `branch`.
  - `issues list --text <word>` ids equal `[A]` within 10 s.
  - `issues assign A me` `after.assignee` is the session viewer; raw `user/assignable/search` items each have string `accountId`, `displayName`, `accountType`.
  - `issues move A done --dry-run` `requiredFields` deep-equals `requiredFields(rawTransitionToDone)` from `transitions.mjs`; the real move gives raw `status.statusCategory.key === 'done'`.
  - `metrics cycle-time --since <today>` names A; raw `search/jql` with `expand=changelog` on A has `changelog.histories` non-empty.
  - `finally`: raw `DELETE issue/<key>` for E's children first then the rest; then `search/jql` `key in (...)` finds none.

- [ ] **Step 3: Run it skipped**: `node --test scripts/lib/jira/client-live.mjs` without `PMKIT_LIVE`. Expected: every test skips with its reason. `npm run lint` passes.

- [ ] **Step 4: Run it live** (env from the owner's settings, never echoed): `PMKIT_LIVE=1 PMKIT_LIVE_JIRA_SITE=<host> PMKIT_LIVE_JIRA_SPACE=KAN node --test scripts/lib/jira/client-live.mjs`. Expected: pass, the company-managed, scoped and limited tests skipped; Kudos empty after. A failure that shows a real Jira difference goes back to the adapter or fake, test-first, before going on.

- [ ] **Step 5: Commit** `test: a live check of the Jira issue flows (PMK-367)`

### Task 3: record the result

**Files:**
- Modify: `docs/superpowers/specs/2026-11-24-pmk-367-check-jira-issue-flows-live-design.md` (a "Result" section: command, pass/skip counts, per-check table, Kudos state after)
- Modify: `docs/runbooks/issues-jira.md` (the "Live check" line)

- [ ] **Step 1: Write both** from Task 2's run output; no host, email or token.
- [ ] **Step 2: `npm test` and `npm run lint`.** Expected: pass.
- [ ] **Step 3: Commit** `docs: record the live run of the Jira issue flows (PMK-367)`
