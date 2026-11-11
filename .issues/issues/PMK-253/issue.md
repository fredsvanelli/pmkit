---
id: PMK-253
title: Verify Linear releases against a Business workspace
type: task
status: backlog
priority: low
estimate: 2
parent: EPC-5
created: 2026-11-11T22:34:42.222Z
updated: 2026-11-11T22:34:42Z
---

## Description

### Context

PMK-246 mapped Linear releases against the fake Linear API only, because nobody had a workspace on a plan with releases. The user left its criterion 5 open for this issue. `scripts/lib/linear/API-VERIFICATION.md` ("Releases mapped (PMK-246)") lists what the real API still has to confirm. Source: PMK-246, PR #208.

### Scope (in)

- One run of the release commands against a real Linear workspace with releases turned on: `release list`, `release get`, `issues get`, `issues update --release`, `issues bulk release`, `release issues`, `release-readiness` and `release-notes`.
- Each point listed in `API-VERIFICATION.md` confirmed or corrected: the pipeline team filter, stage and completedAt, `Issue.releases`, `addedReleaseIds` and `removedReleaseIds`, the `releases.some` filter, a pipeline with no team, and the query complexity Linear reports.

### Out of scope

- New release features (create, mark released, several releases per issue).

### Tasks

- [ ] Run the release commands once on a test team of a workspace with releases
- [ ] Correct the mapping where the real API differs from the fake
- [ ] Record the result next to the Linear adapter

## Acceptance criteria

- [ ] Each point in the PMK-246 section of the API verification notes is marked confirmed or corrected, with the date and how it was checked
- [ ] Every release command named in the scope runs without error on the test team
- [ ] Any difference between the real API and the fake is fixed in the adapter and in the fake, with a test
