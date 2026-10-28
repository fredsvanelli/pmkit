---
id: PMK-161
title: Handle nested splits in one cycle close
type: task
status: backlog
priority: low
parent: EPC-1
related: [PMK-123]
milestone: local-gaps
created: 2026-10-28T00:11:40.126Z
updated: 2026-10-28T00:11:40Z
---

## Description

Found in PMK-123. When a carried blocker or sub-issue is itself split in the same `/pmkit:cycle:close`, step 7 only warns in the preview and says what the new issue ends up pointing to. Decide a write order or a rule so the remaining work and the blockers point to the right issues.
