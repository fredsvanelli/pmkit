---
id: PMK-372
title: Publish Jira epic status updates to Atlassian Home
type: feature
status: backlog
priority: low
parent: EPC-14
milestone: jira
created: 2026-11-23T03:46:34.826Z
updated: 2026-11-23T03:46:34Z
---

## Description

Source: PMK-79 Interview Q1 (docs/superpowers/specs/2026-11-23-pmk-79-map-jira-epics-versions-status-updates-design.md). PMK-79 writes status updates as epic comments; Atlassian Home updates belong to Home projects linked to epics, through the Atlassian GraphQL gateway, and need a live site to build against.

## Acceptance criteria

- [ ] An epic linked to an Atlassian Home project publishes its status update to Home, and falls back to a comment otherwise
- [ ] listStatusUpdates reads Home updates for a linked epic
- [ ] Verified on a live Jira Cloud site with Home
