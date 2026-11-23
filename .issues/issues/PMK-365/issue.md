---
id: PMK-365
title: Set up pmkit on a Jira site
type: feature
status: in_progress
priority: low
estimate: 5
assignee: fred
parent: EPC-7
blocked_by: [PMK-77, PMK-76]
milestone: jira
branch: fredsvanelli/pmk-365-setup-pmkit
created: 2026-11-22T19:14:24.247Z
updated: 2026-11-23T00:03:16Z
---

## Description

ADR 0013 describes what `/pmkit:setup` does for Jira (run `discover --json`, AUTH and NOT_SUPPORTED guidance, write `tracker.scope.site` and `tracker.scope.space`), but no EPC-7 issue owned it. PMK-76 adds `discover` and `capabilities` for Jira and leaves setup out (PMK-76 design, resolved question 1). Until this lands, a Jira `.pmkit/config.yaml` is written by hand. Field mappings hold the Jira field id (ADR 0014).

## Acceptance criteria

- [ ] `init --tracker jira --site <host> --space <KEY>` reads the site through discovery and returns the questions setup must ask: statuses for backlog, in_review and canceled (blocked is not asked: on Jira it comes from Blocks links); the field roles the Jira code reads through mappings.fields, estimate and acceptance_criteria (offered by name, written as the field id); each pmkit type to a work type
- [ ] `/pmkit:setup` offers Jira and walks the first run and an existing Jira config, with the AUTH and NOT_SUPPORTED guidance of ADR 0013
- [ ] A runbook and its E2E test on the fake Jira fetch
