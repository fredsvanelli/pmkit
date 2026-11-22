---
id: PMK-265
title: Keep issue docs in the Linear-to-Local migration
type: feature
status: in_review
priority: low
estimate: 2
assignee: fred
parent: EPC-5
branch: pmk-265-keep-issue-docs-in-the-linear-to-local
created: 2026-11-11T22:34:43.140Z
updated: 2026-11-22T07:27:35Z
---

## Description

### Context

PMK-252 stores issue docs on Linear as attachments. A migration from Linear to the Local tracker does not bring them back, so the docs of each issue are lost on the way. Source: PMK-252, PR #211.

### Scope (in)

- The Linear-to-Local migration reads the docs attachments pmkit created and writes them into each Local issue's `docs` list.

### Out of scope

- Attachments pmkit did not create.

### Tasks

- [ ] Bring the docs of each Linear issue into the Local tracker
- [ ] Count docs in the migration report

## Acceptance criteria

- [x] After a migration from Linear to the Local tracker, each issue has the same docs it had on Linear
- [x] The migration preview counts the docs it will bring, and an attachment pmkit did not create is not counted as a doc
