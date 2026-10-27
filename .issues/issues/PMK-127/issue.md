---
id: PMK-127
title: Running the CLI inside a test fixture breaks the suite
type: chore
status: backlog
related: [PMK-20]
created: 2026-10-27T19:32:57.752Z
updated: 2026-10-27T19:32:57Z
---

## Description

Running `pmkit` inside `scripts/__fixtures__/<name>` writes `.issues/.cache/` there, and 16 tests then fail. Make the tests ignore a cache in the fixtures, or have the CLI skip the index cache for fixture paths.
