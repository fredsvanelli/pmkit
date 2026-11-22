---
id: PMK-157
title: Tidy how validate handles migrations and a skipped tracker
type: bug
status: in_progress
priority: low
assignee: fred
parent: EPC-1
related: [PMK-118, PMK-119]
milestone: local-gaps
branch: pmk-157-tidy-how-validate-handles-migrations-and
created: 2026-10-28T00:11:39.206Z
updated: 2026-11-22T04:12:34Z
---

## Description

Found in PMK-118 and PMK-119. `validate` rethrows a `NOT_SUPPORTED` from `chain()`, and `setScalar` runs outside the `try` in `planMigration`. When `validate` skips the tracker it still prints `checked: 0 issues`.

## Acceptance criteria

- [ ] `validate` lists a missing migration (the `NOT_SUPPORTED` of `chain()`) as a `migration` problem and exits 0
- [ ] A failing version bump in `planMigration` is the same `migration ... failed` problem as a failing step
- [ ] When `validate` skips the tracker files it says so and why, in the text and the JSON, instead of `checked: 0 issues`
