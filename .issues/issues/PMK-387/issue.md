---
id: PMK-387
title: Check the Bitbucket Cloud git host against a live repository
type: chore
status: backlog
priority: low
parent: EPC-14
related: [PMK-81]
milestone: jira
created: 2026-11-23T21:16:16.796Z
updated: 2026-11-23T21:16:16Z
---

## Description

Source: PMK-81 design (Follow-ups for EPC-14) and its reviews. No Bitbucket Cloud account existed, so the Bitbucket git host ran only against a fake API.

## Acceptance criteria

- [ ] A scoped user API token in BITBUCKET_TOKEN sent as Bearer reads a repository; if it fails, a new ADR decides the fallback (ADR 0018)
- [ ] The pull request diff redirect stays inside the repository on api.bitbucket.org, and the diff size limit answer (406/413) is confirmed
- [ ] Paging works: next links on pullrequests and statuses, the page parameter on pipelines, sort=-release.created_on on deployments
- [ ] ci logs --run <build number> finds a run, and step logs read for FAILED and ERROR steps
- [ ] docs/runbooks/git-host-bitbucket.md runs end to end against a real repository, and its Live check line records the result
