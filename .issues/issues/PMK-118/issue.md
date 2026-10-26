---
id: PMK-118
title: Give the migration failure a source so validate lists it
type: bug
status: backlog
priority: medium
parent: EPC-1
related: [PMK-112]
milestone: local-gaps
created: 2026-10-26T17:58:03.406Z
updated: 2026-10-26T17:58:03Z
---

## Description

Found in PMK-112. The error thrown at `scripts/lib/local/migrations.mjs:85` ("migration X to Y failed") has no `details` and does not start with the tracker file label, so `validateRepo` rethrows it instead of listing it. Its message tells the user to run `pmkit validate`, which would throw the same error. Not reachable today, because the only built-in migration does nothing. Give the error `details`, or start its message with the tracker file label.
