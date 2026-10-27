---
id: PMK-129
title: "`events --since` accepts impossible dates"
type: bug
status: backlog
related: [PMK-18]
created: 2026-10-27T19:32:57.916Z
updated: 2026-10-27T19:32:57Z
---

## Description

`events --since 2026-13-40` is accepted, while the metrics commands refuse it through `rangeText`. Use the same check in `events`.
