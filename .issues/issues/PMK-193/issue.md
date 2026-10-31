---
id: PMK-193
title: Fix the edges of the log-time duration parser
type: bug
status: backlog
priority: low
estimate: 1
related: [PMK-60]
created: 2026-10-31T19:29:36.074Z
updated: 2026-10-31T19:29:36Z
---

## Description

### Context

`/pmkit:issues:log-time` and the duration parser (PMK-60) merged with these defects, found by the second review of PR #102. Source: PMK-60, PR #102.

### Scope (in)

- `scripts/lib/duration.mjs:22`: values above 2^53 lose precision. `99999999999999999999999` becomes `1e+23`, with a note nobody can read. `Number.isSafeInteger` fixes it.
- `scripts/lib/duration.mjs:27`: `hoursText` writes `1666h40` for 100000 minutes.
- `scripts/pmkit.mjs:586`: on a direct call without `--dry-run`, the "more than a day" note is printed after the write, saying "check the time before you confirm".
- The PMK-60 summary comment still says "up to 24 hours".

### Out of scope

- The improvements listed in `docs/superpowers/epc-6-follow-ups.md`.

## Acceptance criteria

- [ ] A duration that is not a safe integer number of minutes answers `INVALID_INPUT`
- [ ] The readable form of a long duration uses days
- [ ] The more-than-a-day note on a real write says the time was already logged
