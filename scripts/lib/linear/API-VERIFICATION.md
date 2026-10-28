# Linear API verification

Checked on 2026-10-27 against the sandbox workspace (Free plan) at `https://api.linear.app/graphql`, with a personal API key and no write. `verify-api.mjs` in this folder ran the checks. The folder holds a verification tool and no adapter code yet.

To repeat the check:

```
set -a; . ./.env; set +a; PMKIT_LIVE=1 node scripts/lib/linear/verify-api.mjs
```

Without `PMKIT_LIVE=1` the script sends nothing. It sends only queries and refuses a document that starts with `mutation`. Use the shell to put the key in the environment so it never appears on a command line.

## Summary

| Feature | Answer | API object | Access | Plan | Verified by | Caveat |
|---|---|---|---|---|---|---|
| Recurring issues | yes | `Issue.recurringIssueTemplate` (type `Template`) | read | no page found | schema, live read | Schedule and rules are not in the API. |
| Dependencies between projects | yes | `ProjectRelation`; `projectRelations`; `projectRelationCreate`, `projectRelationUpdate`, `projectRelationDelete` | read/write | no plan stated | schema, live read, docs | Write access comes from the schema only. A relation can also point at a milestone (`anchorType`, `relatedAnchorType`). |
| Releases | yes | `Release`, `ReleasePipeline`, `ReleaseStage`; `releases`, `releasePipelines`; `releaseCreate`, `releaseComplete`, `issueToReleaseCreate`; `Issue.releases` | read/write | Business and Enterprise | schema, live read, docs | `Organization.releasesEnabled` is `false` on this workspace. Write access comes from the schema only. |
| Insights | no | none | none | Business and Enterprise (UI) | schema, docs | PMK-33 treats `native_metrics` as `derived`. |
| Triage responsibility and Triage Intelligence | yes | `Team.triageResponsibility`, `TriageResponsibility`, `TimeSchedule`; `triageResponsibilityCreate`, `triageResponsibilityUpdate`, `triageResponsibilityDelete`; `IssueSuggestion`, `Issue.suggestions` | read/write for triage responsibility, read for suggestions | Business and Enterprise | schema, live read, docs | The mutations come from the schema only. Both reads answer on Free, so the plan decides. |

## Recurring issues

Matches for `recurr`: `Issue.recurringIssueTemplate` and `IssueSearchResult.recurringIssueTemplate`. No type, query or mutation has `recurr` in its name. `Issue.recurringIssueTemplate` is not deprecated and has type `Template`.

`Template` has these fields: `id`, `createdAt`, `updatedAt`, `archivedAt`, `type`, `name`, `description`, `icon`, `color`, `templateData`, `sortOrder`, `lastAppliedAt`, `organization`, `team`, `pipeline`, `creator`, `lastUpdatedBy`, `inheritedFrom`, `content`, `hasFormFields`. None holds a schedule, so the API shows which template created an issue and cannot read or create the rule.

Live: `templates` and `issues(first: 1) { recurringIssueTemplate }` answer without error. The workspace has no templates, so both results are empty.

Docs: `https://linear.app/docs/recurring-issues` returned 404 on 2026-10-27, so no docs page was found for the plan gate or the API. The Plan cell says so.

Answer `yes`, access `read`, by the rule for a feature exposed only as a read-only link.

## Dependencies between projects

Matches for `projectRelation`: types `ProjectRelation`, `ProjectRelationConnection`, `ProjectRelationCreateInput`, `ProjectRelationEdge`, `ProjectRelationPayload`, `ProjectRelationUpdateInput`; queries `projectRelation`, `projectRelations`; mutations `projectRelationCreate`, `projectRelationDelete`, `projectRelationUpdate`.

Live: `projectRelations(first: 1)` answers with an empty list.

Docs: `https://linear.app/docs/project-dependencies` (read 2026-10-27) names no plan restriction.

Answer `yes`, access `read/write`.

## Releases

Matches for `release` include the types `Release`, `ReleasePipeline`, `ReleaseStage`, `IssueToRelease` and `ReleaseNote`; the queries `releases`, `releasePipelines`, `releaseStages`, `issueToReleases`; the mutations `releaseCreate`, `releaseComplete`, `releaseUpdate`, `releasePipelineCreate`, `releaseStageCreate`, `issueToReleaseCreate`, `issueToReleaseDelete`; and the fields `Issue.releases`, `Team.releasePipelines` and `Organization.releasesEnabled`. The full list is in the script output.

Live: `releases(first: 1)` and `releasePipelines(first: 1)` answer with empty lists on the Free workspace. `Organization.releasesEnabled` is `false`, so a read passes while the feature stays off.

Docs: `https://linear.app/docs/releases` (read 2026-10-27) says releases are available on Business and Enterprise plans, and Business allows up to 15 pipelines. It also says a personal API key cannot replace a pipeline access key, which applies to the `*ByAccessKey` mutations.

Answer `yes`, access `read/write`. Creation was not tried, so the Verified by cell does not claim a live write.

## Insights

The schema has no type, query, mutation or field whose name matches `insight`, `analytic` or `metric`. Live queries were skipped because there is no object to query.

Docs: `https://linear.app/docs/insights` (read 2026-10-27) says Insights is available on Business and Enterprise plans. The page mentions no API.

Answer `no`. Absence from the schema is the proof. For PMK-33, `native_metrics` on Linear is `derived` from issue history and never `native`.

## Triage responsibility and Triage Intelligence

Checked 2026-10-27 for PMK-43, by introspection and reads only.

Schema. `Team.triageResponsibility` has type `TriageResponsibility` (`id`, `action`, `manualSelection`, `team`, `timeSchedule`, `currentUser`) and is null when the team has none. `action` is `assign` or `notify`. `manualSelection` holds `userIds` and `assignmentIndex`. `TimeSchedule` has an `integration` when a service such as PagerDuty syncs it. `Team.triageEnabled` is a separate setting. The queries are `triageResponsibilities` and `triageResponsibility`. The mutations are `triageResponsibilityCreate` (input `TriageResponsibilityCreateInput`: `teamId`, `action`, `manualSelection`, `timeScheduleId`), `triageResponsibilityUpdate` (`id`, input `TriageResponsibilityUpdateInput`) and `triageResponsibilityDelete` (`id`). `IssueSuggestion` has `type` (`team`, `project`, `assignee`, `label`, `similarIssue`, `relatedIssue`), `state` (`active`, `stale`, `accepted`, `dismissed`), `metadata` (`score`, `classification`, `reasons`), `presentedReasons` and the suggested team, project, user, label and issue. The schema has no accept or dismiss mutation.

Live. `triageResponsibilities(first: 5)` and `Issue.suggestions` answer with empty lists on the Free workspace, and `Team.triageResponsibility` is null. No mutation was sent.

Docs. `https://linear.app/docs/triage` (read 2026-10-27) says triage responsibility and Triage Intelligence are available on the Business and Enterprise plans.

Answer `yes`. Triage responsibility is read/write and suggestions are read-only. The three mutations stay `schema, docs` until a Business or trial workspace with a dedicated test team tries them. `linear triage show` and `suggestions` therefore decide from the plan and `Team.triageEnabled` in the cached discovery and send no triage query on Free.

## Cycles (PMK-37)

Checked on 2026-10-28 against the sandbox workspace, with reads only. The sandbox team has cycles turned off and no cycle, so a fact about a cycle's values stays `unverified` until a workspace with cycles runs `scripts/lib/linear/client-live.mjs`. That file checks that each cycle's `endsAt` is the next cycle's `startsAt` when the team has no cooldown, and prints the time of day in `startsAt` and `endsAt`, the cycles that ended but are not `isPast`, and how many `isPast` cycles have `completedAt`. The plan is to run it against the dedicated test team that PMK-39 creates.

| Fact | Status | Source |
|---|---|---|
| `Mutation` has `cycleUpdate`, `cycleArchive`, `cycleShiftAll`, `cycleStartUpcomingCycleToday` and `teamCyclesDelete`, and no `cycleCreate` | schema | introspection of `Mutation` |
| `CycleCreateInput` exists and no mutation takes it, so the public API cannot open a cycle | schema | introspection |
| `CycleUpdateInput` has `name`, `description`, `startsAt`, `endsAt` and `completedAt` | schema | introspection |
| `Cycle` has `id`, `number` (Float), `name` (nullable), `description`, `startsAt`, `endsAt`, `completedAt`, `isActive`, `isFuture`, `isPast`, `isNext`, `isPrevious`, `progress`, `team`, `issues`, `uncompletedIssuesUponClose` | schema | introspection |
| `CycleFilter` has `id`, `number`, `name`, `startsAt`, `endsAt`, `completedAt`, `isActive`, `isNext`, `isPrevious`, `isFuture`, `isPast`, `isInCooldown`, `team`, `issues`, `and` and `or` | schema | introspection |
| `Query` has `cycles(filter, first, after)` and `cycle(id)` | schema | introspection |
| `Team` has `cyclesEnabled`, `cycleDuration`, `cycleCooldownTime`, `cycleStartDay`, `cycleLockToActive`, `upcomingCycleCount`, `activeCycle` and `cycles` | schema | introspection |
| `IssueFilter.cycle` takes a `CycleFilter`, so `cycle: { isActive: { eq: true } }`, `cycle: { number: { eq: 12 } }` and `cycle: { null: true }` are valid | schema | introspection |
| The sandbox team has `cyclesEnabled: false`, `activeCycle: null`, duration 2 weeks and cooldown 0 | read | `teams` |
| `cycles(first: 5)` answers with an empty list | read | live read |
| `issues(first: 3, filter: { cycle: { isActive: { eq: true } } })` answers with an empty list and no error | read | live read |
| `startsAt` is the cycle's first instant and `endsAt` an exclusive boundary (with no cooldown, one cycle's `endsAt` is the next cycle's `startsAt`), so a sprint's `start` is the UTC date of `startsAt` and its `end` the UTC date of `endsAt` minus one calendar day. Whether both are midnight UTC is also open | unverified | needs a team with cycles; `client-live.mjs` checks the boundary |
| `isPast` is false while a cycle is in cooldown | unverified | needs a team with cycles |
| `completedAt` is set on a cycle that ended by date | unverified | needs a team with cycles |
| `issueUpdate` with `cycleId` of another team's cycle is refused | unverified | the fake refuses it from the schema; no write was sent |

## Paid-plan features on a Free workspace

Check a gated feature in this order.

1. Schema. Introspection lists every object whatever the plan. If the object is missing, the answer is `no` on every plan.
2. Docs. Record the page and the date for the plan that unlocks the feature.
3. Live read. An empty list proves the query is allowed. A permission error proves a gate and goes into the Caveat.
4. Live write. Not done in PMK-29. A write that depends on the plan stays `schema, docs` until a later issue tries it on a Business or trial workspace with a dedicated test team.

A read passes on Free for triage responsibility and suggestions, so for these objects the plan decides and an empty answer proves nothing.

## Repeat the check

Run the command at the top on another workspace, such as a Business one. Compare `organization.urlKey`, the `found` lists and each `live` value with this note. A `live` error on a feature that is `empty` here points to a plan gate. Run it again after PMK-28 settles the credential type, because introspection may differ for an OAuth app.
