# PMK-55 the inbox-digest command

Source: Unified model, Foundation catalog (`inbox-digest`: "What needs the user's attention (mentions, assignments, reviews)"; degradation "Derived from followed issues and mentions"). PMK-47 added `inbox list` and `inbox mark-read` without a command file and left the command file to this issue (`docs/superpowers/epc-6-follow-ups.md`, PMK-47).

## Intent

One command, `/pmkit:issues:inbox-digest`, that answers "what needs my attention" in one screen: mentions, new assignments and reviews waiting. It only reads. No new CLI command: the command file composes `inbox list`, `issues list` and `pr blockers`.

## Goals, non-goals, anti-goals

- Goals: summarize mentions and new assignments (from `inbox list`) and reviews waiting for the user (from `pr blockers`); write nothing, which includes never running `inbox mark-read`.
- Non-goals: marking items seen (the digest offers `inbox mark-read --key ...` as the user's next step), a Linear notification read, counting status changes.
- Anti-goal: an empty digest that only means a read failed. A read that may be incomplete is shown as incomplete or "not verified", and no line says "nothing new" or "no reviews" from it.

## Decisions (builder's calls)

- Name and place: `commands/issues/inbox-digest.md`, `/pmkit:issues:inbox-digest`. No new group folder.
- Mentions and assignments: `inbox list --json`. Keys are repeated as they are, so the user can pass them to `mark-read --key`. `complete: false` or `problems` make the digest incomplete. `hidden > 0` is said ("N older unseen items are not shown, `--all` lists them"). Optional argument `since=<timestamp>` maps to `--since`.
- Reviews waiting for the user are two kinds, both read from `pr blockers` of the branch of an `in_review` issue:
  - `review requested`: an issue of another member whose PR has the user among `reviews.requested`. The user is the member id, or the GitHub login the user passes as `login=<name>` (case-insensitive). The config has no member to GitHub login mapping, so with no `login` and no match the command says the requests could not be matched to the user, and lists the PRs that have an open request as "requested of someone else or not matched".
  - `changes to address`: an issue assigned to the user whose PR has `reviews.changesRequested` or `threads.open`.
- Not verified, never "none": no git host (`NOT_SUPPORTED`, `NOT_CONFIGURED`, `AUTH`) stops the review reads and says why; an issue with no `branch`, a failed `pr blockers`, or a `pr blockers` whose `unchecked` holds `reviews` or `threads` is listed as not verified; an `issues list` with `problems` or a `warning:` about a cut read makes the review part incomplete.
- Degradation (the catalog line): when `user_inbox` is `absent` (Linear, `inbox list` answers `NOT_SUPPORTED`), the command lists the issues assigned to the user updated in the last 14 days (`issues list --assignee me --updated-after`) as "assigned or changed, derived", says mentions are not verified, and goes on with the reviews.
- Writes nothing. The Local user store is not touched, so the same digest shows again until the user marks items.

## Contract used

`inbox list --json`: `available, user, checked, since, hidden, items, counts, complete, problems`; items have `key, kind, issue, title, at, by, in, comment, excerpt, synthetic, seen`. `pr blockers --json`: `reviews.requested`, `reviews.changesRequested`, `threads.open`, `unchecked`.
