---
id: PMK-377
title: Name Jira in the cut-off warnings that say Linear
type: task
status: backlog
priority: low
parent: EPC-14
related: [PMK-361, PMK-79]
milestone: jira
created: 2026-11-23T05:13:16.443Z
updated: 2026-11-23T05:13:22Z
---

## Description

Source: PMK-79 review (PR #385). Since PMK-77, warnings for reads cut at 1000 items name Linear on a Jira repository: capWarning in scripts/pmkit.mjs maps every tracker but GitHub to Linear, and the warnings near pmkit.mjs lines 273, 1111, 1118 and 2978 say 'Linear has more ...'. PMK-79 fixed only epic progress. PMK-361 covers the release-notes warning on GitHub.

## Acceptance criteria

- [ ] On Jira, every cut-off warning names Jira and its limit
- [ ] On Linear and GitHub the words stay as they are
