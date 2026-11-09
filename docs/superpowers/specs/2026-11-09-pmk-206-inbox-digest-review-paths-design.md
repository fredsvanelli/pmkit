# PMK-206: review-request and error paths of the inbox digest

Follow-up of PMK-55 (inbox digest, PR #118). Files: `commands/issues/inbox-digest.md`, `scripts/lib/pr-blockers.mjs`, `scripts/__scenarios__/issues-inbox-digest.mjs`. Non-goals: `docs/superpowers/epc-6-follow-ups.md`.

Choices made without a human (autonomous run, recorded so the reviewer can overrule them):

1. **Teams are told apart in the data, not in the command file.** `pr blockers` flattened user and team requests into `reviews.requested` as `login ?? name ?? slug`, so a team named like the user matched the user. Now `reviews.requested` holds only the logins of users (`__typename` `User`, or an entry with a `login`) and the new `reviews.requestedTeams` holds team slugs. The text line reads `waiting for dee; team core`. A request counts as pending in `open` for both. The digest matches only `requested` and lists `requestedTeams` as "requested of a team, not matched to you".
2. **A rate limit stops the loop and marks the reviews incomplete.** `RATE_LIMITED` joins `NOT_SUPPORTED`, `NOT_CONFIGURED` and `AUTH` in step 5.1: stop calling `pr blockers`, name the issues not read as "not verified: rate limited", and end the digest with the incomplete line.
3. **Reviews are read for every open issue that has a branch.** Step 5 lists `backlog,todo,in_progress,in_review` (not `done` or `canceled`: their pull requests are merged or closed) instead of only `in_review`. An issue with no branch is "not verified: no branch recorded" only when it is `in_review`; for the other statuses a missing branch is normal work in progress and is skipped silently.
4. **Changes to address** are for an open pull request whose issue is assigned to the user **or** whose author (`pr.author.login`) is one of the user's logins, whatever the issue's status.
5. **`since=` on Linear** is passed to the derived list as `--updated-after <date part of since>` (the flag takes a date); without `since` the 14 day window stays. The digest says which window it used.
6. **Scenario:** `issues-inbox-digest` becomes three entries: the existing one (plus an `in_progress` issue with a team request and an authored PR), a complete inbox (the conflicted fixture file is removed in setup) that shows the keys offered to `mark-read`, and a rate-limited read.

Acceptance: each criterion has a test that failed first; `npm test` exits 0.
