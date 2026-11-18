---
id: PMK-341
title: Name the Discussions permission in the fine-grained PAT hint
type: bug
status: in_review
priority: low
assignee: fred
parent: EPC-8
milestone: github-issues
branch: pmk-341-name-the-discussions-permission-in-the
created: 2026-11-17T22:21:23.265Z
updated: 2026-11-18T01:51:42Z
---

## Description

Found while working PMK-90 (PR #313). A fine-grained PAT without the Discussions permission gets the client's AUTH hint about Projects and Issues (ADR 0007, PMK-85). For a discussions call, the hint should name Discussions.

## Acceptance criteria

- [x] A discussions call refused for a fine-grained PAT gives a next step that names the Discussions permission
