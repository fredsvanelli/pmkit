---
id: PMK-194
title: Fix docs next-adr for a tracker outside the repo and odd file names
type: bug
status: backlog
priority: medium
estimate: 1
related: [PMK-65]
created: 2026-10-31T19:29:36.272Z
updated: 2026-10-31T19:29:36Z
---

## Description

### Context

`docs next-adr` and `/pmkit:spec:record-decision` (PMK-65) merged with these defects, found by the second and third reviews of PR #103. Source: PMK-65, PR #103.

### Scope (in)

- `scripts/lib/adr.mjs:66`: with the tracker folder outside the repository, the `path` written into the issue comments is an absolute path of this machine, which is useless to the rest of the team.
- `scripts/lib/adr.mjs:10`: a note named `20261031.md` in `docs/adr/` counts as ADR 20261031, so the next ADR is `20261032-<slug>.md`.
- With `tracker.path: .`, the same folder is counted twice and a false "also has ADRs" note shows.
- A title in Cyrillic or CJK is refused with "has no letter or digit", and `ß`, `æ` and `ø` become hyphens.

### Out of scope

- The improvements listed in `docs/superpowers/epc-6-follow-ups.md`.

## Acceptance criteria

- [ ] The comment path is relative to the repository or to the tracker, never absolute
- [ ] Only names of the form `NNNN-` count as ADR numbers
- [ ] The slug and its error message handle non-Latin titles
