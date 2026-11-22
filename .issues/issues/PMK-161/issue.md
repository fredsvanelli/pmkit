---
id: PMK-161
title: Handle nested splits in one cycle close
type: task
status: in_review
priority: low
assignee: fred
parent: EPC-1
related: [PMK-123]
milestone: local-gaps
branch: pmk-161-handle-nested-splits-in-one-cycle-close
created: 2026-10-28T00:11:40.126Z
updated: 2026-11-22T05:52:22Z
---

## Description

Found in PMK-123. When a carried blocker or sub-issue is itself split in the same `/pmkit:cycle:close`, step 7 only warns in the preview and says what the new issue ends up pointing to. Decide a write order or a rule so the remaining work and the blockers point to the right issues.

## Acceptance criteria

- [x] `/pmkit:cycle:close` has a rule for a carried blocker or sub-issue that is split in the same close: the new issue is blocked by the blocker's remaining work, and the sub-issue's remaining work moves under the new issue
- [x] Step 8 runs every split's create before the links, so each link can name any new issue of the close
- [x] A cycle-close scenario runs nested splits and the remaining work and blockers point to the right issues
