---
id: PMK-343
title: "Unify the fake GitHub's models of non-issue Project items"
type: chore
status: backlog
priority: low
parent: EPC-8
milestone: github-issues
created: 2026-11-18T00:15:22.751Z
updated: 2026-11-18T00:15:22Z
---

## Description

Found while working PMK-88 (PR #318) and PMK-91 (PR #317). The fake GitHub models non-issue Project items twice: PMK-88's `item.kind` and PMK-91's `item.draft`. `PmkitEpicItems` reads only `kind`, so a PMK-91 draft in an epic Project would break that fake reply, and a test could pass against a fake that real GitHub would answer differently.

## Acceptance criteria

- [ ] The fake GitHub has one model of Project item content (issue, pull request, draft issue)
- [ ] A test puts a draft issue in an epic Project and reads the epic
