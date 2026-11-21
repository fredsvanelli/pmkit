# PMK-357: report a GitHub discussion or comment deleted mid-read as not found

Issue: PMK-357 (EPC-8, bug). Left open by the Secure step of PMK-342 (PR #330, `docs/superpowers/specs/2026-11-21-pmk-342-discussion-threads-past-100-design.md`).

## Intent

`github discussions get` reads a thread past 100 comments or 100 replies in further pages, by node id, after the first read (`completeThread` in `scripts/lib/github/discussions.mjs`). When the discussion or a comment is deleted between the first read and a further page, the user should see the same `NOT_FOUND` a missing discussion gets, not an error that reads like a broken GitHub.

## Root cause

Reproduced against the stateful fake, which answers an unknown node id the way GitHub does (`NOT_FOUND`, "Could not resolve to a node with the global id of '<id>'"). The further page goes through `client.paginate`, and the client's `answerError` turns that answer into its generic `NOT_FOUND`:

- message `GitHub found nothing: Could not resolve to a node with the global id of 'D_1'`
- next step `Check the owner, repository and Project number, and that the gh account can see them`

So the code is already `NOT_FOUND` on that answer (the issue says `UPSTREAM`), but the message names an opaque node id instead of the discussion number, and the next step talks about a Project, which `discussions get` has nothing to do with. `read` maps a missing discussion on the first read to pmkit's own message (`GitHub has no discussion #<n> in <repo>`, next step `pmkit github discussions list`); `completeThread` has no such mapping. The `UPSTREAM` of the issue happens only when a host answers `node: null` with no error: then `paginate`'s `select` finds no connection and throws "GitHub returned a broken page".

## Goals, non-goals, anti-goals

- Goal: a discussion deleted before a further comments page fails `NOT_FOUND` with exactly the message and next step of a discussion that does not exist.
- Goal: a comment deleted before its further replies page fails `NOT_FOUND` and names the comment: `GitHub has no comment <id> in discussion #<n> in <repo>; it was deleted while pmkit read the thread`, next step `pmkit github discussions get <n>` (read the thread again).
- Non-goal (issue): retries, and threads that change in other ways during the read.
- Anti-goal: catching other errors from further pages (`AUTH`, rate limit, `UPSTREAM`) and calling them not found.

## Approaches

1. **Map `NOT_FOUND` in `completeThread` (chosen).** Wrap each `allNodes` call: a `NOT_FOUND` from the comments read rethrows the missing-discussion error `read` already builds (shared through one small function), and a `NOT_FOUND` from a replies read throws the comment error. Also treat `node: null` the same way: `pick` returns the connection of a found node, and a `null` node is turned into the same `NOT_FOUND` before `paginate` calls it broken. Small, local, and both host answers end the same.
2. **Map node-id `NOT_FOUND` in the client.** Every caller of `paginate` would get a different message, but the client does not know which discussion or comment the id was. Rejected.
3. **Re-read the discussion by number after a further page fails, to tell deleted from other failures.** One more request to say what the error already says. Rejected.

For the `node: null` case: `paginate` swallows exceptions thrown by `select` (`connectionOf` in `scripts/lib/graphql.mjs`), so the mapping cannot throw from `pick`. `completeThread` instead remembers that `pick` saw a `null` node and turns the resulting broken-page `UPSTREAM` into the `NOT_FOUND`. The builder may pick the cleanest way to do that without changing `paginateConnection`.

## Design

- `scripts/lib/github/discussions.mjs`: a `missingDiscussion(number)` builder used by `read` and by `completeThread`; a `deletedComment(number, id)` builder; `completeThread(node, number)` maps `NOT_FOUND` (and a `null` node) from each further read.
- Fake GitHub: no change. The fake's `failures` queue (`failNext`, and `issues.failures` in an E2E fixture) can answer `PmkitDiscussionComments` or `PmkitDiscussionReplies` with GitHub's `NOT_FOUND` answer, and unit tests can delete the record from `fake.state` after the first read.
- Docs: `docs/runbooks/discussions-github.md` gets two steps under "A long thread" (the discussion deleted mid-read, a comment deleted mid-read) with the expected error; `commands/github/discussions.md` "If something is missing" gets one line if it lists the not-found case.

## Tests

- Unit (`scripts/lib/github/discussions.test.mjs`): a 150-comment thread whose discussion is deleted after the first read fails with the same `code`, `message` and `nextStep` as `get` of a missing number; a comment with 150 replies deleted after the first read fails `NOT_FOUND` naming the comment; a `node: null` answer with no error ends the same; an `AUTH` refusal on a further page is still `AUTH`.
- E2E (`scripts/runbook-discussions-github.test.mjs`): the two new runbook steps, with the fixture's `failures` queue answering the further page with GitHub's `NOT_FOUND`.

## Left to the builder

How `completeThread` notices the `null` node; test names.

## Interview

Approved on 2026-11-21 by the pmkit PO on the owner's behalf: the issue's acceptance criteria and this design, with no open product question. The questions the grilling raised and the answers taken (the recommended ones):

- A host that answers `node: null` with no error ends as the same `NOT_FOUND`, not a broken-page `UPSTREAM`: yes, both answers mean the node is gone.
- A deleted comment's next step is `pmkit github discussions get <n>` (read the thread again), and its message says it was deleted while pmkit read the thread.
- Errors other than `NOT_FOUND` from a further page keep their code and message.
- No new term for `CONTEXT.md` (Discussion is defined) and no ADR.
