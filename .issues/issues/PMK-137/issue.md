---
id: PMK-137
title: Doctor could list issues moved by hand with no event
type: chore
status: backlog
related: [PMK-18]
created: 2026-10-27T19:32:58.577Z
updated: 2026-10-27T19:32:58Z
---

## Description

An `issue.md` edited by hand into `in_progress` has no move event, so `metrics aging` misses it until the next write. Have `/pmkit:local:doctor` list issues whose status differs from the last move event.
