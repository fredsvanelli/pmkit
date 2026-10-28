---
id: PMK-156
title: Guide setup and doctor through a failing migration
type: bug
status: backlog
priority: medium
parent: EPC-1
related: [PMK-118, PMK-119]
milestone: local-gaps
created: 2026-10-28T00:11:38.981Z
updated: 2026-10-28T00:11:39Z
---

## Description

Found in PMK-118 and PMK-119. `/pmkit:local:doctor` has no branch for a migration failure, and `/pmkit:setup` step 2 should handle it by its error code before the first migration that can fail. The setup step 2 sentence about `init --update` refusing needs rewording. The doctor advice "set it to local" can leave `.issues/` missing, so the next command answers `NOT_CONFIGURED`.
