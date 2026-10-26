---
id: PMK-117
title: Show --sprint current in the pmkit design spec
type: task
status: in_review
priority: low
estimate: 1
assignee: fred
parent: EPC-1
related: [PMK-114]
milestone: local-gaps
branch: pmk-117-show-sprint-current-in-the-pmkit-design
created: 2026-10-26T17:58:03.307Z
updated: 2026-10-26T18:28:40Z
---

## Description

Found in PMK-114. `docs/superpowers/specs/2026-10-23-pmkit-design.md` still shows `[--sprint]` for `issues create` and `issues update`. The CLI usage now says `[--sprint id|current|none]`.

## Acceptance criteria

- [ ] The `issues create` row in `docs/superpowers/specs/2026-10-23-pmkit-design.md` shows `[--sprint id|current|none]`, the same text as the `issues create` usage in `scripts/pmkit.mjs`
- [ ] The `issues update` row in the same spec shows `[--sprint id|current|none]`, the same text as the `issues update` usage in `scripts/pmkit.mjs`
- [ ] `grep -F '[--sprint]' docs/superpowers/specs/2026-10-23-pmkit-design.md` finds nothing, and `npm test` passes
