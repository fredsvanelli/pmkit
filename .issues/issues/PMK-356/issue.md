---
id: PMK-356
title: Verify Linear projectUpdate with statusId against a live workspace
type: feature
status: done
parent: EPC-6
related: [PMK-353]
branch: pmk-356-verify-linear-projectupdate-with
created: 2026-11-21T07:03:24.308Z
updated: 2026-11-22T02:55:24Z
---

## Description

### Context

PMK-353 moves a Linear epic with `projectUpdate(id, input: { statusId })` (`PROJECT_SET_STATUS` in `scripts/lib/linear/projects.mjs`). It has only run against `scripts/fake-linear-api.mjs`. The live contract run skips the `deliverable-writes` family because the live sandbox's write guard has no `projectUpdate` rule, and `scripts/lib/linear/API-VERIFICATION.md` records `statusId` on `ProjectCreateInput` only.

### Scope (in)

- A write-guard rule for `projectUpdate` on sandbox projects, `deliverable-writes` in the live family list, and a live run

### Out of scope

- Other Linear mutations

## Acceptance criteria

- [x] `scripts/lib/linear/API-VERIFICATION.md` records `projectUpdate` with `statusId` on `ProjectUpdateInput`, verified against a real workspace
- [x] The live sandbox write guard allows `projectUpdate` only on projects the sandbox created
- [x] The live Linear contract run includes the `deliverable-writes` family and passes
