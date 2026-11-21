---
id: PMK-345
title: Clean up the open review findings of the GitHub sprint and epic code
type: chore
status: in_review
priority: low
estimate: 5
assignee: fred
parent: EPC-8
milestone: github-issues
branch: pmk-345-clean-up-the-open-review-findings-of-the
created: 2026-11-18T00:15:22.878Z
updated: 2026-11-21T21:14:48Z
---

## Description

Found by `utils:review-work` on PMK-88 (PR #318), re-rated at 8.8:

- `scripts/lib/github/cycle-ops.mjs` imports the capacity store from `scripts/lib/linear/capacity-store.mjs`; move it to `scripts/lib/`.
- `classifyRest` in `scripts/lib/github/client.mjs` has no test for an unreadable GET answer or for `already_exists` off `/milestones`.
- `sprintStep` in `scripts/lib/github/filter.mjs` leaves a `stale: true` detail on its final INVALID_INPUT.
- Complexity 11 to 18: `problemOf`, `fieldValue`, `toIssueWithWarnings`, `searchIssues`, `applyPlan`, `createDeliverable`, `moveToCycle`, `epicInput`, `openCycle`, `bodyOf`, `classifyRest` (see also PMK-336).

## Acceptance criteria

- [x] The capacity store lives in `scripts/lib/`
- [x] `classifyRest` has tests for both cases
- [x] The stale detail is gone
- [x] Each listed function has a cyclomatic complexity of 10 or less, or is listed in PMK-336
