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
| Customers and customer requests | yes | `Customer`, `CustomerNeed`, `CustomerStatus`, `CustomerTier`; `customers`, `customerNeeds`, `customerStatuses`, `customerTiers`; `customerUpdate`, `customerNeedCreate`, `customerNeedUpdate`; `Organization.customersEnabled` | read/write | Linear tab says Business and Enterprise; the docs page says all plans, enabled by an admin | schema, live read, docs | The mutations come from the schema only. Customer reads fail when the feature is off, so the `customersEnabled` flag decides, on any plan. |

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

## Projects, project updates, milestones and documents

Checked 2026-10-28 for PMK-38, by introspection and reads only, through a fetch wrapper that refuses any document starting with `mutation`. The workspace holds projects that belong to real work, so this section gives shapes and counts and no names.

| Call | Result |
|---|---|
| `__type(Project)` | `id`, `slugId`, `identifier`, `previousIdentifiers`, `name`, `description` (short), `content` (long, Markdown), `status`, `health` (nullable), `healthUpdatedAt`, `progress` (Float), `scope`, `startDate`, `targetDate`, `lead`, `url`, `teams`, `issues`, `projectMilestones`, `documents`, `projectUpdates`, `relations`, `initiatives`. |
| `__type(ProjectStatusType)` | `backlog`, `planned`, `started`, `paused`, `completed`, `canceled`. |
| `projectStatuses(first: 20)` | Five statuses on Free (Backlog, Planned, In Progress, Completed, Canceled). None has the type `paused`. |
| `__type(ProjectUpdateHealthType)` | `onTrack`, `atRisk`, `offTrack`. |
| `__type(ProjectUpdate)` | `id`, `body`, `health` (required), `user`, `project`, `createdAt`, `url`. |
| `__type(ProjectUpdateCreateInput)` | `id` (client-chosen), `projectId` (required), `body`, `health`. |
| `__type(ProjectCreateInput)` | `id` (client-chosen), `name` (required), `teamIds` (required), `content`, `description`, `startDate`, `targetDate`, `statusId`, `leadId`. |
| `__type(ProjectMilestone)` | `id`, `name`, `description`, `targetDate`, `status` (`unstarted`, `next`, `overdue`, `done`), `progress`, `project`. No slug and no short identifier. |
| `__type(Document)` | `id`, `slugId`, `title`, `content` (Markdown), `project`, `initiative`, `team`, `issue`, `url`. |
| `__type(DocumentCreateInput)` | `title` (required), `content`, and one container such as `projectId`. No path. |
| `projects(first: 50)` | Four projects. Every `slugId` has 12 hexadecimal characters. Every `identifier` is set and has the shape letter, hyphen, three letters, hyphen, number. No `previousIdentifiers`. All four have `health: null` and the status type `backlog`. One has milestones, none has documents. |
| `project(id:)` with the UUID, the `slugId` and the `identifier` | All three answer. The identifier answers in lower case too. |
| `projects(filter: { id: { eq: "<identifier>" } })` | One match. The same filter with a `slugId` gives none. `projects(filter: { slugId: { eq } })` gives one. |
| `projects(filter: { accessibleTeams: { some: { key: { eq } } } })` | Answers. |
| `issues(filter: { project: { id: { eq: "<uuid>" } } })` | Answers. |
| `projectMilestones(first: 50)` | Answers, with `project { slugId }`. A `project: { id: { eq } }` filter fails with "Argument Validation Error" when the value is not a real id, so the adapter filters on the client. |
| `documents(first: 50)`, `documents(filter: { slugId: { eq } })` | Answer. The workspace has no document. |
| `initiatives(first: 5)`, `projectRelations(first: 5)` | Answer with an empty list on Free. |

The adapter's own documents were also sent live on 2026-10-28, with `client-live.mjs`: the project list with milestones and documents, the three key forms through `getDeliverable`, `projectMilestones`, the document filter, `projectUpdates`, the issue filters on `project` and on a null `parent`, and `deliverableProgress`. Linear accepted every one, and the three keys answered the same canonical id.

Writes are not proven live. `projectCreate` and `projectUpdateCreate` run against the stateful fake in `npm test`, and PMK-39 tries them on a throwaway project. A Free workspace may refuse them, and the refusal reaches the command as `UPSTREAM` with Linear's message.

## Customers and customer requests

Schema. `Customer` has `id`, `name`, `status` (`CustomerStatus`), `tier` (`CustomerTier`, nullable), `revenue` (`Int`, nullable), `size` (`Float`, nullable), `owner` (`User`), `domains`, `externalIds`, `approximateNeedCount`, `slugId`, `url` and `needs`. `CustomerStatus` and `CustomerTier` have `id`, `name`, `displayName`, `color`, `description` and `position`. `CustomerNeed` is the customer request. It has `customer`, `issue`, `project`, `priority` (0 or 1), `body` and `url`, and it may have neither an issue nor a project. The queries are `customers`, `customer`, `customerNeeds`, `customerNeed`, `customerStatuses` and `customerTiers`. The mutations pmkit uses are `customerUpdate` (`id`, input `CustomerUpdateInput`: `name`, `statusId`, `tierId`, `revenue`, `size`, `ownerId`), `customerNeedCreate` (input `CustomerNeedCreateInput`: `customerId`, `issueId`, `projectId`, `priority`, `body`) and `customerNeedUpdate` (`id`, input `CustomerNeedUpdateInput`, which can move a request). Their payloads return `success` and the object. Revenue has no unit in the schema.

Live. On the sandbox workspace (Free), `customers(first: 1)` and `customerNeeds(first: 1)` fail with "Customer requests are not available in this workspace." `customerStatuses` answers with four statuses and `customerTiers` with an empty list. `Organization.customersEnabled` is false. No mutation was sent.

Docs. `https://linear.app/docs/customer-requests` (read 2026-10-28; `https://linear.app/docs/customers` answered 404) says "Customer Requests is available on all currently offered plans", that an admin enables it in workspace settings, and that after that anyone in the workspace except guests can view and edit customers. This differs from the Linear tab, which marks the feature Business. The sandbox result fits the docs: the workspace has the feature off, and customer reads fail until it is on.

Answer `yes`, access `read/write`. The three mutations stay `schema` because none was sent. `linear customers` decides from `customersEnabled` in the cached discovery and sends no customer query when it is false. When the flag is false the reason is `customers_off` on every plan, with the hint "An admin can turn on customer requests in the workspace settings.", because the docs say the feature exists on all plans and the docs win over the Linear tab (decided in PMK-42 review).

## Live writes (PMK-39)

The contract suite runs against the sandbox workspace through one fixed test team. The third live run, on 2026-10-29, ran 38 tests: 25 passed, 0 failed and 13 were skipped. The skipped tests belong to the families cycle-lifecycle, milestone-writes, releases, time and document-writes, which the Linear adapter does not run. The test team was empty afterwards. The run is by hand and no CI runs it.

The key comes from `LINEAR_API_KEY` in the shell. Put it there with `set -a; . ./.env; set +a`, so it never appears on a command line. `PMKIT_LIVE_WORKSPACE` holds the URL key the key must belong to.

```
PMKIT_LIVE=1 PMKIT_LIVE_WORKSPACE=$PMKIT_LIVE_WORKSPACE node scripts/lib/linear/contract-live.mjs
PMKIT_LIVE=1 PMKIT_LIVE_WORKSPACE=$PMKIT_LIVE_WORKSPACE node scripts/lib/linear/contract-live.mjs cleanup
PMKIT_LIVE=1 PMKIT_LIVE_WORKSPACE=$PMKIT_LIVE_WORKSPACE node scripts/lib/linear/contract-live.mjs cleanup --yes
```

`cleanup` lists what the test team holds and writes nothing. `cleanup --yes` trashes it. Without `PMKIT_LIVE=1`, a workspace and a usable key, every test is skipped with one reason and nothing is sent. `npm test` removes `LINEAR_API_KEY` and `PMKIT_LIVE` from the environment of its tests and never loads the live file.

### The test team

The team is named `pmkit-test`, has the key `PKT` and carries the marker `pmkit-contract-team` in its description. The run creates it once and reuses it. It never edits or deletes the team. A team that fails the name, key, marker, archive, cycles or triage check stops the run. Each test starts on an empty team, and the sweep after it trashes the issues with `issueDelete` and the projects with `projectDelete`.

### The test-team helper, for PMK-41

`scripts/lib/linear/sandbox.mjs` exports five names. Each function takes the caller's client, so the caller's guard and request counter apply.

| Export | What it does |
|---|---|
| `TEST_TEAM` | `{ name: 'pmkit-test', key: 'PKT', marker: 'pmkit-contract-team' }`. |
| `findOrCreateTestTeam({ client, guard })` | Finds the team by name or creates it once. Returns `{ team: { id, key }, created }`. Sends no write when the team exists. |
| `listTestTeamItems({ client, team, guard })` | Returns `{ issues, projects }` that the team holds and are not trashed. |
| `trashTestTeamItems({ client, team, guard })` | Trashes those issues and projects. Returns the counts. |
| `createGuardedFetch({ fetch, workspace, allowlist })` | Returns `{ fetch, guard }`. The fetch refuses every mutation the allowlist lacks. The default allowlist is `SUITE_ALLOWLIST`, the 14 mutations of this suite. PMK-41 passes its own allowlist. |

`preflight`, `waitForCycles` and `checkTestTeam` are exported too. The live run calls them in this order: `preflight`, `findOrCreateTestTeam`, `waitForCycles`.

### The write guard

The guard reads each request with `isMutation` and refuses a mutation before it leaves the process unless its root field is on the allowlist and every id it names belongs to the run. The suite allowlist holds `teamCreate`, `workflowStateCreate`, `cycleStartUpcomingCycleToday`, `issueCreate`, `issueUpdate`, `issueArchive`, `issueRelationCreate`, `issueRelationDelete`, `commentCreate`, `commentResolve`, `projectCreate`, `projectUpdateCreate`, `issueDelete` and `projectDelete`. No mutation passes before `preflight` succeeds. After a stop signal only `issueDelete` and `projectDelete` of owned ids pass.

### Request budget

Estimated, not measured. The run aims at under 1,000 requests and stops suite requests at 1,200, with 100 more kept for cleanup. The preflight needs 1,700 requests and 1,500,000 complexity points left in the hour.

| Measure | Estimate | Measured |
|---|---|---|
| Requests | about 600 | 409 |
| Writes | about 90 | 90 |
| Complexity points | not estimated | 178133 |

### Probe results

| Probe | Source | Result |
|---|---|---|
| A description with a criteria list round-trips through `updateIssue` and `getIssue` | PMK-35 | The description and the criteria equal what `updateIssue` sent (third live run) |
| Which parts of a comment body survive (marker line, checklist, code fence) | PMK-36 | The marker line, the checklist and the code fence all survive (third live run) |
| History codes and sides for `blocks`, `duplicate` and a removed relation | PMK-36 | `blocks` gives code `ax` on the blocking issue and `ab` on the blocked one. A removed relation adds `rx` and `rb`. `duplicate` gives `ad` on the duplicate and `am` on the original (third live run) |
| A new comment moves `updatedAt` | PMK-36 | A comment does not change the issue's `updatedAt` (PMK-39 live run) |
| A missing comment id | PMK-36 | `comments(filter: { id })` answers HTTP 200 with `errors[0]` holding `message: 'Argument Validation Error'`, `path: ['comments']`, and extensions `code: 'INVALID_INPUT'`, `type: 'invalid input'`, `userError: true`. The code is not `INPUT_ERROR`. The adapter maps this answer to NOT_FOUND. |
| An update right after create | PMK-39 | The history had no `update` entry for a title change made seconds after create. Linear folds it into the create entry. See the section on folded quick edits below. |
| `endsAt` equals the next `startsAt`, the time of day, `isPast` and `completedAt` | PMK-37 | `endsAt` equals the next `startsAt` on the 2 cycles read. Every time of day is `00:00:00.000Z`. No cycle was `isPast` and none had `completedAt` (third live run) |

### Open facts

| Fact | Status |
|---|---|
| `cycleStartDay` 0 means Sunday | `unverified` |
| `teamCreate` accepts the five-character key `PKT` | Yes, the third live run created issues PKT-71 and PKT-72 |
| `issueDelete` works on an archived issue | `unverified` |
| Trashed issues count toward the 250 issues of the Free plan | `unverified` |
| `projects(filter: { accessibleTeams })` and `issues(filter: { team })` with an id comparator accept the test team id | `unverified` |

### History folds a quick edit into the create entry

Second live run, 2026-10-28, test "keeps comments and history in the order the writes happened". The test created an issue, updated its title right away and commented. `issue.history` returned one entry for the create, with no from/to field set, and no separate update entry. Linear folds an update made right after a create into the create entry. The live setup sets `foldsQuickEdits`, so that test requires create first, the comment last and the updated title, but no `update` entry. The Local run still requires `create`, `update`, `comment`.

## Paid-plan features on a Free workspace

Check a gated feature in this order.

1. Schema. Introspection lists every object whatever the plan. If the object is missing, the answer is `no` on every plan.
2. Docs. Record the page and the date for the plan that unlocks the feature.
3. Live read. An empty list proves the query is allowed. A permission error proves a gate and goes into the Caveat.
4. Live write. Not done in PMK-29. A write that depends on the plan stays `schema, docs` until a later issue tries it on a Business or trial workspace with a dedicated test team.

A read passes on Free for triage responsibility and suggestions, so for these objects the plan decides and an empty answer proves nothing. Customer reads fail on Free, but the statuses and tiers reads pass, so for customers the `customersEnabled` flag decides.

## Repeat the check

Run the command at the top on another workspace, such as a Business one. Compare `organization.urlKey`, the `found` lists and each `live` value with this note. A `live` error on a feature that is `empty` here points to a plan gate. Run it again after PMK-28 settles the credential type, because introspection may differ for an OAuth app.

## Degraded paths (PMK-40)

PMK-40 checks that each command on Linear prints a `note:` line or refuses with `NOT_SUPPORTED` when the workspace lacks the capability. The offline tests cover every command. The live run script degraded-live.mjs arrives in Task 12 of the plan and is started with:

```sh
set -a; . ./.env; set +a; PMKIT_LIVE=1 PMKIT_LIVE_WORKSPACE=<workspace> node --test scripts/lib/linear/degraded-live.mjs
```

request count: filled in by the live run
