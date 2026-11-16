# PMK-298: say when the local default branch is not level with origin in `issues branch`

## Intent
`issues branch` starts from the local default branch (PMK-290) and fetches nothing, so a local `develop` behind `origin/develop` silently gives a branch on an old commit (PR #248 had to be rebased). The command should say so, with a next step that works.

## Goals
- Without `--from`, when the local default exists and there is a last fetched `origin/<default>`, compare both ways (`git rev-list --left-right --count <default>...origin/<default>`, local refs only) and give a note in `notes` of the JSON (and, in text mode, as a stderr note, like `defaultBranchNotes`; never repeated in stdout):
  - **behind only** (N commits): the count and the next step.
  - **diverged** (A only here, B only there): both counts, and that the default cannot fast-forward. Never suggests a pull.
  - **cannot compare** (`rev-list` fails): says so. An unknowable state is never read as up to date.
- The next step depends on whether the branch exists yet:
  - **dry run** (nothing created): behind -> `git pull --ff-only` on the default, or `--from origin/<default>`; diverged -> rebase or merge the default first, or `--from origin/<default>`; cannot compare -> `git fetch origin` and retry, or `--from origin/<default>`.
  - **real run** (the branch exists from the old base, so a pull of the default no longer helps it): one path for all three, `git rebase --onto origin/<default> <default> <new branch>` after `git fetch origin`. `--onto` takes the branch's own commits (none yet) onto origin and leaves commits that only the local default has behind. For "cannot compare" it is conditional: check `git log <default>..origin/<default>` and rebase when behind. Chosen over recreating with `--from` for the behind case so the agent has one path and does not have to delete a branch the tracker already records.
- `commands/issues/work.md` step 6 says what the agent does with the note.

## Non-goals / anti-goals
- No fetch (counts are as of the last fetch). No configurable remote. No note with an explicit `--from`, with a level or ahead-only default, with no local default (already says `origin/<default>`), or with no `origin/<default>` ref. The command never fails because of the comparison.

## Approaches
1. Count both sides in `branchBase`, return `sync` (`{ ahead, behind }`, `{ unknown: true }` or `null`), build the notes in `syncNotes(from, sync, created)`. (chosen: local refs only, one git call)
2. Count only `default..origin/default`: rejected, a diverged default would be told to pull and the pull fails; a failed count would read as level.
3. Fetch first: rejected, out of scope and writes to the repo.
4. Warn in `pr open`: rejected, too late.

## Design
`branchBase` returns `{ from, note, sync }`. `syncNotes(from, sync, created = null)` returns the notes; `created` is the new branch name on the real run. Dry run puts `syncNotes(from, sync)` first in `notes`, the real run `syncNotes(from, sync, branch)`; the JSON `data.notes` holds the same. Step 6 of work.md: show the note with the branch and base, recommend `--from origin/<default>` over a pull before creating; after the real run follow the note's `git rebase --onto` when it has one.
