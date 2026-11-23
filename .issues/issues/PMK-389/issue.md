---
id: PMK-389
title: Read pr blockers on Bitbucket pull requests
type: feature
status: backlog
priority: low
parent: EPC-14
related: [PMK-81]
milestone: jira
created: 2026-11-23T21:16:17.185Z
updated: 2026-11-23T21:16:17Z
---

## Description

Source: PMK-81 design, scope 2A. On Bitbucket pr blockers answers NOT_SUPPORTED and pr status and issues track-agents report blockers as not verified.

## Acceptance criteria

- [ ] pr blockers on Bitbucket reads merge checks (pullrequests/{id}/mergeability/checks or branch restrictions), failing build statuses, requested changes, open tasks and unresolved comments
- [ ] pr status and issues track-agents give a blockers verdict on Bitbucket
