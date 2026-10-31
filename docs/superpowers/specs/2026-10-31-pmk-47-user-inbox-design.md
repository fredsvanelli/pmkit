# PMK-47 user inbox for the Local tracker

Source: Local adapter, Capabilities (`user_inbox`: "Mentions (`@user`) and assignments since the user's last check, stored in the user store"); Unified model, `list_notifications`, `mark_read`.

## Intent

A member asks what happened to them that they have not seen yet: who assigned them an issue and who mentioned them. `user_inbox` becomes native on the Local tracker. PMK-55 (`inbox-digest`) builds on the `--json` output, so the keys below stay stable.

## Design change after review

The first design compared the date of each item with the date of the last check. That hides an item made in another clone before the check and brought in by `git pull` after it, which is the normal flow of a Local tracker shared through git. It also needed rules for items written in the same second as the check. The inbox now marks items seen. Each item has a key that does not depend on a clock, the user store keeps the keys the member has seen, and the list shows the items whose key is not in that set. The date of an item orders the list and serves an optional cut (`--since`). It never hides an item that is not seen, apart from the first list (see "First use").

## Goals and non-goals

- Goals: list the assignments and mentions the member has not seen; record what the member has seen in the user store; never hide an item silently.
- Non-goals: syncing the seen set between machines, notifications for reviews or status changes, a Linear implementation (Linear has a native `Notification`, but the adapter does not read it yet).
- Anti-goal: an inbox that looks empty because a file did not parse, or because an item has an old date.

## Who the user is

The member id the CLI resolves for every command (`whoami`: git email, then `PMKIT_USER`). `--as <member>` picks another member, so an agent member (`agent:claude`) has its own inbox. The member must exist in the config.

## What counts

- Assignment. An `assign` event whose `to` is the user, or a `create` event whose `to.assignee` is the user, when `by` is not the user. Assigning yourself is not news. An agent member receives delegations from PMK-57 the same way, because `delegate` assigns the issue. The delegation comment holds no `@` mention, so it adds no second item. Events marked `synthetic` (the CLI noticed a hand edit of the frontmatter of `issue.md`) count and keep `synthetic: true`; their `by` is the member who wrote next. An assignment undone later (a later `assign` to someone else or to nobody) stays in the inbox until the member has seen it, on purpose: the member was told, and Linear keeps its notification too.
- Mention in a comment. A comment whose author is not the user and whose text has `@<user>`.
- Mention in the description or the acceptance criteria. One item for each line of the body that mentions the user, so a second line, or a criterion, added after the first line was seen is a new item. A line that is in the description is `in: description`, and any other line of the body (which is where the criteria are) is `in: acceptance_criteria`. The same line twice in a body is one item. A description item is dated by the newest `create` event or `update` event on the field `description`. A criteria item is dated by the newest `create` event or `update` event on `description` or `acceptance_criteria`. An issue with no such event is dated by its `created` time. The log does not record the text of an edit, so it does not say who wrote a line. `by` is the author of the newest description event when that author is not the member, and null otherwise, and for every criteria item. No description or criteria item is dropped for its author: a line the member wrote in their own description shows once and is gone after the member has seen it. This is the one case where a mention by the member counts, and it is on purpose, because dropping by author would hide a mention that another person wrote by hand in an issue the member created.

Mention rule. `@` followed by the member id, case-insensitive. The `@` is not preceded by a letter, digit, `_`, `.`, `+`, `-`, `/` or `\`, so `a@fred.com` and `\@fred` do not match. The id is not followed by a letter, digit, `_`, `-`, or a `.` and a letter or digit, so `@fredo` and `@fred.com` do not match and `thanks @fred.` does. Text in fenced code blocks and in inline code spans does not count. A fence opens with three or more backticks or tildes (up to three spaces of indent; the info string of a backtick fence has no backtick) and closes with the same character, at least as many of them and nothing else on the line, as CommonMark says. An unclosed fence runs to the end.

## Keys

A key does not depend on the clock of any machine, so two clones that merge the same files compute the same key.

| Item | Key |
| --- | --- |
| Assignment | `assign:<issue>:<hash>`, where the hash is the first 12 hex characters of the SHA-256 of the event's time, author, operation, field and assignee |
| Comment mention | `comment:<issue>:<comment id>`, the comment file name without `.md` |
| Description or criteria mention | `description:<issue>:<hash>`, where the hash is of the mention line without its list marker or checkbox and with white space collapsed |

Each line that mentions the user has its own key. Editing the text of the mention line gives a new key, so the member sees it again, and adding another mention line adds an item. Editing anything else in the body, ticking a criterion, or changing the title does not. A hand edit of a description is not an event (`driftEvents` compares only the frontmatter), but its mention line is a key the member has not seen, so it shows at the next list. Its date is the one of the newest description event, or `created`.

## The user store

`inbox/<repo-hash>.json` in the user store (`repoHash` of the tracker root), never in `.issues/`. Content:

```
{ "version": 2, "checks": { "<member>": { "at": "<time of the last mark-read>", "seen": { "<key>": "<time it was marked>" } } } }
```

The store is per user account and per checkout, and holds no credential. The write is atomic and refuses a path inside a repository. Times are read as whole seconds in Z, and a time with a zone or a fraction is normalized. Only the entry of the member asked for is checked, so a bad entry of another member does not block this one, and a write keeps the other entries as they are. A file that does not parse, has another version, or an entry that is not a timestamp with a map of seen keys, is `INVALID_INPUT` with a message that starts with `The inbox file`. The error says the file is in the user store and the user did not type it: delete it or fix it by hand, and do not ask for a corrected value. `--all` and `--since` read the tracker only for the items but still read the entry of the member, so they fail the same way until the file is fixed.

## First use

A member with no entry gets the items of the last 14 days at the first list. The list counts the older unseen items in `hidden` and prints a line that says so; `--all` lists them. The first mark-read with no `--key` also marks the older items, so the backlog the first list counted does not appear afterwards. With `--key` it marks exactly the keys passed, as at any other time, and the older items then show at the next list. `since` in the result is the cut that was used.

## Incomplete reads

An issue that does not parse, an event log with a bad line and a comment that cannot be read each become an entry in `problems` (`{ id, code, message }`, `id` is the issue). The result then has `complete: false`, the CLI prints one `warning:` per problem pointing to `pmkit validate`, and the text output says the inbox is incomplete. Mark-read refuses (`INVALID_INPUT`) on an incomplete read and writes nothing, so a broken file cannot get its items marked seen. An event time or a comment `created` that is not a date is not a problem: the item takes the modified time of its file, because the time only orders the list. A comment file without frontmatter is read as a whole as the text of a comment with no author.

## Mark read

`inbox mark-read [--key <key> ...] [--dry-run]` records what the member has seen.

- With no `--key` it marks every unseen item at that moment. An item that arrives between the list and the mark is marked too, so a caller that lists and then marks passes the keys of the list with `--key`.
- With `--key` it marks exactly those keys, whatever their date, also at the first use. An item that arrives after the list, in any way, keeps its own key and stays unseen. A key no item has is `INVALID_INPUT` and nothing is written.
- It sets `at` to now. The result has `previous` (the earlier `at` or null), `recorded` (the `at` now stored), `marked` (the keys it added), `pruned` (see below) and `changed`. When nothing is marked or pruned and an entry exists, it writes nothing and `recorded` is the old `at`.
- `--dry-run` returns the same result and writes nothing.

Pruning keeps the set from growing without bound. At each mark-read it drops the seen keys of items that no longer exist (the issue, the comment or the mention line is gone) when the key was marked more than 30 days ago. A key whose item still exists stays, and so does a key marked within 30 days, so a member who switches branches for a while does not see old items again. The set is therefore as large as the items that exist for the member plus the last 30 days of marks.

## CLI and JSON

- `inbox list [--as member] [--since timestamp] [--all]`
- `inbox mark-read [--as member] [--key key ...] [--dry-run]`

`--since` and the check take only the strict timestamp of `scripts/lib/local/sprints.mjs` (`validTimestamp`: date, time and a zone, `Z` or an offset). Anything else, such as `1`, `Oct 1` or a time without a zone, is `INVALID_INPUT`. `--since` keeps the unseen items dated at or after it. `--all` lists every item, seen or not, and cannot be combined with `--since`.

`inbox list --json`:

```
{ available, user, checked, since, hidden, items, counts: { assignments, mentions }, complete, problems }
```

`checked` is the `at` of the entry, or null. `since` is the cut used, or null. `hidden` counts the unseen items the cut left out. Each item always has the same keys: `key`, `kind` (`assignment` or `mention`), `issue`, `title` (null when the issue does not parse), `at`, `by` (null when unknown), `in` (`assignment`, `description`, `acceptance_criteria` or `comment`), `comment` (the comment id or null), `excerpt` (the line that holds the mention, cut at 200 characters, or null), `synthetic` and `seen`. Items sort by `at`, then issue, then kind, then key. `at` is whole seconds in Z.

`inbox mark-read --json`: `{ user, previous, recorded, marked, pruned, changed, dryRun }`.

The text output is a table (When, Kind, Issue, Title, By, Where, Key), a line for `hidden` and, when `complete` is false, a line saying the inbox is incomplete. Linear: `listNotifications` and `markRead` answer `NOT_SUPPORTED` with the manifest hint, and the manifest reports `user_inbox` `absent` with `detail: { workspace: 'native', unsupported: ['listNotifications', 'markRead'] }`.

## Contract and capability

Two contract operations: `listNotifications({ user, since, all })` and `markRead({ user, keys, dryRun })`. `SERVED_BY.user_inbox = ['inbox list', 'inbox mark-read']`. The Local tracker then serves all 20 capabilities: 16 native and 4 derived. ADR-0001 stops listing an `absent` capability and its Consequences paragraph changes.

## Calls of the builder

- Keys over dates, as the user decided after the review. The date orders and cuts, and never hides.
- Reads take `--as`; the issue does not name it.
- Refusing to mark on an incomplete read follows the round 3 lessons.
- The first list shows 14 days and the first mark-read with no `--key` marks the backlog (the user said to decide).
- The seen set drops keys of vanished items after 30 days.
- One item per mention line, with the key of the line.
- Per-worktree hash: two checkouts of one repository keep separate sets. A follow-up can key on the remote.
