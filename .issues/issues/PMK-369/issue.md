---
id: PMK-369
title: Start a planned sprint created outside pmkit (startCycle)
type: feature
status: backlog
priority: low
parent: EPC-14
milestone: jira
created: 2026-11-23T01:33:05.590Z
updated: 2026-11-23T01:33:05Z
---

## Description

Source: PMK-78 Interview Q1 (docs/superpowers/specs/2026-11-22-pmk-78-jira-sprints-design.md). A future sprint created in Jira's backlog view, not by pmkit cycle open, cannot be started from pmkit: the contract has openCycle and closeCycle but no start operation. Add startCycle(id, actor) to the contract, implement it on Jira (POST /rest/agile/1.0/sprint/{id} state active) and on Local (planned to active), and refuse it on Linear and GitHub.

## Acceptance criteria

- [ ] startCycle is a contract operation with a CLI command and a dry run
- [ ] Jira starts a dated future sprint; Local makes a planned sprint active; Linear and GitHub refuse with NOT_SUPPORTED
