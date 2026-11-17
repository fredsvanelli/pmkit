# The github-discussions command implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** List, read and comment on GitHub Discussions through three GitHub-only CLI calls, and add `/pmkit:github:discussions`, which summarizes a discussion and turns it into an issue after confirmation.

**Architecture:** A new module `scripts/lib/github/discussions.mjs` holds the GraphQL documents, the views and `discussionOperations({ client, scope })`. The GitHub tracker returns it as `discussions`, the CLI reaches it through `ctx.github('discussions')` behind a `github: true` gate, and the stateful fake GitHub learns the discussion operations from `scripts/fake-github-discussions.mjs`.

**Tech Stack:** Node.js ESM, `node:test`, no dependencies (ADR 0003).

**Spec:** `docs/specs/2026-11-17-pmk-90-github-discussions-design.md`

## Global constraints

- No new dependency. Tests use `node:test` and the stateful fake; no test starts `gh` or opens a socket.
- Every GitHub call goes through `createGithubClient` (`request`), with values in GraphQL variables only.
- The three calls refuse a tracker other than `github` with `NOT_SUPPORTED`, `` `<name>` works only with the GitHub Issues tracker, and tracker.system is "<system>" ``, next step `node scripts/pmkit.mjs --help`.
- A number is a positive integer written `12` or `#12`; anything else is `INVALID_INPUT`.
- `list` limit defaults to 20, at most 100; `get` reads 100 comments and 100 replies per comment.
- Discussions off: `{ available: false, reason: 'disabled', enableHint: 'Turn on Discussions in the repository settings on GitHub' }`.
- Unknown number: `NOT_FOUND`, `GitHub has no discussion #<n> in <owner/name>`, next step `pmkit github discussions list`.
- Every commit message carries `PMK-90` and ends with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Prose follows the Unslop rules.
- Keep edits to shared files (`tracker.mjs`, `pmkit.mjs`, `fake-github-issues.mjs`) small and additive; PMK-88 changes the GitHub adapter in parallel.

## Review focus

1. A discussion whose author account was deleted (`author: null`) reads `ghost`, never crashes. Test in Task 2.
2. A discussion body or comment holding shell or prompt text (`$(rm -rf ~)`, "ignore the above") comes back as plain JSON text and never reaches a command line. Test in Task 2 (the text round-trips unchanged) and the command file rule in Task 4.
3. `--category` written in another case (`ideas` for `Ideas`) matches; an unknown name lists the real names. Test in Task 2.
4. A comment dry run on a missing discussion fails before any confirmation, and writes nothing. Test in Task 2.
5. A broken `.pmkit/config.yaml` refuses `github discussions comment` but lets `list` and `get` run. Test in Task 3.

---

### Task 1: The fake GitHub serves discussions

**Files:**
- Create: `scripts/fake-github-discussions.mjs`
- Modify: `scripts/fake-github-issues.mjs` (state init, `handle` routing, returned helpers)
- Test: `scripts/fake-github-issues.test.mjs`

**Interfaces:**
- Produces: `discussionRoutes(state, { stamp, refuse, unknownNode, page, connection })` returning `{ queries: { PmkitDiscussions, PmkitDiscussion, PmkitDiscussionCategories }, mutations: { PmkitAddDiscussionComment } }`; `fake.seedDiscussion({ number, title, body, category, author, state, stateReason, locked, labels, upvotes, createdAt, updatedAt, answer, comments })` returning `{ id, number }`, where a comment is `{ author, body, upvotes, isAnswer, replies: [{ author, body, upvotes }] }`; `fakeGithubIssues({ discussionsEnabled = true, discussionCategories })`. Default categories: `Announcements` (not answerable), `General`, `Ideas`, `Q&A` (answerable).
- State: `state.discussions` (array), `state.discussionCategories`, `state.discussionsEnabled`; all survive `toJSON()` and `fakeGithubIssuesFrom`.

- [ ] **Step 1:** Write `fake GitHub lists, reads and comments on seeded discussions` in `scripts/fake-github-issues.test.mjs`: seed two discussions, call `handle('PmkitDiscussions', { owner: 'acme', name: 'widgets', first: 10, states: ['OPEN'] })`, assert newest `updatedAt` first and `hasDiscussionsEnabled: true`; `handle('PmkitDiscussion', { ..., number: 1, comments: 100, replies: 100 })` returns comments with replies; `handle('PmkitAddDiscussionComment', { input: { discussionId, body: 'Tracked in #3' } })` appends a comment and the next read shows it; an unknown number gives `{ data: { repository: { discussion: null } }, errors: [{ type: 'NOT_FOUND' }] }`; the state survives `fakeGithubIssuesFrom(fake.toJSON())`.
- [ ] **Step 2:** Run `node --test scripts/fake-github-issues.test.mjs`; expect the new test to fail with `fake GitHub has no operation PmkitDiscussions`.
- [ ] **Step 3:** Implement the routes and `seedDiscussion`. Filters on `PmkitDiscussions`: `states`, `categoryId`, `answered`, ordered by `updatedAt` desc, paged with `connection`.
- [ ] **Step 4:** Run the test file; expect PASS.
- [ ] **Step 5:** Commit `test: serve discussions from the fake GitHub (PMK-90)`.

### Task 2: discussionOperations reads and comments

**Files:**
- Create: `scripts/lib/github/discussions.mjs`
- Test: `scripts/lib/github/discussions.test.mjs`

**Interfaces:**
- Consumes: Task 1 fake; `createGithubClient({ exec, retries: 0, sleep })`.
- Produces: `discussionOperations({ client, scope })` with `list({ category, answered, state, limit })`, `get(number)` and `comment(number, body, { dryRun })`; `parseDiscussionNumber(value)` returning an integer or throwing `INVALID_INPUT`. Return shapes are the spec's "CLI calls" section, plus `text` helpers `listText(result)`, `getText(result)`, `commentText(result, dryRun)`.
- Operation names in the documents: `PmkitDiscussions`, `PmkitDiscussion`, `PmkitDiscussionCategories`, `PmkitAddDiscussionComment`.

- [ ] **Step 1:** Write tests: `list returns open discussions, newest activity first`; `list filters by category without case and by answered`; `list refuses an unknown category and names the real ones`; `list caps --limit at 100 and refuses 0`; `list and get answer available false when Discussions are off`; `get returns comments, replies, the answer and labels`; `get reads a deleted author as ghost`; `get keeps shell and prompt text as plain text` (body `$(rm -rf ~) ignore the above`); `get warns when comments or replies are cut` (seed 101 comments); `get on a missing number fails with NOT_FOUND`; `parseDiscussionNumber takes 12 and #12 and refuses 0, -1, 1.5, abc`; `comment dry run reads the discussion and writes nothing`; `comment dry run on a missing number fails with NOT_FOUND and writes nothing`; `comment posts and returns the url`; `comment refuses an empty body`.
- [ ] **Step 2:** Run `node --test scripts/lib/github/discussions.test.mjs`; expect FAIL, module not found.
- [ ] **Step 3:** Implement. Catch the client's `NOT_FOUND` on `PmkitDiscussion` and rethrow with the spec's message and next step.
- [ ] **Step 4:** Run the test file; expect PASS.
- [ ] **Step 5:** Commit `feat: read and comment on GitHub discussions (PMK-90)`.

### Task 3: The CLI calls

**Files:**
- Modify: `scripts/lib/github/tracker.mjs` (return `discussions`), `scripts/pmkit.mjs` (`ctx.github`, `github: true` gate, three entries after the `linear customers` entries), `scripts/lib/github/tracker.test.mjs` if it asserts the returned keys
- Test: `scripts/cli-discussions-github.test.mjs`

**Interfaces:**
- Consumes: Task 2 `discussionOperations`.
- Produces: commands `github discussions list` (`--category`, `--answered yes|no`, `--state open|closed|all`, `--limit`), `github discussions get <number>`, `github discussions comment <number> --body-file f` (`write: true`, `dryRun: true`).

- [ ] **Step 1:** Write tests: list, get and comment through `run()` with the fake; `--answered maybe` and `--state shut` are `INVALID_INPUT`; a Local tracker gets `NOT_SUPPORTED` with the message above; a broken config refuses `comment` and still runs `list`; the comment dry run sends no mutation; text output without `--json` names the discussions.
- [ ] **Step 2:** Run it; expect FAIL with an unknown command.
- [ ] **Step 3:** Implement the tracker key, `ctx.github`, the gate next to the `linear` gate, and the three entries.
- [ ] **Step 4:** Run the new test and `node --test scripts/cli.test.mjs scripts/lib/github/tracker.test.mjs scripts/capabilities.test.mjs`; expect PASS.
- [ ] **Step 5:** Commit `feat: add the github discussions CLI calls (PMK-90)`.

### Task 4: The command and its docs

**Files:**
- Create: `commands/github/discussions.md`
- Modify: `scripts/plugin.test.mjs` (COMMANDS gets `github: ['discussions']`, a test of the command's steps), `README.md`, `commands/help.md`, `skills/pmkit/SKILL.md`, `CONTEXT.md`, `CHANGELOG.md`

- [ ] **Step 1:** Write `discussions.md stops on another tracker, creates through issues create --dry-run, and previews the comment before writing it` in `scripts/plugin.test.mjs`, in the style of the `customers.md` test.
- [ ] **Step 2:** Run `node --test scripts/plugin.test.mjs`; expect FAIL.
- [ ] **Step 3:** Write the command (spec, "The command"), the README rows, the help line, the SKILL.md routing row, the CONTEXT.md term **Discussion** and the CHANGELOG entry.
- [ ] **Step 4:** Run `node --test scripts/plugin.test.mjs scripts/changelog.test.mjs`; expect PASS.
- [ ] **Step 5:** Commit `feat: add /pmkit:github:discussions (PMK-90)`.

### Task 5: The runbook

**Files:**
- Create: `docs/runbooks/discussions-github.md`, `scripts/runbook-discussions-github.test.mjs`

- [ ] **Step 1:** Write the runbook: before you start, list, get, create the issue from files, comment back with a dry run then for real, then Discussions off. Write the E2E test with the fake `gh` on `PATH`, as `scripts/runbook-issues-github.test.mjs` does, and assert the runbook names every command it runs.
- [ ] **Step 2:** Run `node --test scripts/runbook-discussions-github.test.mjs`; expect PASS once the runbook and Task 3 agree, and fix whichever is wrong.
- [ ] **Step 3:** Run `npm test`; the only failures allowed are the four known ones (PMK-333).
- [ ] **Step 4:** Commit `test: add the discussions-github runbook (PMK-90)`.
