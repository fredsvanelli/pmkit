# PMK-47 user inbox for the Local tracker

Source: Local adapter, Capabilities (`user_inbox`: "Mentions (`@user`) and assignments since the user's last check, stored in the user store"); Unified model, `list_notifications`, `mark_read`.

## Intent

A member asks what happened to them since they last looked: who assigned them an issue and who mentioned them. `user_inbox` becomes native on the Local tracker. PMK-55 (`inbox-digest`) builds on the `--json` output, so the keys below stay stable.

## Goals and non-goals

- Goals: list assignments and mentions since the last check; record the check in the user store; never hide an item silently.
- Non-goals: per-item read state, notifications for reviews or status changes, a Linear implementation (Linear has a native `Notification`, but the adapter does not read it yet).
- Anti-goal: an inbox that looks empty because a file did not parse.

## Who the user is

The member id the CLI resolves for every command (`whoami`: git email, then `PMKIT_USER`). `--as <member>` picks another member, so an agent member (`agent:claude`) has its own inbox. Reads accept `--as`; the member must exist in the config.

## What counts

Only items newer than the last check (`at` strictly after it). With no stored check, or with `--all`, every item counts. `--since <timestamp>` replaces the stored check for one read and records nothing.

- Assignment. An `assign` event whose `to` is the user, or a `create` event whose `to.assignee` is the user, when `by` is not the user. Assigning yourself is not news. An agent member receives delegations from PMK-57 the same way, because `delegate` assigns the issue. The delegation comment holds no `@` mention, so it adds no second item. Events marked `synthetic` (the CLI noticed a hand edit of `issue.md`) count and keep `synthetic: true`; their `by` is the member who wrote next.
- Mention in a comment. A comment whose `created` is newer than the check and whose author is not the user, with `@<user>` in the text.
- Mention in a description. The issue file carries no author or date per edit. The event log does: the item is dated by the newest `create` or `update` event on `description` and is attributed to its `by`. It counts when that event is newer than the check, `by` is not the user and the body mentions the user. A later edit of a description that already mentioned the user raises it again. A hand edit of `issue.md` has no event until the next write on that issue, so it stays invisible until then.

Mention rule. `@` followed by the member id, case-insensitive. The `@` is not preceded by a letter, digit, `_`, `.`, `+`, `-`, `/` or `\`, so `a@fred.com` and `\@fred` do not match. The id is not followed by a letter, digit, `_`, `-`, or a `.` and a letter or digit, so `@fredo` and `@fred.com` do not match and `thanks @fred.` does. Text in fenced code blocks (``` or ~~~, an unclosed fence runs to the end) and in inline code spans does not count. The mention of yourself in your own comment does not count.

## Incomplete reads

An issue that does not parse, an event log with a bad line and a comment that cannot be read each become an entry in `problems` (`{ id, code, message }`, `id` is the issue). The result then has `complete: false`, the CLI prints one `warning:` per problem pointing to `pmkit validate`, and the text output says the inbox is incomplete. Mark-read refuses (`INVALID_INPUT`) on an incomplete read and writes nothing, so a broken file cannot get its items marked read.

## Mark read

`inbox mark-read [--through <timestamp>] [--dry-run]` records the check for the user. The check is a point in time, not a list of items: marking is all at once up to `through`. Items are time-ordered, so `--through` marks a prefix. The default `through` is now. The `--json` of `inbox list` carries `through` (now), and a caller that lists and then marks passes it back, so an item that arrives between the two calls stays unread.

- Never moves back. A `through` at or before the stored check changes nothing (`changed: false`).
- A `through` after now is `INVALID_INPUT`. An item dated after now (a clock ahead on another machine) stays unread until time reaches it, and the list flags it `future: true`. Nothing is hidden; the cost is that such an item reappears after mark-read.
- `--dry-run` returns the same result and writes nothing.
- A user store file that does not parse is `INVALID_INPUT` for both commands, naming the file.

## The user store

`inbox/<repo-hash>.json` in the user store (`repoHash` of the tracker root), as the design spec says, never in `.issues/`. Content: `{ "version": 1, "checks": { "<member>": "<timestamp>" } }`. The store is per user account and per checkout, and holds no credential. The write is atomic and refuses a path inside a repository, like every other user store write. New exports in `scripts/lib/user-store.mjs`: `inboxGet(root, member, options)` and `inboxSet(root, member, at, options)`.

## CLI and JSON

- `inbox list [--as member] [--since ts] [--all]`
- `inbox mark-read [--as member] [--through ts] [--dry-run]`

`inbox list --json`:

```
{ available, user, since, through, items, counts: { assignments, mentions }, complete, problems }
```

`since` is the check used, or null. Each item always has the same keys: `kind` (`assignment` or `mention`), `issue`, `title` (null when the issue does not parse), `at`, `by`, `in` (`assignment`, `description` or `comment`), `comment` (the comment id or null), `excerpt` (the line that holds the mention or null), `synthetic`, `future`. Items sort by `at`, then issue, then kind, then comment id.

`inbox mark-read --json`: `{ user, previous, recorded, through, changed, dryRun }`.

The text output is a table (When, Kind, Issue, Title, By, Where) and, when complete is false, a line saying the inbox is incomplete. Linear: `listNotifications` and `markRead` answer `NOT_SUPPORTED` with the manifest hint, and the manifest reports `user_inbox` `absent` with `detail: { workspace: 'native', unsupported: ['listNotifications', 'markRead'] }`.

## Contract and capability

Two contract operations: `listNotifications({ user, since })` and `markRead({ user, through, dryRun })`. `SERVED_BY.user_inbox = ['inbox list', 'inbox mark-read']`. The Local tracker then serves all 20 capabilities: 16 native and 4 derived. ADR-0001 stops listing an `absent` capability and its Consequences paragraph changes.

## Calls of the builder

- Mark everything up to a time, not item by item (the issue asks only that marking records the check).
- Reads take `--as`; the issue does not name it.
- Refusing to mark on an incomplete read follows the round 3 lessons.
- Per-worktree hash: two checkouts of one repository keep separate checks. A follow-up can key on the remote.
