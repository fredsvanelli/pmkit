# PMK-344: read sprint issues faster on GitHub

Issue: PMK-344 (EPC-8, feature). Found while working PMK-88 (PR #318, `docs/specs/2026-11-17-pmk-88-github-iterations-milestones-epics-design.md`, "Sprints").

## Intent

`cycle issues <sprint>` reads every issue of the repository and keeps the ones in the sprint on the client, so a big repository pays for its whole history to list one sprint. `cycle add` reads each issue more than it needs to. Make both cheaper without changing what they return.

## Today

- `cycleIssues(id)` in `scripts/lib/github/cycle-ops.mjs` calls `ops.searchIssues({ sprint: id })`. `translateFilter` (`scripts/lib/github/filter.mjs`) has no GitHub filter for a sprint, so `sprintStep` is a client step: `searchIssues` pages through `repository.issues` (all states) and keeps `issue.sprint === id`.
- `moveToCycle` checks every issue first (`ops.writable`, `ops.readNode`), so a bad id writes nothing, then calls `ops.updateIssue` per issue, which reads the issue again (`readNode`) before planning, and reads it a third time for `after`. So two reads before each write.

## Schema facts (GitHub's published schemas, `github/docs`, downloaded 2026-11-21)

`ProjectV2.items` has `query: String` ("Search query for filtering items") and `archivedStates` (default `NOT_ARCHIVED`) on github.com (`fpt`) and GHES 3.20, 3.21 and 3.22. GHES 3.19 has neither. The query uses the Project's filter syntax (`is:issue`, `repo:owner/name`, `iteration:"<title>"`); the schema does not describe the syntax, and no live run has checked it on GHES yet (PMK-351).

## Goals, non-goals, anti-goals

- Goal (criterion 1): on github.com and GHE.com, `cycle issues` reads through `ProjectV2.items(query: ...)`; on GHES it keeps the client scan.
- Goal (criterion 2): `cycle add` reads each issue once before its write.
- Non-goal: `issues list --sprint` keeps the repository scan (the issue names `cycle issues` only; `searchIssues` mixes the sprint with every other filter).
- Anti-goal: `cycle issues` returning anything different from today: the same issues, the same issue shape, the same order (created, oldest first), archived items left out, issues of other repositories left out, drafts and pull requests left out.

## Approaches

1. **A Project items read for `cycle issues`, gated by host (chosen).** A new document `SPRINT_ITEMS` reads `node(id: <project>) { ... on ProjectV2 { items(first, after, query) { nodes { isArchived content { __typename ... on Issue { <the issue fragment> } } } pageInfo } } }` with `query: is:issue repo:<owner/name> iteration:"<title>"`. Each node is completed (`completeNested`) and mapped (`toIssueWithWarnings`) as in `searchIssues`, then kept when its repository is the scope repository and `issue.sprint === id` (two iterations can share a title, so the query narrows and the client step decides), and sorted by created. A title holding `"` cannot be quoted in the filter, so that sprint falls back to the scan. Hosts: `hostFeatures` gains `itemQuery`, true on github.com and GHE.com only.
2. **Add the sprint to `searchIssues` as a server filter.** `repository.issues(filterBy:)` has no iteration filter, and a search API query (`search(type: ISSUE)`) has no Project iteration qualifier that covers a repository. Rejected.
3. **Use the query on GHES 3.20+ too, since the schema has it.** The schema shows the argument but not whether GHES's filter syntax matches github.com's; the issue says to keep the scan on GHES. Not chosen; a question below.

For `cycle add`: `updateIssue` takes an optional `read` (`{ node, issue }` from `readNode`) and skips its own read when given. `moveToCycle` keeps the check loop's reads and passes each one on. The read after the write (`after`) stays: it is what GitHub now holds.

## Design

- `scripts/lib/github/documents.mjs`: `itemQuery` in `hostFeatures`; the `SPRINT_ITEMS` document built with the same issue fragment and field variables as `ISSUES`.
- `scripts/lib/github/issue-ops.mjs`: `sprintIssues(id, title)` (the items read and the client step), and the `read` option of `updateIssue`.
- `scripts/lib/github/cycle-ops.mjs`: `cycleIssues` uses `sprintIssues` when `context.features.itemQuery` and the sprint exists with a quotable title; else the scan, as today. An id that names no sprint returns `[]` with no items read.
- Fake GitHub: answers `SPRINT_ITEMS` with its Project items, applying `is:issue`, `repo:` and `iteration:"<title>"` and leaving archived items out; refuses `items(query:)` on GHES 3.19 on its own schema fact (as PMK-335 did for the other facts).
- Page cap: `paginate`'s 10 pages of 100, as the scan has; `hasMore` past it gives the existing cut warning.

## Tests

- Unit (`cycle-ops.test.mjs`): on github.com `cycle issues` sends `PmkitSprintItems` and no `PmkitIssues`, and returns the same issues as the scan (an archived item, a draft, a pull request, an issue of another repository and an issue of a sprint with the same title are left out); on GHES it sends `PmkitIssues` only; a title with `"` scans.
- Unit: `moveToCycle` of two issues sends two `PmkitIssue` reads before the writes, not four (and the after reads).
- Contract suite: unchanged; it already checks `cycleIssues` on the GitHub tracker against the fake.
- E2E: `scripts/runbook-cycles-epics-github.test.mjs` runs `cycle issues`; it keeps passing, and asserts the read sent `PmkitSprintItems`.

## Left to the builder

Names; whether `sprintIssues` lives in `issue-ops.mjs` or `cycle-ops.mjs`.

## Interview

Pending.
