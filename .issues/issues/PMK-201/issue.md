---
id: PMK-201
title: Make the test suite pass on a default macOS setup
type: bug
status: backlog
priority: medium
estimate: 2
created: 2026-11-08T03:15:26.776Z
updated: 2026-11-08T03:15:26Z
---

## Description

### Context

Found while starting EPC-6 round 7. On `develop` 4bc6839, `npm test` exited 1 with 4 failures on a default macOS machine (Node 22.22, APFS case-insensitive, `TMPDIR` under `/var`, which is a symlink to `/private/var`). Round 6 had closed with exit 0 in another environment. Rounds 7 and 8 ran with a resolved `TMPDIR` and accepted two known failures. Source: EPC-6 round 7 orchestration.

### Scope (in)

- `scripts/cli-migrate.test.mjs:102` and `scripts/golden-helpers.test.mjs:194` compare paths built from `os.tmpdir()` without `realpath`, so they fail when `TMPDIR` goes through a symlink.
- `scripts/validate.test.mjs:196` ("two folders with the same normalized id") writes `ISS-1AAA` and `iss-1aaa`, which are one folder on a case-insensitive filesystem.
- `scripts/cli.test.mjs:1490` ("deep chain in text mode and fails only for JSON") expects a 3000-deep chain to overflow `JSON.stringify`, which does not happen on Node 22.22, so the rejection never comes.
- `matchTodos stays fast with 500 candidates and 5000 issues` (`scripts/todos.test.mjs`) failed at least five times under load (load average around 150) and passed when run alone.

### Out of scope

- The improvements listed in `docs/superpowers/epc-6-follow-ups.md`.

## Acceptance criteria

- [ ] `npm test` exits 0 on macOS with the default `TMPDIR` and a case-insensitive filesystem
- [ ] The case test is skipped, with a reason, where the filesystem folds case
- [ ] The depth test does not depend on the Node stack size
- [ ] The `matchTodos` timing test does not fail under machine load
