---
id: PMK-309
title: Keep npm test output in TAP when piped on Node 26
type: chore
status: in_review
priority: low
estimate: 1
assignee: fred
parent: EPC-6
branch: pmk-309-keep-npm-test-output-in-tap-when-piped
created: 2026-11-13T21:09:10.587Z
updated: 2026-11-14T00:25:17Z
---

## Description

### Context

`scripts/run-tests.mjs:33` runs `node --test` with no reporter. Node 22 prints TAP when stdout is not a terminal and Node 26 prints the spec reporter there too. Checked at 041bc521 with `node --test scripts/paths.test.mjs | tail`: Node 22.22.0 ends with `# pass 37`, Node 26.4.0 with `ℹ pass 37`. Agents and the orchestration read `# tests`, `# pass` and `# fail` from a piped `npm test`; on Node 26 they find nothing and cannot tell a pass from a run that never finished. PMK-301 already asks for `--test-reporter=tap` in the child runs that read TAP (`degraded-live` and the sandbox test). Source: PMK-303, PR #264 (implementer).

### Scope (in)

- `npm test` asks for the TAP reporter when stdout is not a terminal, so piped output looks the same on Node 22 and Node 26.
- In a terminal the reporter is not forced.

### Out of scope

- Changing what the tests check, or the leak guard of `run-tests.mjs`.

### Tasks

- [ ] Choose the reporter by whether stdout is a terminal, in a function the test can call
- [ ] Test both cases

## Acceptance criteria

- [x] A piped `npm test` ends with the `# tests`, `# pass` and `# fail` lines on Node 22 and on Node 26, with a test of the arguments `run-tests.mjs` builds
- [x] In a terminal the reporter is not forced, with a test
