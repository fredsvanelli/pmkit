---
id: PMK-252
title: Map issue docs on Linear
type: feature
status: in_progress
priority: low
estimate: 3
assignee: fred
parent: EPC-5
branch: pmk-252-map-issue-docs-on-linear
created: 2026-11-10T20:03:45.412Z
updated: 2026-11-11T01:55:35Z
---

## Description

### Context

PMK-228 added a `docs` field on issues, which `/pmkit:spec:record-decision` fills with the ADR the issue relates to. Linear does not support it: the manifest lists `issueDocs` as unsupported, `--add-doc` is refused, and on Linear the decision comment is the only link between an issue and its ADR. Source: PMK-228, PR #196.

### Scope (in)

- Read and write the `docs` of a Linear issue, stored as links on the issue.
- record-decision links the ADR on Linear as it does on the Local tracker.

### Out of scope

- Creating Linear documents (PMK-167).
- Copying ADR text into Linear.

### Tasks

- [ ] Show the docs of a Linear issue
- [ ] Add and remove docs on a Linear issue
- [ ] Link the ADR to its issues on Linear in record-decision
- [ ] Report the capability in the manifest

## Acceptance criteria

- [x] `issues get` on a Linear issue shows its docs
- [x] `issues update --add-doc` and `--remove-doc` work on Linear, and `--dry-run` sends no request
- [x] `/pmkit:spec:record-decision` on Linear links the ADR to each related issue, not only through a comment
- [x] The manifest no longer lists `issueDocs` as unsupported
