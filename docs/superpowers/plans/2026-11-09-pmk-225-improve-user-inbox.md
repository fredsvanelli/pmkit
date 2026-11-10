# PMK-225 Improve the user inbox Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the five PMK-225 gaps of the user inbox: remote-keyed check, Linear notifications, status changes and review requests, a richer text table, locked writes.

**Architecture:** The user store gets a remote-derived inbox key and a lock with a merge-on-write update. The Local tracker adds a `status` kind with a per-kind first-list cut. A new `scripts/lib/linear/notifications.mjs` serves the two contract operations on Linear. The CLI adds `--reviews`/`--login` to `inbox list`, backed by one `gh pr list` call in the GitHub host.

**Tech Stack:** Node.js ESM, `node:test`, no dependencies.

**Spec:** `docs/superpowers/specs/2026-11-09-pmk-225-improve-user-inbox-design.md`

## Global Constraints

- Keys and existing `--json` fields stay; only fields are added. Item key order: `key, kind, issue, title, at, by, in, comment, excerpt, from, to, synthetic, seen`.
- Any process spawn uses a large `maxBuffer`; a timeout only on reads.
- An unread or cut read is "not verified"/`complete: false`, never 0.
- Commit messages carry `(PMK-225)` and end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Never run the CLI inside `scripts/__fixtures__/`.

## Review Focus

- A repository with an `https` origin in one clone and an `ssh` origin in another: same inbox file (Task 1 test).
- A lock left behind by a killed process: stale after 30 s, removed (Task 1 test).
- An existing entry with no `kinds` and years of status changes: old ones go to `hidden`, not the list (Task 2 test).
- `gh` missing or not logged in with `--reviews`: `verified: false`, `counts.reviewRequests` null, the list still prints (Task 4 test).
- A Linear `notificationUpdate` failing on the second of three: the error names the marked key and the two left (Task 3 test).

---

### Task 1: Remote-keyed, locked inbox file (criteria 1 and 5, store side)

**Files:**
- Modify: `scripts/lib/user-store.mjs`
- Test: `scripts/user-store-inbox.test.mjs`

**Interfaces:**
- Produces: `inboxKey(root): string` (12 hex), `inboxGet(root, member, options)` returns `{ at, seen, kinds }` (`kinds` defaults to `['assignment', 'mention']`), `inboxUpdate(root, member, update, options)` where `update(current: entry|null) => entry`, runs under `<file>.lock` and writes the result. `inboxSet` stays, implemented through `inboxUpdate`. Options accept `lockWaitMs` (default 10000) and `staleLockMs` (default 30000).

- [ ] **Step 1: Failing tests**
  - `inbox key: two clones with https and ssh URLs of one GitHub repo share the key; a repo with no remote falls back to the path hash` (init two temp git repos, `git remote add origin https://github.com/Acme/Repo.git` and `git@github.com:acme/repo`; assert `inboxKey(a) === inboxKey(b)` and `inboxKey(noRemote) === repoHash(noRemote)`).
  - `inbox key: the path file is read when the remote file is missing, and the write goes to the remote file` (write a v2 file at `inbox/<repoHash>.json`, assert `inboxGet` returns it, `inboxSet` creates `inbox/<inboxKey>.json`, the old file is unchanged).
  - `inbox lock: a fresh lock makes the write wait and fail with CONFLICT naming the lock; a stale lock is removed` (create `<file>.lock`; `lockWaitMs: 200` → `CONFLICT`; set its mtime 60 s back → write succeeds and the lock is gone).
  - `inbox update: the updater sees the entry on disk at write time` (two `inboxUpdate` calls each adding a key keep both).
- [ ] **Step 2:** `node --test scripts/user-store-inbox.test.mjs` fails.
- [ ] **Step 3:** Implement. Remote: `spawnSync('git', ['remote', '-v'], { cwd: root, timeout: 10000, maxBuffer: 16 MiB })`, parse fetch lines into `[{ name, url }]`, `chooseRemote`, `parseRemoteUrl`; identity `remote:${host}/${owner}/${name}` lowercased. Lock: `fs.openSync(lock, 'wx')`, retry with `Atomics.wait` sleeps of 25 ms, stale by `mtimeMs`. `inboxBad` errors keep naming the file read.
- [ ] **Step 4:** Tests pass, plus `node --test scripts/inbox-tracker.test.mjs scripts/cli-inbox.test.mjs`.
- [ ] **Step 5:** Commit `feat(inbox): key the check by git remote and lock its writes (PMK-225)`.

### Task 2: Status changes on Local and the merge in markRead (criteria 3 and 5, tracker side)

**Files:**
- Modify: `scripts/lib/local/tracker.mjs` (`scanInbox`, `branchReader.has`, `listNotifications`, `markRead`)
- Test: `scripts/inbox-tracker.test.mjs`

**Interfaces:**
- Consumes: `inboxGet`, `inboxUpdate` from Task 1.
- Produces: items with `from`, `to`; kind `status` (`in: 'status'`, key `status:<id>:<12 hex of [at, by, from, to]>`); `counts.statusChanges`.

- [ ] **Step 1: Failing tests**
  - `a move by another member of an issue assigned to the user is a status item; a self move or a move before the assignment is not` (assert `kind`, `in`, `from`, `to`, key regex, `counts.statusChanges === 1`).
  - `an entry without kinds hides status items older than 14 days and the next mark-read with no key marks them and records kinds` (write the entry with `inboxSet`, assert `hidden` and that after `markRead` `inboxGet(...).kinds` has `status`).
  - `a status key survives the prune while its move is on another branch`.
  - `mark-read merges with keys written after it read the file` (call `markRead({ keys: [a] })`, write key `b` with `inboxUpdate` from a stubbed clock in between is not possible in-process, so: run two `markRead` calls with different keys and assert both keys are in `inboxGet(...).seen`, and a unit check that `markRead` writes through `inboxUpdate` by pre-seeding a key the snapshot did not hold via `inboxSet` after `listNotifications`).
  - Update `ITEM_KEYS` to the global order.
- [ ] **Step 2:** Run, fail.
- [ ] **Step 3:** Implement. Assignee replay per issue log; per-kind cut: kinds missing from `stored.kinds` (or all kinds when `stored` is null) use the 14-day cut; mark-read with no `--key` marks their older items and writes `kinds: ['assignment', 'mention', 'status']`. Write: `inboxUpdate(root, user, (current) => ({ at: recorded, seen: merge(current?.seen, marked, prunedKeys), kinds }))`.
- [ ] **Step 4:** Tests pass.
- [ ] **Step 5:** Commit `feat(inbox): list status changes and merge concurrent mark-reads (PMK-225)`.

### Task 3: Linear notifications (criterion 2)

**Files:**
- Create: `scripts/lib/linear/notifications.mjs`, `scripts/lib/linear/notifications.test.mjs`
- Modify: `scripts/lib/linear/documents.mjs` (queries), `scripts/lib/linear/tracker.mjs` (wire, drop from `STUB_CAPABILITY`), `scripts/lib/linear/manifest.mjs`, `scripts/lib/linear/manifest.test.mjs`, `scripts/lib/linear/tracker.test.mjs` if it asserts the stub

**Interfaces:**
- Consumes: `client.paginate`, `client.request`, `ops.context()` (viewer) from `issue-ops.mjs`.
- Produces: `notificationOperations({ client, ops, now }) => { listNotifications, markRead }` with the Local result shapes; queries `NOTIFICATIONS_QUERY` (`query PmkitNotifications`) and `NOTIFICATION_READ` (`mutation PmkitNotificationRead($id: String!, $readAt: DateTime!) { notificationUpdate(id: $id, input: { readAt: $readAt }) { success notification { id readAt } } }`).

- [ ] **Step 1: Failing tests** with `fakeLinearFetch` routes `PmkitNotifications` and `PmkitNotificationRead`:
  - type mapping (four types, one other type dropped), keys `notification:<id>`, `seen` from `readAt`, `by`, `excerpt` of a comment mention, `from`/`to` null, counts.
  - `--as` another member → `INVALID_INPUT`.
  - `hasMore` → `complete: false` with the problem, and markRead refuses.
  - markRead: dry run sends no mutation; keys mark exactly those; unknown keys returned; the second of three updates failing throws with `marked` and `left`.
  - manifest: `user_inbox` is `{ path: 'native', detail: { workspace: 'native' } }`.
- [ ] **Step 2:** Run, fail.
- [ ] **Step 3:** Implement per the spec, section 2.
- [ ] **Step 4:** `node --test scripts/lib/linear/*.test.mjs scripts/cli-linear.test.mjs scripts/capabilities.test.mjs` pass.
- [ ] **Step 5:** Commit `feat(linear): serve the user inbox from Linear notifications (PMK-225)`.

### Task 4: `inbox list --reviews` and the text table (criteria 3 and 4, CLI)

**Files:**
- Modify: `scripts/lib/github/host.mjs` (`listReviewRequests()`), `scripts/pmkit.mjs` (`inbox list`), `scripts/__goldens__/*/inbox-list.txt`
- Test: `scripts/cli-inbox.test.mjs`

**Interfaces:**
- Produces: `host.listReviewRequests() => [{ number, url, title, headRefName, author, reviewRequests }]`; `inbox list` data gains `reviews` (spec section 3) and `counts.reviewRequests`.

- [ ] **Step 1: Failing tests** (fake `gh` from `scripts/fake-gh.mjs`):
  - `--reviews` matches a user request by member id or `--login` ignoring case, lists team requests apart, sets `counts.reviewRequests`.
  - `--reviews` with `git_host: none` or a failing `gh` → `verified: false`, `counts.reviewRequests: null`, text `review requests not verified: …`, exit 0.
  - 200 PRs → `complete: false`.
  - without `--reviews`: `reviews: null`, no `gh` call.
  - the text table has `Text` and `Seen` columns, an excerpt cut at 60 with `…`, and `backlog → in_progress` for a status item.
- [ ] **Step 2:** Run, fail.
- [ ] **Step 3:** Implement; regenerate the goldens with the repo's golden update path and read the diff.
- [ ] **Step 4:** Tests pass.
- [ ] **Step 5:** Commit `feat(inbox): count review requests and show the text and seen state (PMK-225)`.

### Task 5: Docs and delivery checks

**Files:** `CHANGELOG.md` (one line under `## Unreleased`), `skills/pmkit/SKILL.md` and `README.md` where they describe the inbox, `commands/issues/inbox-digest.md` (drop "(Linear)" from the `absent` case, since Linear is native now), `docs/adr/0001-…` only if counts change (they do not: Local stays 16/4).

- [ ] Update the docs; run `npm test` in the foreground and check exit 0.
- [ ] Commit `docs(inbox): describe the inbox improvements (PMK-225)`.
