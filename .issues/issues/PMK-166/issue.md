---
id: PMK-166
title: Refuse cycle add into a closed sprint and check closed in adapters
type: bug
status: backlog
priority: low
parent: EPC-1
related: [PMK-121]
milestone: local-gaps
created: 2026-10-28T00:11:41.052Z
updated: 2026-10-28T00:11:41Z
---

## Description

Found in PMK-121. `cycle add` accepts an issue into a sprint whose state is `closed`. Adapters other than the local tracker have no validity check for the sprint's `closed` time, and an unparsable value would drop every issue from velocity.
