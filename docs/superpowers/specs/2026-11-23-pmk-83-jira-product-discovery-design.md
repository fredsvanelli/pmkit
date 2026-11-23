# PMK-83: The jira-product-discovery command

Issue PMK-83, epic EPC-7 (Jira tracker adapter and Bitbucket git host), milestone `jira`. Acceptance criteria: "Lists ideas with insights and votes" and "Connects an idea to an epic after confirmation". Written on 2026-11-23 by a dispatched worker with no live user dialogue, from the issue, ADR 0013 to 0017, the PMK-82 (`/pmkit:jira:plans-scenarios`) and PMK-90 (`/pmkit:github:discussions`) system-specific commands, the Jira adapter code, Atlassian's Jira Product Discovery (JPD) docs and Atlassian's JPD reference app (`github.com/Jira-Product-Discovery-Integrations/polaris-forge-ref-app`, read on 2026-11-23). Calls marked **(builder's call)** change no acceptance criterion; the owner can override any of them. Status: draft, waiting for the owner's answers in Interview. No Jira credentials exist, so nothing here was checked against a live site.

## Intent

The Unified model lists `jira-product-discovery` as a Jira-only skill: "Manages ideas, insights and votes and connects them to epics". A PM using JPD collects ideas, attaches insights (customer evidence) and lets people vote, then hands a chosen idea to delivery by linking it to an epic. pmkit already reads and writes the space's epics (PMK-79) but cannot see ideas, so the question "which ideas have the most evidence and votes, and which are already in delivery" needs Jira's UI today, and so does the hand-off.

## Goals

- `/pmkit:jira:product-discovery` in `commands/jira/product-discovery.md`, as `/pmkit:jira:plans-scenarios` is for Plans.
- `pmkit jira ideas list [--project KEY] [--limit n]`: the ideas of one JPD project, each with its status, its votes, its insights and the epics it is connected to.
- `pmkit jira ideas connect <idea> <epic> [--dry-run]`: links the idea to an epic of `tracker.scope.space` with JPD's delivery link, as the "Link existing work item" button of the idea's Delivery tab does. The command file shows the dry run and asks before the real run.
- On a site with no JPD project, `jira ideas list` answers `available: false` with a reason and a hint, and the command file says so and stops.

## Non-goals

- Creating, editing, archiving or merging ideas, and adding or editing insights. JPD has no public write API for insights; idea writes can come as their own issue.
- Casting or changing votes. The Votes field is a JPD dynamic field that JPD itself computes.
- Disconnecting an idea from an epic. `pmkit issues unlink` handles only blocks, related and duplicate; a follow-up can add it.
- JPD views, which have no public API.
- A new capability id in the manifest. As with Plans (PMK-82), a system-specific command answers `available` itself **(builder's call)**.
- Live checks: recorded as skipped and filed under EPC-14.

## Anti-goals

- A vote or insight count the command did not read. A value Jira did not return shows as unread (`null`) with a warning, never as `0`.
- A connection made without a confirmation, or to a work item that is not an epic of the configured space.
- An insights failure that hides the ideas: the list still answers, with a warning.

## Facts (unverified on a live site)

- An idea is an ordinary Jira work item in a project whose `projectTypeKey` is `product_discovery`. The Jira REST API reads it like any work item, but "will return all fields except dynamic fields (e.g. formula fields)" (Atlassian's JPD integrations guide).
- Discovery (PMK-76) already reads every project of the site (`spaces`, with `type`) and the site's link types (`linkTypes`), so finding JPD projects and JPD's link type costs no new call.
- **Votes**: each JPD project has a project-scoped custom field whose schema is `{ type: "number", custom: "jira.polaris:votes" }` (community answer with a `GET /rest/api/3/field` dump). A project can have more than one. JPD lists Votes among its dynamic fields, so search may return it as `null`.
- **Insights**: the Insights count is a dynamic field (not returned). Insights themselves are read through Atlassian's GraphQL API, query `polarisInsights(project: ID!, container: ID)`, with the header `X-ExperimentalApi: polaris-v0`. Each insight has an ARI `id`, a `description` in ADF, `created`, `updated` and `snippets` (each with a `url` and `data`). `project` is the project ARI `ari:cloud:jira:<cloudId>:project/<id>`, `container` the idea's ARI `ari:cloud:jira:<cloudId>:issue/<id>`. Atlassian calls the API experimental; the reference app calls it with OAuth 3LO on `api-private.atlassian.com/graphql`. Whether the site's gateway (`https://<site>/gateway/api/graphql`) accepts the API token is unverified; Atlassian announced that some GraphQL queries stop accepting classic API tokens.
- **Delivery link**: JPD adds the link types "Polaris work item link" (named "Polaris issue link" on older sites), "Polaris datapoint issue link" and "Polaris merge issue link". The delivery link joins an idea and its delivery work: the delivery work "implements" the idea, the idea "is implemented by" it. A new link is `POST /rest/api/3/issueLink`, as PMK-77's `link` does.

## Approaches

1. **Ideas and votes through REST, insights through the experimental GraphQL API, connect through the delivery link (recommended).** Meets both criteria with real insight content (count, text, source links). Cost: the client gains one more allowed path (`POST /gateway/api/graphql`, nothing else), the API can change without notice, and the token may be refused; when it is, the list still answers with `insights: null` and a warning (Q1).
2. **REST only; insights reported unread.** No new path, nothing experimental, but the first criterion ("with insights") is met only as "unreadable", on every site.
3. **REST only; insights counted from "Polaris datapoint issue link" links.** Cheap, but those links join ideas to other work items used as evidence, not JPD's insights; the count would be wrong on most sites. Rejected (anti-goal).

## Which JPD project (Q2)

Ideas live in a JPD project, not in `tracker.scope.space`. `jira ideas list` takes `--project KEY`; without it, it uses the site's only JPD project, and with several it answers `INVALID_INPUT` listing their keys so the command file can ask which one. No config key **(builder's call: recommended)**. Alternative: a new `tracker.scope.discovery` key set in setup.

## Result shapes

`jira ideas list [--project KEY] [--limit n]` (default limit 50, newest first) **(builder's call)**:

```json
{ "available": true, "site": "acme.atlassian.net", "project": { "key": "IDEA", "name": "Ideas" },
  "ideas": [{ "id": "IDEA-12", "title": "Bulk export", "status": "Discovery",
              "votes": [{ "field": "Votes", "value": 7 }],
              "insights": { "count": 2, "items": [{ "id": "ari:...:polaris-insight/10004", "text": "Three customers asked …", "urls": ["https://…"], "created": "2026-11-20T10:00:00Z" }] },
              "epics": ["PAY-40"] }],
  "hasMore": false, "warnings": [] }
```

- `votes`: one entry per `jira.polaris:votes` field of the project, by field name, with `value` a number or `null` when Jira did not return it (then one warning for the list). A project with no votes field gives `[]`.
- `insights`: `null` with one warning when the GraphQL call is refused or fails (Q1); `text` is the ADF description as plain text, cut to 200 characters **(builder's call)**.
- `epics`: the keys linked by the delivery link, either direction, any project (delivery work can be a non-epic too; the command labels the column "delivery") **(builder's call)**.
- No JPD project on the site: `{ "available": false, "reason": "no_discovery_project", "enableHint": "Create a Jira Product Discovery project on <site>, or check that the token's owner can browse one", "site": "..." }`.

`jira ideas connect <idea> <epic> [--dry-run]`:

```json
{ "idea": "IDEA-12", "epic": "PAY-40", "linkType": "Polaris work item link", "before": { "epics": [] }, "after": { "epics": ["PAY-40"] } }
```

- `<idea>` must be a work item of a JPD project and `<epic>` an epic of `tracker.scope.space` (ADR 0017, read through `getDeliverable`); anything else is `NOT_FOUND` (Q3).
- Already connected: no write, `before` equals `after`.
- No delivery link type on the site: `NOT_SUPPORTED`, "Jira Product Discovery's delivery link type is missing".
- Direction: the epic is the side whose description is "implements"; the code reads the link type's `inward` and `outward` text, so a site whose type is reversed still links the right way **(builder's call)**.

## Wiring

- `scripts/lib/jira/discovery-ideas.mjs` **(builder's call on the name)**: `ideaOperations({ client, site, getContext, epics })` with `list(options)` and `connect(idea, epic, { dryRun })`, and pure mappers. Exposed as `tracker.ideas` beside `tracker.plans`. `connect` runs through `guarded` (it reads the epic mapping); `list` reads the discovery context for spaces and link types.
- `scripts/lib/jira/client.mjs`: `graphql(query, variables)` posts to `/gateway/api/graphql` with `X-ExperimentalApi: polaris-v0`; the REST path guard is unchanged. The cloud id for the ARIs comes from the GraphQL query `tenantContexts(hostNames: [site]) { cloudId }` (unverified).
- `scripts/pmkit.mjs`: `jira ideas list` and `jira ideas connect`, `jira: true`, with text output in `scripts/lib/jira/ideas-text.mjs`.
- `commands/jira/product-discovery.md`: (1) `capabilities`, stop when not `jira`; (2) `jira ideas list`, ask which project when several; on `available: false` print the hint and stop; (3) table of ideas sorted by votes, with insights count, delivery and warnings; (4) when the user wants to connect an idea, `jira ideas connect --dry-run`, show before and after, ask once, then the real run. One confirmation point.
- Listed in `skills/pmkit/SKILL.md`, `README.md` and `scripts/plugin.test.mjs`.
- `docs/runbooks/product-discovery-jira.md` with `scripts/runbook-product-discovery-jira.test.mjs` on the fake Jira (a JPD project with votes and a GraphQL route; a site without JPD; a GraphQL refusal). Live check: skipped, with an EPC-14 follow-up.
- CONTEXT.md gains **Idea**, **Insight** and **Vote** (distinct from **Demand signal**). An ADR only if Q1 chooses the GraphQL path, since widening the client's allowed paths is hard to take back once commands rely on it.

## Open questions for the owner (Interview)

- **Q1. Insights source.** Approach 1 (experimental GraphQL, degrade to `null` with a warning) or approach 2 (insights always reported unreadable)? Recommended: 1.
- **Q2. Which JPD project.** `--project KEY`, else the only JPD project, else ask; or a config key? Recommended: the flag.
- **Q3. Connect target.** Only epics of `tracker.scope.space`, or any epic-level work item on the site? Recommended: the configured space, as every other pmkit epic command.
- **Q4. Votes when Jira returns none.** Show `null` with a warning (recommended) or leave the votes column out?

## Left to the builder

Text output wording, test names, the fake's fixtures, file names and the order of the tasks.
