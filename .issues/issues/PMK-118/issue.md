---
id: PMK-118
title: Give the migration failure a source so validate lists it
type: bug
status: done
priority: medium
estimate: 2
assignee: fred
parent: EPC-1
related: [PMK-112]
milestone: local-gaps
branch: pmk-118-give-the-migration-failure-a-source-so
created: 2026-10-26T17:58:03.406Z
updated: 2026-10-26T23:46:26Z
---

## Description

Found in PMK-112. The error thrown at `scripts/lib/local/migrations.mjs:85` ("migration X to Y failed") has no `details` and does not start with the tracker file label, so `validateRepo` rethrows it instead of listing it. Its message tells the user to run `pmkit validate`, which would throw the same error. Not reachable today, because the only built-in migration does nothing. Give the error `details`, or start its message with the tracker file label.

## Acceptance criteria

- [ ] When a migration step fails, `validate` lists the failure as a problem at the tracker's `config.yaml`, with the step and the cause, instead of rethrowing the error
- [ ] The command that hits the failure still exits 2 with `INVALID_INPUT`, and its next step points to something that works (running `pmkit validate` shows the problem instead of the same error)
- [ ] A test with a failing migration step proves both, and `npm test` passes
