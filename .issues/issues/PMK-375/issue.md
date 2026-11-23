---
id: PMK-375
title: "Show the epic's health in a dry-run move out of done on Jira"
type: task
status: backlog
priority: low
parent: EPC-14
related: [PMK-79]
milestone: jira
created: 2026-11-23T05:13:15.818Z
updated: 2026-11-23T05:13:22Z
---

## Description

Source: PMK-79 review (PR #385). moveDeliverable in scripts/lib/jira/epic-ops.mjs builds the dry-run after from before, which has no health when the epic is done or canceled, so a dry run from done back to an open category shows no health while the real run restores the latest status update's health.

## Acceptance criteria

- [ ] A dry-run epic move from done to an open category shows the latest status update's health, as the real run does
