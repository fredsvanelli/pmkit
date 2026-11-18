# PMK-337 plan: page through Project items and linked Projects past the first 20

Design: `docs/specs/2026-11-17-pmk-337-page-project-items-and-linked-projects-design.md`. Small task, run in sequence by one agent, test first.

## Task 1: the fake pages a blocker's Project items

1. Test in `scripts/fake-github-issues.test.mjs`: a blocker in 25 Projects answers 20 `projectItems` with `hasNextPage: true` inside `blockedBy`.
2. Run it and see it fail.
3. In `listsOf` of `scripts/fake-github-issues.mjs`, wrap the blocker's items in `connection(items, NESTED.projectItems)`.
4. Run the fake's tests.

## Task 2: blockers read every Project item

1. Tests in `scripts/lib/github/issue-ops.test.mjs`, with a fake of 25 linked epic Projects: a blocker that is in the 25 epics before the configured Project reads as an open blocker in `getIssue` and `searchIssues({ blocked: true })`; with its configured item archived it does not block.
2. Run them and see them fail.
3. `documents.mjs`: add `pageInfo { hasNextPage endCursor }` to `statusSelection` and to the metric `projectItems`.
4. `requests.mjs`: `completeProjectItems(client, context, node, { archived })` rereads `MORE('projectItems')` with `client.paginate` when `node.projectItems.pageInfo.hasNextPage` is true, and drops archived items unless `archived`.
5. `issue-ops.mjs`: after the nested connections, complete each blocker node's items with `archived: false`.
6. Run the tests.

## Task 3: metric events read every Project item

1. Test in `scripts/lib/github/history-ops.test.mjs`: a reopened issue in 25 epics before the configured Project names its option in the `ReopenedEvent`.
2. See it fail, then complete each metric node with `archived: true` in `metricEvents`.

## Task 4: fetchLinkedProjects pages

1. Test in `scripts/lib/github/discovery.test.mjs`: over the stateful fake with 25 linked epics plus the scope Project, `fetchLinkedProjects` returns 26 Projects in two or more reads.
2. See it fail, then add `$first`, `$after` and `pageInfo` to `LINKED_PROJECTS_QUERY` and read it with `client.paginate` at 100 per page. The fixture-based fake answers with `pageInfo.hasNextPage: false` already.

## Task 5: runbook and checks

1. `docs/runbooks/draft-issues-github.md` and its E2E test: if the runbook fake can seed more than 20 linked Projects, check that `--project` accepts the last one.
2. Run `npm test` and compare failures with the known PMK-333 list.
