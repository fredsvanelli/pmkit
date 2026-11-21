# PMK-342: read GitHub discussion threads past 100 comments or 100 replies

Issue: PMK-342 (EPC-8, milestone github-issues). Follows PMK-90 (`docs/specs/2026-11-17-pmk-90-github-discussions-design.md`, PR #313).

## Intent

`github discussions get` reads one discussion in one GraphQL call: the first 100 comments and the first 100 replies of each (`scripts/lib/github/discussions.mjs`, `DISCUSSION_DOCUMENTS.GET`). Past that it warns what it cut, and `/pmkit:github:discussions` summarizes only the part it read. Long RFC threads go past 100, so the summary misses the end of the debate, often where the decision is.

Acceptance criterion: `github discussions get` pages through every comment and reply, or up to a documented limit with the warning.

## Goals, non-goals, anti-goals

- Goal: `get` returns every comment and every reply of a thread up to the limit below, and warns only past it.
- Non-goal: `github discussions comment` keeps its read of one comment and one reply (it needs only the id and the title). `list` is unchanged.
- Non-goal: no new flag (`--all`, `--max-comments`) (approved by the user).
- Anti-goal: a thread of normal size (100 comments or fewer, 100 replies or fewer each) costs a second request. It must still be one call.

## Approaches

1. **Complete the cut connections after the first read, with the client's `paginate` (chosen).** `get` reads as today. When `comments.pageInfo.hasNextPage` is true, it reads the comments again through `client.paginate` over a new query on the discussion's node id, from the first page, with each comment's first 100 replies. Then, for each comment whose `replies.pageInfo.hasNextPage` is true, it reads that comment's replies through `client.paginate` over a query on the comment's node id. This is the pattern `completeNested` in `scripts/lib/github/issue-ops.mjs` uses for an issue's nested connections. Cost: the first comment page is read twice, only for a thread past 100 comments.
2. **Continue from the first read's `endCursor`.** Saves that one repeated page, but `paginateConnection` (`scripts/lib/graphql.mjs`), shared by the Linear and GitHub clients, always starts at `after: null`. It would need a start-cursor option, or a hand-written loop that repeats its cursor checks. Not worth one request on rare threads.
3. **Page the GET query itself with `paginate`.** One document, but every page rereads the discussion header, and `paginate` turns Discussions off or a missing number into a "broken page" `UPSTREAM` error instead of today's `available: false` and `NOT_FOUND`. Rejected.

## Design

- **The limit (approved by the user):** `paginate`'s default cap of 10 pages of 100. So at most 1000 comments, and at most 1000 replies per comment. Past that, the existing warnings, which now name the read count: `discussion #<n> has <total> comments and pmkit read the first 1000`, `comment <id> has <total> replies and pmkit read the first 1000`. `cutWarnings` already compares `totalCount` with what was read, so it needs no change.
- **New documents** in `DISCUSSION_DOCUMENTS`:
  - `COMMENTS`: `query PmkitDiscussionComments($id: ID!, $first: Int!, $after: String, $replies: Int!) { node(id: $id) { ... on Discussion { comments(first: $first, after: $after) { nodes { <comment fields> replies(first: $replies) { totalCount nodes { <reply fields> } pageInfo } } pageInfo } } } }`.
  - `REPLIES`: `query PmkitDiscussionReplies($id: ID!, $first: Int!, $after: String) { node(id: $id) { ... on DiscussionComment { replies(first: $first, after: $after) { nodes { <reply fields> } pageInfo } } } }`.
  - `GET` adds `pageInfo { hasNextPage endCursor }` to `comments` and `replies`. The comment and reply selections become shared constants so the three documents select the same fields.
- **Where:** a `completeThread(node)` step in `get`, after `read` and before `fullView`. `read` and `comment` do not change.
- **The fine-grained PAT step:** `client.paginate` passes `options.permissions` on to `request`, so a refusal on a further page names the Discussions permission like the first read does (PMK-341). One-line change in `scripts/lib/github/client.mjs`.
- **Rate limit:** no extra cap on the total number of requests (approved by the user). Worst case is 10 comment pages plus 10 reply pages per comment past 100 replies; the client's rate-limit guard (`assertRoom`) already stops a call when the GraphQL budget is spent. A page of 100 comments with 100 replies each is about 10,100 nodes, well under GitHub's 500,000-node limit per query.
- **Fake GitHub:** `scripts/fake-github-discussions.mjs` answers `PmkitDiscussionComments` and `PmkitDiscussionReplies` with its `connection` helper, and refuses an unknown node id with `unknownNode`.
- **Docs:** README's `github discussions get` row, `commands/github/discussions.md` ("If something is missing": 1000, not 100), the runbook `docs/runbooks/discussions-github.md`, and a note in the PMK-90 design's get section pointing here.

## Tests

- Unit (`scripts/lib/github/discussions.test.mjs`, against the stateful fake through the real client): a thread of 250 comments and a comment with 230 replies comes back whole, with no warning; a normal thread is still one `PmkitDiscussion` read and no further query; a thread past 1000 comments and a comment past 1000 replies keep the first 1000 and warn; a PAT refusal on a further page names Discussions.
- Client (`scripts/lib/github/client.test.mjs`): `paginate` passes `permissions` to the request.
- E2E (`scripts/runbook-discussions-github.test.mjs` and its runbook): a new step reads a long thread (more than 100 comments, a comment with more than 100 replies) and gets all of it with no warning.

## Left to the builder

The names of the shared selection constants and of `completeThread`; whether the thread past 1000 test seeds 1001 comments or lowers nothing (the cap is `paginate`'s default, not a pmkit constant).

## Interview

The user approved the design on 2026-11-21 with the three open questions answered: the limit is 10 pages (1000 comments, 1000 replies per comment), no cap on the total request count, no new flag. No new term for CONTEXT.md (Discussion is already defined) and no ADR: the limit is a constant that is easy to change.
