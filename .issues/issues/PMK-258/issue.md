---
id: PMK-258
title: Fix Linear write edge cases for docs and releases
type: bug
status: backlog
priority: low
estimate: 2
parent: EPC-5
created: 2026-11-11T22:34:42.607Z
updated: 2026-11-11T22:34:42Z
---

## Description

### Context

The reviews of PMK-246 and PMK-252 approved writes on Linear with edge cases that give a wrong result. None is reachable through pmkit's own writes today, but each would report success for a doc that was deleted, or an error for a write that succeeded. Source: PMK-246 (PR #208), PMK-252 (PR #211).

### Scope (in)

- An attachment whose `pmkitDoc` is not in the normal form (written by another client, such as `./docs/a.md`) is upserted and deleted in the same docs change, so the doc disappears while the command says it worked.
- After `issueUpdate` and `attachmentCreate` succeed, a `RATE_LIMITED` on the final re-read makes the command exit with code 2 even though everything was written.
- `docs\..\..\x.md` passes the path check as one segment and becomes a broken link.
- `/pmkit:spec:record-decision` step 6 does not say what to do when the docs dry run answers `CONFLICT` (a hand-made attachment with the ADR link).
- `release-notes` writes `release: null` for an issue in two releases or whose release could not be read.

### Out of scope

- The extra reads on every write (their own issue).

### Tasks

- [ ] Never delete a doc that the same change adds
- [ ] Report a write that succeeded even when the re-read after it fails
- [ ] Refuse a doc path with a backslash part
- [ ] Say what record-decision does with a CONFLICT on docs
- [ ] Show an unknown or multiple release in release notes as such

## Acceptance criteria

- [ ] A docs change on an issue whose attachment metadata is not normalized keeps the doc and says what it did
- [ ] A write whose final re-read fails exits with code 0, says the write was done, and notes that the issue could not be read back
- [ ] A doc path with a backslash `..` part is refused before any request
- [ ] `/pmkit:spec:record-decision` skips an issue whose docs dry run answers `CONFLICT` and says so
- [ ] Release notes show an issue in two releases, or with an unread release, as such and never as `release: null`
