---
id: PMK-120
title: Check .pmkit/config.yaml in loadConfig for every command
type: task
status: backlog
priority: medium
parent: EPC-1
related: [PMK-112]
milestone: local-gaps
created: 2026-10-26T17:58:03.560Z
updated: 2026-10-26T17:58:03Z
---

## Description

Found in PMK-112, approach C of its spec. `loadConfig` calls `validatePmkitConfig`, so every command refuses an invalid `.pmkit/config.yaml`, not only `validate` and `init`. This changes every command, so it needs its own decision.
