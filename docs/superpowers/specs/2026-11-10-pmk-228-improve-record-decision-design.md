# PMK-228: Improve record-decision

Follow-ups of PMK-65 (`/pmkit:spec:record-decision`), collected in `docs/superpowers/epc-6-follow-ups.md`. None is a defect. The worker was told to decide without asking, so every choice below marked **(builder's call)** was made by the implementer.

## Why

`record-decision` writes an ADR and links it to issues with a comment. Four gaps showed up in its reviews:

1. Two branches can write the same ADR number. Nothing reports it after the merge.
2. The link from an issue to its ADR lives only in a comment, so no read can list an issue's decisions.
3. An ADR can never be marked superseded or deprecated through pmkit.
4. With no `git_host.default_branch`, pmkit uses `main` even when `origin/HEAD` says otherwise, so `docs next-adr` and every base-branch read can look at the wrong branch.

## Goals

One change per acceptance criterion:

1. `validate` reports two ADRs with the same number.
2. Issues get an optional `docs` field, written by `issues update --add-doc / --remove-doc`, and `record-decision` sets it on the Local tracker.
3. `docs adr-status` (CLI) and `/pmkit:spec:adr-status` (command file) change the status of an existing ADR.
4. `resolveDefaultBranch` reads `origin/HEAD` when `default_branch` is unset.

## Non-goals

- Renumbering duplicate ADRs automatically. `validate` reports; the user renames.
- A `docs` field on Linear. Linear has no free list field on issues; the comment stays the link there.
- Setting `docs` at `issues create`.
- Editing the newer ADR when an older one is superseded (one file per write).
- Reading `origin/HEAD` when `default_branch` is set but invalid: that stays `main` with the existing note, because the user wrote a value and it is wrong.
- The defects of the same reviews, which have their own bug issues.

## Design

### 1. Duplicate ADR numbers in `validate`

- `scripts/lib/adr.mjs` exports `adrFolders({ root, trackerDir })`: the repository folder `docs/adr` and, for the Local tracker, `<issuesDir>/docs/adr` when it is not the same folder (`tracker.path: .`). `planNextAdr` and the new checks use it.
- It also exports `adrFiles(folders)`: every direct child file whose name matches the existing `NUMBERED` rule, as `{ number, file, place }`.
- `validateRepo` adds one problem per file that shares its number with another file, with code `adr`, at that file's path: `ADR number 0003 is also used by docs/adr/0003-other.md`. It reads the working tree only, so `validate` stays offline.
- It runs for a hosted tracker too (repository folder only), before the early return, because the ADR files live in the repository whatever the tracker.
- `/pmkit:local:doctor` gets one bullet under step 5 (what the CLI cannot fix): the user renames the later file to the number `docs next-adr` gives and updates the comments that cite it, as `record-decision` already says.

### 2. `docs` field on issues

- Model: `docs?: string[]`, present only when not empty, like `branch`. Each entry is the ADR or document path a command cites (`path` from `docs next-adr` / `docs adr-status`), one line, not empty. Duplicates are dropped. **(builder's call: optional, so no existing JSON or golden changes.)**
- Local file: frontmatter key `docs`, after `branch`. Omitted when empty. Parsed as a list.
- `UPDATE_KEYS` gets `docs`. The Local normalizer checks a list of one-line strings and drops duplicates; an empty list deletes the field.
- CLI: `issues update <id> --add-doc <path>` and `--remove-doc <path>`. One path each. The CLI reads the issue and computes the new list, so the agent does no read-modify-write. Adding a path already there, or removing one that is absent, changes nothing (`before` equals `after`). **(builder's call: add/remove rather than a full replacement list, because paths may hold commas and the agent should not merge lists.)**
- The update records one `update` event with `field: docs`, `from` and `to`, like any field.
- `issues get` text shows a `docs` line when set (`format.mjs`).
- Linear: `updateIssue` with `docs` fails with `NOT_SUPPORTED` before any request ("Linear issues have no docs field", next step "The comment on the issue stays the link to the document"). The manifest declares `issueDocs` in `documents.detail.unsupported`, with a test.
- Migration Local → Linear: an issue with `docs` adds a `doc links` loss.
- `record-decision` step 6: after the comments, when `documents.detail.unsupported` of `capabilities --json` does not list `issueDocs`, each related issue also gets `issues update <id> --add-doc <path> --dry-run --json`, shown with the comments in the same preview and run after them. A failure stops as step 7 says.

### 3. Change the status of an ADR

CLI `docs adr-status <number> <status> [--by <number>] [--dry-run]`, a write.

- `<number>`: one to four digits (`3` or `0003`). `<status>`: `accepted`, `deprecated` or `superseded`. `--by` is required with `superseded` and refused with the others; it names the newer ADR, which must exist and differ from `<number>`.
- Lookup: `adrFiles(adrFolders(...))`. No file has the number: `NOT_FOUND`. More than one: `CONFLICT` naming each path, next step `pmkit validate`.
- The status line: `Status: accepted`, `Status: deprecated`, or `Status: superseded by <path of the newer ADR>`. It replaces the first line that starts with `Status:` before the first `## ` heading; otherwise it goes after the first `# ` heading with one blank line on each side, or at the top when there is no heading. **(builder's call: the ADRs of this repository carry no status yet, so the line is added, not required.)**
- The same status already there: no write, `before` equals `after`.
- Write: a repository file (`docs/adr/`) is written directly and stays without a commit, with a note saying so. A tracker document goes through a new tracker operation `updateDocument(path, body, actor, { dryRun })`, so `auto_commit` applies. Local implements it; Linear returns `NOT_SUPPORTED` like `createDocument`, and the manifest lists `updateDocument` in `documents.detail.unsupported`. `contract.mjs` lists the operation.
- Output: `{ number, path, place, status: { before, after }, before, after }` where `before` and `after` are the file texts; text output shows the status line before and after.
- Command file `commands/spec/adr-status.md` (`/pmkit:spec:adr-status <number> <status> [--by <number>]`): dry run, show the status line before and after, ask once whatever `write_policy.confirm` says (an ADR is a permanent record, as in `record-decision`), then write. With a scenario, the counts of the scenario tests, `COMMANDS` in `plugin.test.mjs`, README table, `skills/pmkit/SKILL.md` and CHANGELOG.
- `SERVED_BY.documents` gets `docs adr-status`.

### 4. `origin/HEAD` for an unset default branch

- `resolveDefaultBranch(pmkit, { originHead })`: when `default_branch` is unset and `originHead()` returns a valid branch name, that name is the branch, with the note `git_host.default_branch is not set, so origin/HEAD (<name>) is used`. Otherwise `main` with no note, as today.
- `originHead` in the CLI runs `git symbolic-ref --quiet --short refs/remotes/origin/HEAD` in the root with the read timeout and the large output buffer, strips `origin/`, and returns `null` on any failure. It is called only when `default_branch` is unset, once per run.
- Every reader goes through it: `defaultBranch(ctx)`, `defaultBranchNotes(ctx)`, `default-branch`, `docs next-adr`. `validate` keeps calling it without `originHead`, because it checks the config value only.
- The command files that say "`main` when `git_host.default_branch` is unset" and the README row say "`origin/HEAD`, else `main`".

## Constraints

- No dependency (ADR 0003). Commands do not compute (ADR 0002): numbers, lookup and status text are in the CLI.
- Reads that fail are not conclusions: an `origin/HEAD` that cannot be read falls back to `main` exactly as before.
- CRLF is normalized when an ADR is read; the written file keeps LF.

## Left to the builder

Test layout, the exact wording of notes and messages, and the scenario fixture details.
