---
id: PMK-342
title: Read GitHub discussion threads past 100 comments or 100 replies
type: feature
status: in_review
priority: low
assignee: fred
parent: EPC-8
milestone: github-issues
branch: pmk-342-read-github-discussion-threads-past-100
created: 2026-11-17T22:21:23.349Z
updated: 2026-11-21T17:14:32Z
---

## Description

Found while working PMK-90 (PR #313). `github discussions get` reads the first 100 comments and 100 replies each, then warns what it cut. Long RFC threads exceed that.

## Acceptance criteria

- [ ] `github discussions get` pages through every comment and reply, or up to a documented limit with the warning
