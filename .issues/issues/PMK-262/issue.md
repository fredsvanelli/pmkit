---
id: PMK-262
title: Cut the extra release and docs reads on Linear
type: task
status: backlog
priority: low
estimate: 3
parent: EPC-5
created: 2026-11-11T22:34:42.919Z
updated: 2026-11-11T22:34:42Z
---

## Description

### Context

PMK-246 and PMK-252 made pmkit read an issue's releases and docs on Linear wherever an issue comes back. The reviews accepted the extra requests as a follow-up: about one or two more requests per write and one per 100 issues in a list, about 400 more for a bulk change of 200 issues. Source: PMK-246 (PR #208), PMK-252 (PR #211).

### Scope (in)

- Reads that never show releases or docs (history, comments, delete, parent lookup) stop reading them.
- A write reuses the releases and docs it read before when the write does not change them, instead of reading them again after.
- Search reads releases after its own filtering, not before.
- The docs batch read follows the same pattern as the releases one, so one failure does not mark a whole batch unknown.

### Out of scope

- Changing what any command shows.

### Tasks

- [ ] Stop reading releases and docs where nothing shows them
- [ ] Reuse what a write already read
- [ ] Read releases after search filtering

## Acceptance criteria

- [ ] A write on Linear that does not touch releases or docs sends no release or attachment read after the write
- [ ] History, comments, delete and parent lookup on Linear send no release or attachment read
- [ ] Every command shows the same output as before, checked by the existing tests
- [ ] A test counts the requests of a bulk change on Linear and fails if the extra reads come back
