---
id: PMK-343
title: "Unify the fake GitHub's models of non-issue Project items"
type: chore
status: in_review
priority: low
assignee: fred
parent: EPC-8
milestone: github-issues
branch: pmk-343-unify-the-fake-github-s-models-of-non
created: 2026-11-18T00:15:22.751Z
updated: 2026-11-18T02:07:29Z
---

## Description

Found while working PMK-88 (PR #318) and PMK-91 (PR #317). The fake GitHub models non-issue Project items twice: PMK-88's `item.kind` and PMK-91's `item.draft`. `PmkitEpicItems` reads only `kind`, so a PMK-91 draft in an epic Project would break that fake reply, and a test could pass against a fake that real GitHub would answer differently.

## Acceptance criteria

- [x] The fake GitHub has one model of Project item content (issue, pull request, draft issue)
- [x] A test puts a draft issue in an epic Project and reads the epic
