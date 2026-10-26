---
id: PMK-124
title: Separate the paragraph after a sub-list in pause and spec import
type: task
status: in_progress
priority: low
estimate: 1
assignee: fred
parent: EPC-1
related: [PMK-113]
milestone: local-gaps
branch: pmk-124-separate-the-paragraph-after-a-sub-list
created: 2026-10-26T17:58:03.864Z
updated: 2026-10-26T18:29:56Z
---

## Description

Found in PMK-113. `commands/issues/pause.md:28` and `commands/spec/import.md:29` have an indented paragraph right after a sub-list with no blank line, so it renders inside the last bullet. Add the blank line, as PMK-113 did in `commands/cycle/close.md` step 7.

## Acceptance criteria

- [ ] In `commands/issues/pause.md` step 7, a blank line separates the last sub-list bullet from the indented paragraph that starts "When the user approves", so the paragraph renders as part of step 7 and not inside the last bullet
- [ ] In `commands/spec/import.md` step 7, a blank line separates the last sub-list bullet from the indented paragraph that starts "When one fails", with the same effect
- [ ] No other text in the two files changes, and `npm test` passes, including the `issues-pause` and `spec-import` scenarios
