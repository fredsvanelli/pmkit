# Discussion or comment deleted mid-read Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `github discussions get` reports a discussion or comment deleted between its first read and a further page as `NOT_FOUND`, with pmkit's own message.

**Architecture:** `completeThread` in `scripts/lib/github/discussions.mjs` maps a `NOT_FOUND` (or a `null` node) from each further read to the missing-discussion error `read` builds, or to a deleted-comment error. Nothing else changes.

**Tech Stack:** Node 18+ ES modules, `node:test`, the stateful fake GitHub.

**Spec:** `docs/superpowers/specs/2026-11-21-pmk-357-discussion-deleted-mid-read-design.md`

## Global Constraints

- No dependencies (ADR 0003).
- Missing discussion: `NOT_FOUND`, message `GitHub has no discussion #<n> in <repo>`, next step `pmkit github discussions list`, the same object fields as `read` throws today.
- Deleted comment: `NOT_FOUND`, message `GitHub has no comment <id> in discussion #<n> in <repo>; it was deleted while pmkit read the thread`, next step `pmkit github discussions get <n>`.
- Other codes from a further page (`AUTH`, `UPSTREAM`, rate limit) pass through unchanged.

## Review Focus

- A `null` node with no GraphQL error (a host that answers so): must end as the same `NOT_FOUND`, not "broken page". Test in Task 1.
- A discussion deleted while its replies (not its comments) are read: the replies read of a comment fails `NOT_FOUND` for the comment, which is right; the comment message names the comment. Covered by the comment test.
- `AUTH` on a further page keeps `AUTH` and the Discussions PAT step (PMK-341). Test in Task 1.

---

### Task 1: map a node gone mid-read in `completeThread`

**Files:**
- Modify: `scripts/lib/github/discussions.mjs` (`read`, `allNodes`, `completeThread`, `get`)
- Test: `scripts/lib/github/discussions.test.mjs`

**Interfaces:**
- Produces: `missingDiscussion(number)` and `deletedComment(number, id)` (module-private builders returning `PmkitError`); `completeThread(node, number)`.

- [ ] **Step 1: Write the failing tests** in `discussions.test.mjs`, with a helper `deleteAfterFirstRead(fake, remove)` that wraps `fake.exec` so `remove(fake.state)` runs after the first `PmkitDiscussion` answer:
  - `get fails NOT_FOUND like a missing discussion when the discussion is deleted mid-read`: 150 comments; remove the discussion; the rejection's `{ code, message, nextStep }` deep-equals `get(9)`'s for a missing number with `#1`: `NOT_FOUND`, `GitHub has no discussion #1 in acme/widgets`, `pmkit github discussions list`.
  - `get fails NOT_FOUND naming the comment deleted mid-read`: one comment with 150 replies; remove that comment; `NOT_FOUND`, `GitHub has no comment DC_1 in discussion #1 in acme/widgets; it was deleted while pmkit read the thread`, next step `pmkit github discussions get 1`.
  - `get maps a null node with no error to NOT_FOUND`: `fake.failNext('PmkitDiscussionComments', { data: { node: null } })` on a 150-comment thread; same expectation as the discussion test.
  - `get keeps AUTH from a further page`: `fake.failNext('PmkitDiscussionComments', { errors: [{ type: 'FORBIDDEN', message: 'Resource not accessible by personal access token' }] })`; code `AUTH`, next step names Discussions.
- [ ] **Step 2: Run** `node --test scripts/lib/github/discussions.test.mjs`. Expected: the three NOT_FOUND tests FAIL (generic "GitHub found nothing" message, or "broken page"); the AUTH test passes already.
- [ ] **Step 3: Implement.** `read` throws `missingDiscussion(number)`. `allNodes(document, variables, pick, gone)`: `pick` notes when `data.node` is `null`; a `PmkitError` `NOT_FOUND`, or the broken-page error after a `null` node, is replaced by `gone()`. `completeThread(node, number)` passes `() => missingDiscussion(number)` for comments and `() => deletedComment(number, comment.id)` for replies. `get` passes the number.
- [ ] **Step 4: Run** the file again. Expected: all pass. Then `npm test` and `npm run lint`: pass.
- [ ] **Step 5: Commit** `fix: report a discussion or comment deleted mid-read as not found (PMK-357)`.

### Task 2: the runbook covers both cases (E2E)

**Files:**
- Modify: `docs/runbooks/discussions-github.md` (section "A long thread": steps 11 and 12), `scripts/runbook-discussions-github.test.mjs`, `commands/github/discussions.md` ("If something is missing": one line)

- [ ] **Step 1: Write the failing test.** In the runbook test, after step 10: queue `issues.failures = { PmkitDiscussionComments: [{ data: { node: null }, errors: [{ type: 'NOT_FOUND', path: ['node'], message: "Could not resolve to a node with the global id of 'D_2'" }] }] }` in the fixture, run `get2`, expect `{ code: 'NOT_FOUND', message: 'GitHub has no discussion #2 in acme/widgets', nextStep: 'pmkit github discussions list' }`. Then queue the same on `PmkitDiscussionReplies` with the answer's id (`long.discussion.comments[0].id`), run `get2`, expect the deleted-comment error naming that id with next step `pmkit github discussions get 2`. Add both messages to the "runbook names" test's expected texts.
- [ ] **Step 2: Run** `node --test scripts/runbook-discussions-github.test.mjs`. Expected: FAIL on the runbook text (Task 1 makes the CLI pass).
- [ ] **Step 3: Write runbook steps 11 and 12** ("the discussion is deleted while pmkit reads its further pages", "a comment is deleted while pmkit reads its further replies") with the exact expected error, and the line in `commands/github/discussions.md`: a discussion or comment deleted during the read fails `NOT_FOUND`; read it again.
- [ ] **Step 4: Run** the runbook test, `npm test`, `npm run lint`. Expected: pass.
- [ ] **Step 5: Commit** `docs: the discussions runbook covers a thread deleted mid-read (PMK-357)`.
