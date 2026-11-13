---
id: PMK-305
title: Say in pr open when the branch is behind origin
type: bug
status: in_progress
priority: low
estimate: 1
assignee: fred
parent: EPC-6
branch: pmk-305-say-in-pr-open-when-the-branch-is-behind
created: 2026-11-13T16:20:45.502Z
updated: 2026-11-13T17:08:14Z
---

## Description

### Context

PMK-298 made `issues branch` say when the local default branch is behind `origin/<default>`, since a branch created from an old commit needs a rebase later. `pr open` does not check the base of the branch it pushes (`scripts/pmkit.mjs`, `pr open`: its notes are only `defaultBranchNotes` and capability notes). A branch whose base is behind the last fetched `origin/<default>` opens a pull request that may conflict or that misses fixes, and the user learns it on GitHub. In an active repository most branches fall behind with time, so the note must be cheap and informative, never a refusal. Source: PMK-298, PR #252 (implementer).

### Scope (in)

- `pr open`, real and dry run, adds a note to the text and the JSON when `origin/<default>` has commits the branch lacks (as of the last fetch), with the count and the next step (`git fetch origin`, then `git rebase origin/<default>`).
- No note when the branch has them all, or when `origin/<default>` is missing.

### Out of scope

- Fetching, rebasing or refusing the push.

### Tasks

- [ ] Count the commits of origin/<default> missing from the branch
- [ ] Test with a branch behind and one up to date

## Acceptance criteria

- [x] `pr open` on a branch behind origin/<default> says how many commits and gives the next step, on the dry run too, with a test
- [x] `pr open` on an up-to-date branch, or without origin/<default>, has no such note, with a test
