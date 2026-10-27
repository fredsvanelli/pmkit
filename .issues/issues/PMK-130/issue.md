---
id: PMK-130
title: A reopened issue keeps its last done time in flow metrics
type: bug
status: backlog
related: [PMK-18]
created: 2026-10-27T19:32:57.996Z
updated: 2026-10-27T19:32:58Z
---

## Description

An issue moved back out of `done` still counts with its last done time in cycle time, lead time and throughput. Count only issues whose current category is done, or cut at the reopen.
