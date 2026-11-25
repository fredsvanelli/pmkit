---
id: PMK-396
title: Gate Jira release writes on the releases capability
type: feature
status: backlog
priority: medium
estimate: 2
parent: EPC-14
related: [PMK-393]
milestone: jira
created: 2026-11-24T23:59:59.143Z
updated: 2026-11-24T23:59:59Z
---

## Description

Follow-up of PMK-393 (interview Q3). On Jira, `release create`, `release mark-released`, and `issues create`/`update --release` write versions without reading the `releases` capability. On a team-managed space whose Releases feature is off, `capabilities` now reports `releases` absent with "Turn on Releases in space KEY's features" (PMK-393), but these writes still go to Jira and fail there: the create screen has no `fixVersions` field. The release-notes and release-readiness flows already read the entry; on Linear the release writes are gated (`scripts/lib/linear/tracker.mjs`).

## Acceptance criteria

- [ ] On Jira, release create, release mark-released and a --release write answer NOT_SUPPORTED with the releases enableHint when the manifest has releases absent, before any write
- [ ] A runbook step on a team-managed space with Releases off covers it
