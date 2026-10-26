---
id: PMK-119
title: List tracker.system linear as a problem in validate
type: bug
status: backlog
priority: low
parent: EPC-1
related: [PMK-112]
milestone: local-gaps
created: 2026-10-26T17:58:03.483Z
updated: 2026-10-26T17:58:03Z
---

## Description

Found in PMK-112. With `tracker.system: linear` and no other bad key, `validate` throws `NOT_SUPPORTED` instead of listing a problem at `.pmkit/config.yaml`. With another bad key it lists the problems. Make both cases list.
