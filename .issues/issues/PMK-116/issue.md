---
id: PMK-116
title: Say there is no active sprint in issues list --sprint current
type: bug
status: backlog
priority: low
parent: EPC-1
related: [PMK-114]
milestone: local-gaps
created: 2026-10-26T17:58:03.226Z
updated: 2026-10-26T17:58:03Z
---

## Description

Found in PMK-114. `issues list --sprint current` with no active sprint returns an empty list and says nothing, while `issues create` and `issues update` now fail with "there is no active sprint". Tell the user why the list is empty.
