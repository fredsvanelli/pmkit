---
id: PMK-61
title: Add the review-pr-against-issue command
type: feature
status: done
priority: medium
estimate: 3
assignee: fred
parent: EPC-6
milestone: generic-commands
branch: pmk-61-add-the-review-pr-against-issue-command
created: 2026-10-25T19:13:22Z
updated: 2026-10-30T23:09:54Z
---

## Description

Source: Unified model, Dev catalog (`review-pr-against-issue`: "Compares the diff with acceptance criteria"; degradation "Reads the local diff"); Linear tab ("flags gaps"; "Optional: comments").

## Acceptance criteria

- [x] Compares the pull request diff with each acceptance criterion and flags the gaps
- [x] Without a pull request it reads the local diff
- [x] Optionally comments the result after confirmation
