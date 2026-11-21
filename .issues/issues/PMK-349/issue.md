---
id: PMK-349
title: Clean up after the writing GitHub live checks when a run is interrupted
type: task
status: done
priority: low
estimate: 2
assignee: fred
parent: EPC-8
related: [PMK-335]
branch: pmk-349-clean-up-after-the-writing-github-live
created: 2026-11-20T22:03:02.091Z
updated: 2026-11-21T21:46:14Z
---

## Description

### Context

Found while working PMK-335 (PR #327). The writing live checks in `scripts/lib/github/client-live.mjs` add draft items to the throwaway Project, convert a draft on GHES and add a sprint iteration. A run stopped with Ctrl-C (SIGINT) skips the cleanup, so drafts, the converted issue or the extra iteration stay behind. Today the runbook's cleanup steps cover this by hand.

### Scope (in)

- Clean up what the writing live checks created when the run gets SIGINT or SIGTERM
- Print what the cleanup removed and what it could not remove, with each item's URL

### Out of scope

- Changes to the read-only live checks
- Cleanup after a forced kill (SIGKILL), which no handler can catch

### Tasks

- [ ] Clean up the throwaway Project when a live run is interrupted
- [ ] Report what was left behind and how to remove it
- [ ] Update the GitHub live checks runbook

## Acceptance criteria

- [x] Stopping a writing live check with Ctrl-C removes the drafts it added and restores the Project's iteration list
- [x] An interrupted run that cannot remove an item prints the item's URL and the runbook step to remove it by hand
- [x] A test against the fake gh proves the cleanup runs on SIGINT
