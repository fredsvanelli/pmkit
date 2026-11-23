---
id: PMK-382
title: Read every scenario of a Jira plan when Jira publishes a scenarios API
type: chore
status: backlog
priority: low
parent: EPC-14
related: [PMK-82]
milestone: jira
created: 2026-11-23T16:11:26.918Z
updated: 2026-11-23T16:11:39Z
---

## Description

Source: PMK-82 interview, Q1. Jira's public REST API exposes only each plan's default scenario id (scenarioId in the plan list), so jira plans get shows the default scenario and says other scenarios are not readable. pmkit uses no private /rest/jpo endpoints. Revisit when Atlassian publishes a scenarios API.

## Acceptance criteria

- [ ] Atlassian's Jira Cloud REST API v3 is checked for a public endpoint that lists or reads a plan's scenarios
- [ ] When one exists, jira plans get lists every scenario of the plan, the default one marked; when none exists, the issue records the date checked
