# Improve unblock-pr Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `pr blockers` reads rulesets and every review thread, reads the pull request once, and `pr status` and `/pmkit:issues:mine` show the verdict.

**Architecture:** The GitHub host (`scripts/lib/github/host.mjs`) gains `getPullRequest(selector, { detail: true })`, a paged `prThreads` without bodies and `branchRules(base)`; `prReviews` and `prMergeState` go away. `collectBlockers` (`scripts/lib/pr-blockers.mjs`) reads `pr.detail`, merges protection and rules into one set of requirements, and `pr status` (`scripts/pmkit.mjs`) runs it.

**Tech Stack:** Node ESM, `node:test`, `gh` through an injected `exec`.

**Spec:** `docs/superpowers/specs/2026-11-09-pmk-218-improve-unblock-pr-design.md`

## Global Constraints

- Every commit message carries `(PMK-218)` and ends with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- No timeout on the new reads; `gh` calls go through `run`/`check` (shared `MAX_OUTPUT`).
- A read that GitHub refuses with 403/404 becomes an `unchecked` entry; never conclude "met", "none" or "nothing blocks" from a missing read.
- `npm test` must exit 0 in the foreground (leak guard included).
- Detail fields: `reviews,reviewRequests,mergeable,mergeStateStatus,reviewDecision,baseRefName`.
- Rules endpoint: `repos/{owner}/{repo}/rules/branches/<encodeURIComponent(base)>?per_page=100&page=<n>`.

## Review Focus

1. Protection refused (the common non-admin case) with rules read: unmet ruleset requirements block, open items are `unknown`, text never says `all met` (Task 3 test).
2. A ruleset required check that fails while protection is unread: listed once in `blocking`, not again in `unknown` (Task 3 test).
3. Thread pagination where `hasNextPage` is true but `endCursor` is missing: `UPSTREAM`, no endless loop (Task 1 test).
4. `pr status` on a merged pull request: no blockers line, `blockers.blocked` false, no extra reads (Task 4 test).
5. `pr status` with protection refused: `blockers.blocked` null and the text says `blockers not verified`, never `nothing blocks it` (Task 4 test).

---

### Task 1: Host reads (detail, paged threads, rules)

**Files:**
- Modify: `scripts/lib/github/host.mjs` (`VIEW_FIELDS`, `THREADS_QUERY`, `getPullRequest`, `prThreads`, remove `prReviews`/`prMergeState`, add `branchRules`)
- Test: `scripts/github-host.test.mjs`

**Interfaces:**
- Produces: `getPullRequest(selector, { detail = false } = {})` → view fields, plus `detail: { reviews, reviewRequests, mergeable, mergeStateStatus, reviewDecision, baseRefName }` when `detail`; `prThreads(number)` → `{ threads: [{ isResolved, isOutdated, path, line, url, author }] }`; `branchRules(base)` → array of `{ type, parameters }`.

- [ ] **Step 1: Write the failing tests** in `scripts/github-host.test.mjs`:
  - `getPullRequest with detail reads the review and merge fields in the same gh pr view`: args `['pr','view','feat','--json', VIEW_FIELDS + ',reviews,reviewRequests,mergeable,mergeStateStatus,reviewDecision,baseRefName']`; result has the view fields and `detail` with the six fields, and no top-level `reviews`.
  - `prThreads reads every page, sends the cursor of the previous page and asks for no comment body`: two replies (page 1 `hasNextPage: true, endCursor: 'c1'`, page 2 `hasNextPage: false`); `calls.length === 2`; second call args include `endCursor=c1`, first does not; the `query=` arg does not contain `body`; threads from both pages, each without `body`; result has no `incomplete`.
  - `prThreads fails when GitHub says there is a next page without a cursor`: `hasNextPage: true`, no `endCursor` → throws `UPSTREAM` matching `/no cursor/`.
  - `branchRules reads the active rules of the base page by page`: first page 100 rules, second page 1 → 101 rules; args `['api','repos/{owner}/{repo}/rules/branches/main?per_page=100&page=1']` then `page=2`; a 403 stderr throws `UPSTREAM` with `httpStatus` 403; a non-array reply throws `UPSTREAM`; `-x` throws `INVALID_INPUT` with no call.
  - Replace the `prMergeState`/`prReviews` uses in the existing failure-mapping tests with `prRefs(1)`; delete `prMergeState reads the merge fields` and the `prReviews` half of `prChecks and prReviews call gh with the spec flags`; update the old `prThreads ... reports a second page` test to the new shape.
- [ ] **Step 2:** `node --test scripts/github-host.test.mjs` → the new tests FAIL.
- [ ] **Step 3: Implement.** `THREADS_QUERY` takes `$endCursor: String`, `reviewThreads(first: 100, after: $endCursor)`, `pageInfo { hasNextPage endCursor }`, comment nodes `url author { login }`. Later pages append `-f endCursor=<cursor>`. `branchRules` loops pages until a page has fewer than 100 items.
- [ ] **Step 4:** `node --test scripts/github-host.test.mjs` → PASS.
- [ ] **Step 5:** Commit `feat(github): read a pull request with its detail once, every review thread and the branch rules (PMK-218)` (together with Task 2, since `collectBlockers` uses the removed reads).

### Task 2: collectBlockers on `pr.detail` and complete threads

**Files:**
- Modify: `scripts/lib/pr-blockers.mjs`
- Test: `scripts/pr-blockers.test.mjs`

**Interfaces:**
- Consumes: `pr.detail` (Task 1), `host.prChecks`, `host.prThreads`, `host.branchProtection`.
- Produces: `collectBlockers(host, pr)` with the same result keys; `threads` is `{ open, outdated }`.

- [ ] **Step 1: Update the tests.** `OPEN_PR` gets `detail: { ...merge(), reviews: [], reviewRequests: [] }`; a helper `open(over)` builds a pr whose detail merges `over`. The stub drops `prReviews`/`prMergeState`, `prThreads` defaults to `{ threads: [] }`. Rewrite every `prReviews:`/`prMergeState:` stub option as detail. Remove the tests whose only subject is a refused review or merge-state read and the `incomplete` thread assertions. New test: `the reviews and the merge state come from the pull request, with no other read`: `calls` never holds a review or merge read.
- [ ] **Step 2:** `node --test scripts/pr-blockers.test.mjs` → FAIL.
- [ ] **Step 3: Implement.** `mergeState` and `reviewData` from `pr.detail`; drop the `attempt('conflicts'|'reviews')`, the base-unknown entry, `required approvals` from `NEEDS`, the `threads.incomplete` unknown item and the "first 100" texts.
- [ ] **Step 4:** `node --test scripts/pr-blockers.test.mjs scripts/github-host.test.mjs` → PASS.
- [ ] **Step 5:** Commit with Task 1.

### Task 3: Rulesets in the policies

**Files:**
- Modify: `scripts/lib/pr-blockers.mjs`
- Test: `scripts/pr-blockers.test.mjs`

**Interfaces:**
- Consumes: `host.branchRules(base)` (Task 1).
- Produces: `policies = { protected: boolean|null, rulesets: string[]|null, unread: string[], requiredApprovals, approvals, requiredChecks, unmet, unreadRule, unevaluated }` or `null` when neither source was read.

- [ ] **Step 1: Write the failing tests** (stub default `branchRules: []`):
  - `a ruleset pull_request rule requires approvals and conversation resolution`: rules `[{ type: 'pull_request', parameters: { required_approving_review_count: 2, required_review_thread_resolution: true } }]`, one approval, one open thread → `blocking` has `needs 1 more approval (1 of 2)` and the conversation message; `policies.rulesets` `['pull_request']`.
  - `a ruleset required check and strict policy merge with the classic protection`: classic `contexts: ['lint']`, rule `required_status_checks: [{ context: 'build' }]`, `strict_required_status_checks_policy: true`, both checks failing, `mergeStateStatus: 'BEHIND'` → `requiredChecks` `['lint','build']`, both unmet, the behind item blocks.
  - `the largest required approval count of both sources wins`: classic 1, rule 3 → `requiredApprovals` 3.
  - `with the protection refused and the rules read, a known unmet rule blocks and the rest is unknown`: protection `refusal()`, rule requires `build` (failing) and a requested reviewer `cy` → `blocking` holds `required check build does not pass`; `unknown` holds `waiting for cy` and no `build` item; `blocked` true; `policies.protected` null, `policies.unread` `['branch protection']`; text matches `/^policies: required check build does not pass; not read: branch protection/m` and not `/all met/`.
  - `with both policy reads refused, policies is null and both are unchecked`: two `unchecked` entries with area `policies`.
  - `BLOCKED with both sources read names the active rules it does not evaluate`: rules `[{ type: 'required_signatures' }, { type: 'pull_request', parameters: {} }]`, `mergeStateStatus: 'BLOCKED'` → blocking message matches `/does not evaluate .*active rules it does not evaluate: required_signatures$/`.
  - `the policies text says no protection or ruleset only when both were read and both are empty`.
- [ ] **Step 2:** `node --test scripts/pr-blockers.test.mjs` → FAIL.
- [ ] **Step 3: Implement** the merge as the spec's "Rulesets" section says. `attempt(area, read, refused = null)` returns `refused` on a 403/404; the protection read passes a `REFUSED` symbol so "unprotected" (`null`) and "refused" differ. Checks split on `requiredChecks` alone. `notChecked(area)` joins every unchecked message of the area.
- [ ] **Step 4:** `node --test scripts/pr-blockers.test.mjs` → PASS.
- [ ] **Step 5:** Commit `feat(pr): read repository rulesets in pr blockers (PMK-218)`.

### Task 4: pr status and track-agents read with detail; blockers in pr status

**Files:**
- Modify: `scripts/pmkit.mjs` (`pr status`, `pr blockers`, `issues track-agents`), `scripts/lib/track-agents.mjs` (export `blockedText(summary)` used by `prText`)
- Test: `scripts/cli-pr.test.mjs`, `scripts/cli-track-agents.test.mjs`

**Interfaces:**
- Consumes: Tasks 1-3.
- Produces: `pr status` JSON `{ branch, pr, checks, reviews, blockers }`, `blockers = { blocked, blocking, pending, unknown, unchecked } | null`; text line `blockers: <blockedText>` for an open PR. `pr blockers` and `pr status` JSON `pr` has no `detail`.

- [ ] **Step 1: Write the failing tests** in `scripts/cli-pr.test.mjs`: `pr status shows the blockers of an open pull request and reads it once` (draft PR → `blockers.blocked` true, text has `blockers: blocked: the pull request is a draft`, exactly one `pr view` call, one `pr checks` call, `pr` has no `detail`); `pr status says the blockers are not verified when the protection is refused` (text `blockers not verified`, `blocked` null); `pr status on a merged pull request reads no blocker` (its checks read stays as today; no graphql, protection or rules call, no `blockers:` line, `blockers.blocked` false). Update the existing gh keys in `cli-pr.test.mjs` and `cli-track-agents.test.mjs` (detail VIEW key, rules key, no review/merge keys).
- [ ] **Step 2:** `node --test scripts/cli-pr.test.mjs scripts/cli-track-agents.test.mjs` → FAIL.
- [ ] **Step 3: Implement.** `pr status`: `getPullRequest({ head }, { detail: true })`, `checks` read as today, `collectBlockers({ ...host, prChecks: () => checks }, pr)` only when `pr.state === 'OPEN'`, else `collectBlockers(host, pr)` (reads nothing). Strip `detail` from the output `pr`.
- [ ] **Step 4:** run the two files → PASS.
- [ ] **Step 5:** Commit `feat(pr): show the blockers in pr status (PMK-218)`.

### Task 5: Scenarios, command files and docs

**Files:**
- Modify: `scripts/__scenarios__/issues-unblock.mjs`, `issues-mine.mjs`, `issues-inbox-digest.mjs`, `issues-investigate-bug.mjs`, `team-standup.mjs` (+ regenerated `.after.txt`), `commands/issues/unblock.md`, `commands/issues/inbox-digest.md`, `commands/issues/mine.md`, `README.md`, `CHANGELOG.md`

- [ ] **Step 1:** Update the gh keys of the five scenarios (detail VIEW key for `pr blockers`/`pr status` reads, rules key, no review/merge keys, thread nodes without `body`). Inbox-digest B1 (cut threads) becomes a thread read over two pages whose second page holds the open thread: `saved.cut.threads.open.length === 1`. `issues-mine` asserts `saved.status.blockers.blocked` and the `blocking`/`unknown` it expects.
- [ ] **Step 2:** `UPDATE_GOLDENS=1 node --test scripts/scenarios.test.mjs`, review the diff of the `.after.txt` files, then `node --test scripts/scenarios.test.mjs` → PASS.
- [ ] **Step 3:** Command files: unblock (rulesets, `policies.protected`/`rulesets`/`unread`, no 100 limit), inbox-digest (drop the `threads.incomplete` sentence), mine (step 5 notes `blockers`; the PR column shows the verdict, `null` never as "nothing blocks it"). README rows of `pr status` and `pr blockers`. One CHANGELOG line at the top of `## Unreleased`.
- [ ] **Step 4:** `npm test` in the foreground → exit 0.
- [ ] **Step 5:** Commit `docs(pr): blockers in pr status and issues:mine, rulesets in unblock (PMK-218)`.
