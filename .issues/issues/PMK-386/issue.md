---
id: PMK-386
title: Tidy the PMK-83 Jira Product Discovery review minors
type: chore
status: backlog
priority: low
parent: EPC-14
related: [PMK-83]
milestone: jira
created: 2026-11-23T18:14:42.425Z
updated: 2026-11-23T18:14:46Z
---

## Description

Source: the PMK-83 reviews (task reviews, the whole-branch review and review-work). Minor findings left open on the Jira Product Discovery code.

## Acceptance criteria

- [ ] docs/runbooks/product-discovery-jira.md runs the several-JPD-projects case (INVALID_INPUT naming both keys) through the CLI, with a second JPD project in the fake behind an env var
- [ ] jira ideas connect counts implementing-side links of every delivery type in its no-op check, so a site with both Polaris link types gets no duplicate link
- [ ] jira ideas connect with a key that is not an idea does not re-read the Jira discovery
- [ ] jira ideas list re-reads the discovery when the cached JPD project named by --project no longer exists on the site
