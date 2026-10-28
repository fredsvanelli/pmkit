---
id: PMK-164
title: Offer in-review issues sent back to no sprint in cycle plan
type: bug
status: backlog
priority: medium
parent: EPC-1
related: [PMK-122]
milestone: local-gaps
created: 2026-10-28T00:11:40.739Z
updated: 2026-10-28T00:11:40Z
---

## Description

Found in PMK-122. `/pmkit:cycle:close` sends back any unfinished issue, including one in `in_review`, with `cycle add --to none`, which keeps its status. `/pmkit:cycle:plan` step 5 reads `todo`, `backlog` and `in_progress`, so it never offers a sprintless `in_review` issue.
