---
id: PMK-272
title: Pin the one-second unarchive history limit with a test
type: chore
status: backlog
priority: low
estimate: 1
parent: EPC-6
created: 2026-11-12T00:43:33.227Z
updated: 2026-11-12T00:43:33Z
---

## Description

### Context

PMK-267 hides a one-second archive and unarchive run that a merge repeats whole. A real run of two equal halves in one second also reads as a merge copy, so four real changes show as two in the history; the final state is the same. The code marks this with a `ponytail:` comment, but no test fixes it. Source: PMK-267, PR #219.

### Scope (in)

- A test that records the limit: a real archive, unarchive, archive, unarchive in one second, without a merge, shows two events in `issues get --history` and leaves the issue unarchived (`scripts/lib/local/events.mjs:58`).
- A test that the Local tracker still refuses `issues bulk unarchive --limit` with a usage error, since PMK-267 moved the Linear check before the flag check.

### Out of scope

- Sub-second timestamps in events.

### Tasks

- [ ] Test the one-second limit
- [ ] Test the Local usage error for bulk unarchive

## Acceptance criteria

- [ ] A test fixes that four real flips in one second show as two events and leave the right final state
- [ ] A test fixes that `issues bulk unarchive --limit` on the Local tracker answers `INVALID_INPUT`
