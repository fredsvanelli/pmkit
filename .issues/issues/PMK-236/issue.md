---
id: PMK-236
title: Improve inbox-digest
type: feature
status: backlog
priority: medium
estimate: 5
blocked_by: [PMK-225]
related: [PMK-55]
created: 2026-11-08T20:37:26.382Z
updated: 2026-11-08T20:53:53Z
---

## Description

### Context

Improvements suggested by the implementer and reviewers of PMK-55 (inbox-digest) during EPC-6, collected in `docs/superpowers/epc-6-follow-ups.md`. None of them is a defect. Source: PMK-55.

### Scope (in)

- A map from members to GitHub logins, or a `gh api user` read, so review requests match without `login=`.
- `--all` and status-change items in the digest.
- Use the Linear notifications read from PMK-225 instead of deriving the list.
- Use the review-request count from PMK-225 instead of a full `pr blockers` per `in_review` issue.
- Scenarios for Linear, hidden items, a broken inbox file, `git_host: none` and `login=`.

### Out of scope

- The defects found in the same reviews, which are their own bug issues.

## Acceptance criteria

- [ ] A map from members to GitHub logins, or a `gh api user` read, so review requests match without `login=`
- [ ] `--all` and status-change items in the digest
- [ ] Use the Linear notifications read from PMK-225 instead of deriving the list
- [ ] Use the review-request count from PMK-225 instead of a full `pr blockers` per `in_review` issue
- [ ] Scenarios for Linear, hidden items, a broken inbox file, `git_host: none` and `login=`
