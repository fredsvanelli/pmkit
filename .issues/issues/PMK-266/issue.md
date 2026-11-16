---
id: PMK-266
title: "Tidy the Linear release, docs and archive code"
type: chore
status: backlog
priority: low
estimate: 2
parent: EPC-5
created: 2026-11-11T22:34:43.213Z
updated: 2026-11-11T22:34:43Z
---

## Description

### Context

The reviews of PMK-246, PMK-250 and PMK-252 left small code and doc cleanups that change no behavior a user sees, except the first, which needs an incomplete config to happen. Source: PMK-246 (PR #208), PMK-250 (PR #205), PMK-252 (PR #211).

### Scope (in)

- `scripts/lib/linear/releases.mjs:44` does not check `tracker.scope.team`: without it, `release list` can list every team's releases. Refuse with `NOT_CONFIGURED` as `cycle-ops` does.
- The fake Linear API pages an issue's releases by 50 and `API-VERIFICATION.md` describes `releases(first: 50)` and about 4,300 points, while the code asks for 20 and costs about 4,650.
- `RELEASE_QUERY` is built with a `.replace` on the shared fields, which fails silently if the fields change.
- The cancelled-release rule lives in three places.
- The cut-off warning of release notes says "Linear" and a fixed 1000 in two copies.
- `docUrl` falls back to a branch without `origin/HEAD` when no branch is passed, and `--remove-doc` alone prints the default-branch note and calls git twice.
- `archive` is written twice, in the Local tracker and in the bulk builders.

### Out of scope

- Any change to what a command shows.

### Tasks

- [ ] Refuse release reads without a scope team
- [ ] Make the fake and the verification notes match the release query
- [ ] Remove the duplicated release, docs and archive code

## Acceptance criteria

- [ ] `release list` on Linear with no `tracker.scope.team` answers `NOT_CONFIGURED`
- [ ] The fake Linear API and the API verification notes use the same release page size and complexity figure as the code
- [ ] The release query no longer depends on a text replace, and a test fails if its team field goes missing
- [ ] `npm test` passes with no change to any command's output
