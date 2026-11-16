---
id: PMK-218
title: Improve unblock-pr
type: feature
status: done
priority: medium
estimate: 5
assignee: fred
related: [PMK-62]
branch: pmk-218-improve-unblock-pr
created: 2026-11-08T20:37:23.866Z
updated: 2026-11-10T02:11:05Z
---

## Description

### Context

Improvements suggested by the implementer and reviewers of PMK-62 (unblock-pr) during EPC-6, collected in `docs/superpowers/epc-6-follow-ups.md`. None of them is a defect. Source: PMK-62.

### Scope (in)

- Read repository rulesets (`rules/branches`) as well as classic branch protection.
- Page past the first 100 review threads.
- Show the blockers in `pr status` and `/pmkit:issues:mine`.
- Read the pull request once instead of three `gh pr view` calls, and stop downloading thread bodies that nothing reads.

### Out of scope

- The defects found in the same reviews, which are their own bug issues.

## Acceptance criteria

- [x] Read repository rulesets (`rules/branches`) as well as classic branch protection
- [x] Page past the first 100 review threads
- [x] Show the blockers in `pr status` and `/pmkit:issues:mine`
- [x] Read the pull request once instead of three `gh pr view` calls, and stop downloading thread bodies that nothing reads
