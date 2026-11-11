---
id: PMK-261
title: Create and mark releases on Linear
type: feature
status: backlog
priority: low
estimate: 5
parent: EPC-5
created: 2026-11-11T22:34:42.843Z
updated: 2026-11-11T22:34:42Z
---

## Description

### Context

PMK-246 lets pmkit read Linear releases and set an issue's release, but `issues create --release`, `release create` and `release mark-released` still answer `NOT_SUPPORTED` on Linear. Teams on Linear cannot create a release or ship one through pmkit, as they can on the Local tracker. Source: PMK-246, PR #208.

### Scope (in)

- `issues create --release` on Linear.
- `release create` on Linear, in a pipeline of the scope team.
- `release mark-released` on Linear.

### Out of scope

- Editing a release or undoing a mark (PMK-147 covers the Local tracker).
- Several releases per issue (its own issue).

### Tasks

- [ ] Set the release of a new Linear issue
- [ ] Create a Linear release
- [ ] Mark a Linear release as released

## Acceptance criteria

- [ ] `issues create --release <id>` on Linear creates the issue in that release, and `--dry-run` shows it
- [ ] `release create` on Linear creates a release in a pipeline of the scope team and prints the same record as the Local tracker
- [ ] `release mark-released` on Linear marks the release released and `release get` shows it as released
- [ ] Each of the three refuses with a clear message when releases are turned off in the workspace
