---
id: PMK-225
title: Improve user inbox
type: feature
status: done
priority: medium
estimate: 5
assignee: fred
related: [PMK-47]
branch: pmk-225-improve-user-inbox
created: 2026-11-08T20:37:24.875Z
updated: 2026-11-10T02:11:05Z
---

## Description

### Context

Improvements suggested by the implementer and reviewers of PMK-47 (user inbox) during EPC-6, collected in `docs/superpowers/epc-6-follow-ups.md`. None of them is a defect. Source: PMK-47.

### Scope (in)

- Key the inbox check by git remote instead of checkout path, so two worktrees of one repository share it.
- Read Linear `Notification` objects, so the Linear adapter can serve `user_inbox`.
- Count review requests and status changes in `inbox list`, so `/pmkit:issues:inbox-digest` needs fewer `gh` calls (PMK-236).
- Show the mention text and whether an item was seen in the text table.
- Lock the user store file on write, so two `mark-read` calls at once cannot drop each other's check.

### Out of scope

- The defects found in the same reviews, which are their own bug issues.

## Acceptance criteria

- [x] Key the inbox check by git remote instead of checkout path, so two worktrees of one repository share it
- [x] Read Linear `Notification` objects, so the Linear adapter can serve `user_inbox`
- [x] Count review requests and status changes in `inbox list`, so `/pmkit:issues:inbox-digest` needs fewer `gh` calls (PMK-236)
- [x] Show the mention text and whether an item was seen in the text table
- [x] Lock the user store file on write, so two `mark-read` calls at once cannot drop each other's check
