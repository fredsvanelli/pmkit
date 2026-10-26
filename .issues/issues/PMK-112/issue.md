---
id: PMK-112
title: Report .pmkit/config.yaml problems in validate and init
type: bug
status: in_review
priority: medium
estimate: 2
assignee: fred
parent: EPC-1
related: [PMK-8, PMK-118, PMK-119, PMK-120]
milestone: local-gaps
branch: pmk-112-report-pmkit-config-yaml-problems-in
created: 2026-10-26T15:39:49.360Z
updated: 2026-10-26T17:58:03Z
---

## Description

Found in PMK-8. `validatePmkitConfig` in `scripts/lib/config.mjs` checks `.pmkit/config.yaml`, but only tests call it. `pmkit validate` never reports a problem in that file, and `init` does not run it on the file it writes. A wrong `git_host.system` or `write_policy.confirm` shows up only when a command fails.

The JSON Schema for `.pmkit/config.yaml` already matches the validator (`scripts/schemas.test.mjs`), so an editor marks the problem while the CLI stays silent.

## Acceptance criteria

- [ ] `pmkit validate` reports the problems of `.pmkit/config.yaml` with the file path, next to those of `.issues/config.yaml`
- [ ] `init` validates `.pmkit/config.yaml` before it writes it, in both modes, and refuses with the file to fix
