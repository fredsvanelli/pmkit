---
description: What needs your attention - mentions, new assignments and reviews waiting for you. Reads only and marks nothing as seen
argument-hint: "[since=<timestamp>] [login=<github login>]"
disable-model-invocation: true
---

# Inbox digest

Arguments: `$ARGUMENTS`

## Parameters

- `since=<timestamp>` (optional): the cut of `inbox list --since`, a timestamp with a zone such as `2026-10-31T10:00:00Z`. On a tracker with no inbox (step 3) its date part is the cut of the derived list.
- `login=<github login>` (optional): the user's GitHub login, to match review requests (step 5). The config does not map members to GitHub logins, so without it only a login equal to the member ID matches.

## Steps

Read `${CLAUDE_PLUGIN_ROOT}/skills/pmkit/references/conventions.md` first.

1. Run `node "${CLAUDE_PLUGIN_ROOT}/scripts/pmkit.mjs" capabilities --json`. Read `user_inbox`. When it is `absent`, skip step 2 and do step 3. Otherwise skip step 3.
2. Mentions and new assignments (when `user_inbox` is not `absent`). Run `node "${CLAUDE_PLUGIN_ROOT}/scripts/pmkit.mjs" inbox list [--since <timestamp>] --json`.
   1. Show the `items` with `kind` `assignment` as "new assignments" and the ones with `kind` `mention` as "mentions", each with its issue ID, title, `at`, `by` (unknown when null; always null for `description` and `acceptance_criteria` items, so never name an author for them), `in` and, for a mention, the `excerpt`. Keep each `key` so the user can pass it to `inbox mark-read --key`. Say `counts`.
   2. When `hidden` is above 0, say how many older unseen items the cut left out (the number is `hidden`) and that `pmkit inbox list --all` lists them. They are unseen, so they count as something waiting for the user, even when `items` is empty.
   3. When `complete` is `false`, say the inbox is incomplete, show each entry of `problems` as a warning with its issue ID and point to `pmkit validate`. Never say there is nothing new from an incomplete list.
   4. When `items` is empty, `complete` is `true` and `hidden` is 0, say there are no unseen mentions or assignments. When `items` is empty and `hidden` is above 0, say there are none in the window but `hidden` older ones are not shown, and never say there is nothing.
   5. When the call fails with `INVALID_INPUT` and `error.message` starts with `The inbox file`, apply the rule for the user store files in the conventions, and show mentions and assignments as "not verified".
3. Derived list (only when `user_inbox` is `absent`). Say that this tracker has no inbox, so the list is derived. Run `node "${CLAUDE_PLUGIN_ROOT}/scripts/pmkit.mjs" issues list --assignee me --updated-after <date> --json`, where `<date>` is the date part of `since` when it was given and the date 14 days ago otherwise. Show the issues as "assigned to you and changed since <date> (derived, not proven new)", and say which cut was used. Say that mentions are not verified. When `hasMore` is `true` or the result has `problems` or a `warning:`, say the derived list is incomplete.
4. Find the user. Run `node "${CLAUDE_PLUGIN_ROOT}/scripts/pmkit.mjs" whoami --json` and keep `id`. The user's logins for review requests are that `id` and the `login` argument, compared without case.
5. Reviews waiting. Run `node "${CLAUDE_PLUGIN_ROOT}/scripts/pmkit.mjs" issues list --category backlog,todo,in_progress,in_review --json`: a pull request can wait for a review whatever the status or the assignee of its issue, and `done` or `canceled` issues have no pull request waiting. Repeat each `warning:` line, and treat `problems` or `hasMore` `true` as an incomplete list of reviews.
   1. For each issue with a `branch`, run `node "${CLAUDE_PLUGIN_ROOT}/scripts/pmkit.mjs" pr blockers --branch <branch> --json`. When a call fails with `NOT_SUPPORTED`, `NOT_CONFIGURED`, `AUTH` or `RATE_LIMITED`, stop calling it, say that reviews are not verified and why (`error.message`, then `error.nextStep`), and list every issue with a `branch` that was not read yet, plus the `in_review` ones with no branch, as "not verified: <code lowercased>" (the issues step 5.2 skips stay skipped). The reviews part is incomplete from then on, so the digest never says there are no reviews or no changes to address. Another failure marks that issue "not verified" with its `error.message` and the loop goes on.
   2. Sort each issue by what the result holds, in this order:
      - No `branch` recorded on an `in_review` issue: "not verified: no branch recorded". An issue in another status with no `branch` is work that has no pull request yet: skip it without a call and without a line.
      - `pr` is `null`: "no pull request yet for the branch". The read worked, so this is a fact, not an incomplete read: there is no review request to show, the issue is listed with that line, and it never makes the digest incomplete or "not verified". Only `pr` being `null` means there is no pull request. `blocked` being `null` does not, because an open pull request has `blocked` `null` whenever one of its fields could not be read.
      - `pr.state` is not `OPEN` (merged or closed): "nothing waiting: pull request <state lowercased>", with the PR number. For these `reviews` and `threads` are `null` and `unchecked` is empty, so read nothing from them and count nothing.
      - An open pull request: go on with 3 and 4. A `reviews` that is `null` (`unchecked` has the area `reviews`) is "not verified: reviews not read" for that issue. Likewise a `threads` that is `null` (area `threads`).
   3. Review requests, for every open pull request whatever its assignee: the assignee is the user, another member or nobody. It is a review waiting for the user when `reviews.requested` holds one of the user's logins from step 4. A request made to a team is in `reviews.requestedTeams`, never in `reviews.requested`, so it never matches the user, whatever the team is called: show it as "requested of team <slug>, not matched to you". When no `login` was given and nothing matched, say that review requests could not be matched to the user and name the pull requests that have a request open (`reviews.requested` not empty) as "requested of someone, not matched".
   4. Changes to address, for an open pull request whose issue is assigned to the user or whose author (`pr.author.login`) is one of the user's logins from step 4, whatever the issue's status: it holds "changes to address" when `reviews.changesRequested` is not empty or `threads.open` is not empty. Show the reviewers and the number of open threads. `pr blockers` reads every thread, so the count is complete.
6. Show the digest. Lead with the counts of mentions, new assignments, reviews requested and changes to address, then one table or list per group. A group that was not verified shows `not verified` with the reason in place of a count, and never `0` or `none`. List the merged or closed pull requests as "nothing waiting" with their state, and the issues that are not verified with their reason. When any part is incomplete or not verified, end with one line that says what was not read.
7. Offer the next step without running it. For mentions and assignments, when `complete` is `true` and step 2 showed at least one `key`, show the call the user can run to mark what was shown as seen: `pmkit inbox mark-read --key <key> ...` with exactly the keys of step 2, never without `--key`: a call with no key marks every unseen item, the hidden ones the user never saw too. When step 2 showed no key, do not offer mark-read. When `complete` is `false`, do not offer it: `inbox mark-read` refuses on an incomplete inbox, so offer `pmkit validate` and `/pmkit:local:doctor` first and say mark-read waits for the fix. For an issue to work on, offer `/pmkit:issues:work <id>`.

The command never writes. It does not run `inbox mark-read`, so the same items show again until the user marks them.

## Confirmation points

- None. The digest only reads, and `write_policy.confirm` has nothing to skip.

## Output

The counts line, the new assignments, the mentions (with `key`, `excerpt`), the reviews requested and the changes to address, each issue with its full ID. Say what is incomplete or not verified. End with the `mark-read` call for the shown keys and `/pmkit:issues:work <id>`.

## If something is missing

- A tracker with `user_inbox` `absent`: step 3, derived list (cut by `since` when given), mentions not verified.
- The git host is `none`, or `gh` is missing or not logged in: skip the rest of step 5 after the first failure (a `RATE_LIMITED` read too), say reviews are not verified and why, and show the rest. The digest is incomplete: end with the line that says what was not read.
- A broken file in the user store (`The inbox file ...`): mentions and assignments are not verified; offer to delete it or fix it by hand.
- Nothing found, everything read and `hidden` 0: say there is nothing that needs the user's attention.
- An error from the CLI: apply the rules for reading errors in the conventions.
