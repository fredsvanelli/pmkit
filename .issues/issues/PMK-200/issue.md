---
id: PMK-200
title: Give view errors a stable reason instead of matching message text
type: bug
status: backlog
priority: low
estimate: 1
related: [PMK-54]
created: 2026-10-31T20:35:31.425Z
updated: 2026-10-31T20:35:31Z
---

## Description

### Context

Found by the second review of PR #107 (PMK-54). Source: PMK-54, PR #107.

### Scope (in)

- `commands/issues/run-view.md` step 4 tells an invalid name, an out-of-date view and a broken file apart by the text of `error.message`, because all three are `INVALID_INPUT`. Rewording one message breaks the command and no test fails.
- The step-4 error branches and the Linear branch have no scenario.

### Out of scope

- The improvements listed in `docs/superpowers/epc-6-follow-ups.md`.

## Acceptance criteria

- [ ] `PmkitError` carries a stable `details.reason` for each view error, and the command reads it
- [ ] Each branch of step 4 has a scenario
