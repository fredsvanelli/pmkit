---
id: PMK-1
title: Fix the README paths left from the monorepo layout
type: chore
status: in_progress
priority: high
estimate: 1
assignee: fred
parent: EPC-1
milestone: local-gaps
branch: pmk-1-fix-the-readme-paths-left-from-the
created: 2026-10-25T19:13:19Z
updated: 2026-10-25T20:04:18Z
---

## Description

Commit 5c39154 moved pmkit to its own repository, but the README still says `node pmkit/scripts/pmkit.mjs`, "Run it from `pmkit/`", `claude --plugin-dir pmkit`, and installs from the `fredsvanelli/skills` marketplace.

## Acceptance criteria

- [ ] CLI examples use `node scripts/pmkit.mjs`
- [ ] The Tests section runs `npm test` from the repository root
- [ ] Local development uses `claude --plugin-dir .`
- [ ] The install lines name a marketplace that lists pmkit
