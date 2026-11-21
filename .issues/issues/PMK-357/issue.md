---
id: PMK-357
title: Report a GitHub discussion or comment deleted mid-read as not found
type: bug
status: backlog
priority: low
estimate: 2
parent: EPC-8
created: 2026-11-21T18:10:43.549Z
updated: 2026-11-21T18:10:43Z
---

## Description

### Context

Left open by the Secure step of PMK-342 (PR #330). `github discussions get` now reads a thread past 100 comments or 100 replies with further pages after the first read. If the discussion or a comment is deleted between the first read and a further page, the command fails with a generic `UPSTREAM` error. A missing discussion on the first read already fails with `NOT_FOUND` and a clear message, so the two cases disagree, and the user can't tell that the thread is simply gone.

### Scope (in)

- Reading a long GitHub discussion whose discussion or comment is deleted mid-read

### Out of scope

- Discussions that change in other ways during a read (new or edited comments)
- Retrying the read automatically

### Tasks

- [ ] Report a discussion deleted during the read as not found, with the same message as a missing discussion
- [ ] Report a comment deleted during the read as not found, naming the comment

## Acceptance criteria

- [ ] Reading a long discussion that is deleted before its further pages are read fails with NOT_FOUND and the same message as a discussion that does not exist
- [ ] Reading a long discussion whose comment is deleted before its further replies are read fails with NOT_FOUND and names the comment
- [ ] The Discussions runbook covers both cases
