---
id: PMK-397
title: "Jira --sprint none leaves out an item in another board's open sprint"
type: bug
status: backlog
priority: low
parent: EPC-14
related: [PMK-370]
milestone: jira
created: 2026-11-25T01:10:27.050Z
updated: 2026-11-25T01:10:27Z
---

## Description

Follow-up of PMK-370 (seen live on 2026-11-24 with a cross-project Scrum board over a team-managed space). An item in another board's open sprint reads as no sprint of this board (ADR 0016: a sprint of another board never counts), so `issues get` shows no `sprint`. But `issues list --sprint none` leaves it out: its JQL is `(sprint is EMPTY OR sprint not in openSprints())`, and `openSprints()` covers every board's open sprints. `/pmkit:cycle:plan` drafts from `--sprint none`, so it never offers such an item. Building the clause from this board's open sprint ids (`sprint not in (<ids>)`, or no clause when the board has none, the client step deciding) would match the read.

## Acceptance criteria

- [ ] issues list --sprint none lists an item whose only open sprint belongs to another board, as issues get reads it
- [ ] The fake models a sprint of another board and openSprints() across boards
- [ ] A cycles-jira runbook step covers it
