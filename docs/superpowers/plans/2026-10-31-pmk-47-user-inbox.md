# PMK-47 user inbox Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `inbox list` and `inbox mark-read` give a member the assignments and mentions since the last check, and record the check in the user store, with `user_inbox` native on Local.

**Architecture:** A pure module (`scripts/lib/local/inbox.mjs`) finds mentions. The Local tracker adds `listNotifications` and `markRead` and reads the check through two new user store functions. The CLI adds the `inbox` group. Linear keeps `user_inbox` absent.

**Tech Stack:** Node.js ESM, `node:test`, no dependencies (ADR-0003).

**Spec:** `docs/superpowers/specs/2026-10-31-pmk-47-user-inbox-design.md`

## Global Constraints

- The check lives in `inbox/<repo-hash>.json` of the user store and never in `.issues/`.
- A file that does not parse never breaks a list: it becomes a `problems` entry, `complete: false` and a `warning:` that points to `pmkit validate`. Mark-read refuses on an incomplete read.
- Text files are read with CRLF normalized.
- Changes in `README.md`, `CHANGELOG.md`, `skills/pmkit/SKILL.md`, `scripts/lib/args.mjs` and `scripts/pmkit.mjs` stay small (PMK-56, PMK-60 and PMK-65 edit them in the same round). No file in `commands/`, so scenario counts do not change.
- Every commit message carries `(PMK-47)` and ends with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Never run the CLI inside `scripts/__fixtures__/`; tests copy fixtures with `makeRepo`.

## Review Focus

- `a@fred.com`, `@fredo`, `\@fred`, a mention inside a fence or backticks, and `thanks @fred.` (Task 1).
- A comment file that cannot be read and an issue file that does not parse: items from the others stay, `complete` is false (Task 2).
- Mark-read on an incomplete read, `--through` in the future and `--through` before the stored check (Task 2).
- An item dated after now stays unread and is flagged `future` (Task 2).
- A user store file that does not parse (Task 1).

---

### Task 1: Mention finder and user store check

**Files:**
- Create: `scripts/lib/local/inbox.mjs`, `scripts/inbox.test.mjs`
- Modify: `scripts/lib/user-store.mjs`, `scripts/user-store.test.mjs`

**Interfaces:**
- Produces: `findMention(text, member) -> string | null` (the first line holding a mention outside code, trimmed, cut at 200 characters). `inboxGet(root, member, options) -> string | null` and `inboxSet(root, member, at, options) -> void` in `user-store.mjs`; both throw `INVALID_INPUT` naming the file when it does not parse.

- [ ] **Step 1: Write failing tests**: `findMention` matches `hi @fred`, `@FRED please`, `thanks @fred.`, `(@fred)` and `@agent:claude` for `agent:claude`; it returns null for `a@fred.com`, `@fredo`, `@fred.com`, `\@fred`, a fenced block (``` and ~~~, and an unclosed fence) and an inline code span. `inboxGet` is null on a new store; `inboxSet` then `inboxGet` round-trips; two members keep separate checks; a second repo root keeps its own file; a bad JSON file throws `INVALID_INPUT`; a `PMKIT_HOME` inside a git repository throws.
- [ ] **Step 2: Run** `node --test scripts/inbox.test.mjs scripts/user-store.test.mjs`, expect FAIL.
- [ ] **Step 3: Implement** both. Strip code first (fences line by line, then inline spans), then run one regex per line. `inboxSet` writes with `writeAtomic`.
- [ ] **Step 4: Run** the tests, expect PASS.
- [ ] **Step 5: Commit** `feat(inbox): add the mention rule and the inbox check in the user store (PMK-47)`.

### Task 2: Tracker operations

**Files:**
- Modify: `scripts/lib/contract.mjs`, `scripts/lib/local/tracker.mjs` (new block after the demand signals, and the returned object), `scripts/lib/linear/tracker.mjs` (`STUB_CAPABILITY`)
- Test: `scripts/inbox.test.mjs` (tracker part)

**Interfaces:**
- Consumes: `findMention`, `inboxGet`, `inboxSet`.
- Produces: `listNotifications({ user, since, all })` returning `{ user, since, through, items, counts, complete, problems }` and `markRead({ user, through, dryRun })` returning `{ user, previous, recorded, through, changed, dryRun }`, with the item keys of the spec. `user` is checked against the members (`INVALID_INPUT`). `since` undefined reads the stored check; `all` ignores it.

- [ ] **Step 1: Write failing tests** on a `makeRepo('no-sprints')` copy with `PMKIT_HOME` set: an assignment by another member shows; a self-assignment does not; a `create` event with an assignee shows; a comment mention by another member shows, by the user does not; a description mention shows dated by the newest description event; a delegated `agent:x` issue shows for `agent:x` and not for `fred`. After `markRead`, `listNotifications` is empty and a later comment shows. `since` and `all` override the check and write nothing. A comment file whose frontmatter is broken, an issue file with conflict markers and an events line that is not JSON each give a `problems` entry with `complete: false` while the other items stay. `markRead` on that state throws `INVALID_INPUT` and the store file does not exist. `through` after now throws; `through` before the stored check gives `changed: false`; `dryRun` writes nothing. An event dated after now is listed with `future: true` and stays after `markRead`.
- [ ] **Step 2: Run** `node --test scripts/inbox.test.mjs scripts/contract.test.mjs`, expect FAIL.
- [ ] **Step 3: Implement** the block. Per issue: `readEvents` (a log problem goes to `problems`), `listComments` per file inside try/catch, `readAll` problems. Sort as the spec says. `markRead` reads the same list, refuses on `complete: false`, then writes `max(previous, through)`.
- [ ] **Step 4: Run** `npm test`, expect PASS except the capability tests changed in Task 3.
- [ ] **Step 5: Commit** `feat(inbox): add listNotifications and markRead to the Local tracker (PMK-47)`.

### Task 3: CLI, capability and the Linear manifest

**Files:**
- Modify: `scripts/pmkit.mjs` (two commands after `demand list`), `scripts/lib/args.mjs` (`GROUPS` gains `inbox`), `scripts/lib/capabilities.mjs`, `scripts/lib/linear/manifest.mjs`
- Modify tests: `scripts/cli.test.mjs`, `scripts/capabilities.test.mjs`, `scripts/lib/linear/manifest.test.mjs`, `scripts/cli-degraded-coverage.test.mjs`, `scripts/golden-cases.mjs` if the harness lists every command

**Interfaces:**
- Produces: `inbox list [--as member] [--since ts] [--all]` and `inbox mark-read [--as member] [--through ts] [--dry-run]` (`dryRun: true`, not `write`, because they never touch the tracker), JSON as in the spec. `SERVED_BY.user_inbox = ['inbox list', 'inbox mark-read']`. Linear `user_inbox`: `absent`, `detail: { workspace: 'native', unsupported: ['listNotifications', 'markRead'] }`, hint "The Linear adapter does not read notifications yet; Linear offers them on this workspace".

- [ ] **Step 1: Write failing tests**: `inbox list --json` keys and the item keys; text output for an empty inbox and for an incomplete one (with the warning); `inbox mark-read --dry-run` writes no store file; capabilities: Local has no absent capability; manifest and REFUSALS for Linear.
- [ ] **Step 2: Run** those files, expect FAIL.
- [ ] **Step 3: Implement** the commands, `SERVED_BY` and the manifest entry.
- [ ] **Step 4: Regenerate goldens if needed** with `UPDATE_GOLDENS=1 node --test scripts/goldens.test.mjs`, read the diff, run `npm test`, expect PASS.
- [ ] **Step 5: Commit** `feat(inbox): add the inbox commands and serve user_inbox (PMK-47)`.

### Task 4: Docs

**Files:**
- Modify: `README.md`, `CHANGELOG.md`, `skills/pmkit/SKILL.md`, `CONTEXT.md`, `docs/adr/0001-local-tracker-is-the-reference-implementation.md`, `docs/superpowers/specs/2026-10-23-pmkit-design.md`

- [ ] **Step 1: Update** the README command rows, a CHANGELOG line at the top of `## Unreleased`, the SKILL.md command table, an Inbox glossary entry, ADR-0001 (20 served, 16 native, no absent capability, Consequences paragraph) and the design spec lines that say `user_inbox` is absent.
- [ ] **Step 2: Run** `npm test`, expect PASS.
- [ ] **Step 3: Commit** `docs(inbox): document the user inbox (PMK-47)`.
