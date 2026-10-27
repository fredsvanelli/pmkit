---
id: PMK-132
title: A `|` in an issue title breaks Markdown tables in chat
type: bug
status: backlog
related: [PMK-23]
created: 2026-10-27T19:32:58.160Z
updated: 2026-10-27T19:32:58Z
---

## Description

Commands that print issue tables in chat copy titles as they are, so a `|` splits the row. Escape `|` in table cells.
