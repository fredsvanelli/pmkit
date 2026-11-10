# PMK-225 Improve the user inbox

Source: PMK-225, the follow-ups of PMK-47 collected in `docs/superpowers/epc-6-follow-ups.md`. Builds on `docs/superpowers/specs/2026-10-31-pmk-47-user-inbox-design.md` and PMK-195. PMK-236 (`inbox-digest`) reads what this issue adds.

## Intent

The inbox of PMK-47 works on the Local tracker only, keeps one seen set per checkout, lists only assignments and mentions, hides the mention text in the text table, and can lose a mark-read when two run at once. This issue closes those five gaps without changing the keys or the `--json` fields PMK-55 reads: it only adds fields.

## Goals, non-goals, anti-goals

- Goals: the five acceptance criteria below.
- Non-goals: the changes to `/pmkit:issues:inbox-digest` (PMK-236), a member to GitHub login map (PMK-236), syncing the seen set between machines, Linear notification types other than assignment, mention and status change.
- Anti-goals: a review count of 0 when GitHub was not read; an inbox that floods an existing member with every old status change; a mark-read that drops a key another mark-read wrote.

## 1. The check is keyed by the git remote

The inbox file becomes `inbox/<key>.json`, where `<key>` is the first 12 hex characters of the SHA-256 of `remote:<host>/<owner>/<name>` (lowercased), read from the remote `chooseRemote` picks in `scripts/lib/git-remote.mjs` (origin, else the only remote). Two worktrees or clones of one repository then share the file. `git remote -v` runs once, with a timeout because it is a read and a large `maxBuffer`.

When git cannot say (no git, no remote, several remotes without origin, a URL `parseRemoteUrl` does not read), or the root is not the top level of its repository (a project of a monorepo), the key falls back to the real path of the root, as today. Migration (review of PR #171): the path files of every worktree of the repository (`git worktree list`) are joined into the remote file, all members, the later check and every seen key; each is joined once and listed in the file's `migrated`. Reads join the files not migrated yet without writing. The old files stay, untouched. The Linear discovery cache keeps its path key (out of scope).

## 2. Linear serves `user_inbox`

`listNotifications` and `markRead` on the Linear tracker read Linear `Notification` objects (`notifications` query, `IssueNotification` fragment) and write `notificationUpdate(id, { readAt })`. `user_inbox` becomes `native` on Linear with `detail: { workspace: 'native' }` and no `unsupported`.

- Who: Linear returns only the notifications of the owner of `LINEAR_API_KEY`. A `user` other than the viewer is `INVALID_INPUT`, as `requireViewer` does for writes (ADR-0005).
- What counts: type `issueAssignedToYou` is `assignment` (`in: assignment`), `issueMention` is `mention` (`in: description`), `issueCommentMention` is `mention` (`in: comment`, `comment` the comment id, `excerpt` the first non-empty line of the comment, cut at 200), `issueStatusChanged` is `status` (`in: status`). Other types are left out. Archived notifications are not read.
- Key: `notification:<id>`. Seen: `readAt` is set. `by` is the actor's user id or null. `title` is the issue title, `issue` its identifier. `from` and `to` are null: the notification does not carry the states.
- Read: pages of 100, at most 10 pages. A cut read (`hasMore`) makes `complete: false` with a problem `{ id: null, code: 'UPSTREAM', message: 'only the newest 1000 notifications were read' }`. `checked` is null and there is no first-list cut, because Linear keeps the read state itself. `since` and `all` behave as on Local.
- Mark read: with no `--key`, refuses on an incomplete read, like Local. With `--key`, a key the cut read did not reach is marked by the id it holds. With no `--key` it marks every unseen item; with `--key`, exactly those, and unknown keys come back in `unknown`. One mutation per notification, in key order. When one fails, it stops and throws with the keys already marked and the keys left, in the message and in `marked`/`left` on the error. `--dry-run` sends nothing. `pruned` is always 0 and `previous` null.

The Notification schema comes from Linear's public GraphQL schema; there was no key in this worktree to check it live, so `verify-api.mjs` and the live probes get a follow-up.

## 3. Status changes and review requests in `inbox list`

Status changes. A new kind `status` on Local: a `move` event on `field: status` of an issue whose assignee at that event (replayed from the log: `create` `to.assignee`, then each `assign` event) is the user, when `by` is not the user. Key `status:<issue>:<hash>`, the hash of the event's time, author, `from` and `to`. The item has `in: status`, `from` and `to`. Prune: a `status` key is still on a branch when its event is in that branch's log, as for `assign`.

No flood (review of PR #171): an entry written before this change has no `kinds` and never listed status changes, so the status changes dated up to its last check (`at`) count as seen. The next write, with or without `--key`, records their keys in `seen` and sets `kinds`. `counts` gains `statusChanges`.

Review requests. `inbox list --reviews [--login <github login> ...]` makes one `gh pr list --state open --limit 200 --json number,url,title,headRefName,author,reviewRequests` call and adds `reviews` to the result:

```
reviews: { verified: true, requested: [{ number, url, title, branch, author }], teamRequests: [{ number, team }], complete, reason }
reviews: { verified: false, requested: null, teamRequests: null, complete: false, reason: '<error.message>', code: '<error.code>' }
```

A pull request counts when one of its user review requests has a login equal, ignoring case, to the member id or a `--login`. On Linear the member id is a Linear user id, so only `--login` counts, and without it `reviews` is not verified (`INVALID_INPUT`). A team request never matches and is listed in `teamRequests`. 200 pull requests back means `complete: false` with the reason. A failed call (`NOT_SUPPORTED` with no git host, `NOT_CONFIGURED`, `AUTH`, `RATE_LIMITED`, `UPSTREAM`) is `verified: false`, never a count of 0, and the text says "review requests not verified: <reason>". `counts.reviewRequests` is the count when verified and null otherwise. Without `--reviews`, `reviews` is null and `counts.reviewRequests` null: the plain list stays offline. Works on both trackers, because the git host is separate from the tracker.

## 4. The text table

Columns: When, Kind, Issue, Title, By, Where, Text, Seen, Key. Text is the `excerpt` for a mention and `from → to` for a status change, cut at 60 characters with `…` (the JSON keeps the full excerpt). Seen is `yes` or `no`. With `--reviews`, a second table lists the review requests (PR, Title, Branch, Author) or the "not verified" line.

## 5. Locked writes

Every inbox write takes `<file>.lock`, created with the `wx` flag, and removes it after. A lock already there makes the writer wait and retry, up to 10 seconds. A lock older than 30 seconds is stale and removed. A timeout is `CONFLICT` ("Another pmkit run holds the inbox lock …", not "The inbox file", so an agent retries), naming the lock file and saying to delete it when no other pmkit runs.

Under the lock, `markRead` re-reads the member's entry and merges: the keys this call marked are added, the keys this call pruned are removed, and every other key stays as the file has it now. Two mark-reads at once then keep both sets of keys.

## The builder's calls

- The remote identity is host, owner and name, so `https` and `ssh` URLs of one repository share the file.
- `status` items follow the assignment rule: the assignee at the time of the move, not the current one.
- `--reviews` is opt-in, so `inbox list` needs no network by default.
- Linear `from`/`to` are null rather than a guess from the current state.
- An old entry counts the status changes up to its last check as seen, so it is not flooded.
