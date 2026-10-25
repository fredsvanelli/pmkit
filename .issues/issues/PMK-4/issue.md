---
id: PMK-4
title: Record days off per sprint from the CLI
type: feature
status: in_progress
priority: medium
estimate: 2
assignee: fred
parent: EPC-1
milestone: local-gaps
branch: pmk-4-record-days-off-per-sprint-from-the-cli
created: 2026-10-25T19:13:19Z
updated: 2026-10-25T23:00:18Z
---

## Description

Sprint files have a `days_off` map, but `cycle capacity` cannot set it, so `/pmkit:cycle:plan` says "The CLI cannot record days off, so they feed only this calculation".

Source: MVP skills, plan-cycle ("capacity from member availability in config and days off entered for this sprint"); Technical spec, `SprintFile.days_off`.

## Acceptance criteria

- [ ] `cycle capacity <id>` reads and sets days off per member
- [ ] `/pmkit:cycle:plan` stores the days off it asks for
