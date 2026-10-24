---
id: ISS-7K3Q
title: Retry failed webhook deliveries
type: bug
status: done
priority: high
estimate: 3
assignee: fred
labels: [backend, webhooks]
parent: EPC-2M9D
sprint: 2026-09-28
due: 2026-10-09
created: 2026-09-26T10:00:00Z
updated: 2026-10-06T16:00:00Z
---

## Description

Deliveries that fail with 5xx are dropped instead of retried.

## Acceptance criteria

- [ ] Retries with exponential backoff, max 5 attempts
- [x] Dead-letter after the last attempt
