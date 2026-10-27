---
id: PMK-23
title: Add the release-notes command
type: feature
status: done
priority: medium
estimate: 3
assignee: fred
parent: EPC-3
blocked_by: [PMK-22]
milestone: phase-2-commands
branch: pmk-23-add-the-release-notes-command
created: 2026-10-25T19:13:20Z
updated: 2026-10-27T19:30:41Z
---

## Description

Source: Unified model, PM catalog (`release-notes`: "Completed issues by release, cycle or period, in user-facing language"; degradation "Period or cycle"); Linear tab ("Optional: saves as a document").

## Acceptance criteria

- [x] Groups completed issues by release, sprint or period in user-facing language
- [x] Without releases it uses a sprint or a period, and says so
- [x] Optionally saves the notes as a document after confirmation
