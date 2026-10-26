---
id: PMK-113
title: Keep the original of a split issue out of the closed sprint
type: bug
status: in_review
priority: medium
estimate: 2
assignee: fred
parent: EPC-1
related: [PMK-10]
milestone: local-gaps
branch: pmk-113-keep-the-original-of-a-split-issue-out
created: 2026-10-26T15:39:49.436Z
updated: 2026-10-26T17:40:07Z
---

## Description

Found in PMK-10. When `/pmkit:cycle:close` splits an unfinished issue, the new issue goes to the backlog, and the original keeps its status (often `in_progress`) in the sprint that just closed. `issues list --sprint none` does not return it, so `/pmkit:cycle:plan` never offers it again, and it stays in progress in a closed sprint.

`commands/cycle/close.md` step 7 now states this behavior. The fix decides what the original becomes after a split.

## Acceptance criteria

- [ ] After a split in `/pmkit:cycle:close`, the original issue no longer stays open in the closed sprint
- [ ] `/pmkit:cycle:plan` can offer the remaining work of a split issue
