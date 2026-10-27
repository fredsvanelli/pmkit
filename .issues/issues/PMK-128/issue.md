---
id: PMK-128
title: "`readEvents` sorts events by the `at` text, not the instant"
type: bug
status: backlog
related: [PMK-18]
created: 2026-10-27T19:32:57.840Z
updated: 2026-10-27T19:32:57Z
---

## Description

Each log is sorted by the `at` string. Events written with different offsets can replay out of order, which changes metrics and history. Sort by the parsed instant, reading a time with no zone as UTC (`eventInstant`).
