---
description: What needs your attention - mentions, new assignments and reviews waiting for you. Reads only and marks nothing as seen
argument-hint: "[since=<timestamp>] [login=<github login>]"
disable-model-invocation: true
---

# Inbox digest

Arguments: `$ARGUMENTS`

## Parameters

- `since=<timestamp>` (optional): the cut of `inbox list --since`, a timestamp with a zone such as `2026-10-31T10:00:00Z`.
- `login=<github login>` (optional): the user's GitHub login, to match review requests (step 3). The config does not map members to GitHub logins, so without it only a login equal to the member ID matches.

## Steps

Read `${CLAUDE_PLUGIN_ROOT}/skills/pmkit/references/conventions.md` first.

1. Run `node "${CLAUDE_PLUGIN_ROOT}/scripts/pmkit.mjs" capabilities --json`. Read `user_inbox`. When it is `absent` (Linear), skip step 2 and do step 2b instead.
2. Mentions and new assignments. Run `node "${CLAUDE_PLUGIN_ROOT}/scripts/pmkit.mjs" inbox list [--since <timestamp>] --json`.
   1. Show the `items` with `kind` `assignment` as "new assignments" and the ones with `kind` `mention` as "mentions", each with its issue ID, title, `at`, `by` (unknown when null), `in` and, for a mention, the `excerpt`. Keep each `key` so the user can pass it to `inbox mark-read --key`. Say `counts`.
   2. When `hidden` is above 0, say that many older unseen items are not shown and that `pmkit inbox list --all` lists them.
   3. When `complete` is `false`, say the inbox is incomplete, show each entry of `problems` as a warning with its issue ID and point to `pmkit validate`. Never say there is nothing new from an incomplete list.
   4. When `items` is empty and `complete` is `true`, say there are no unseen mentions or assignments.
   5. When the call fails with `INVALID_INPUT` and `error.message` starts with `The inbox file`, apply the rule for the user store files in the conventions, and show mentions and assignments as "not verified".
   - 2b. On `absent`, say that this tracker has no inbox and the list is derived. Run `node "${CLAUDE_PLUGIN_ROOT}/scripts/pmkit.mjs" issues list --assignee me --updated-after <date 14 days ago> --json` and show the issues as "assigned to you and changed in the last 14 days (derived, not proven new)". Say that mentions are not verified. When `hasMore` is `true` or the result has `problems` or a `warning:`, say the derived list is incomplete.
3. Reviews waiting. Run `node "${CLAUDE_PLUGIN_ROOT}/scripts/pmkit.mjs" issues list --category in_review --json`. Repeat each `warning:` line, and treat `problems` or `hasMore` `true` as an incomplete list of reviews.
   1. For each issue with a `branch`, run `node "${CLAUDE_PLUGIN_ROOT}/scripts/pmkit.mjs" pr blockers --branch <branch> --json`. When a call fails with `NOT_SUPPORTED`, `NOT_CONFIGURED` or `AUTH`, stop calling it, say that reviews are not verified and why (`error.message`, then `error.nextStep`). Another failure marks that issue "not verified" with its `error.message` and the loop goes on.
   2. An issue with no `branch`, or whose `pr` is missing (`blocked` is `null` for no pull request), is "not verified: no pull request found". An issue is also "not verified" for the part named in `unchecked` when `unchecked` holds the area `reviews` or `threads`.
   3. For an issue assigned to someone else, it is a review waiting for the user when `reviews.requested` holds the user's login: the member ID (`pmkit.mjs whoami --json`, field `id`) or the `login` argument, compared without case. When no `login` was given and nothing matches, say that review requests could not be matched to the user and name the PRs that have a request open (`reviews.requested` not empty) as "requested of someone, not matched".
   4. For an issue assigned to the user, it holds "changes to address" when `reviews.changesRequested` is not empty or `threads.open` is not empty. Show the reviewers and the number of open threads.
4. Show the digest. Lead with the counts of mentions, new assignments, reviews requested and changes to address, then one table or list per group. A group that was not verified shows `not verified` with the reason in place of a count, and never `0` or `none`. When any part is incomplete or not verified, end with one line that says what was not read.
5. Offer the next step without running it. For mentions and assignments, show the call the user can run to mark what was shown as seen: `pmkit inbox mark-read --key <key> ...` with the keys of step 2. For an issue to work on, offer `/pmkit:issues:work <id>`.

The command never writes. It does not run `inbox mark-read`, so the same items show again until the user marks them.

## Confirmation points

- None. The digest only reads, and `write_policy.confirm` has nothing to skip.

## Output

The counts line, the new assignments, the mentions (with `key`, `excerpt`), the reviews requested and the changes to address, each issue with its full ID. Say what is incomplete or not verified. End with the `mark-read` call for the shown keys and `/pmkit:issues:work <id>`.

## If something is missing

- Linear or another tracker with `user_inbox` `absent`: step 2b, derived list, mentions not verified.
- The git host is `none`, or `gh` is missing or not logged in: skip step 3 after the first failure, say reviews are not verified and why, and show the rest.
- A broken file in the user store (`The inbox file ...`): mentions and assignments are not verified; offer to delete it or fix it by hand.
- Nothing found and everything read: say there is nothing that needs the user's attention.
- An error from the CLI: apply the rules for reading errors in the conventions.
