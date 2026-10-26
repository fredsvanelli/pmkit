---
id: PMK-122
title: Offer in-progress issues sent back to the backlog in cycle plan
type: bug
status: backlog
priority: medium
parent: EPC-1
related: [PMK-113]
milestone: local-gaps
created: 2026-10-26T17:58:03.712Z
updated: 2026-10-26T17:58:03Z
---

## Description

Found in PMK-113. `/pmkit:cycle:close` can send an unfinished `in_progress` issue back to the backlog, but `commands/cycle/plan.md` step 5 asks for `--category todo,backlog --sprint none`, so plan never offers it.
