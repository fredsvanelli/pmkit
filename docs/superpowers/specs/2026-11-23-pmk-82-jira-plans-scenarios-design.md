# PMK-82: The jira-plans-scenarios command

Issue PMK-82, epic EPC-7 (Jira tracker adapter and Bitbucket git host), milestone `jira`. Acceptance criteria: "Reads plans, scenarios, per-team capacity and schedule dependencies" and "Without Premium it says the capability is absent". Written on 2026-11-23 by a dispatched worker with no live user dialogue, from the issue, ADR 0013 to 0017, the PMK-43 (Linear triage rotation) and PMK-90 (GitHub Discussions) system-specific commands, the Jira adapter code and Atlassian's published OpenAPI document for the Jira Cloud platform REST API v3 (`swagger-v3.v3.json`, read on 2026-11-23). Calls marked **(builder's call)** change no acceptance criterion; the owner can override any of them. Status: approved by the owner (Orca coordinator) on 2026-11-23, with yes to Q1 to Q4 in "Interview answers". No Jira credentials exist, so nothing here was checked against a live site.

## Intent

The Unified model lists `jira-plans-scenarios` as a Jira-only skill for Jira Premium: "Reads cross-team plans, alternative scenarios, per-team capacity and schedule dependencies". pmkit already reads one space's sprints and capacity (PMK-78), but a Jira Premium site plans across teams and spaces in Plans (formerly Advanced Roadmaps), which no pmkit command reads. A PM asking "what does the cross-team plan say, and how much can each team take on" today has to open Jira.

## Goals

- `/pmkit:jira:plans-scenarios`, a read-only command, in `commands/jira/plans-scenarios.md`, as `/pmkit:linear:triage-rotation` and `/pmkit:github:discussions` are for their systems.
- `pmkit jira plans list`: the site's plans, each with its status, its default scenario and its issue sources.
- `pmkit jira plans get <id>`: one plan with its scheduling settings (how dependencies schedule, the estimation unit, inferred dates, the start and end date fields), its scenario, its cross-project releases, and every team in it with its planning style, sprint length and capacity.
- On a site without Premium (or a token owner without the permission Plans needs), both commands answer `available: false` with a reason and a hint, and the command file says the capability is absent and stops.

## Non-goals

- Writes: creating, updating, duplicating, archiving or trashing a plan, or adding and editing teams. The issue asks for reads; writes can come as their own issue.
- Reading the work items of a plan through its issue sources, or computing a plan's schedule. Jira computes the schedule in the browser; the REST API does not return it.
- Atlassian team names: `getTeams` returns a name only for a plan-only team, and Atlassian's Teams API lives under `/gateway/api/public/teams`, outside the two path prefixes the Jira client allows (PMK-75). An Atlassian team shows by id.
- A new capability id. The manifest's 20 ids come from the Unified model's capability list, which has no plans entry; system-specific commands answer `available` themselves (PMK-43, PMK-90) **(builder's call)**.
- Live checks: recorded as skipped and filed under EPC-14.

## Anti-goals

- A command that claims a scenario, capacity or dependency it did not read.
- A Premium refusal that surfaces as a raw `AUTH` error, which reads as a bad token.
- Undocumented endpoints (`/rest/jpo/...`), which the client refuses and Atlassian can change without notice.

## Facts from Atlassian's Jira Cloud OpenAPI document (unverified on a live site)

Every call below needs Jira Premium (or Enterprise) and the *Administer Jira* global permission. Each answers 403 "if the site has no premium edition of Jira or if the user does not have the Administer Jira global permission", so pmkit cannot tell the two causes apart.

| Call | Answer |
|---|---|
| `GET /rest/api/3/plans/plan?includeTrashed&includeArchived&cursor&maxResults` (at most 50) | Cursor page `{ cursor, last, nextPageCursor, size, total, values }`; each value `{ id, name, status: Active\|Trashed\|Archived, scenarioId, issueSources: [{ type, value }] }`. `scenarioId` is the plan's default scenario. |
| `GET /rest/api/3/plans/plan/{planId}` | `{ id, name, status, leadAccountId, lastSaved, issueSources, scheduling, crossProjectReleases: [{ name, releaseIds }], customFields, exclusionRules, permissions }`. `scheduling` is `{ dependencies: Sequential\|Concurrent, estimation: StoryPoints\|Days\|Hours, inferredDates: None\|SprintDates\|ReleaseDates\|AnySprintDates, startDate, endDate }` (date fields `{ type, dateCustomFieldId? }`). 404 when the plan is not found. |
| `GET /rest/api/3/plans/plan/{planId}/team?cursor&maxResults` | Cursor page; each value `{ id, type: PlanOnly\|Atlassian, name }` (name only for PlanOnly). |
| `GET /rest/api/3/plans/plan/{planId}/team/planonly/{teamId}` | `{ id, name, capacity, issueSourceId, memberAccountIds, planningStyle: Scrum\|Kanban, sprintLength }` |
| `GET /rest/api/3/plans/plan/{planId}/team/atlassian/{teamId}` | `{ id, capacity, issueSourceId, planningStyle, sprintLength }` |

No public endpoint lists a plan's scenarios or reads a non-default scenario: the only scenario the API exposes is `scenarioId` in the list.

## Approaches

1. **The public Plans API, read-only, as a `jira plans` command group (recommended).** Two CLI reads, a `plans` feature on the Jira tracker (as `triage` on Linear and `discussions` on GitHub), a command file, a runbook with an E2E test on the fake Jira. Documented, inside the client's allowed paths, and the 403 maps to `available: false`. Its limit: scenarios beyond the default one are not readable (Q1).
2. **The private `/rest/jpo/1.0/` endpoints the Plans UI uses.** Would reach every scenario and the computed schedule, but they are undocumented, can change without notice, and need the client's path guard widened. Rejected (anti-goal).
3. **Plans as a capability in the manifest, served by contract operations.** Every tracker would carry a `plans` operation that only Jira serves, and the Unified model's capability list would change. Rejected: PMK-43 and PMK-90 set the pattern of system-only commands outside the contract.

## The result shapes

`jira plans list [--archived] [--trashed] [--limit n]`:

```json
{ "available": true, "site": "acme.atlassian.net",
  "plans": [{ "id": "12", "name": "Q1 roadmap", "status": "active", "scenario": { "id": "34", "default": true },
              "sources": [{ "type": "board", "id": 7 }] }],
  "hasMore": false, "warnings": [] }
```

`jira plans get <id>`:

```json
{ "available": true, "site": "acme.atlassian.net",
  "plan": { "id": "12", "name": "Q1 roadmap", "status": "active", "lead": "acc-1", "lastSaved": "2026-11-20T10:00:00Z",
            "sources": [{ "type": "board", "id": 7 }],
            "scenario": { "id": "34", "default": true },
            "scheduling": { "dependencies": "sequential", "estimation": "story_points", "inferredDates": "sprint_dates",
                            "startDate": { "type": "DueDate" }, "endDate": { "type": "TargetEndDate" } },
            "releases": [{ "name": "Spring launch", "versionIds": [10001, 10002] }],
            "teams": [{ "id": "5", "type": "plan_only", "name": "Payments", "planningStyle": "scrum", "sprintLength": 14,
                        "capacity": 30, "capacityUnit": "story points per sprint", "source": 7, "members": ["acc-1"] }] },
  "warnings": [] }
```

- Enum values in snake case, as pmkit writes its own values **(builder's call)**.
- `capacityUnit` joins the plan's estimation unit with "per sprint" for a Scrum team and "per week" for a Kanban team, which is how Jira Plans states capacity (unverified, listed for the live check) **(builder's call)**.
- `scenario` is the plan's default scenario, from the list call (`get` reads it there too, since `getPlan` has no `scenarioId`) (Q1).
- A team whose detail read fails (404: removed since the list) is left out with a warning; any other failure fails the command **(builder's call)**.
- Without Premium or the permission (a 403 on the first Plans call): `{ "available": false, "reason": "premium", "enableHint": "Jira Plans need Jira Premium or Enterprise, and the token's owner needs the Administer Jira global permission", "site": "..." }`. A 401 stays `AUTH` (bad token); a 404 on `get` stays `NOT_FOUND`.

## Paging

The Plans API pages with `cursor` and `nextPageCursor`, which `client.paginate` (offset or `nextPageToken`) does not read. `paginate` learns a third list style: a page with `nextPageCursor` sends it back as `cursor` and ends at `last: true` **(builder's call)**. The 10-page cap without a limit stays.

## Schedule dependencies

The plan's `scheduling.dependencies` says whether dependent work schedules one after the other (`sequential`) or may overlap (`concurrent`). The dependencies themselves are Jira issue links, which `pmkit issues dependencies` and `/pmkit:issues:dependencies` already read (PMK-77). The command shows the setting and points to `/pmkit:issues:dependencies` for the links (Q2).

## Wiring

- `scripts/lib/jira/plans.mjs`: `createJiraPlans(client, { site })` with `list(options)` and `get(id)`, and pure mappers. The Jira tracker exposes it as `tracker.plans`.
- `scripts/pmkit.mjs`: a `jira: true` command flag and `ctx.jira(feature)`, as `linear: true` and `github: true` do; on another tracker the CLI answers `NOT_SUPPORTED`. Two commands, `jira plans list` and `jira plans get`, with text output.
- `commands/jira/plans-scenarios.md`: (1) `capabilities`; stop when the tracker is not `jira`; (2) `jira plans list`; on `available: false` print the reason and hint, say the capability is absent, stop; (3) table of plans; ask which plan when there are several (the user may name one in the arguments); (4) `jira plans get <id>`; show the scheduling, the scenario, the releases and the teams' capacity; (5) point to `/pmkit:issues:dependencies` for the links. No write, so no confirmation point.
- Listed in `skills/pmkit/SKILL.md`, `README.md` and `scripts/plugin.test.mjs`.
- `docs/runbooks/plans-jira.md` with `scripts/runbook-plans-jira.test.mjs` (fake Jira routes for the Plans calls, a Premium site and a 403 site). Live check: skipped, with an EPC-14 follow-up.
- No ADR: every decision here is reversible by a later change. CONTEXT.md gains **Plan** and **Scenario**.

## Interview answers (owner, 2026-11-23)

- **Q1. Scenarios: yes.** Show each plan's default scenario and say that other scenarios are not readable through Jira's public API. No private `/rest/jpo` endpoints. A follow-up in EPC-14 revisits this when Atlassian publishes a scenarios API.
- **Q2. Schedule dependencies: yes.** Show the plan's dependency scheduling setting (`sequential` or `concurrent`) and point to `/pmkit:issues:dependencies` for the blocking links; the command does not read the plan's work items.
- **Q3. Absent capability: yes.** The command answers `available: false` with a reason and a hint, as the Linear triage and GitHub Discussions commands do. The manifest's 20 capabilities stay unchanged.
- **Q4. Scope: yes.** Plans are site-wide and cross-space, so `jira plans list` lists every plan on `tracker.scope.site`, not filtered by `tracker.scope.space`.
- CONTEXT.md gains **Plan** and **Scenario**; no ADR.

## Left to the builder

Text output wording, test names, the fake's fixtures, and the order of the tasks.
