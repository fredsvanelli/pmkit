---
id: PMK-345
title: Clean up the open review findings of the GitHub sprint and epic code
type: chore
status: backlog
priority: low
estimate: 5
parent: EPC-8
milestone: github-issues
created: 2026-11-18T00:15:22.878Z
updated: 2026-11-21T16:50:26Z
---

## Description

Found by `utils:review-work` on PMK-88 (PR #318), re-rated at 8.8:

- `scripts/lib/github/cycle-ops.mjs` imports the capacity store from `scripts/lib/linear/capacity-store.mjs`; move it to `scripts/lib/`.
- `classifyRest` in `scripts/lib/github/client.mjs` has no test for an unreadable GET answer or for `already_exists` off `/milestones`.
- `sprintStep` in `scripts/lib/github/filter.mjs` leaves a `stale: true` detail on its final INVALID_INPUT.
- Complexity 11 to 18: `problemOf`, `fieldValue`, `toIssueWithWarnings`, `searchIssues`, `applyPlan`, `createDeliverable`, `moveToCycle`, `epicInput`, `openCycle`, `bodyOf`, `classifyRest` (see also PMK-336).

## Acceptance criteria

- [ ] The capacity store lives in `scripts/lib/`
- [ ] `classifyRest` has tests for both cases
- [ ] The stale detail is gone
- [ ] Each listed function has a cyclomatic complexity of 10 or less, or is listed in PMK-336
