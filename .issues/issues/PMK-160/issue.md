---
id: PMK-160
title: Let a cycle close rerun find and finish every half-done split
type: bug
status: backlog
priority: medium
parent: EPC-1
related: [PMK-121, PMK-123]
milestone: local-gaps
created: 2026-10-28T00:11:39.878Z
updated: 2026-10-28T00:11:40Z
---

## Description

Found in PMK-121 and PMK-123. When a split's create succeeds and its `related` link fails, a second run of `/pmkit:cycle:close` cannot find the new issue, because nothing marks it with its origin. When a split fails at the move to `done`, a second run may be refused because the original's estimate already dropped to the delivered part.
