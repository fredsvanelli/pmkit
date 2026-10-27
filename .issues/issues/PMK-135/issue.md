---
id: PMK-135
title: "`render` drops a trailing `#` from a sprint name"
type: bug
status: backlog
related: [PMK-25]
created: 2026-10-27T19:32:58.408Z
updated: 2026-10-27T19:32:58Z
---

## Description

A sprint name ending in `#` followed by spaces, such as "end # ", loses the `#` in the Markdown heading, because the heading escape only matches a `#` run at the very end. Trim before escaping.
