---
id: PMK-197
title: Make text redact trade false positives for no missed secrets
type: bug
status: backlog
priority: medium
estimate: 2
related: [PMK-63]
created: 2026-10-31T20:35:30.957Z
updated: 2026-10-31T20:35:31Z
---

## Description

### Context

`text redact` (PMK-63) merged after four review cycles. The comment of `/pmkit:issues:investigate-bug` no longer carries CI log lines, so `text redact` is a second layer over the issue and comment text the agent quotes. The fourth review found cases that pass unredacted, and the user chose to merge and track them here. Source: PMK-63, PR #108.

### Scope (in)

- `scripts/lib/redact.mjs:22`: a password value with `.` or `(` is never redacted, so `DB_PASSWORD=Summer.2024!`, `Password: Hunter.22`, `the password: hunter22.` and `password=(hunter22)` pass. A value that starts with `/` or `~` also passes (`PASSWORD=/x9Kq!zz`).
- `redact.mjs:51`: `&` ends a value, so `API_TOKEN=abc123&rest` passes and `password=hunter&22` leaves `&22`. Only the first 512 characters of a value are replaced, so a long `AWS_SESSION_TOKEN` stays partly visible.
- `"Authorization": "Basic ..."` in JSON form, `PRIVATE_KEY=...`, `curl -u user:pass`, `GIT_CREDENTIAL=...`, `password=pa$$;word123` and `secret=Xy7#kL:42` pass.
- `(token=...)` and `` `token=...` `` lose the closing `)` or backtick, which breaks the comment's Markdown.
- The scenario `expect` (`scripts/__scenarios__/issues-investigate-bug.mjs:65`) only really tests one log line.

### Out of scope

- The improvements listed in `docs/superpowers/epc-6-follow-ups.md`.

## Acceptance criteria

- [ ] Every value after a password, passwd, pwd, credentials, secret, token or api_key key followed by `=` or `:` is redacted in full, and the false positives this accepts are listed in the spec
- [ ] Every case above has a probe in `scripts/redact-probes.test.mjs` with the expected output
- [ ] Redaction keeps the surrounding Markdown intact
