---
id: PMK-232
title: Improve roadmap-review
type: feature
status: backlog
priority: low
estimate: 3
related: [PMK-66]
created: 2026-11-08T20:37:25.824Z
updated: 2026-11-08T20:53:52Z
---

## Description

### Context

Improvements suggested by the implementer and reviewers of PMK-66 (roadmap-review) during EPC-6, collected in `docs/superpowers/epc-6-follow-ups.md`. None of them is a defect. Source: PMK-66.

### Scope (in)

- Run the two reads per epic in parallel.
- Share the section, `OPEN` and unfiled helpers with `risks.mjs` and `render-data.mjs`, and parse each file once in `unreadableRecords`.
- Have the Local `listDeliverables` and `listMilestones` report their skipped files, instead of the side method `unreadableRecords`.
- Give the team fixture a milestone, so tests stop adding one by hand.

### Out of scope

- The defects found in the same reviews, which are their own bug issues.

## Acceptance criteria

- [ ] Run the two reads per epic in parallel
- [ ] Share the section, `OPEN` and unfiled helpers with `risks.mjs` and `render-data.mjs`, and parse each file once in `unreadableRecords`
- [ ] Have the Local `listDeliverables` and `listMilestones` report their skipped files, instead of the side method `unreadableRecords`
- [ ] Give the team fixture a milestone, so tests stop adding one by hand
