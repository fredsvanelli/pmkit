---
id: PMK-287
title: Redact the user name of an https URL in git errors
type: bug
status: backlog
priority: low
estimate: 1
parent: EPC-6
created: 2026-11-12T14:41:34.861Z
updated: 2026-11-12T14:41:34Z
---

## Description

### Context

PMK-278 shows a `scheme://host` URL through `redact(url).text`, which hides `user:password@` and tokens. A user name without a password stays: `unable to access 'https://bob@host/r.git/': 403` shows `bob`. Source: PMK-278, PR #233 (cycle 3 review).

### Scope (in)

- The user name of an `http` or `https` URL in a git error becomes `[redacted]`.

### Out of scope

- `ssh://git@host` and `git@host:` forms, where the user is the fixed `git`.
- The rules of `redact.mjs` for other text.

### Tasks

- [ ] Redact the user name of http(s) URLs in hideAbsolutePaths
- [ ] Test with and without a password

## Acceptance criteria

- [ ] `https://bob@host/r.git` in a git error shows as `https://[redacted]@host/r.git`, with a test
- [ ] `ssh://git@host/r.git` is unchanged, with a test
