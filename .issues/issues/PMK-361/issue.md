---
id: PMK-361
title: Name the tracker in the release-notes cut-off warning
type: task
status: backlog
priority: low
parent: EPC-13
related: [PMK-377]
created: 2026-11-22T17:58:26.637Z
updated: 2026-11-23T05:13:16Z
---

## Description

### Context

Found in PMK-266 (PR #369). The release-notes cut-off warning is one constant, `NOTES_CUT` in `scripts/lib/release-notes.mjs`, and says "Linear has more issues than the 1000 pmkit read" whatever the tracker, GitHub included. PMK-266 kept the words because it changed no output.

### Scope (in)

- The warning names the tracker that cut the read and its own limit.

## Acceptance criteria

- [ ] On GitHub, the release-notes cut-off warning names GitHub and its limit
- [ ] On Linear, the words stay as they are
