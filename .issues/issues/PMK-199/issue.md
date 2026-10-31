---
id: PMK-199
title: Fix track-agents on a broken comment and transient errors
type: bug
status: backlog
priority: medium
estimate: 1
related: [PMK-58]
created: 2026-10-31T20:35:31.270Z
updated: 2026-10-31T20:35:31Z
---

## Description

### Context

`issues track-agents` (PMK-58) merged with these defects, found by the second review of PR #110. Source: PMK-58, PR #110.

### Scope (in)

- `scripts/pmkit.mjs:1842`: a comment with broken frontmatter (for example a tab) stops the whole command with exit 2, because the `catch` rethrows `FrontmatterError`, which is not a `PmkitError`.
- `scripts/pmkit.mjs:1820`: the branch-protection cache also keeps transient errors, so one 502 turns every later PR of the same base into `unknown`.
- `scripts/pmkit.mjs:1872`: the text says "no open issue is assigned to an agent" even when the list is incomplete. With `blocked: true` the text hides `unknown` and `unchecked`.
- The incomplete-list warning is fixed text that names GitHub even when the only cause is an issue with conflict markers.

### Out of scope

- The improvements listed in `docs/superpowers/epc-6-follow-ups.md`.

## Acceptance criteria

- [ ] A broken comment marks its issue incomplete and the command goes on
- [ ] Only a successful protection read is cached
- [ ] The text of an incomplete or blocked list says what is unknown
