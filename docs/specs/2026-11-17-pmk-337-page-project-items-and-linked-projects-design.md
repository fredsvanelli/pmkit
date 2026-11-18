# PMK-337 design: page through Project items and linked Projects past the first 20

Issue PMK-337, epic EPC-8 (GitHub Issues tracker adapter), milestone `github-issues`. Status: approved by the user on 2026-11-17, with the builder's calls. The issue needs no design decision from the user: the PMK-87 spec already rules that "a nested connection with `hasNextPage` gets its remaining pages read before the issue is mapped", and this change applies that rule to the three reads it missed. Calls marked **(builder's call)** change no acceptance criterion.

## Problem

`utils:review-work` on PMK-87 (PR #311) and PMK-91 (PR #317) found three GitHub reads that stop at 20 Project entries:

1. The blocker read. `blockedBy` in the issue fragment selects `projectItems(first: 20)` on each blocker for its Status. A blocker that is in more than 20 Projects can lose the configured Project's item, so it reads `Open` and `issues list --blocked` gets it wrong.
2. The metric read. `METRIC_ISSUES` selects `projectItems(first: 20, includeArchived: true)` on each issue. A reopened issue in more than 20 Projects can lose its Status, so its `ReopenedEvent` names `Open` instead of the option it holds.
3. `fetchLinkedProjects` reads `projectsV2(first: 20)`. With more than 20 linked Projects, setup's Project question misses some, and `github draft-issues --project` refuses a linked Project past the 20th.

Acceptance criteria:

1. Both `projectItems` reads page through every Project item, or find the configured Project's item directly.
2. `fetchLinkedProjects` pages through every linked Project.
3. Tests cover more than 20 Project items and more than 20 linked Projects.

## Decisions already made

- The adapter reads the configured Project's item only, and a nested connection with more pages gets them read before the issue is mapped (PMK-87 spec, "The issue fragment"). `completeNested` in `scripts/lib/github/issue-ops.mjs` does it today for the issue's own `projectItems`, by rereading the whole connection with `MORE('projectItems')` through `client.paginate`.
- Every read goes through the client of `scripts/lib/github/client.mjs` and its `paginate` (PMK-85).
- No dependencies (ADR 0003).

## Facts checked

- GitHub has no argument on `Issue.projectItems` that picks one Project, and `ProjectV2.items` cannot filter by issue on GHES 3.19 (PMK-91 spec, "Facts checked"). So "find the configured Project's item directly" is not available on every host, and pmkit pages instead.
- The blocker selection reads `projectItems` without `includeArchived`, so an archived item of a blocker is not read today, and the blocker reads `Open` or `Closed` from its state. `MORE('projectItems')` reads with `includeArchived: true`.
- The stateful fake already pages `PmkitLinkedProjects` and `PmkitIssueMore_projectItems` by `first` and `after`. It caps an issue's own `projectItems` at 20, but returns every item of a blocker in one list with no `pageInfo`.

## Design

### The blocker and metric reads (criterion 1)

Both selections add `pageInfo { hasNextPage endCursor }` to their `projectItems`. After the read, any node whose `projectItems.pageInfo.hasNextPage` is `true` gets its whole item list read again with the existing `MORE('projectItems')` document and `client.paginate` (page size 100), and the result replaces the cut list. A cursor from the first read cannot continue a read with other arguments, so the reread starts from the first item, as `completeNested` does **(builder's call)**.

- Blockers: `completeNested` already pages `blockedBy`. Right after, it completes the `projectItems` of each blocker node, from the fragment or from the `blockedBy` pages. The reread includes archived items, so pmkit drops them to keep today's rule: a blocker's archived item gives no Status **(builder's call)**.
- Metrics: `metricEvents` in `scripts/lib/github/history-ops.mjs` completes each issue node before `toEvents` maps it. The metric selection already includes archived items, so the reread keeps them.

One shared helper, `completeProjectItems(client, context, node, { archived })`, does both. It lives next to `docsOf` in `scripts/lib/github/requests.mjs`, which both operation modules import already **(builder's call)**. A node within 20 items costs no extra request.

### Linked Projects (criterion 2)

`LINKED_PROJECTS_QUERY` takes `$first` and `$after` and selects `pageInfo { hasNextPage endCursor }`. `fetchLinkedProjects` reads it through `client.paginate` with page size 100. The operation name stays `PmkitLinkedProjects`, so the fixtures and the fake answer it unchanged.

### Page cap

`paginate` stops after 10 pages when no cap is given: 1000 items for an issue, 1000 linked Projects. Both are far past what a repository holds, so pmkit keeps that cap and adds no warning **(builder's call)**.

### The fake GitHub (criterion 3)

`scripts/fake-github-issues.mjs` gives each blocker's `projectItems` a connection capped at 20 with `pageInfo`, without archived items, as GitHub does for a read without `includeArchived`. `PmkitLinkedProjects` applies a page size written in the document, such as the old `projectsV2(first: 20)`, so a test fails against the old query. The issue's own `projectItems` and the metric read page already. A blocker's `projectItems` and `PmkitLinkedProjects` answer the same way as before for 20 entries or fewer **(builder's call, found during the build)**.

## Tests

- `scripts/lib/github/issue-ops.test.mjs`: a blocker whose configured item, in Done, comes after 20 other items does not block in `searchIssues({ blocked })`; with that item archived the blocker still blocks.
- `scripts/lib/github/history-ops.test.mjs`: a reopened issue whose configured item comes after 20 other items names its option in the `ReopenedEvent`.
- `scripts/lib/github/discovery.test.mjs`: `fetchLinkedProjects` over a fake with 151 linked Projects returns all of them in two reads of 100.
- `scripts/fake-github-issues.test.mjs`: a blocker's `projectItems` stops at 20 with `hasNextPage: true`.
- `scripts/lib/github/discovery.test.mjs`: a repository answer with no `repository` still lists no Projects, as before the read paged.
- Runbooks: `docs/runbooks/draft-issues-github.md` gains step 8, `github draft-issues list --project acme/220` with 120 extra linked Projects, so `--project` needs a second page of linked Projects; `scripts/runbook-draft-issues-github.test.mjs` runs it. `docs/runbooks/setup-github.md` says that the Project question lists every linked Project. The `issues-github` and `setup-github` flows keep their steps, and their E2E tests run unchanged.

## Out of scope

- The `issueFieldValues(first: 20)` read of the fragment. It is per issue and GitHub caps issue fields per organization; it is not part of this issue.
- `LINKED_EPICS_QUERY` in `scripts/lib/github/project-ops.mjs`, which pages already.
