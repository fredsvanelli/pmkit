---
id: PMK-186
title: Keep the CLI from writing a cache into the test fixtures
type: bug
status: backlog
priority: medium
estimate: 1
related: [PMK-71]
created: 2026-10-31T16:01:22.796Z
updated: 2026-10-31T16:01:23Z
---

## Description

### Context

Found while implementing PMK-71 and reviewing PMK-61. Source: PMK-71, PR #92.

### Scope (in)

- Running `node scripts/pmkit.mjs` inside `scripts/__fixtures__/*` creates `.issues/.cache`, which breaks 7 tests of `reindex` and `pr open`. Agents ran into it twice during EPC-6.
- The comment at `scripts/scenarios-live.mjs:5` gives the number of live runs and entries, and it has been wrong for several PRs (the review of PR #85 counted 46 entries when the comment said 38).

### Out of scope

- The improvements listed in `docs/superpowers/epc-6-follow-ups.md`.

## Acceptance criteria

- [ ] A cache inside `scripts/__fixtures__/` is ignored by git and does not break the suite, or the CLI refuses to write it there
- [ ] The `scenarios-live.mjs` counts come from the list itself or a test checks them
