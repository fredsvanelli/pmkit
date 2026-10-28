---
id: PMK-34
title: Ask for the mappings a hosted tracker cannot infer
type: feature
status: in_progress
priority: medium
estimate: 5
assignee: fred
parent: EPC-5
blocked_by: [PMK-33]
milestone: linear
branch: pmk-34-ask-for-the-mappings-a-hosted-tracker
created: 2026-10-25T19:13:21Z
updated: 2026-10-28T01:55:14Z
---

## Description

Source: Unified model, Q6 decision C.

## Acceptance criteria

- [ ] Setup applies unambiguous mappings by itself: native state categories, single-candidate fields, tier, plan and version, the default scope when the user is in one team
- [ ] Setup always asks which status means in review and blocked, the estimate field when there are several candidates, and the default scope when the user is in several teams
- [ ] One summary is approved at the end, and the mappings go to `.pmkit/config.yaml`
- [ ] When a mapped status or field disappears, the command stops and asks
