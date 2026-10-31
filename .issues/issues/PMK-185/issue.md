---
id: PMK-185
title: "Fix alerts list notes, advisory titles and the missing-npm check"
type: bug
status: backlog
priority: medium
estimate: 1
related: [PMK-48]
created: 2026-10-31T16:01:21.642Z
updated: 2026-10-31T16:01:22Z
---

## Description

### Context

`alerts list` (PMK-48) and its Windows fix (PMK-175) merged with these defects, found by the reviews of PRs #81 and #94. Source: PMK-48, PR #81.

### Scope (in)

- `scripts/pmkit.mjs:927`: the command does not print the `note:` of the derived path that rule 4 of the conventions asks for.
- `scripts/lib/alerts.mjs:38`: the severity is the package's, but the title and URL come from the first advisory in `via`, so `[{ title: 'ReDoS', severity: 'low' }, { title: 'RCE', severity: 'critical' }]` gives `critical | x | ReDoS`.
- When stdout is empty, the warning drops npm's stderr and only says `npm audit printed empty output`.
- `scripts/lib/alerts.mjs:66`: the second missing-npm check (`status !== 0` plus "is not recognized") also matches an `npm audit` that exits 1 with valid JSON and prints that text.

### Out of scope

- The improvements listed in `docs/superpowers/epc-6-follow-ups.md`.

## Acceptance criteria

- [ ] `alerts list` prints the derived-path note
- [ ] The alert title and URL come from the advisory with the alert's severity
- [ ] The empty-output warning includes npm's stderr
- [ ] A valid `npm audit` report is never read as a missing npm
