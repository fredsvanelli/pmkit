---
id: PMK-119
title: List tracker.system linear as a problem in validate
type: bug
status: in_progress
priority: low
estimate: 1
assignee: fred
parent: EPC-1
related: [PMK-112]
milestone: local-gaps
branch: pmk-119-list-tracker-system-linear-as-a-problem
created: 2026-10-26T17:58:03.483Z
updated: 2026-10-26T19:17:43Z
---

## Description

Found in PMK-112. With `tracker.system: linear` and no other bad key, `validate` throws `NOT_SUPPORTED` instead of listing a problem at `.pmkit/config.yaml`. With another bad key it lists the problems. Make both cases list.

## Acceptance criteria

- [ ] With `tracker.system: linear` and no other bad key in `.pmkit/config.yaml`, `validate` lists a problem at `.pmkit/config.yaml` that names the unsupported tracker, instead of failing with `NOT_SUPPORTED`
- [ ] With `tracker.system: linear` and another bad key, `validate` lists both problems
- [ ] In both cases the exit code and the output shape are the same as for any other problem `validate` lists
- [ ] Tests cover both cases, and `npm test` passes
