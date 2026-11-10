---
id: PMK-251
title: Write the Supersedes line in a new ADR
type: feature
status: backlog
priority: low
estimate: 2
parent: EPC-6
created: 2026-11-10T20:03:45.337Z
updated: 2026-11-10T21:16:03Z
---

## Description

### Context

PMK-228 added `docs adr-status`, which marks an old ADR "superseded by" the new one. The new ADR that `/pmkit:spec:record-decision` writes says nothing about the ADR it replaces, so the link only goes one way and a reader of the new ADR cannot find the old one. Source: PMK-228, PR #196.

### Scope (in)

- A "Supersedes" line in a new ADR that names the ADR it replaces, when the user says the decision replaces one.
- Mark the old ADR superseded in the same run, after the user confirms.

### Out of scope

- Finding replaced ADRs on its own from their text.
- ADRs that already exist.

### Tasks

- [ ] Ask in record-decision whether the decision replaces an older ADR
- [ ] Write the Supersedes line in the new ADR
- [ ] Mark the old ADR superseded by the new one, after confirmation

## Acceptance criteria

- [ ] A new ADR that replaces an older one has a line naming the older ADR's number and path
- [ ] After the run, the older ADR says it is superseded by the new one, and its status change was confirmed first
- [ ] A decision that replaces no ADR is written as it is today
