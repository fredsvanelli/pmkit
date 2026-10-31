---
id: PMK-180
title: Fix saved views with invalid file names and the Linear hint
type: bug
status: backlog
priority: medium
estimate: 1
related: [PMK-44]
created: 2026-10-31T16:01:14.694Z
updated: 2026-10-31T16:01:15Z
---

## Description

### Context

Saved views (PMK-44) merged with these defects, found by the second and third reviews of PR #86. Source: PMK-44, PR #86.

### Scope (in)

- `scripts/lib/local/tracker.mjs:1108`: `views list` drops a file whose name breaks the rule (for example `bad+name.yaml`) with no warning; only `validate` reports it. `views list --json` returns no `problems`, unlike its neighbours.
- `commands/local/doctor.md:37`: for a `view` problem about the name, the doctor proposes `views save bad+name ... --overwrite`, which `saveView` refuses with `INVALID_INPUT`.
- `scripts/lib/linear/manifest.mjs:20`: the Linear hint says "No pmkit command serves saved_views yet", but the `views` commands exist.
- `scripts/pmkit.mjs:161`: `filterText` does not quote values with a space or `=`.

### Out of scope

- The improvements listed in `docs/superpowers/epc-6-follow-ups.md`.

## Acceptance criteria

- [ ] `views list` warns about a file with an invalid name, and `--json` returns `problems`
- [ ] The doctor does not propose a `views save` that the CLI refuses
- [ ] The Linear hint says the Linear adapter does not serve views yet
- [ ] `filterText` quotes values with a space or `=`
