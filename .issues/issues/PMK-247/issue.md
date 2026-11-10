---
id: PMK-247
title: Improve ADR folders when the tracker is the repository or outside it
type: feature
status: in_progress
priority: low
estimate: 2
assignee: fred
parent: EPC-6
branch: pmk-247-improve-adr-folders-when-the-tracker-is
created: 2026-11-10T19:28:14.611Z
updated: 2026-11-10T22:25:57Z
---

## Description

### Context

The second review of PR #196 (PMK-228) found two cases where the ADR commands treat the tracker's `docs/adr` folder unlike any other tracker path. Both come from how `docs next-adr` (PMK-65) labels the folders, so the fix has to change `next-adr` and `adr-status` together. The re-review accepted leaving them out of PMK-228. Source: PMK-228, PR #196.

### Scope (in)

- With `tracker.path: .`, `docs adr-status` writes the ADR as a repository file and never commits it, whatever `auto_commit` says.
- With the tracker folder outside the repository, its ADRs are also labelled `docs/adr`, so when both folders have `0002-a.md`, `validate` and the `CONFLICT` error show two identical paths.

### Out of scope

- Other `tracker.path` values, which already behave the same way in both commands.

### Tasks

- [ ] Make the ADR commands follow `auto_commit` when the tracker is the repository folder
- [ ] Label the ADR folder of a tracker outside the repository so it differs from the repository's own folder

## Acceptance criteria

- [ ] With `tracker.path: .`, `docs next-adr` and `docs adr-status` follow `auto_commit` the same way they do for any other tracker path
- [ ] When the repository and a tracker outside it both hold an ADR with the same number, `validate` and the `CONFLICT` error show two different paths, so the user can tell which file to rename
