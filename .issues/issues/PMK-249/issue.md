---
id: PMK-249
title: Set the milestone in issues create on Linear
type: feature
status: backlog
priority: low
estimate: 1
parent: EPC-5
created: 2026-11-10T20:03:45.191Z
updated: 2026-11-10T21:16:02Z
---

## Description

### Context

PMK-226 let `issues update` and `issues bulk` set a Linear milestone, but `issues create --milestone` on Linear is still refused with "set the milestone in Linear". The refusal exists because a create has no project to check the milestone against, yet a create with `--parent <epic>` already names the project. Source: PMK-226, PR #195.

### Scope (in)

- `issues create --milestone` on Linear when `--parent` names an epic, with the milestone checked against that epic's project.

### Out of scope

- A milestone on a create with no epic parent, which stays refused.
- Creating milestones on Linear (PMK-167).

### Tasks

- [ ] Set the milestone of a new Linear issue created under an epic
- [ ] Refuse a milestone of another project, or with no epic, with a message that says what to do

## Acceptance criteria

- [ ] `issues create --parent <epic> --milestone <id>` on Linear creates the issue with that milestone, and `--dry-run` shows it
- [ ] A milestone from another project is refused before anything is created, with the same message as `issues update`
- [ ] `issues create --milestone` with no epic parent on Linear is refused with a message that says to add `--parent <epic>`
