---
id: PMK-255
title: Let milestone writes through the Linear live sandbox
type: bug
status: backlog
priority: medium
estimate: 1
parent: EPC-5
created: 2026-11-11T22:34:42.371Z
updated: 2026-11-11T22:34:42Z
---

## Description

### Context

PMK-226 and PMK-249 made pmkit write a Linear issue's milestone (`projectMilestoneId`) on update, bulk and create. The list of fields the Linear live sandbox lets through (`ISSUE_KEYS` in `scripts/lib/linear/sandbox.mjs`) does not include it, so a live sandbox run refuses every milestone write. Found by the PMK-249 implementer. Source: PMK-249, PR #204.

### Scope (in)

- Milestone writes allowed in the live sandbox, on update, bulk and create.

### Out of scope

- Other fields the sandbox may be missing, unless they turn up while fixing this one.

### Tasks

- [ ] Let milestone writes through the live sandbox

## Acceptance criteria

- [ ] A live sandbox run of `issues update --milestone`, `issues bulk milestone` and `issues create --parent <epic> --milestone` sends the write instead of refusing it
- [ ] A test fails if the milestone field leaves the sandbox list again
