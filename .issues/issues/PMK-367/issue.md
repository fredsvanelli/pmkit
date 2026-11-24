---
id: PMK-367
title: Check the Jira issue flows against a live site
type: chore
status: in_progress
priority: low
estimate: 3
assignee: fred
parent: EPC-14
related: [PMK-77]
milestone: jira
branch: fredsvanelli/pmk-367-check-jira
created: 2026-11-22T19:57:51.700Z
updated: 2026-11-24T20:21:09Z
---

## Description

PMK-77 built the Jira work-item, transition, link, history and JQL operations from Atlassian's OpenAPI documents and checked them only against the stateful fake Jira (`scripts/fake-jira-issues.mjs`): no Jira credentials existed. Run the issue flows on a real Jira Cloud site once credentials exist, and fix the adapter or the fake where the real answers differ. Spec: `docs/superpowers/specs/2026-11-22-pmk-77-jira-work-items-transitions-links-jql-design.md`, "Live checks".

## Acceptance criteria

- [ ] `issues link A B --kind blocks` makes A block B on the site (the inwardIssue/outwardIssue direction), and related and duplicate read back as pmkit shows them
- [ ] `issues parent X none` clears the parent, and a description with acceptance criteria round-trips through ADF as a Jira task list
- [ ] `issues list --text`, the assignable-users read, the changelog in `search/jql` and the `pmkit.branch` property read in search match the documented shapes
- [ ] A move through a transition with a required Resolution screen lists the field in the dry run and succeeds with `--field`
- [ ] Jira's development panel links a branch named with the lower-case key (`eng-12-slug`); if not, `issues branch` on Jira keeps the key upper case
