---
id: PMK-156
title: Guide setup and doctor through a failing migration
type: bug
status: done
priority: medium
assignee: fred
parent: EPC-1
related: [PMK-118, PMK-119, PMK-360]
milestone: local-gaps
branch: pmk-156-guide-setup-and-doctor-through-a-failing
created: 2026-10-28T00:11:38.981Z
updated: 2026-11-22T05:53:36Z
---

## Description

Found in PMK-118 and PMK-119. `/pmkit:local:doctor` has no branch for a migration failure, and `/pmkit:setup` step 2 should handle it by its error code before the first migration that can fail. The setup step 2 sentence about `init --update` refusing needs rewording. The doctor advice "set it to local" can leave `.issues/` missing, so the next command answers `NOT_CONFIGURED`.

## Acceptance criteria

- [x] `/pmkit:local:doctor` has a branch for `migration` problems: a missing migration sends the user to `/pmkit:upgrade`, a failing step shows its reason, and the CLI fixes wait until it is settled
- [x] `/pmkit:setup` step 2 handles the problems by code, and says which ones make `init --update` refuse
- [x] The doctor advice for an unsupported `tracker.system` never leaves the repository without a tracker folder
