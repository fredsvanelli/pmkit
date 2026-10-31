---
id: PMK-191
title: Make the ctime test of query-index stable
type: bug
status: backlog
priority: low
estimate: 1
related: [PMK-52]
created: 2026-10-31T16:59:11.658Z
updated: 2026-10-31T16:59:11Z
---

## Description

### Context

A timing-sensitive test in `scripts/query-index.test.mjs` (it depends on file ctime) failed twice during the rebases of PR #99 and passed on the next run each time. Source: PMK-52, PR #99.

### Scope (in)

- The test fails now and then under a full parallel run and passes alone.

### Out of scope

- The improvements listed in `docs/superpowers/epc-6-follow-ups.md`.

## Acceptance criteria

- [ ] The test passes 20 full runs in a row, or it no longer depends on the clock
