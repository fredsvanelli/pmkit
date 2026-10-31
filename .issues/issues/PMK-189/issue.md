---
id: PMK-189
title: Fix team capacity on hand-edited days off and the days-off error
type: bug
status: backlog
priority: medium
estimate: 1
related: [PMK-72]
created: 2026-10-31T16:59:11.253Z
updated: 2026-10-31T16:59:11Z
---

## Description

### Context

`team capacity` (PMK-72) merged with these defects, found by the reviews of PRs #98 and #97. Source: PMK-72, PR #98.

### Scope (in)

- `scripts/lib/team-capacity.mjs:29`: `workingDays` subtracts `daysOff.length` without checking that each date is a working day inside the sprint and is not repeated. Only a hand edit of `.pmkit/capacity.yaml` reaches it.
- `--days-off` with bad syntax fails as a usage error from `parseDaysOff`, while `commands/team/capacity.md` says it answers `INVALID_INPUT`.

### Out of scope

- The improvements listed in `docs/superpowers/epc-6-follow-ups.md`.

## Acceptance criteria

- [ ] `workingDays` counts only distinct working days inside the sprint
- [ ] A bad `--days-off` answers what the command file says, or the command file says what it answers
