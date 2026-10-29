---
id: PMK-167
title: Create milestones and documents on Linear
type: feature
status: backlog
priority: medium
estimate: 5
related: [PMK-38]
created: 2026-10-29T02:47:04.146Z
updated: 2026-10-29T02:47:09Z
---

## Description

The Linear adapter reads projects as epics but cannot create milestones or documents. `pmkit milestone create` and `pmkit docs create` on Linear refuse with "does not create them" (see scripts/lib/linear/degraded-live.mjs:53 and :58). PMK-38 left both out of scope.

Add both writes to the Linear adapter. A pmkit milestone becomes a Linear project milestone, and a pmkit doc becomes a Linear document attached to a project. Both go through the existing client, the write guard and the `--dry-run` preview, and both report their capability in the manifest. Update the degraded-path table so the two rows stop refusing.

## Acceptance criteria

- [ ] `milestone create` on Linear creates a project milestone and prints the same record as Local
- [ ] `docs create` on Linear creates a Linear document and prints the same record as Local
- [ ] Both commands support `--dry-run` and send no request when it is set
- [ ] The manifest reports both capabilities as native and the degraded-path table no longer lists them as refused
- [ ] Tests cover both writes with the fake Linear client
