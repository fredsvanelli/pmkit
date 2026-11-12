---
id: PMK-288
title: Make hideAbsolutePaths linear on long lines
type: bug
status: in_review
priority: low
estimate: 1
assignee: fred
parent: EPC-6
branch: pmk-288-make-hideabsolutepaths-linear-on-long
created: 2026-11-12T14:41:34.946Z
updated: 2026-11-12T18:13:08Z
---

## Description

### Context

The URL alternative of `hideAbsolutePaths` (`SCHEME_URL`, `scripts/lib/paths.mjs:22`) is tried at every word boundary and scans the word run to its end before it fails, so a line with many `.`, `+` or `-` and no `://` takes quadratic time. `"a.".repeat(n)`: 38 ms for 5,000, 151 ms for 10,000, 601 ms for 20,000. Source: PMK-278, PR #233 (cycle 3 review).

### Scope (in)

- The same output in time that grows linearly with the line.

### Out of scope

- Changing which text is hidden.

### Tasks

- [ ] Rewrite the URL match so it does not rescan
- [ ] Add a timing test in the style of `redact-probes.test.mjs`

## Acceptance criteria

- [x] A 200,000-character line without `://` goes through hideAbsolutePaths in under a second, with a test
- [x] The existing paths tests pass unchanged
