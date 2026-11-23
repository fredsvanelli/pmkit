---
id: PMK-385
title: Read Jira Product Discovery insights through polarisInsights when a live site allows it
type: feature
status: backlog
priority: low
parent: EPC-14
related: [PMK-83]
milestone: jira
created: 2026-11-23T18:14:42.334Z
updated: 2026-11-23T18:14:46Z
---

## Description

Source: PMK-83 Interview Q1. Jira's REST API does not return JPD insights, so pmkit reports them as unread. Atlassian's experimental GraphQL query polarisInsights (header X-ExperimentalApi: polaris-v0) may read them.

## Acceptance criteria

- [ ] polarisInsights is called on a live site with JIRA_EMAIL and JIRA_API_TOKEN, through the site gateway, and the answer (works, refused, needs OAuth) is recorded
- [ ] If it works, an ADR decides whether the Jira client may call that one GraphQL path, beside ADR 0013
