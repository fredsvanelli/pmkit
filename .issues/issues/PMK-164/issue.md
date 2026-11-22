---
id: PMK-164
title: Offer in-review issues sent back to no sprint in cycle plan
type: bug
status: in_progress
priority: medium
assignee: fred
parent: EPC-1
related: [PMK-122]
milestone: local-gaps
branch: pmk-164-offer-in-review-issues-sent-back-to-no
created: 2026-10-28T00:11:40.739Z
updated: 2026-11-22T05:17:22Z
---

## Description

Found in PMK-122. `/pmkit:cycle:close` sends back any unfinished issue, including one in `in_review`, with `cycle add --to none`, which keeps its status. `/pmkit:cycle:plan` step 5 reads `todo`, `backlog` and `in_progress`, so it never offers a sprintless `in_review` issue.

## Acceptance criteria

- [ ] `/pmkit:cycle:plan` step 5 offers `in_review` issues with no sprint, in both of its `issues list` calls
- [ ] `/pmkit:cycle:close` step 6 names `in_review` among the categories plan offers again
- [ ] The cycle-plan scenario offers and plans a sprintless `in_review` issue
