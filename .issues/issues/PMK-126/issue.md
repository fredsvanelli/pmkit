---
id: PMK-126
title: The doc-path test fails on plans that name future command files
type: chore
status: backlog
related: [PMK-20]
created: 2026-10-27T19:32:57.656Z
updated: 2026-10-27T19:32:57Z
---

## Description

The test "every ${CLAUDE_PLUGIN_ROOT} path in the plugin docs exists" scans `docs/superpowers/plans/`. A plan that names a command file the same branch adds later leaves every commit red until that file exists. This happened on the PRs for PMK-20, 21, 22, 24 and 25. Skip plans and specs in that test, or check only command and skill files.
