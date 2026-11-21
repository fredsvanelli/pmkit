---
id: PMK-350
title: Read Status change events from GHES 3.20
type: feature
status: in_progress
priority: low
estimate: 2
assignee: fred
parent: EPC-8
related: [PMK-335]
branch: pmk-350-read-status-change-events-from-ghes-3-20
created: 2026-11-20T22:03:02.155Z
updated: 2026-11-21T20:13:09Z
---

## Description

### Context

Found while working PMK-335 (PR #327). The schema validation showed that the published GHES 3.20 schema already has `ProjectV2ItemStatusChangedEvent`, but `hostFeatures` turns Status events on only from GHES 3.21. On GHES 3.20 pmkit therefore misses Status change history that the host can return.

### Scope (in)

- Turn on Status change events for GHES 3.20
- Validate the documents that read the events against the GHES 3.20 schema
- Record the new threshold in ADR 0007

### Out of scope

- Issue fields on GHES, which stay at 3.22
- GHES 3.19, whose schema has no Status change events

### Tasks

- [ ] Read Status change events on GHES 3.20
- [ ] Teach the fake GitHub to refuse the events before 3.20
- [ ] Amend ADR 0007 with the 3.20 threshold

## Acceptance criteria

- [ ] On a GHES 3.20 host, the history and flow metrics read Status change events
- [ ] On GHES 3.19 the fake GitHub still refuses the Status change event document, and pmkit does not send it
- [ ] Every document pmkit sends to GHES 3.20 validates against the published 3.20 schema
