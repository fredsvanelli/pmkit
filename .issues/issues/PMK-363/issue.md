---
id: PMK-363
title: Pick a release pipeline in release create on Linear
type: task
status: backlog
priority: low
parent: EPC-13
created: 2026-11-22T17:58:26.812Z
updated: 2026-11-22T17:58:26Z
---

## Description

### Context

Found in PMK-261 (PR #377). `release create` on Linear makes the release in the scope team's release pipeline and refuses a team with several pipelines, naming them, because the command has no way to pick one. Linear Business allows up to 15 pipelines.

### Scope (in)

- A `--pipeline <name|id>` option for `release create` on Linear.

## Acceptance criteria

- [ ] `release create --pipeline <name>` on a team with two pipelines creates the release in that one
- [ ] Without `--pipeline`, a team with two pipelines is still refused with their names
