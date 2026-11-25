---
id: PMK-374
title: Mark a Jira release released when it has more than 1000 issues
type: task
status: backlog
priority: low
parent: EPC-14
related: [PMK-79]
milestone: jira
created: 2026-11-23T05:13:15.700Z
updated: 2026-11-23T05:13:22Z
---

## Description

Source: PMK-79 review (PR #385). release mark-released refuses with UPSTREAM when the release's issue search is cut at 1000 (releaseIssues in scripts/lib/jira/releases.mjs), although only the unfinished list would be partial; the release itself could be marked.

## Acceptance criteria

- [ ] mark-released on a version with more than 1000 issues marks it released and warns that the unfinished list covers the first 1000
- [ ] release issues keeps refusing a cut read
