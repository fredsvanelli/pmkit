---
id: PMK-384
title: Check the Jira Product Discovery flows against a live site
type: chore
status: done
priority: low
assignee: fred
parent: EPC-14
related: [PMK-83, PMK-402]
milestone: jira
branch: fredsvanelli/pmk-384-check
created: 2026-11-23T18:14:42.217Z
updated: 2026-11-25T15:31:31Z
---

## Description

Source: PMK-83. The Jira Product Discovery commands were checked against the fake Jira only; no Jira credentials existed.

## Acceptance criteria

- [ ] jira ideas list on a live site with a JPD project: the Votes field is a jira.polaris:votes field and search returns its number (or note that it returns null)
- [ ] The delivery link type name (Polaris work item link or Polaris issue link) and its inward and outward text match what pmkit reads, and jira ideas connect makes the epic show in the idea's Delivery tab
- [x] A site without JPD answers available false with the hint
