# Improve unblock-pr (PMK-218)

## Intent

PMK-62 shipped `pr blockers` and `/pmkit:issues:unblock`. Its implementer and reviewers left four improvements (`docs/superpowers/epc-6-follow-ups.md`): rulesets are not read, review threads stop at 100, `pr status` and `/pmkit:issues:mine` do not show the blockers, and the pull request is read by three `gh pr view` calls while the thread query downloads comment bodies that nothing reads. None is a defect. This issue does the four.

## Goals

1. Read the repository rules that apply to the base branch (`GET repos/{owner}/{repo}/rules/branches/{branch}`) as well as the classic branch protection, and judge the pull request against both.
2. Read every review thread, page by page, instead of the first 100.
3. `pr status` returns and prints the verdict of `collectBlockers`, and `/pmkit:issues:mine` shows it in its PR column.
4. One `gh pr view` per pull request reads the pull request, its reviews and its merge state. The thread query no longer asks for comment bodies.

## Non-goals

- No write. `pr blockers` and `pr status` still only read.
- No evaluation of rule types other than `pull_request` and `required_status_checks` (signatures, merge queue, deployments, linear history). GitHub's `mergeStateStatus: BLOCKED` still covers them, and the message names the active rule types the command does not evaluate.
- No change to the Linear adapter or the capability manifest: these are git host reads.

## Decisions

### One pull request read (goal 4)

- `host.getPullRequest(selector, { detail: true })` reads `VIEW_FIELDS` plus `reviews,reviewRequests,mergeable,mergeStateStatus,reviewDecision,baseRefName` in one `gh pr view`, and returns the view fields with the extra ones nested in `pr.detail`. Without the option the call and its fields are unchanged, so `pr open`, `pr ready`, `pr sync` and `pr diff` do not pay for it.
- `collectBlockers(host, pr)` reads reviews and merge state from `pr.detail`. `host.prReviews` and `host.prMergeState` go away, since nothing else calls them.
- `pr blockers`, `pr status` and `issues track-agents` read the pull request with `{ detail: true }`. The JSON `pr` they return leaves `detail` out, so review bodies do not reach the output twice.
- Consequence, my call: reviews and merge state can no longer be refused on their own. A 403 on that read fails the pull request read, as a refused `gh pr view` did before. GitHub grants the three groups of fields with the same permission, so the per-area `unchecked` entries for `reviews` and `conflicts` were not reachable in practice. The `conflicts` `NOT_READY` entry (merge state `UNKNOWN`) stays. `policies.unevaluated` loses `required approvals`, which needed a refused review read.
- The thread query asks `comments(first: 1) { nodes { url author { login } } }`, without `body`. Threads no longer carry `body`.

### All review threads (goal 2)

- `prThreads` pages with `reviewThreads(first: 100, after: $endCursor)` and `pageInfo { hasNextPage endCursor }`, one `gh api graphql` call per page, until `hasNextPage` is false. The first call sends no cursor, so it keeps today's arguments apart from the query text.
- `hasNextPage` true with no `endCursor` throws `UPSTREAM` ("gh api graphql returned no cursor for the next page of review threads"), so the loop cannot spin and a partial list is never returned as complete.
- The read is complete, so `threads.incomplete` and every "first 100" text go away: the `unknown` item, the text suffix, and the lines in `commands/issues/unblock.md` and `commands/issues/inbox-digest.md`. A cap would bring back an incomplete state to handle. My call: no cap. A rate limit fails the read with `RATE_LIMITED`, as any read does.

### Rulesets (goal 1)

- New host read `branchRules(base)`: `gh api repos/{owner}/{repo}/rules/branches/<base>?per_page=100&page=<n>`, page by page until a page holds fewer than 100 rules. It returns the list of active rules (`type`, `parameters`). GitHub returns only rules with `active` enforcement and includes the organization rulesets. A reply that is not an array throws `UPSTREAM`.
- Both policy reads go through `attempt('policies', ...)`. A 403 or 404 on either adds an `unchecked` entry with area `policies` and its own message (the message names the endpoint). Any other failure fails the command, as today.
- Requirements merge the two sources:
  - required approvals: the largest `required_approving_review_count` of the classic protection and of every `pull_request` rule, or `null` when none sets one.
  - required checks: the union of the classic `contexts` and `checks[].context` and of every `required_status_checks` rule's `required_status_checks[].context`.
  - up to date (strict): classic `required_status_checks.strict` or any rule's `strict_required_status_checks_policy`.
  - conversation resolution: classic `required_conversation_resolution.enabled` or any `pull_request` rule's `required_review_thread_resolution`.
- `policiesKnown` (what decided pending against unknown before) is true only when both reads worked. With one read, what it requires and is unmet still blocks, since a known requirement is a fact. What is open is `unknown`, as with no read, because the other source may require it.
- A known required check no longer lands in `unknown` as well as in `blocking`: the checks split on `requiredChecks` whatever was read.
- `policies` is `null` only when neither read worked. Its fields: `protected` (true or false, `null` when the protection was not read), `rulesets` (the distinct types of the active rules, `null` when they were not read), `unread` (`branch protection`, `rulesets`: what was refused), `requiredApprovals`, `approvals`, `requiredChecks`, `unmet`, `unreadRule`, `unevaluated`.
- `mergeStateStatus: BLOCKED` with nothing in `blocking`:
  - both read: "GitHub blocks the merge by a rule this command does not evaluate (for example signed commits, a merge queue or required deployments)", and when the base has active rules of other types than the two evaluated, "; active rules it does not evaluate: <types>". `unreadRule` is true.
  - one or none read: today's message about a rule it could not read (branch protection or a ruleset).
- Text of `policies`: the unmet rules, then `not checked: ...` for unevaluated rules, then `not read: <source> (<message>)` for each unread source. `all met` only when both were read and nothing else is listed. `the base branch has no branch protection or ruleset` when both were read, `protected` is false and `rulesets` is empty.

### Blockers in pr status and issues:mine (goal 3)

- `pr status` reads the pull request with `{ detail: true }`, reads the checks as today, and runs `collectBlockers` on a host whose `prChecks` returns the list it already read, so checks are read once. `reviews` comes from `pr.detail.reviews`.
- Its JSON adds `blockers: { blocked, blocking, pending, unknown, unchecked }`, the lists as `pr blockers` returns them, or `null` with no pull request. Its text adds one line for an open pull request: `blockers: ` followed by the same verdict text as `issues track-agents` (`blocked: ...`, `nothing blocks it`, `blockers not verified: ...`). The verdict text moves to one exported helper in `scripts/lib/track-agents.mjs`, used by both.
- `pr status` now also reads threads, protection and rules. A refusal there lands in `blockers.unchecked`. A network error or 5xx there fails `pr status`, as a failed check read already did. `/pmkit:team:standup` and `/pmkit:issues:investigate-bug` read `pr status` and ignore the new field.
- `commands/issues/mine.md` step 5 notes `blockers`, and the PR column shows the verdict for an open pull request: `blocked` with the `blocking` messages, `nothing blocks it`, or `not verified` with the `unknown` and `unchecked` items. `null` is never shown as "nothing blocks it".

## Tests

- Host: one call with `{ detail: true }` and its fields; threads over two pages (cursor sent on the second call) and the missing-cursor error; no `body` in the query; `branchRules` over two pages, refusal mapping.
- `collectBlockers`: ruleset approvals, checks, strict and conversation resolution; the merge of both sources; protection refused with rules read (unmet blocks, open items unknown, text never says `all met`); both refused; `BLOCKED` with other rule types; required check not duplicated in `unknown`.
- CLI: `pr status` JSON and text with blockers, and one `gh pr view` per pull request in `pr blockers`, `pr status` and `track-agents`.
- Scenarios `issues-unblock`, `issues-mine`, `issues-inbox-digest`, `issues-investigate-bug` and `team-standup`: the new gh keys, and `issues-mine` asserts the blockers of its pull request.

## Docs

README rows of `pr status` and `pr blockers`, `commands/issues/unblock.md` (rulesets, no 100 limit, the `policies` fields), `commands/issues/inbox-digest.md` (no 100 limit), `commands/issues/mine.md` (step 5 and the PR column), and one `CHANGELOG.md` line under `## Unreleased`.

## Calls I made

- `detail` nested in the pull request instead of a new host method, and stripped from the JSON.
- Losing the separate refusal of reviews and merge state.
- No cap on thread pages, so `threads.incomplete` goes away.
- With one policy source read, known unmet requirements block, open items stay `unknown`.
- `pr status` shows blockers by default, with no flag.
