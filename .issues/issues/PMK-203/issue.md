---
id: PMK-203
title: Fix the fallback and incomplete paths of goals overview
type: bug
status: in_progress
priority: medium
estimate: 2
assignee: fred
related: [PMK-67]
branch: pmk-203-fix-the-fallback-and-incomplete-paths-of
created: 2026-11-08T03:15:27.003Z
updated: 2026-11-09T22:22:17Z
---

## Description

### Context

Found by the second review of PR #116 (PMK-67) and left as non-blocking. Source: PMK-67, PR #116.

### Scope (in)

- `scripts/lib/local/tracker.mjs:1257` and `scripts/pmkit.mjs:1979`: with no goals, a broken `epic.md` marks the top-level path `complete: false` even though every issue was read. `goals list` now prints epic warnings, and the CHANGELOG does not say so.
- `scripts/pmkit.mjs:2001`: `searchIssues({})` drops archived issues, so the live children of an archived parent become top-level rows with `complete: true`, and the spec's archived-parent warning never fires.
- `scripts/pmkit.mjs:1981`: a stray file such as `notes.md` in `.issues/goals` blocks the fallback.
- `commands/report/initiatives-and-goals.md:36`: the "needs an epic" line still shows when `complete` is false.
- `scripts/lib/initiatives.mjs:19`: the children of an unparseable parent are split into separate rows.

### Out of scope

- The improvements listed in `docs/superpowers/epc-6-follow-ups.md`.

## Acceptance criteria

- [x] A broken epic file only marks the result incomplete when that epic is part of the answer
- [x] Children of an archived or unparseable parent are reported with a warning, not as top-level rows
- [x] A file in `.issues/goals` that is not a goal does not block the fallback
- [x] The command file says "needs an epic" only when the read was complete
