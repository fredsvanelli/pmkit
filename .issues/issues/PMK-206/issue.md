---
id: PMK-206
title: Fix the review-request and error paths of the inbox digest
type: bug
status: in_review
priority: medium
estimate: 2
assignee: fred
related: [PMK-55]
branch: pmk-206-fix-the-review-request-and-error-paths
created: 2026-11-08T04:05:51.147Z
updated: 2026-11-09T23:13:14Z
---

## Description

### Context

Found by the reviews of PR #118 (PMK-55) and left as non-blocking. Source: PMK-55, PR #118.

### Scope (in)

- `commands/issues/inbox-digest.md:30`: the digest does not stop or mark itself incomplete on `RATE_LIMITED` from the pull request reads.
- `commands/issues/inbox-digest.md:36`: team review requests show by name (`r.login ?? r.name ?? r.slug`), so a team whose name equals the user's login matches the user, and a real team request never does.
- `commands/issues/inbox-digest.md:37`: "changes to address" skips pull requests the user authored on unassigned or `in_progress` issues.
- `commands/issues/inbox-digest.md:29`: review requests are read only on `in_review` issues, so a request on a pull request whose issue is still `in_progress` is missed.
- `commands/issues/inbox-digest.md:27`: `since=` is ignored on Linear.
- `scripts/__scenarios__/issues-inbox-digest.mjs:62-92`: the scenario checks the saved data, not the digest's wording, and `complete` is false in the fixture, so the branch that offers `mark-read` never runs.

### Out of scope

- The improvements listed in `docs/superpowers/epc-6-follow-ups.md`.

## Acceptance criteria

- [x] A rate-limited pull request read marks the digest incomplete
- [x] Team review requests are shown as team requests, never matched to the user by name
- [x] Review requests and changes to address are found whatever the issue's status and assignee
- [x] A scenario runs the `mark-read` offer with a complete inbox
