---
id: PMK-243
title: Let tests raise the git read timeout of link-repo
type: bug
status: backlog
priority: low
related: [PMK-201]
created: 2026-11-08T22:28:25.706Z
updated: 2026-11-08T22:28:25Z
---

## Description

### Context

Found while verifying PMK-201. With four suites running at once (load average about 96), `cli-link-repo.test.mjs:315` ("Linear: the git host is written without a Linear call when no team is asked for") took 242 s and failed: `git remote -v` hit `GIT_READ_TIMEOUT_MS` (10 s, `scripts/pmkit.mjs:2762`), so the host was not inferred. The product handled it correctly (a note, the host kept). Source: PMK-201.

### Scope (in)

- Let the test environment raise the git read timeout, or have the test tolerate the not-inferred path when git timed out.

### Out of scope

- Changing the 10 s limit for users.

## Acceptance criteria

- [ ] cli-link-repo.test.mjs passes under four parallel suites
- [ ] The 10 s limit stays the default for users
