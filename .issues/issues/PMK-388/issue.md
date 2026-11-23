---
id: PMK-388
title: Post pr review on Bitbucket pull requests
type: feature
status: backlog
priority: low
parent: EPC-14
related: [PMK-81]
milestone: jira
created: 2026-11-23T21:16:17.033Z
updated: 2026-11-23T21:16:17Z
---

## Description

Source: PMK-81 design, scope 2A. On Bitbucket pr review answers NOT_SUPPORTED. Bitbucket takes inline comments through POST pullrequests/{id}/comments with inline.path and inline.to.

## Acceptance criteria

- [ ] pr review posts the body and the inline comments on a Bitbucket pull request, checked against the diff as on GitHub
- [ ] The capability manifest no longer lists pr review as unsupported on Bitbucket
