# PMK-298: say when the local default branch is behind origin in `issues branch`

## Intent
`issues branch` starts from the local default branch (PMK-290) and fetches nothing, so a local `develop` behind `origin/develop` silently gives a branch on an old commit (PR #248 had to be rebased). The command should say so.

## Goals
- Without `--from`, when the local default exists and `origin/<default>` has commits it lacks, the text and `notes` (JSON) say how many and give the next step: `git pull --ff-only` on the default branch, or `--from origin/<default>`. Same on `--dry-run`.
- `commands/issues/work.md` step 6 says what the agent does with that note.

## Non-goals / anti-goals
- No fetch (the count only knows the last fetched `origin/<default>`). No configurable remote. No note with an explicit `--from`, with an up-to-date default, with no local default (already says `origin/<default>`), or with no `origin/<default>` ref. Never fails the command.

## Approaches
1. Count with `git rev-list --count <default>..origin/<default>` in `branchBase`, return it as `behind`, add the note in the command. (chosen: local refs only, one call)
2. Fetch first: rejected, out of scope and writes to the repo.
3. Warn in `pr open`: rejected, too late.

## Design
`branchBase` returns `{ from, note, behind }`; `behind` is 0 when `--from` is given, the remote ref is missing or git fails. A helper `behindNote(from, behind)` builds the sentence. `issues branch` appends it to the text and puts it first in `notes`. Dry run and real run both do. Step 6 of work.md: when the note says the default is behind, show it with the branch and base, and recommend `--from origin/<default>` (no pull: it changes the user's branch); use it when the user agrees, re-run the dry run.
