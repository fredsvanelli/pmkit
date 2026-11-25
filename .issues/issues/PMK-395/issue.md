---
id: PMK-395
title: Name Jira history work types by id on a site in another language
type: chore
status: backlog
priority: low
estimate: 1
parent: EPC-14
related: [PMK-367]
milestone: jira
created: 2026-11-24T21:49:29.828Z
updated: 2026-11-24T21:49:36Z
---

## Description

PMK-367 found live that Jira's changelog names statuses in English while a site in another language shows them translated, and fixed history to name a status by its id. A work-type change likely has the same shape: `history.mjs` reads an `issuetype` change's `fromString`/`toString` through `typeOfName`, and the created item's type through `startOf(histories, 'issuetype', ...)`, while `mappings.types` holds the shown name (`História`). On a Portuguese site a type change would then read `Story` instead of `feature`, and `metrics throughput` would count it under `Story`. Not seen live: the PMK-367 live test never changes a type.

## Acceptance criteria

- [ ] A live probe on a site in another language records what Jira's changelog gives for a work-type change (`fromString`/`toString`, `from`/`to`)
- [ ] If the names are English, history and the metrics name the type by its id against the space's work types, as statuses are since PMK-367, with a unit test and a runbook step on the Portuguese fake
