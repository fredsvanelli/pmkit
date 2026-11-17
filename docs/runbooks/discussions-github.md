# Runbook: discussions on GitHub Issues

The flow of `/pmkit:github:discussions` on a repository whose tracker is GitHub Issues: list the discussions, read one, create an issue from it, and comment back on the discussion. Then a missing discussion and a repository with Discussions turned off. `scripts/runbook-discussions-github.test.mjs` runs every step below with the real CLI and a fake `gh` first on `PATH`. The fake keeps the state of GitHub in a file between runs, so `npm test` checks this runbook.

## Before you start

- `/pmkit:setup` ran on this repository, as `docs/runbooks/setup-github.md` describes, with the Project `acme/7`.
- `gh` is logged in to the host of the repository.
- The repository `acme/widgets` has Discussions turned on and holds two discussions:
  - `#1` in Ideas, `RFC: offline mode`, by `hubot`, with two comments. The first, by `octocat`, has one reply by `hubot`.
  - `#2` in Q&A, `How do I reset my token?`, whose answer is marked.
- Texts go through files, as `skills/pmkit/references/conventions.md` requires. The steps write them in `tmp/` with the file tool:
  - `tmp/title.txt`: `Add an offline mode`
  - `tmp/description.md`: a `### Context` section whose first line is `From discussion #1: https://github.com/acme/widgets/discussions/1`
  - `tmp/criteria.txt`: two lines, `- The app opens without a network` and `- Changes made offline sync when the network is back`
  - `tmp/comment.txt`: `Tracked in #3`

## Read

1. List the discussions:

   ```
   node scripts/pmkit.mjs github discussions list --json
   ```

   Expect `available: true`, discussions `2` then `1` (newest activity first), each with its category, author, state `open`, `answered`, upvotes and comment count, and `hasMore: false`.

2. List the ideas only, with the category name in another case:

   ```
   node scripts/pmkit.mjs github discussions list --category ideas --json
   ```

   Expect discussion `1` alone. `--category RFCs` would fail with `INVALID_INPUT`, `acme/widgets has no discussion category RFCs; its categories are Announcements, General, Ideas, Q&A`.

3. Read discussion 1:

   ```
   node scripts/pmkit.mjs github discussions get 1 --json
   ```

   Expect the title `RFC: offline mode`, the category `Ideas`, the author `hubot`, `answer: null`, `commentsTotal: 2`, the first comment with its reply, and no warning. The command writes its six-part summary from this JSON.

## Turn it into an issue

4. Preview the issue, then create it:

   ```
   node scripts/pmkit.mjs issues create --title-file tmp/title.txt --description-file tmp/description.md --criteria-file tmp/criteria.txt --dry-run --json
   node scripts/pmkit.mjs issues create --title-file tmp/title.txt --description-file tmp/description.md --criteria-file tmp/criteria.txt --json
   ```

   The dry run creates nothing on GitHub. The real run creates issue `3`: discussions and issues share the numbers of a repository. Its description starts with the line `From discussion #1: https://github.com/acme/widgets/discussions/1`.

5. Preview the comment on the discussion, then post it:

   ```
   node scripts/pmkit.mjs github discussions comment 1 --body-file tmp/comment.txt --dry-run --json
   node scripts/pmkit.mjs github discussions comment 1 --body-file tmp/comment.txt --json
   ```

   The dry run returns `url: null`, the body `Tracked in #3` and the author `octocat`, and posts nothing. The real run returns the comment's `url`.

6. Read discussion 1 again:

   ```
   node scripts/pmkit.mjs github discussions get 1 --json
   ```

   Expect `commentsTotal: 3` and the last comment `Tracked in #3` by `octocat`. The discussion stays open.

## When something is missing

7. Read a discussion the repository lacks:

   ```
   node scripts/pmkit.mjs github discussions get 9 --json
   ```

   The command exits with code 2 and `NOT_FOUND`, `GitHub has no discussion #9 in acme/widgets`, with the next step `pmkit github discussions list`.

8. Turn Discussions off in the repository settings, then list and comment:

   ```
   node scripts/pmkit.mjs github discussions list --json
   node scripts/pmkit.mjs github discussions comment 1 --body-file tmp/comment.txt --dry-run --json
   ```

   The list answers `available: false`, `reason: "disabled"` and `enableHint: "Turn on Discussions in the repository settings on GitHub"`. The comment exits with code 2 and `NOT_SUPPORTED`, `acme/widgets has Discussions turned off`.

## What the fake `gh` checks

The test records every `gh` call and fails when an argument or the standard input holds the token in `GH_TOKEN`. Every call carries `--hostname github.com`.
