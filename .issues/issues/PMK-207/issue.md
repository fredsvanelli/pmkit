---
id: PMK-207
title: Fix the dry-run and customer paths of the request queue
type: bug
status: in_review
priority: medium
estimate: 2
assignee: fred
related: [PMK-70]
branch: pmk-207-fix-the-dry-run-and-customer-paths-of
created: 2026-11-08T04:05:51.296Z
updated: 2026-11-09T23:54:10Z
---

## Description

### Context

Found by the reviews of PR #119 (PMK-70) and left as non-blocking. Source: PMK-70, PR #119.

### Scope (in)

- `commands/backlog/request-queue.md:24` (step 5.1) has no rule for a failed `issues create` dry run.
- `commands/backlog/request-queue.md:22` drops the customer ID when the customer has no file and the request has no `from`, so the new issue says nothing about who asked.
- `scripts/__scenarios__/backlog-request-queue.mjs:60-79`: the Linear scenario stops at `AUTH`, so no scenario reaches the branch that suggests triage when there is no request queue (acceptance criterion 2 of PMK-70).

### Out of scope

- The improvements listed in `docs/superpowers/epc-6-follow-ups.md`.

## Acceptance criteria

- [x] A failed create dry run stops that request and says why
- [x] A request whose customer has no file keeps the customer ID in the new issue
- [x] A scenario reaches the triage suggestion without a request queue
