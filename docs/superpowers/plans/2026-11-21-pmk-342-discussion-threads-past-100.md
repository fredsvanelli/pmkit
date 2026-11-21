# PMK-342 discussion threads past 100 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `github discussions get` returns every comment and reply of a thread up to 1000 comments and 1000 replies per comment, and warns only past that.

**Architecture:** `get` keeps its one GraphQL read. When the read's `comments` or a comment's `replies` connection has a next page, a `completeThread` step rereads that connection through `client.paginate` over a node-id query, as `completeNested` does in `scripts/lib/github/issue-ops.mjs`. `paginate`'s default cap of 10 pages is the limit; the existing `cutWarnings` reports what is past it.

**Tech Stack:** Node 18 ES modules, `node:test`, the stateful fake GitHub (`scripts/fake-github-issues.mjs`).

**Spec:** `docs/superpowers/specs/2026-11-21-pmk-342-discussion-threads-past-100-design.md`

## Global Constraints

- No dependencies (ADR 0003). `npm test` and `npm run lint` pass.
- A thread with at most 100 comments and at most 100 replies per comment is still one `PmkitDiscussion` request.
- `comment` and `list` do not change their reads.
- Limit: 10 pages of 100, so 1000 comments and 1000 replies per comment. Warning text past it: `discussion #<n> has <total> comments and pmkit read the first 1000`, `comment <id> has <total> replies and pmkit read the first 1000`.
- Every discussion request, including further pages, carries `{ permissions: 'Discussions' }`.

## Review Focus

- A comment past 100 replies inside a thread also past 100 comments (on the second comment page): its replies must be completed too. Pinned in Task 2's long-thread test (the long-reply comment is comment 150).
- A deleted author on a further page reads as `ghost`, like on the first page. Pinned in Task 2's long-thread test.
- A PAT refusal on a further page names Discussions. Pinned in Task 2.
- The fake refuses an unknown node id for the new queries (no silent empty page). Covered by the fake using `unknownNode`; no extra test.
- The order of comments after completion is GitHub's order, not first page plus rest. Pinned in Task 2 (bodies in order).

---

### Task 1: `client.paginate` forwards `permissions`

**Files:**
- Modify: `scripts/lib/github/client.mjs` (`paginate`)
- Test: `scripts/lib/github/client.test.mjs` (Paging section)

**Interfaces:**
- Produces: `client.paginate(document, variables, { select, pageSize, limit, maxPages, stop, permissions })`; `permissions` goes to every `request` call the same way `request(document, variables, { permissions })` takes it.

- [ ] **Step 1: Failing test** `paginate passes permissions to each page request`: two pages, the second one a fine-grained PAT refusal (`{ errors: [{ type: 'FORBIDDEN', message: 'Resource not accessible by personal access token' }] }`), with `permissions: 'Discussions'`; expect rejection with `code: 'AUTH'` and `nextStep` starting `Give the token read and write access to Discussions`.
- [ ] **Step 2:** `node --test scripts/lib/github/client.test.mjs` fails on that test.
- [ ] **Step 3:** In `paginate`, pass `(document, variables) => request(document, variables, { permissions: options.permissions })` as `paginateConnection`'s request when `options.permissions` is set.
- [ ] **Step 4:** The client tests pass.
- [ ] **Step 5:** Commit `feat: client.paginate names the permissions of each page request (PMK-342)`.

### Task 2: `get` completes cut comments and replies

**Files:**
- Modify: `scripts/lib/github/discussions.mjs`, `scripts/fake-github-discussions.mjs`
- Test: `scripts/lib/github/discussions.test.mjs`

**Interfaces:**
- Consumes: Task 1's `permissions` option.
- Produces: `DISCUSSION_DOCUMENTS.COMMENTS` (operation `PmkitDiscussionComments`, variables `$id: ID!, $first: Int!, $after: String, $replies: Int!`, selects `node { ... on Discussion { comments } }`), `DISCUSSION_DOCUMENTS.REPLIES` (operation `PmkitDiscussionReplies`, variables `$id: ID!, $first: Int!, $after: String`, selects `node { ... on DiscussionComment { replies } }`). `GET` adds `pageInfo { hasNextPage endCursor }` to `comments` and `replies`. The comment and reply field lists are shared constants used by all three documents.

- [ ] **Step 1: Failing tests** in `discussions.test.mjs`:
  - `get reads every comment and reply of a long thread`: seed 250 comments (`comment <i>`), comment 150 with 230 replies (`reply <i>`) and comment 200 by a deleted author (`author: null`). Expect `comments.length === 250`, bodies in order, `comments[149].replies.length === 230` in order, `comments[199].author === 'ghost'`, `warnings` `[]`. Expect `fake.reads` names: one `PmkitDiscussion`, three `PmkitDiscussionComments`, three `PmkitDiscussionReplies` (230 replies = 3 pages).
  - `get of a thread within 100 reads once`: the `seeded()` discussion #1 makes exactly one read named `PmkitDiscussion` (and none of the new names).
  - Replace `get warns when comments or replies are cut` with `get warns past 1000 comments or 1000 replies`: 1001 comments, the first with 1001 replies. Expect 1000 comments, 1000 replies on the first, and the warnings `discussion #1 has 1001 comments and pmkit read the first 1000` and `comment <id> has 1001 replies and pmkit read the first 1000`.
  - Extend the PAT test list with `['PmkitDiscussionComments', (ops) => ops.get('1')]` on a discussion of 101 comments, and `['PmkitDiscussionReplies', ...]` on one comment of 101 replies.
- [ ] **Step 2:** `node --test scripts/lib/github/discussions.test.mjs` fails on those tests.
- [ ] **Step 3:** In the fake, add `PmkitDiscussionComments` (find the discussion by `vars.id`, else `unknownNode`; answer `{ node: { comments: { totalCount, ...connection(views, vars.first, vars.after) } } }` with each comment's replies cut to `vars.replies`) and `PmkitDiscussionReplies` (find the comment by id across discussions, else `unknownNode`; answer its replies `connection`).
- [ ] **Step 4:** In `discussions.mjs`, add `completeThread(node)` in `discussionOperations`, called by `get` between `read` and `fullView`: when `node.comments.pageInfo.hasNextPage`, replace `node.comments.nodes` with `client.paginate(COMMENTS, { id: node.id, replies: READ_REPLIES }, { select: (data) => data.node.comments, pageSize: 100, permissions: 'Discussions' })`; then for each comment with `replies.pageInfo.hasNextPage`, replace `replies.nodes` the same way with `REPLIES` on the comment id. Keep each `totalCount`. Update the file header comment to name this design.
- [ ] **Step 5:** The discussions tests, `node --test scripts/cli-discussions-github.test.mjs` and the golden tests pass (`npm test`).
- [ ] **Step 6:** Commit `feat: discussions get reads threads past 100 comments or replies, up to 1000 (PMK-342)`.

### Task 3: Docs and the runbook step

**Files:**
- Modify: `README.md` (the `github discussions get` row), `commands/github/discussions.md` (the "A thread longer than pmkit reads" line: 1000 comments, 1000 replies each), `docs/specs/2026-11-17-pmk-90-github-discussions-design.md` (a note under the get section: PMK-342 reads up to 1000, see the PMK-342 design), `docs/runbooks/discussions-github.md`, `scripts/runbook-discussions-github.test.mjs`, `CHANGELOG.md` if it has an Unreleased section.

- [ ] **Step 1: Failing E2E step.** "Before you start": discussion `#2` also holds 149 other comments, and its answer has 120 replies. New section `## A long thread`, step 10: `node scripts/pmkit.mjs github discussions get 2 --json`; expect `commentsTotal: 150`, all 150 comments, the answer's 120 replies, and no warning. In the test, seed those comments, add `get2` to `COMMANDS`, and assert step 10 after step 9 (the PAT failure is used up by step 9).
- [ ] **Step 2:** The runbook test passes once the runbook text and the seed match (the code is from Task 2). Run `node --test scripts/runbook-discussions-github.test.mjs`.
- [ ] **Step 3:** Update the README row, the command file line and the PMK-90 design note.
- [ ] **Step 4:** `npm test` and `npm run lint` pass.
- [ ] **Step 5:** Commit `docs: discussions get reads up to 1000 comments and replies, with the runbook step (PMK-342)`.
