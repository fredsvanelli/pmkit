---
id: PMK-246
title: Map Linear releases
type: feature
status: done
priority: low
estimate: 5
assignee: fred
parent: EPC-5
branch: pmk-246-map-linear-releases
created: 2026-11-10T19:28:14.537Z
updated: 2026-11-11T01:42:27Z
---

## Description

### Context

PMK-226 added the Linear milestone to `issues bulk` but left the Linear release out (option A of question PMK-226-1), because the Linear adapter maps no releases: `release list` comes back empty, `release create` and `--release` answer `NOT_SUPPORTED`, and a migration drops each issue's release. Teams on a Linear plan with releases cannot set or read them through pmkit. Source: PMK-226, PR #195.

### Scope (in)

- List the releases of a Linear workspace that has releases enabled.
- Read and write the release of a Linear issue.
- Release as a bulk change on Linear, once the release is mapped.

### Out of scope

- Creating, editing or marking releases on Linear.
- The `--release` filter on Linear (PMK-146 covers the filter on the Local tracker).
- Keeping releases in a migration to or from Linear.

### Tasks

- [ ] Show the Linear releases in `release list`
- [ ] Show and set the release of a Linear issue
- [ ] Accept a release in a bulk change on Linear
- [ ] Check the mapping once against a real Linear workspace with releases

## Acceptance criteria

- [x] `release list` on a Linear workspace with releases enabled lists its releases
- [x] `issues get` on a Linear issue shows its release
- [x] `issues update --release` and `issues bulk` set the release of Linear issues
- [x] On a Linear workspace with releases turned off, those commands refuse with a message that says releases are off
- [ ] The mapping was checked once against a real Linear workspace with releases, and the result is recorded next to the Linear adapter
