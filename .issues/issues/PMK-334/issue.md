---
id: PMK-334
title: "Consider GitHub's native issue status once it leaves preview"
type: task
status: backlog
priority: low
related: [PMK-84]
created: 2026-11-16T18:00:06.044Z
updated: 2026-11-16T18:00:06Z
---

## Description

Found while working PMK-84 (ADR 0007). GitHub's native issue status (`setIssueStatus`, `PlanningStatus`) is in preview and missing from every GHES schema, so the adapter reads the status from the Project's Status field. Once the native status is generally available, decide whether the adapter uses it, for example for repositories without a Project.

## Acceptance criteria

- [ ] An ADR records whether the adapter uses GitHub's native issue status
