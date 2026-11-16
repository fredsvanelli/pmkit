---
id: PMK-308
title: Say in pr ready when the branch is behind origin
type: feature
status: done
priority: low
estimate: 1
assignee: fred
parent: EPC-6
branch: pmk-308-say-in-pr-ready-when-the-branch-is
created: 2026-11-13T21:09:10.498Z
updated: 2026-11-14T01:45:44Z
---

## Description

### Context

PMK-305 made `pr open` add a note when the branch lacks commits of the last fetched `origin/<default>` (`behindNotes`, `scripts/pmkit.mjs:391-406`); on the real run the next step ends with `git push --force-with-lease origin <branch>`, since the branch is on origin. `pr ready` (`scripts/pmkit.mjs:2080-2092`) marks a draft ready for review with capability notes only. A draft opened earlier has often fallen behind by the time it is marked ready, which is when reviewers start to read it. Checked at 041bc521. Source: PMK-305, PR #261 (implementer).

### Scope (in)

- `pr ready`, real and dry run, adds the same note to the text and the JSON when the branch lacks commits of `origin/<default>`, with the count and the next step ending with the force-with-lease push (the branch has an open pull request, so it is on origin).
- No note when the branch has them all, or when `origin/<default>` is missing; `could not compare` when git cannot count. Never a refusal.

### Out of scope

- Fetching, rebasing or refusing.

### Tasks

- [ ] Reuse `behindNotes` in `pr ready`
- [ ] Test with a branch behind and one up to date

## Acceptance criteria

- [x] `pr ready` on a branch behind origin/<default> says how many commits and gives the next step with the force-with-lease push, on the dry run too, with a test
- [x] `pr ready` on an up-to-date branch, or without origin/<default>, has no such note, with a test
