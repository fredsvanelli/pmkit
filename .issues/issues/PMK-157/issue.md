---
id: PMK-157
title: Tidy how validate handles migrations and a skipped tracker
type: bug
status: backlog
priority: low
parent: EPC-1
related: [PMK-118, PMK-119]
milestone: local-gaps
created: 2026-10-28T00:11:39.206Z
updated: 2026-10-28T00:11:39Z
---

## Description

Found in PMK-118 and PMK-119. `validate` rethrows a `NOT_SUPPORTED` from `chain()`, and `setScalar` runs outside the `try` in `planMigration`. When `validate` skips the tracker it still prints `checked: 0 issues`.
