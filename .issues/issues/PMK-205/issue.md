---
id: PMK-205
title: Fix the Linear and error paths of release readiness
type: bug
status: done
priority: medium
estimate: 3
assignee: fred
related: [PMK-69]
branch: pmk-205-fix-the-linear-and-error-paths-of
created: 2026-11-08T03:15:27.300Z
updated: 2026-11-09T23:43:59Z
---

## Description

### Context

Found by the reviews of PR #115 (PMK-69) and left as non-blocking. Source: PMK-69, PR #115.

### Scope (in)

- `scripts/pmkit.mjs:1923`: on Linear with releases on, the command calls the `listReleases` stub and fails even with `--sprint` or `--milestone`.
- `scripts/pmkit.mjs:1897` and `:1919`: a `RATE_LIMITED` or `UPSTREAM` error from `currentCycle` or `listMilestones` aborts `--release` and `--sprint`.
- `--sprint current` with cycles absent gives a misleading `INVALID_INPUT`.
- `scripts/lib/release-readiness.mjs:24`: an empty planned release is reported ready.
- `scripts/pmkit.mjs:1968`: only the 20 newest deploys are read, so the deploy of the release's tag can be missed.
- `scripts/lib/release-readiness.mjs:61`: a deploy ref matches only the exact tag, not `refs/tags/<tag>`.

### Out of scope

- The improvements listed in `docs/superpowers/epc-6-follow-ups.md`.

## Acceptance criteria

- [x] `--sprint` and `--milestone` work on Linear with releases on
- [x] A transient read error marks the result incomplete instead of aborting
- [x] An empty planned release is not reported ready
- [x] The release's deploy is found when it is older than the 20 newest, and through a `refs/tags/` ref
