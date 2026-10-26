---
id: PMK-111
title: Tests leave temp directories behind
type: chore
status: in_progress
priority: medium
estimate: 2
assignee: fred
parent: EPC-1
related: [PMK-3]
milestone: local-gaps
branch: pmk-111-tests-leave-temp-directories-behind
created: 2026-10-25T21:50:16.603Z
updated: 2026-10-26T15:40:44Z
---

## Description

The test helpers create `pmkit-*` directories in the system temp folder with `mkdtempSync` (11 test files) and most never remove them. During PMK-3, `/tmp` ran out of inodes after about 29,000 leftover directories, and the whole suite failed with unrelated errors until they were deleted. About 680 came back within a few runs.

Found while working on PMK-3.

## Acceptance criteria

- [ ] Every test that makes a temp directory removes it when the test ends, pass or fail
- [ ] `npm test` leaves no `pmkit-*` directory in the temp folder
