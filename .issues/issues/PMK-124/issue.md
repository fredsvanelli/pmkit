---
id: PMK-124
title: Separate the paragraph after a sub-list in pause and spec import
type: task
status: backlog
priority: low
parent: EPC-1
related: [PMK-113]
milestone: local-gaps
created: 2026-10-26T17:58:03.864Z
updated: 2026-10-26T17:58:03Z
---

## Description

Found in PMK-113. `commands/issues/pause.md:28` and `commands/spec/import.md:29` have an indented paragraph right after a sub-list with no blank line, so it renders inside the last bullet. Add the blank line, as PMK-113 did in `commands/cycle/close.md` step 7.
