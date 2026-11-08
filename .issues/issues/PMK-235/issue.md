---
id: PMK-235
title: Improve release-readiness
type: feature
status: backlog
priority: low
estimate: 5
related: [PMK-69]
created: 2026-11-08T20:37:26.237Z
updated: 2026-11-08T20:53:53Z
---

## Description

### Context

Improvements suggested by the implementer and reviewers of PMK-69 (release-readiness) during EPC-6, collected in `docs/superpowers/epc-6-follow-ups.md`. None of them is a defect. Source: PMK-69.

### Scope (in)

- Tie deploys to a release by tag or SHA range.
- A milestone filter in `searchIssues`.
- Skip the basis lists (`currentCycle`, `listMilestones`, `listReleases`) when a selector is given.
- Run the `gh` deploy calls in parallel.
- Share `OPEN`, the host block and the section helper with `risks`, and reuse `sortMilestones`.

### Out of scope

- The defects found in the same reviews, which are their own bug issues.

## Acceptance criteria

- [ ] Tie deploys to a release by tag or SHA range
- [ ] A milestone filter in `searchIssues`
- [ ] Skip the basis lists (`currentCycle`, `listMilestones`, `listReleases`) when a selector is given
- [ ] Run the `gh` deploy calls in parallel
- [ ] Share `OPEN`, the host block and the section helper with `risks`, and reuse `sortMilestones`
