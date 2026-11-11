---
id: PMK-264
title: Link issue docs on a GitHub Enterprise host
type: feature
status: backlog
priority: low
estimate: 2
parent: EPC-5
created: 2026-11-11T22:34:43.066Z
updated: 2026-11-11T22:34:43Z
---

## Description

### Context

PMK-252 links the docs of a Linear issue to the file on GitHub. The link always uses `github.com`, so a repository on GitHub Enterprise gets broken links. Source: PMK-252, PR #211.

### Scope (in)

- Doc links that use the host of the repository's git remote or of the configured git host.

### Out of scope

- Git hosts other than GitHub.

### Tasks

- [ ] Build doc links on the repository's own GitHub host

## Acceptance criteria

- [ ] On a repository whose remote is on a GitHub Enterprise host, `issues update --add-doc` on Linear links to that host
- [ ] On github.com, links stay as they are
