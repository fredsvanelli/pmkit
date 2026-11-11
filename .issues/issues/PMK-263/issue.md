---
id: PMK-263
title: Improve the ADR commands
type: feature
status: backlog
priority: low
estimate: 3
parent: EPC-6
created: 2026-11-11T22:34:42.992Z
updated: 2026-11-11T22:34:42Z
---

## Description

### Context

PMK-247, PMK-248 and PMK-251 left improvements to the ADR commands. `/pmkit:spec:record-decision` finds the ADR it replaces through `docs adr-status <old> deprecated --dry-run` because the CLI has no ADR lookup, and it handles one replaced ADR per decision. Source: PMK-247 (PR #207), PMK-248 (PR #203), PMK-251 (PR #210).

### Scope (in)

- A read-only `docs adr-get <number>` that record-decision uses instead of the `adr-status` dry run.
- A decision that replaces several ADRs.
- record-decision warns when the replaced ADR's number is higher than the new one, does not ask which ADR is replaced when the user already said, and mentions a step 6 failure before asking to mark the old ADR.
- `validate` reports an ADR number used twice in the repository's own folder when the tracker is hosted.
- `adr-status` updates a `Status:` line above the first section when the ADR also has front matter or a `## Status` section.

### Out of scope

- The adr-status defects with a tracker outside the repository (their own bug).

### Tasks

- [ ] Look up an ADR by number without writing
- [ ] Record a decision that replaces several ADRs
- [ ] Tidy the record-decision questions and warnings
- [ ] Check ADR numbers with a hosted tracker
- [ ] Update every status line of an ADR

## Acceptance criteria

- [ ] `docs adr-get <number>` shows the ADR's number, title, status and path and writes nothing, and record-decision uses it
- [ ] A decision that replaces two ADRs gets one Supersedes line per ADR, and both old ADRs are marked superseded after confirmation
- [ ] record-decision warns when the replaced ADR is newer than the new one and does not ask again for an ADR the user already named
- [ ] With a hosted tracker, `validate` reports two ADRs in the repository folder with the same number
- [ ] An ADR with a `Status:` line and a `## Status` section shows the new status in both after `docs adr-status`
