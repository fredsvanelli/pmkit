---
id: PMK-254
title: Verify Linear issue docs against a live workspace
type: task
status: backlog
priority: low
estimate: 1
parent: EPC-5
created: 2026-11-11T22:34:42.296Z
updated: 2026-11-11T22:34:42Z
---

## Description

### Context

PMK-252 stores the docs of a Linear issue as attachments that link to the file on GitHub, with the path in the attachment metadata. It was tested against the fake Linear API only. `scripts/lib/linear/API-VERIFICATION.md` has a PMK-252 section of live checks still owed. Source: PMK-252, PR #211.

### Scope (in)

- One run of `issues get`, `issues update --add-doc` and `--remove-doc`, and `/pmkit:spec:record-decision` against a real Linear workspace.
- Each point in the PMK-252 section confirmed or corrected: attachment create and delete shapes, the metadata, the upsert by URL, and how a hand-made attachment with the same link behaves.

### Out of scope

- New docs features.

### Tasks

- [ ] Add, read and remove a doc on a test issue in a real workspace
- [ ] Correct the mapping where the real API differs from the fake
- [ ] Record the result next to the Linear adapter

## Acceptance criteria

- [ ] Each point in the PMK-252 section of the API verification notes is marked confirmed or corrected, with the date and how it was checked
- [ ] Adding, reading and removing a doc works on a real Linear issue, and a hand-made attachment with the same link is left alone
- [ ] Any difference between the real API and the fake is fixed in the adapter and in the fake, with a test
