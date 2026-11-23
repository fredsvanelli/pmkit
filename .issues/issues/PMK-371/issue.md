---
id: PMK-371
title: Close the Jira sprint edge cases left by PMK-78
type: chore
status: backlog
priority: low
parent: EPC-14
milestone: jira
created: 2026-11-23T03:06:36.683Z
updated: 2026-11-23T03:06:36Z
---

## Description

Source: PMK-78 final review (docs/superpowers/specs/2026-11-22-pmk-78-jira-sprints-design.md). Edge cases left open on purpose; none breaks a flow on a space with one Scrum board.

## Acceptance criteria

- [ ] The sprint filter sends the id unquoted (or the name-first match of a quoted value is ruled out on a live site)
- [ ] --sprint none keeps an item whose only open sprint belongs to another board (ADR 0016 reads it as no sprint)
- [ ] Sprint history events ignore sprints of other boards
- [ ] moveToCycle reads each work item once, not twice
- [ ] openCycle reports the created sprint id when the reread after the create fails
- [ ] createIssue with a sprint and a status names the skipped status move when the sprint move fails
