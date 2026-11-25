---
id: PMK-402
title: Check the Jira Product Discovery flows on a site with Jira Product Discovery
type: chore
status: backlog
priority: low
parent: EPC-14
related: [PMK-384]
milestone: jira
created: 2026-11-25T05:50:57.138Z
updated: 2026-11-25T05:51:15Z
---

## Description

Source: PMK-384. The owner's site has no Jira Product Discovery installed (no JPD project, no Polaris link type, no jira.polaris field), so PMK-384 checked only the off path live. Needs a site with Jira Product Discovery and one JPD project; extend the PMK-384 test in scripts/lib/jira/client-live.mjs, which skips on such a site today.

## Acceptance criteria

- [ ] jira ideas list on a live site with a JPD project: the Votes field is a jira.polaris:votes field and search returns its number (or note that it returns null)
- [ ] The delivery link type name (Polaris work item link or Polaris issue link) and its inward and outward text match what pmkit reads, and jira ideas connect makes the epic show in the idea's Delivery tab
- [ ] Every idea, epic and link the check creates is deleted afterwards
