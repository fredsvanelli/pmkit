---
id: PMK-122
title: Offer in-progress issues sent back to the backlog in cycle plan
type: bug
status: in_review
priority: medium
estimate: 2
assignee: fred
parent: EPC-1
related: [PMK-113]
milestone: local-gaps
branch: pmk-122-offer-in-progress-issues-sent-back-to
created: 2026-10-26T17:58:03.712Z
updated: 2026-10-26T22:13:04Z
---

## Description

Found in PMK-113. `/pmkit:cycle:close` can send an unfinished `in_progress` issue back to the backlog, but `commands/cycle/plan.md` step 5 asks for `--category todo,backlog --sprint none`, so plan never offers it.

## Acceptance criteria

- [ ] An issue in an `in_progress` status with no sprint, as `/pmkit:cycle:close` leaves it after a move back to the backlog, is in the list that `/pmkit:cycle:plan` step 5 drafts the scope from
- [ ] `/pmkit:cycle:plan` still offers the `todo` and `backlog` issues with no sprint, and does not offer an issue that is already in a sprint
- [ ] A test fails on today's command text and passes after the change, and `npm test` passes
