# PMK-78: Map Jira sprints, including start and close

Issue: PMK-78 (epic EPC-7, milestone `jira`). Acceptance criterion: "Lists, starts and closes sprints on Scrum boards after confirmation."

## Intent

After PMK-77 a Jira repository reads and writes work items, but every Cycles and Capacity operation is a `NOT_SUPPORTED` stub, the `sprint` field of an issue is never set, `--sprint` on `issues list` refuses, and the manifest reports `cycles` and `capacity` absent (naming PMK-78). `/pmkit:cycle:plan` and `/pmkit:cycle:close` cannot run on Jira. Jira is the one tracker of the four where opening and closing a sprint is a ritual the team performs (Unified model, contract family Cycles: "Open and close only where the system has that ritual (Jira)"), so the adapter should do both, behind the same dry run and confirmation the commands already show (Write policy: "starting or closing a sprint").

## Goals

- `listCycles`, `currentCycle`, `cycleIssues`, `openCycle`, `closeCycle`, `moveToCycle` on the space's Scrum board.
- `openCycle` creates a sprint and starts it when the Local rule says the new sprint is active; `closeCycle` completes the active sprint and returns its unfinished issues.
- An issue's `sprint` is read, written (`createIssue`, `updateIssue`, `moveToCycle`) and filtered (`searchIssues({ sprint })`), with the contract's errors (unknown id `INVALID_INPUT`, closed target `CONFLICT`, `current` with no active sprint `INVALID_INPUT` in writes and an empty list in search).
- Capacity and days off in `.pmkit/capacity.yaml`, as Linear and GitHub keep them.
- The manifest serves `cycles` and `capacity`; setup asks the `sprint` field role.
- The contract suite's `cycles` and `cycle-lifecycle` families pass over the fake.

## Non-goals

- Starting a future sprint that pmkit did not create in the same `openCycle` (one made in Jira's backlog view). The contract has no start operation and Local has none either (see Approaches, Q1).
- Parallel sprints, several Scrum boards in one space, a board other than the one discovery picks.
- Jira Server or Data Center (ADR 0013).
- Live checks against a real site: no credentials exist. Each live check is recorded as skipped and filed under EPC-14.

## Anti-goals

- Faking dates: a future sprint Jira holds without dates is not given invented ones.
- Writing a sprint into Jira through `PUT /issue` fields, which depends on the Sprint field being on the edit and create screens (see Approaches).
- A dry run that sends a write.

## Facts from Atlassian's Jira Software Cloud REST documents (unverified on a live site)

| Call | Use |
|---|---|
| `GET /rest/agile/1.0/board/{boardId}/sprint?state=future,active,closed` | Offset page in `values`: `id`, `name`, `state` (`future`, `active`, `closed`), `startDate`, `endDate`, `completeDate`, `originBoardId`, `goal`. `startDate` and `endDate` are absent on a future sprint nobody dated. |
| `GET /rest/agile/1.0/sprint/{sprintId}` | One sprint, same shape; 404 for an unknown id. |
| `POST /rest/agile/1.0/sprint` | Creates a `future` sprint: `{ name, originBoardId, startDate?, endDate?, goal? }`. |
| `POST /rest/agile/1.0/sprint/{sprintId}` | Partial update. `{ state: 'active' }` starts a future sprint that has both dates; `{ state: 'closed' }` completes an active sprint and sets `completeDate`. Other state changes are refused. |
| `POST /rest/agile/1.0/sprint/{sprintId}/issue` | `{ issues: [key, ...] }`, up to 50: moves the work items into a future or active sprint. 204. |
| `POST /rest/agile/1.0/backlog/issue` | `{ issues: [key, ...] }`, up to 50: takes the work items out of their open sprint. 204. |
| Sprint field (custom type `com.pyxis.greenhopper.jira:gh-sprint`) on a work item | An array of sprint objects (`id`, `name`, `state`, `boardId`, `startDate`, `endDate`, `completeDate`), every sprint the item was ever in. JQL: `sprint = 42`, `sprint is EMPTY`, `sprint in openSprints()`. |

Unverified and filed for EPC-14: what Jira does with the incomplete work items of a sprint closed through REST (moved to the backlog or left in the closed sprint), and whether the agile move endpoints accept an item the board's filter hides.

## Approaches

1. **GitHub-shaped modules, agile endpoints for membership (chosen).** A pure `scripts/lib/jira/sprints.mjs` (a Jira sprint as a pmkit sprint, an item's sprint, the open and close bodies) and `scripts/lib/jira/cycle-ops.mjs` (the ten operations), wired in `tracker.mjs` as `cycleOperations` is on GitHub. An issue's sprint is written with the agile move endpoints after the field write, as the branch property is. This is the layout PMK-77 left for PMK-78, and the endpoints work whatever the screens hold.
2. **Membership through the Sprint field.** `PUT /issue/{key}` with `{ customfield_10020: 42 }` and `null`. One write fewer per update, but Jira refuses it when the field is off the screen, and Scrum spaces often keep Sprint off the create screen. Rejected.
3. **Sprints read through JQL alone.** No state, dates or goal, and no empty sprints. Rejected.

## Interview answers (owner, 2026-11-22)

- Q1: starting a future sprint created in Jira needs a new contract operation (`startCycle`). Out of scope; filed as PMK-369 under EPC-14.
- Q2: the sprint rule of "An issue's sprint" is accepted and recorded as ADR 0016.
- Q3: a future sprint without dates reads `start` and `end` as `null`; days off on it are refused, capacity is accepted.
- Q4: only the first Scrum board's sprints count.
- Q5: Sprint changelog items become `sprint` history events, in scope.
- Q6: pmkit writes sprint dates at 12:00 UTC.

## The sprint model

`toSprint(sprint, entry)` in `sprints.mjs`:

| pmkit | Jira |
|---|---|
| `id` | `String(sprint.id)`; a valid id is `/^[1-9][0-9]*$/` |
| `name` | `name` |
| `start`, `end` | the UTC date of `startDate` and `endDate`; `null` when Jira has none (a future sprint never dated) |
| `goal` | `goal ?? ''` |
| `state` | `future` → `planned`, `active` → `active`, `closed` → `closed` |
| `closed` | `completeDate` as ISO UTC (`jiraTime`), only when closed |
| `capacity`, `daysOff`, `capacityBase` | the `.pmkit/capacity.yaml` entry, key `jira:<site>/<board id>` |

pmkit writes dates at 12:00 UTC (`<date>T12:00:00.000Z`), so the date reads back the same and Jira shows the same calendar day in every zone from UTC-11 to UTC+11 **(builder's call)**.

Sprints are read live from the board on each operation that needs them, not from the discovery cache, as GitHub reads its iteration field **(builder's call)**. The board is `raw.board` from discovery (the space's first Scrum board).

## An issue's sprint

The Sprint field holds every sprint an item was in. `sprintOf(values, category)`:

1. the open sprint (active, else future), when the item has one;
2. else, when the item's status category is `done` or `canceled`, the closed sprint with the latest `completeDate` (where it was delivered);
3. else none: Jira's backlog holds an unfinished item whose sprints are all closed.

This keeps velocity (done issues count in the sprint they closed in) and `--sprint none` (the backlog `/pmkit:cycle:plan` drafts from) right **(builder's call)**.

The read asks for the sprint field id (`view.fields.sprint`, ADR 0014) in `ISSUE_FIELDS`. Without a sprint field the issue has no `sprint`.

Only the board's sprints count: `listCycles` keeps the sprints whose `originBoardId` is the board (or absent), and `sprintOf` skips a sprint value whose `boardId` is another board, so an item in another board's open sprint reads as no sprint of this board **(builder's call, builder check Q2)**. `cycleIssues` and `moveToCycle` then never meet an id they reject.

### History

`/pmkit:cycle:close` step 4 reads scope added and removed from `sprint` events, and `scripts/lib/jira/history.mjs` maps a Sprint change to `jira:customfield_NNNNN` today. A changelog item of the sprint field (`fieldId` equal to `context.fields.sprint`) becomes `update sprint` **(builder check Q1)**. Its `from` and `to` are comma-separated lists of every sprint the item was in, so the event takes the difference: `to` is the id added (last one, else `null`), `from` is the id removed (last one, else the last id of the old list, else `null`). An item that leaves open sprint 43 for the backlog (`42, 43` to `42`) is `43 → null`; one carried from 43 to 44 (`43` to `43, 44`) is `43 → 44`. An item with no difference gives no event. The fake writes these changelog entries on every agile move.

## Operations (`cycle-ops.mjs`)

Every operation starts with `scope()`: the context, the board and the sprint field. A space whose manifest `cycles` entry is absent (no Jira Software, no Scrum board, or no sprint field) fails with `NOT_SUPPORTED` and the manifest's hint. A new absent reason joins the manifest: `No sprint field in space <key>` when the `sprint` role has no field.

- `listCycles({ state })`: the board's sprints, in Jira's order (creation), with the state filter of Local (`INVALID_INPUT` for another state).
- `currentCycle()`: the first active sprint, or `null`.
- `cycleIssues(id)`: `NOT_FOUND` for a malformed or unknown id, else `searchIssues({ sprint: id }).issues`.
- `openCycle(input, actor, { dryRun })`: Local's checks (keys `start`, `end`, `goal`, `name`; dates; one line; overlap with a planned or active dated sprint; default end from `defaults.sprint_length_days`, which is 14 on Jira; default name `Sprint <start>`). Then `POST /sprint` with the dates at 12:00 UTC, and, when `start <= today` and no sprint is active, `POST /sprint/{id}` `{ state: 'active' }`. A failed start after the create is `UPSTREAM` "Jira created sprint <id>, but starting it failed", `details.created`. The dry run returns `{ before: null, after }` with `id: null` and the state the real run would set.
- `closeCycle(id, actor, { dryRun })`: `NOT_FOUND` for an unknown id, `INVALID_INPUT` when the sprint is not active (as Local). The unfinished issues are `cycleIssues(id)` outside `done` and `canceled`, read before the close. Then `POST /sprint/{id}` `{ state: 'closed' }` and a reread for `completeDate`. Returns `{ sprint, unfinished, problems: [] }`; the dry run sets `closed` to now.
- `moveToCycle(ids, to, actor, { dryRun })`: GitHub's order: actor, input, target (`current`: the active one or `INVALID_INPUT`; unknown id or `none`: `INVALID_INPUT`; closed: `CONFLICT`), then each issue read before the first write, then one `updateIssue(id, { sprint })` per issue, `stoppedHalfway` on a failure. ponytail: one move call per issue; batch 50 keys per call if sprint moves of large scopes get slow.
- `getCapacity`, `getDaysOff`, `setCapacity`, `updateCycleCapacity`: the capacity store under `jira:<site>/<board id>`, members the discovery's members, `NOT_FOUND` for an unknown sprint. Jira is not written. Days off on a sprint Jira holds without dates are refused with `INVALID_INPUT`, "sprint <id> has no dates in Jira", next step "Set the sprint's dates in Jira"; capacity is still accepted **(builder's call, builder check Q3)**.

## Issue writes and search

- `toFields` stops refusing `sprint`. With a value, the caller passes the board's sprints; `planSprint` resolves `current` (none active: `INVALID_INPUT`, next step `pmkit cycle list`), an id (unknown or `none`: `unknownSprint`; closed: `closedSprint`), or `null`, sets `after.sprint` and `result.sprint = { to: id | null }` when it changes.
- `updateIssue`: after the field `PUT`, a changed sprint is `POST /sprint/{id}/issue` or `POST /backlog/issue`; a failure after a field write is `UPSTREAM`, as the branch write. `createIssue`: the move runs after the create; a failure is `UPSTREAM` with `details.created`, as the status move.
- `searchIssues({ sprint })`: `checkFilter` gets `sprintExists` from the board's sprints. JQL: an id is `sprint = <id>`; `current` is the active id, or nothing matches; `none` is `(sprint is EMPTY OR sprint not in openSprints())`. A client step `sprint` keeps the issues whose `sprint` (the rule above) equals the asked id, or is unset for `none`.

## Setup

`FIELD_KEYS` in `scripts/lib/jira/setup.mjs` gains `sprint`, candidates the fields of custom type `gh-sprint`. A site has one, so setup applies it ("the site offers only this field"); `init --update` asks a file that never answered it (PMK-365).

## Tests and runbook

- Unit tests next to each module: `sprints.test.mjs`, `cycle-ops.test.mjs`, plus the changed `issues`, `filter`, `issue-ops`, `manifest`, `setup` tests.
- The stateful fake `scripts/fake-jira-issues.mjs` gains the board's sprints, the six agile routes and the JQL `sprint` clauses.
- `scripts/lib/jira/contract.test.mjs` adds the `cycles` and `cycle-lifecycle` families.
- Runbook `docs/runbooks/cycles-jira.md`, verified by `scripts/runbook-cycles-jira.test.mjs` over the fake: `capabilities` (cycles native), `cycle open` dry run and real run (starts), `cycle list`, `cycle add`, `issues list --sprint`, `cycle capacity`, `cycle close` dry run and real run, and a space without a Scrum board (`NOT_SUPPORTED`). Live steps are listed as skipped.

## Risks

- Every Agile API shape above comes from the documents, not a site (EPC-14).
- A sprint dated late in the evening in a zone far from UTC reads one day off.
- Only the first Scrum board's sprints are seen.

## Left to the builder

Module boundaries inside `cycle-ops.mjs`, fake internals, test names.
