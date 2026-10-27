---
id: PMK-136
title: The dependency map walks chains recursively
type: chore
status: backlog
related: [PMK-20]
created: 2026-10-27T19:32:58.488Z
updated: 2026-10-27T19:32:58Z
---

## Description

Loop breaking, the critical path and the text printers recurse once per step, and chain copying is quadratic in memory. Deep chains now fail with a clear error, but a topological pass would remove the limit.
