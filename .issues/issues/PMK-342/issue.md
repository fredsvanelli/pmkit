---
id: PMK-342
title: Read GitHub discussion threads past 100 comments or 100 replies
type: feature
status: backlog
priority: low
parent: EPC-8
milestone: github-issues
created: 2026-11-17T22:21:23.349Z
updated: 2026-11-17T22:21:23Z
---

## Description

Found while working PMK-90 (PR #313). `github discussions get` reads the first 100 comments and 100 replies each, then warns what it cut. Long RFC threads exceed that.

## Acceptance criteria

- [ ] `github discussions get` pages through every comment and reply, or up to a documented limit with the warning
