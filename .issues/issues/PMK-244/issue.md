---
id: PMK-244
title: Give the deep text chain test a stack margin
type: task
status: backlog
priority: low
related: [PMK-201]
created: 2026-11-08T22:28:25.830Z
updated: 2026-11-08T22:28:25Z
---

## Description

### Context

Found in the review of PR #123 (PMK-201). `scripts/cli.test.mjs:1491` prints a 3000-deep chain in text mode. `dependencyText` (`scripts/lib/format.mjs:168`) recurses, so the test fails at `--stack-size` 700 or less (Node 22.22 default is about 984). Source: PMK-201.

### Scope (in)

- Lower the depth, or pick it from a measured margin, so the test passes on smaller stacks and still proves a deep chain prints.

## Acceptance criteria

- [ ] The text depth test passes with --stack-size=500
- [ ] The test still prints a chain deeper than the old 3000-deep JSON overflow point
