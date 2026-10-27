# PMK-21 risk-radar command Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A read-only `pmkit risks` CLI command lists blocked issues, stalled issues, stalled pull requests, epics at risk and broken CI, degrades to tracker activity without a git host, and `/pmkit:team:risk-radar` presents its result.

**Architecture:** Pure functions in a new `scripts/lib/risks.mjs` compute each list and the text report. Two new read methods on the GitHub host (`listPullRequests`, `listRuns`) feed the PR and CI lists. `runRisks(ctx)` in `scripts/pmkit.mjs` gathers the inputs, catches host failures and builds one JSON report. The command file runs `risks --json` once and formats it.

**Tech Stack:** Node 18+ ES modules, no dependencies (ADR 0003), `node:test`. Run tests with `npm test`.

**Spec:** `docs/superpowers/specs/2026-10-26-pmk-21-risk-radar-design.md`

## Global Constraints

### Thresholds and dates

- `today` is `ctx.now().toISOString().slice(0, 10)`. `ctx` gains `now` (the `clock(env)` function `run()` already builds), so `PMKIT_NOW` sets it in tests.
- N is `ctx.config().local.defaults.stuck_business_days`. W is `ctx.config().local.defaults.status_update_window_days`.
- Idle business days of an item: `businessDaysBetween(lastActivity, today)` from `scripts/lib/metrics.mjs`. Stalled means idle business days `> N`.
- Calendar days between two dates: whole UTC days between `date.slice(0, 10)` and `today`. Write a local `daysSince(date, today)` in `risks.mjs`. Do not export `dayNumber` from `metrics.mjs`.
- An open category is anything other than `done` and `canceled`. A `null` category (a status name the config does not know) counts as open.

### Host calls

| Method | `gh` arguments |
|---|---|
| `listPullRequests()` | `pr list --state open --limit 200 --json number,url,title,headRefName,isDraft,updatedAt,author,statusCheckRollup` |
| `listRuns({ branch })` | `run list --branch <branch> --limit 50 --json databaseId,workflowName,status,conclusion,url,createdAt,headSha` |
| `getPullRequest({ head })` | exists today (`pr view <branch> --json number,url,title,state,isDraft,headRefName,author,mergedAt`) |

Both new methods use `check` and `parse`, so a missing `gh` is `NOT_CONFIGURED`, a logged-out one `AUTH`, a rate limit `RATE_LIMITED`, any other failure or unreadable JSON `UPSTREAM`. `listRuns` passes `branch` through `refArg('branch', branch)`.

`runRisks` calls the host in this order: `listPullRequests()`, then `getPullRequest({ head })` for each issue `needsPrLookup` returns (in issue creation order), then `listRuns({ branch: defaultBranch(ctx) })`.

### JSON report

Key order: `today`, `thresholds`, `gitHost`, `blocked`, `stalledIssues`, `stalledPullRequests`, `epics`, `ci`, `problems`.

- `thresholds`: `{ stuckBusinessDays: N, statusUpdateWindowDays: W }`.
- `gitHost`: `{ system: 'github', available: true }`, or `{ system, available: false, reason: { code, message, nextStep } }`. `system` is `git_host.system` from the config, or `'none'` when it is missing.
- Issue row base (blocked and stalled): `{ id, title, status: issue.status.name, assignee: issue.assignee ?? null, estimate: issue.estimate ?? null }`.
- `blocked` row: base plus `blockers`, the open blockers only, in `blockedBy` order. A readable blocker is `{ id, category }`. An unreadable one is `{ id, error }`, where `error` is the problem code of its file (`CONFLICT`, for example) or `NOT_FOUND`.
- `stalledIssues` row: base plus `lastActivity`, `idleBusinessDays`, `reason` (`idle`, `pr_merged`, `pr_closed`), `pr` (a number or `null`).
- `stalledPullRequests` row: `{ number, title, url, branch, isDraft, updatedAt, idleBusinessDays, issue }`. `branch` is `headRefName`. `issue` is an ID or `null`.
- `epics` row: `{ id, title, status: epic.status.name, target: epic.target ?? null, lastUpdate: { at, health } | null, reasons }`. `reasons` is in this order: `late`, then `at_risk` or `off_track`, then `no_recent_update`.
- `ci`: `{ defaultBranch: { branch, workflows, failing }, pullRequests }`. `failing` rows are `{ workflow, conclusion, url, createdAt, headSha }`. `workflows` counts the workflows with a completed run. `pullRequests` rows are `{ number, title, url, failing }`, where `failing` holds check names.
- `problems`: `{ id, code, message }` for each issue file `searchIssues` could not read, then one for each epic whose status updates could not be read.
- Without a host (`NOT_SUPPORTED`, `NOT_CONFIGURED`, `AUTH`): `stalledPullRequests` and `ci` are `null`.
- A `RATE_LIMITED` or `UPSTREAM` failure of `listPullRequests` makes `stalledPullRequests` and `ci.pullRequests` both `{ error: { code, message, nextStep } }`. A failure of `listRuns` makes `ci.defaultBranch` `{ branch, error: { code, message, nextStep } }`.
- Order: issue lists in creation order (the order of `searchIssues`), PR lists by number, epics in `listDeliverables` order, failing workflows by workflow name.

### Warnings (stderr, through `result.warnings`)

In this order:

1. Each problem from `searchIssues`, as `problemLine` prints it (as `issues list` does).
2. Host unavailable, exactly one of:
   - `NOT_SUPPORTED`: `no git host is configured, so issues are stalled by tracker activity only and pull requests and CI are not checked`
   - `NOT_CONFIGURED` or `AUTH`: `` `${message}, so issues are stalled by tracker activity only and pull requests and CI are not checked; next: ${nextStep}` ``
3. `only the 200 most recently created open pull requests were read`, when `listPullRequests` returns exactly 200 PRs.
4. `` `pull requests not checked: ${message}` `` for a failed `listPullRequests`.
5. `` `${id}: the pull request of ${branch} could not be read: ${message}` `` for each failed `getPullRequest` lookup. The issue keeps the reason `idle`.
6. `` `CI on ${branch} not checked: ${message}` `` for a failed `listRuns`.
7. `` `${id}: ${code} ${message}` `` for each epic whose status updates could not be read.

`risks` exits 0 whenever the tracker reads. Every other error (no config, a bad `PMKIT_NOW`) exits 2 as today.

### Text report (`risksText(report)`)

The head (two lines) and the six sections are blocks joined by one blank line, with no trailing newline. Line 1:

`risks on <today>: stalled after <N> business days without activity, status updates due every <W> days`

Line 2, one of:

- `git host: github`
- `git host: none, so issues are stalled by tracker activity only and PRs and CI are not checked`
- `` `git host: ${system} is not available (${reason.message}), so issues are stalled by tracker activity only and PRs and CI are not checked` ``

Then six sections in this order. Each is a title line, then a body:

| Title | Source | Table columns |
|---|---|---|
| `blocked issues` | `blocked` | ID, Title, Status, Assignee, Estimate, Blocked by (`ISS-5N1R (in_progress)`, `ISS-9 (NOT_FOUND)`, joined by `, `) |
| `stalled issues` | `stalledIssues` | ID, Title, Status, Assignee, Estimate, Idle days, Reason, PR (`#9` or empty) |
| `stalled pull requests` | `stalledPullRequests` | PR (`#9`), Title, Branch, Draft (`yes` or empty), Idle days, Issue |
| `epics at risk` | `epics` | ID, Title, Status, Target, Last update (`2026-10-01 at_risk`, or `none`), Reasons (joined by `, `) |
| `failing CI on <branch>` | `ci.defaultBranch` | Workflow, Conclusion, Created, URL |
| `pull requests with failing checks` | `ci.pullRequests` | PR, Title, Failing checks (joined by `, `), URL |

- Rows: the title gets ` (<count>)` and the body is `table(header, rows)` from `scripts/lib/format.mjs`. Empty cells are `''`.
- Empty list: the body is `none`. For `failing CI on <branch>` with `workflows === 0`, the body is `none, no workflow runs on <branch>`.
- `null` (no host): the body is `` `not checked: ${gitHost.reason.message}` ``. With `ci` `null`, the CI title says `failing CI on default branch`.
- `{ error }`: the body is `` `not checked: ${error.message}` ``.
- After the stalled issues table, when a row has the reason `pr_merged`, add the line `pr_merged: the pull request is merged; pmkit pr sync moves the issue to done`.

### Files

- Create: `scripts/lib/risks.mjs`, `scripts/risks.test.mjs`, `scripts/cli-risks.test.mjs`, `commands/team/risk-radar.md`, `scripts/__scenarios__/team-risk-radar.mjs`, and by regeneration only `scripts/__scenarios__/team-risk-radar.after.txt` and `scripts/__goldens__/{basic,team,messy-merge,no-sprints}/risks.txt`.
- Modify: `scripts/lib/github/host.mjs`, `scripts/github-host.test.mjs`, `scripts/pmkit.mjs`, `scripts/goldens.test.mjs`, `scripts/scenarios.test.mjs`, `scripts/plugin.test.mjs`, `skills/pmkit/SKILL.md`, `README.md`, `docs/superpowers/specs/2026-10-23-pmkit-design.md`, `CONTEXT.md`.
- Must not change: `scripts/lib/metrics.mjs`, `scripts/lib/model.mjs`, `scripts/lib/capabilities.mjs` (`SERVED_BY` stays, the spec explains why), `scripts/lib/local/`, `scripts/__fixtures__/`, `schemas/`, `templates/`, every other command file, `skills/pmkit/references/conventions.md`, `.issues/`.
- `commands/help.md` does not change. Step 2 reads each command file's `description` at run time, and the `team` group is already listed.
- `CHANGELOG.md` does not change. Feature branches in this repo add no changelog line, and the release adds one with no `Tracker format:` line (spec, Docs and registration).

### Goldens and scenario snapshots

Never edit a golden or a snapshot by hand. Regenerate only with:

- `UPDATE_GOLDENS=1 node --test scripts/goldens.test.mjs`
- `UPDATE_GOLDENS=1 node --test scripts/scenarios.test.mjs`

Then read `git status` and `git diff` of each one. Expected: four new `risks.txt` goldens (Task 5) and one new `team-risk-radar.after.txt` (Task 7). Every existing golden and snapshot stays byte for byte. A change to any of them is a bug. Run `git checkout -- <file>` on it, find the cause, and fix the code.

### Tests and commits

- Baseline: 1093 tests pass at `d86f7a5`. The final count must be higher.
- TDD: write the tests of a task first, run them, and see them fail for the reason the task states before writing the code.
- Every task runs its focused tests, then `npm test`, before its commit. Every commit leaves `npm test` green.
- Commit subject: `<type>: <subject> (PMK-21)`. The body ends with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Prose in code comments, the command file and docs uses straight quotes, no em dashes, and follows `/home/fred/.claude/skills/unslop/SKILL.md`. No new dependency. Do not run pmkit write commands on this repo's `.issues/`.

### Acceptance criteria map

| Criterion | Tasks |
|---|---|
| 1. Lists blockers, stalled issues, stalled PRs, late epics, epics without a recent status update and broken CI | Task 1 (host reads), Tasks 2 and 3 (each list), Task 5 (`risks` returns all six), Task 7 (the command shows them) |
| 2. Without a git host it lists issues stalled by time, and says so | Task 4 (head line), Task 5 (`git_host.system: none` case and goldens), Task 6 (`gh` missing or logged out) |
| 3. Writes nothing | Task 5 (tree comparison test with its failing control, `gh` call log check), Task 7 (scenario: rule 8 and no new events) |

## Review Focus

1. An issue with no events (a hand-made file, or an event log that does not parse). Its last activity is `issue.updated`, and it can still be stalled. Pinned in Task 2.
2. An event log out of order after a merge (the `messy-merge` fixture). The newest `at` by instant counts, not the last line. Pinned in Task 2.
3. Two open PRs with the same head branch (a fork and the origin). The one with the newest `updatedAt` links to the issue. Pinned in Task 2 (`prsByBranch`).
4. `gh` logged out on the second host call, after `pr list` succeeded. The report drops every host-backed list and does not mix fresh PR data with a missing CI read. Pinned in Task 6.
5. An epic whose status update file does not parse. `risks` still exits 0, the epic is checked with no updates, and `problems` names the epic. Pinned in Task 5.

---

### Task 1: the GitHub host lists open pull requests and workflow runs

**Files:**
- Modify: `scripts/lib/github/host.mjs` (the object `createGithubHost` returns)
- Test: `scripts/github-host.test.mjs`

**Interfaces:**
- Produces: `host.listPullRequests() -> Array<{ number, url, title, headRefName, isDraft, updatedAt, author, statusCheckRollup }>` and `host.listRuns({ branch }) -> Array<{ databaseId, workflowName, status, conclusion, url, createdAt, headSha }>`, both the parsed `gh` JSON as is.

- [ ] **Step 1: Write the failing tests** in `scripts/github-host.test.mjs`, after `prChecks returns an empty list when gh reports no checks`. Use the existing `fakeExec` and `host` helpers.
  - `listPullRequests calls gh pr list with the open state, the limit and the fields`: stdout `JSON.stringify([pr])`. Result deep-equals `[pr]`. `calls[0].cmd` is `'gh'`. `calls[0].args` deep-equals `['pr', 'list', '--state', 'open', '--limit', '200', '--json', 'number,url,title,headRefName,isDraft,updatedAt,author,statusCheckRollup']`.
  - `listRuns calls gh run list on the branch with the limit and the fields`: stdout `'[]'`. `host(exec).listRuns({ branch: 'main' })` deep-equals `[]`. `calls[0].args` deep-equals `['run', 'list', '--branch', 'main', '--limit', '50', '--json', 'databaseId,workflowName,status,conclusion,url,createdAt,headSha']`.
  - `listRuns refuses a branch that starts with a dash before gh runs`: `listRuns({ branch: '-x' })` throws a `PmkitError` with code `INVALID_INPUT`, and `calls` deep-equals `[]`.
  - `listPullRequests maps a logged out gh to AUTH and a missing gh to NOT_CONFIGURED`: a result `{ status: 4, stderr: 'To get started with GitHub CLI, please run:  gh auth login\n' }` throws code `AUTH`. A function that throws `Object.assign(new Error('spawnSync gh ENOENT'), { code: 'ENOENT' })` throws code `NOT_CONFIGURED`.
  - `listRuns maps a failure to UPSTREAM and unreadable JSON to UPSTREAM`: `{ status: 1, stderr: 'HTTP 404: Not Found\n' }` throws `UPSTREAM` with `HTTP 404` in the message. `{ stdout: 'not json' }` throws `UPSTREAM`.

- [ ] **Step 2: Run to verify they fail**

Run: `node --test scripts/github-host.test.mjs`
Expected: the five new tests FAIL with `listPullRequests is not a function` or `listRuns is not a function`. The others PASS.

- [ ] **Step 3: Implement** `listPullRequests()` and `listRuns({ branch })` in the returned object of `createGithubHost`, after `prReviews`. Add two constants next to `VIEW_FIELDS`: `LIST_FIELDS = 'number,url,title,headRefName,isDraft,updatedAt,author,statusCheckRollup'` and `RUN_FIELDS = 'databaseId,workflowName,status,conclusion,url,createdAt,headSha'`. Each method is `parse(check('gh', args).stdout, what)` with `what` set to `'the pull requests'` or `'the workflow runs'`.

- [ ] **Step 4: Run to verify they pass**

Run: `node --test scripts/github-host.test.mjs`
Expected: PASS, the whole file.

- [ ] **Step 5: Run the whole suite**

Run: `npm test`
Expected: PASS, 1098 tests.

- [ ] **Step 6: Commit**

```bash
git add scripts/lib/github/host.mjs scripts/github-host.test.mjs
git commit -m "feat: list open pull requests and workflow runs in the GitHub host (PMK-21)" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task 2: blocked and stalled issues

**Files:**
- Create: `scripts/lib/risks.mjs`
- Test: `scripts/risks.test.mjs`

**Interfaces:**
- Consumes: `businessDaysBetween(a, b)` from `scripts/lib/metrics.mjs`.
- Produces, all exported from `scripts/lib/risks.mjs`:
  - `blockedIssues(issues, { byId, problemsById, activeSprintId }) -> BlockedRow[]`. `issues` is every issue, archived included, in creation order. `byId` is `Map<id, Issue>` over the same list. `problemsById` is `Map<id, code>` from the `searchIssues` problems. `activeSprintId` is a sprint ID or `null`.
  - `prsByBranch(prs) -> Object<branch, pr>`, keyed by `headRefName`. For two PRs on one branch, the one with the newest `updatedAt` (by `Date.parse`) wins.
  - `lastActivity(issue, events, openPr) -> string`, the newest of the event `at` values (by `Date.parse`) and `openPr?.updatedAt`. With no events and no PR, `issue.updated`.
  - `needsPrLookup(issues, { eventsByIssue, openPrsByBranch, today, stuckBusinessDays }) -> Issue[]`: issues that are not archived, are in `in_review`, have a `branch` with no entry in `openPrsByBranch`, and whose `lastActivity(issue, events, undefined)` is more than N business days before `today`.
  - `stalledIssues(issues, { eventsByIssue, openPrsByBranch, closedPrsByBranch, today, stuckBusinessDays }) -> StalledIssueRow[]`. `openPrsByBranch` is the output of `prsByBranch`, or `{}` without host data. `closedPrsByBranch` maps a branch to the `getPullRequest` result of a PR that is not open.
  - Row shapes: Global Constraints, JSON report.

Rules for `stalledIssues`, for each issue that is not archived and is in `in_progress` or `in_review`:

- `openPr = openPrsByBranch[issue.branch]` when the issue has a branch. `lastActivity` and `idleBusinessDays` come from `lastActivity(issue, events, openPr)`.
- When the issue is in `in_review` and `closedPrsByBranch[issue.branch]` exists: reason `pr_merged` when its `mergedAt` is set, else `pr_closed`. `pr` is its `number`. Listed whatever the idle days.
- Otherwise reason `idle`, listed only when idle days `> N`. `pr` is `openPr?.number ?? null`.

`blockedIssues` keeps an issue that is not archived, whose category is `todo`, `in_progress` or `in_review`, or whose category is open and whose `sprint` equals `activeSprintId` (when not `null`), and that has at least one open blocker. An open blocker is a `blockedBy` ID that `byId` lacks, or whose `status.category` is open.

- [ ] **Step 1: Write the failing tests** in a new `scripts/risks.test.mjs`. Helpers:

```js
const TODAY = '2026-10-26' // a Monday
const issue = (id, category, extra = {}) => ({
  id, title: `Title ${id}`, status: { name: category, category }, blockedBy: [], archived: false,
  created: '2026-10-01T00:00:00Z', updated: '2026-10-01T00:00:00Z', ...extra,
})
const ev = (at) => ({ at, by: 'fred', op: 'update' })
const byIdOf = (list) => new Map(list.map((item) => [item.id, item]))
const stalledOpts = (extra = {}) => ({ eventsByIssue: {}, openPrsByBranch: {}, closedPrsByBranch: {}, today: TODAY, stuckBusinessDays: 3, ...extra })
```

  - `blockedIssues names each open blocker, a missing one and an unreadable one`: issues `A` (`in_progress`, `blockedBy: ['B', 'C', 'D', 'E']`, `assignee: 'fred'`, `estimate: 3`), `B` (`todo`), `C` (`done`). `problemsById` is `new Map([['E', 'CONFLICT']])`. The result deep-equals `[{ id: 'A', title: 'Title A', status: 'in_progress', assignee: 'fred', estimate: 3, blockers: [{ id: 'B', category: 'todo' }, { id: 'D', error: 'NOT_FOUND' }, { id: 'E', error: 'CONFLICT' }] }]`.
  - `blockedIssues keeps a backlog issue only when it is in the active sprint`: `F` (`backlog`, `sprint: 'S1'`, blocked by `B`), `G` (`backlog`, no sprint, blocked by `B`), `B` (`todo`). With `activeSprintId: 'S1'` the IDs are `['F']`. With `activeSprintId: null` they are `[]`.
  - `blockedIssues leaves out a done, an archived and a fully unblocked issue`: `H` (`done`, blocked by `B`), `I` (`in_progress`, `archived: true`, blocked by `B`), `J` (`in_progress`, blocked by `C` which is `canceled`), `B` (`todo`). The result is `[]`. A row with no `assignee` and no `estimate` has `assignee: null` and `estimate: null` (check on a separate `K` in `todo` blocked by `B`).
  - `stalledIssues lists an issue idle for more than N business days and not one idle for N`: `S` (`in_progress`) with `ev('2026-10-20T10:00:00Z')` and `T` (`in_review`) with `ev('2026-10-21T10:00:00Z')`. The result deep-equals `[{ id: 'S', title: 'Title S', status: 'in_progress', assignee: null, estimate: null, lastActivity: '2026-10-20T10:00:00Z', idleBusinessDays: 4, reason: 'idle', pr: null }]`.
  - `stalledIssues counts across a weekend`: `U` with `ev('2026-10-23T18:00:00Z')` (a Friday) is not listed.
  - `stalledIssues counts the open pull request of the branch as activity`: `V` (`in_progress`, `branch: 'feat-v'`) with `ev('2026-10-14T10:00:00Z')`. With `openPrsByBranch: { 'feat-v': { number: 5, updatedAt: '2026-10-23T10:00:00Z' } }` it is not listed. With `updatedAt: '2026-10-15T10:00:00Z'` it is listed with `lastActivity: '2026-10-15T10:00:00Z'`, `idleBusinessDays: 7`, `pr: 5`.
  - `stalledIssues lists pr_merged and pr_closed whatever the idle days`: `M` (`in_review`, `branch: 'm'`) and `C2` (`in_review`, `branch: 'c'`), both with `ev('2026-10-26T09:00:00Z')`, and `P` (`in_progress`, `branch: 'p'`) with the same event. `closedPrsByBranch: { m: { number: 7, state: 'MERGED', mergedAt: '2026-10-25T10:00:00Z' }, c: { number: 8, state: 'CLOSED', mergedAt: null }, p: { number: 9, state: 'MERGED', mergedAt: '2026-10-25T10:00:00Z' } }`. Rows: `M` with `reason: 'pr_merged'`, `pr: 7`, `idleBusinessDays: 0`, and `C2` with `reason: 'pr_closed'`, `pr: 8`. `P` is not listed.
  - `stalledIssues uses updated when an issue has no events` (Review Focus 1): `W` (`in_progress`, `updated: '2026-10-20T00:00:00Z'`) with no entry in `eventsByIssue` gives `lastActivity: '2026-10-20T00:00:00Z'` and `idleBusinessDays: 4`.
  - `stalledIssues takes the newest event by instant, not the last line` (Review Focus 2): `X` (`in_progress`) with events `[ev('2026-10-23T10:00:00Z'), ev('2026-10-14T10:00:00Z')]` is not listed.
  - `stalledIssues leaves out todo, done and archived issues`: `todo`, `done`, and `in_progress` with `archived: true`, all with `ev('2026-10-01T10:00:00Z')`, give `[]`.
  - `prsByBranch keeps the newest pull request of a branch` (Review Focus 3): `[{ number: 1, headRefName: 'b', updatedAt: '2026-10-20T10:00:00Z' }, { number: 2, headRefName: 'b', updatedAt: '2026-10-22T10:00:00Z' }, { number: 3, headRefName: 'c', updatedAt: '2026-10-01T10:00:00Z' }]` maps `b` to number 2 and `c` to number 3.
  - `needsPrLookup returns idle in_review issues with a branch and no open pull request`: `R1` (`in_review`, `branch: 'r1'`, event 10-20) is returned. `R2` (`in_review`, `branch: 'r2'`, event 10-20) with `openPrsByBranch: { r2: {...} }`, `R3` (`in_review`, no branch, event 10-20), `R4` (`in_review`, `branch: 'r4'`, event 10-26) and `R5` (`in_progress`, `branch: 'r5'`, event 10-20) are not. The result IDs are `['R1']`.

- [ ] **Step 2: Run to verify they fail**

Run: `node --test scripts/risks.test.mjs`
Expected: FAIL, `Cannot find module` for `./lib/risks.mjs`.

- [ ] **Step 3: Implement** the five functions in `scripts/lib/risks.mjs`, with a header comment in the style of `metrics.mjs` (pure functions, no file or host access). Keep one local `OPEN = (category) => category !== 'done' && category !== 'canceled'` and one `issueRow(issue)` for the shared row base.

- [ ] **Step 4: Run to verify they pass**

Run: `node --test scripts/risks.test.mjs`
Expected: PASS.

- [ ] **Step 5: Run the whole suite**

Run: `npm test`
Expected: PASS, 1110 tests.

- [ ] **Step 6: Commit**

```bash
git add scripts/lib/risks.mjs scripts/risks.test.mjs
git commit -m "feat: compute blocked and stalled issues for the risk radar (PMK-21)" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task 3: stalled pull requests, epics at risk and broken CI

**Files:**
- Modify: `scripts/lib/risks.mjs`
- Test: `scripts/risks.test.mjs`

**Interfaces:**
- Consumes: the helpers of Task 2 and `businessDaysBetween`.
- Produces:
  - `stalledPullRequests(prs, { issuesByBranch, today, stuckBusinessDays }) -> Row[]`. `issuesByBranch` maps a branch to an issue ID. A PR is listed when `businessDaysBetween(pr.updatedAt, today) > N`, draft or not.
  - `epicRisks(epics, { updatesByEpic, today, windowDays }) -> Row[]`. `updatesByEpic[id]` is the `listStatusUpdates` result, newest first.
  - `failingWorkflows(runs) -> { workflows: number, failing: Row[] }`.
  - `failingPullRequests(prs) -> Row[]`.

Rules for `epicRisks`, for each epic whose `status.category` is open:

- `late` when `epic.target` exists and `epic.target < today`.
- `at_risk` or `off_track` when the newest update has that `health`.
- Checked for updates when the category is `in_progress`, or when `epic.start` exists and `daysSince(epic.start, today) > W`.
- `no_recent_update` when checked, and either the newest update has `daysSince(update.at, today) > W`, or there is no update and not (`epic.start` exists and `daysSince(epic.start, today) <= W`).
- An epic with no reason is left out.

Rules for CI:

- `failingWorkflows`: keep runs with `status === 'completed'`. Group by `workflowName`. Per workflow, take the run with the newest `createdAt` (by `Date.parse`, not array order). It fails when its `conclusion` is `failure`, `timed_out` or `startup_failure`. `workflows` is the number of groups.
- `failingPullRequests`: for each PR, the failing entries of `statusCheckRollup ?? []`. An entry with a `context` key is a status context and fails when `state` is `FAILURE` or `ERROR`; its name is `context`. Any other entry is a check run and fails when `conclusion` is `FAILURE`, `TIMED_OUT`, `STARTUP_FAILURE` or `ACTION_REQUIRED`; its name is `name`. Names keep rollup order with duplicates removed. A PR with no failing entry is left out.

- [ ] **Step 1: Write the failing tests** in `scripts/risks.test.mjs`. Add `const epic = (id, category, extra = {}) => ({ id, title: `Epic ${id}`, status: { name: category, category }, ...extra })` and `const update = (at, health = 'on_track') => ({ at, health })`.
  - `stalledPullRequests lists idle pull requests by number, drafts included, with the linked issue`: PRs `{ number: 12, title: 'Old', url: 'u12', headRefName: 'feat-x', isDraft: false, updatedAt: '2026-10-15T10:00:00Z' }`, `{ number: 3, ..., headRefName: 'feat-y', isDraft: false, updatedAt: '2026-10-23T10:00:00Z' }`, `{ number: 7, ..., headRefName: 'feat-z', isDraft: true, updatedAt: '2026-10-20T10:00:00Z' }`, with `issuesByBranch: { 'feat-x': 'ISS-3' }`. The result deep-equals `[{ number: 7, title, url, branch: 'feat-z', isDraft: true, updatedAt: '2026-10-20T10:00:00Z', idleBusinessDays: 4, issue: null }, { number: 12, ..., branch: 'feat-x', isDraft: false, idleBusinessDays: 7, issue: 'ISS-3' }]`.
  - `epicRisks flags a target before today and not one on today`: `epic('E1', 'in_progress', { target: '2026-10-25' })` and `epic('E2', 'in_progress', { target: '2026-10-26' })`, each with `[update('2026-10-20T10:00:00Z')]`. Only `E1`, with `reasons: ['late']`, `lastUpdate: { at: '2026-10-20T10:00:00Z', health: 'on_track' }`, `target: '2026-10-25'`.
  - `epicRisks lists the health of the newest update`: both epics in `in_progress`. `E3` with `[update('2026-10-20T10:00:00Z', 'off_track'), update('2026-10-10T10:00:00Z', 'at_risk')]` has `reasons: ['off_track']`. `E4` with `[update('2026-10-20T10:00:00Z', 'at_risk')]` and `target: '2026-10-01'` has `reasons: ['late', 'at_risk']`.
  - `epicRisks flags an update older than W days and not one W days old`: in `in_progress`, `[update('2026-10-11T10:00:00Z')]` gives `['no_recent_update']`, and `[update('2026-10-12T10:00:00Z')]` gives no row.
  - `epicRisks gives a new in_progress epic W days to report`: in `in_progress` with no update, `start: '2026-10-20'` gives no row, `start: '2026-10-12'` gives no row, `start: '2026-10-11'` gives `['no_recent_update']`, and no `start` gives `['no_recent_update']` with `lastUpdate: null`.
  - `epicRisks checks an epic in another open category only when it started more than W days ago`: in `todo` with no update, `start: '2026-10-01'` gives `['no_recent_update']`, `start: '2026-10-20'` gives no row, and no `start` gives no row.
  - `epicRisks leaves out done and canceled epics, and one with no reason`: `done` and `canceled` epics with `target: '2026-10-01'` and no update give no row. An `in_progress` epic with a recent `on_track` update and no target gives no row. The `target` of a row without one is `null`.
  - `failingWorkflows takes the newest completed run of each workflow`: runs `{ workflowName: 'test', status: 'completed', conclusion: 'success', createdAt: '2026-10-22T10:00:00Z' }`, `{ workflowName: 'test', status: 'completed', conclusion: 'failure', createdAt: '2026-10-21T10:00:00Z' }`, `{ workflowName: 'lint', status: 'in_progress', conclusion: '', createdAt: '2026-10-23T10:00:00Z' }`, `{ workflowName: 'lint', status: 'completed', conclusion: 'timed_out', createdAt: '2026-10-20T10:00:00Z', url: 'ul', headSha: 'abc' }`, `{ workflowName: 'deploy', status: 'completed', conclusion: 'cancelled', createdAt: '2026-10-20T10:00:00Z' }`. The result deep-equals `{ workflows: 3, failing: [{ workflow: 'lint', conclusion: 'timed_out', url: 'ul', createdAt: '2026-10-20T10:00:00Z', headSha: 'abc' }] }`. A second assertion: the same runs with the two `test` runs swapped in the array give the same result.
  - `failingWorkflows counts startup_failure and returns zero workflows for no runs`: `failingWorkflows([])` deep-equals `{ workflows: 0, failing: [] }`. A single completed `startup_failure` run is failing.
  - `failingPullRequests names failing check runs and status contexts`: PR 14 with rollup `[{ __typename: 'CheckRun', name: 'lint', status: 'COMPLETED', conclusion: 'FAILURE' }, { __typename: 'StatusContext', context: 'ci/legacy', state: 'ERROR' }, { __typename: 'CheckRun', name: 'test', status: 'COMPLETED', conclusion: 'SUCCESS' }, { __typename: 'CheckRun', name: 'lint', status: 'COMPLETED', conclusion: 'FAILURE' }]`, PR 2 with `[{ name: 'e2e', conclusion: 'ACTION_REQUIRED' }]`, PR 5 with `statusCheckRollup: null`, PR 6 with `[{ context: 'ok', state: 'SUCCESS' }, { name: 'slow', status: 'IN_PROGRESS', conclusion: '' }]`. The result deep-equals `[{ number: 2, title, url, failing: ['e2e'] }, { number: 14, title, url, failing: ['lint', 'ci/legacy'] }]`.

- [ ] **Step 2: Run to verify they fail**

Run: `node --test scripts/risks.test.mjs`
Expected: the new tests FAIL with `stalledPullRequests is not a function` (or the same for the other three). The Task 2 tests PASS.

- [ ] **Step 3: Implement** `stalledPullRequests`, `epicRisks`, `failingWorkflows`, `failingPullRequests` and the local `daysSince(date, today)` in `scripts/lib/risks.mjs`.

- [ ] **Step 4: Run to verify they pass**

Run: `node --test scripts/risks.test.mjs`
Expected: PASS.

- [ ] **Step 5: Run the whole suite**

Run: `npm test`
Expected: PASS, 1120 tests.

- [ ] **Step 6: Commit**

```bash
git add scripts/lib/risks.mjs scripts/risks.test.mjs
git commit -m "feat: compute stalled pull requests, epics at risk and broken CI (PMK-21)" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task 4: the text report

**Files:**
- Modify: `scripts/lib/risks.mjs`
- Test: `scripts/risks.test.mjs`

**Interfaces:**
- Consumes: `table(header, rows)` from `scripts/lib/format.mjs`, and the report shape of Global Constraints.
- Produces: `risksText(report) -> string`, used by the CLI in Task 5.

- [ ] **Step 1: Write the failing tests** in `scripts/risks.test.mjs`. Add a `baseReport(extra)` helper: `today: '2026-10-23'`, thresholds 3 and 14, `gitHost: { system: 'github', available: true }`, every list `[]`, `ci: { defaultBranch: { branch: 'main', workflows: 2, failing: [] }, pullRequests: [] }`, `problems: []`.
  - `risksText starts with the date, the thresholds and the git host`: the first two lines of `risksText(baseReport())` are `risks on 2026-10-23: stalled after 3 business days without activity, status updates due every 14 days` and `git host: github`.
  - `risksText says none for an empty list`: the text includes `'\n\nblocked issues\nnone\n\nstalled issues\nnone\n\nstalled pull requests\nnone\n\nepics at risk\nnone\n\nfailing CI on main\nnone\n\npull requests with failing checks\nnone'`.
  - `risksText without a git host says why and marks the host lists as not checked`: with `gitHost: { system: 'none', available: false, reason: { code: 'NOT_SUPPORTED', message: 'this repository has no git host configured', nextStep: 'x' } }`, `stalledPullRequests: null`, `ci: null`, line 2 is `git host: none, so issues are stalled by tracker activity only and PRs and CI are not checked`, and the text includes `stalled pull requests\nnot checked: this repository has no git host configured`, `failing CI on default branch\nnot checked: this repository has no git host configured` and `pull requests with failing checks\nnot checked: this repository has no git host configured`.
  - `risksText names an unavailable host and its reason`: `gitHost: { system: 'github', available: false, reason: { code: 'AUTH', message: 'GitHub CLI is not logged in', nextStep: 'gh auth login' } }` gives line 2 `git host: github is not available (GitHub CLI is not logged in), so issues are stalled by tracker activity only and PRs and CI are not checked`.
  - `risksText shows a failed list with its error`: `ci.defaultBranch: { branch: 'main', error: { code: 'UPSTREAM', message: 'gh run list failed: boom' } }` gives `failing CI on main\nnot checked: gh run list failed: boom`. `ci.defaultBranch: { branch: 'main', workflows: 0, failing: [] }` gives `failing CI on main\nnone, no workflow runs on main`.
  - `risksText prints a table with a count for a list with rows`: `blocked: [{ id: 'ISS-1', title: 'T', status: 'in_progress', assignee: null, estimate: 3, blockers: [{ id: 'ISS-2', category: 'todo' }, { id: 'ISS-9', error: 'NOT_FOUND' }] }]` gives a block that starts with `blocked issues (1)\nID ` and whose header row, after `.replace(/ +/g, ' ')`, is `ID | Title | Status | Assignee | Estimate | Blocked by`, and the text includes `ISS-2 (todo), ISS-9 (NOT_FOUND)`.
  - `risksText adds the pr sync note under a pr_merged row`: a `stalledIssues` row with `reason: 'pr_merged'`, `pr: 9` gives text that includes `#9` and the line `pr_merged: the pull request is merged; pmkit pr sync moves the issue to done`. A report with only an `idle` row does not include `pr_merged:`.

- [ ] **Step 2: Run to verify they fail**

Run: `node --test scripts/risks.test.mjs`
Expected: the new tests FAIL with `risksText is not a function`.

- [ ] **Step 3: Implement** `risksText(report)` in `scripts/lib/risks.mjs`, with the exact copy of Global Constraints, Text report. Import `table` from `./format.mjs`.

- [ ] **Step 4: Run to verify they pass**

Run: `node --test scripts/risks.test.mjs`
Expected: PASS.

- [ ] **Step 5: Run the whole suite**

Run: `npm test`
Expected: PASS, 1127 tests.

- [ ] **Step 6: Commit**

```bash
git add scripts/lib/risks.mjs scripts/risks.test.mjs
git commit -m "feat: print the risk radar as a text report (PMK-21)" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task 5: the `risks` CLI command

**Files:**
- Modify: `scripts/pmkit.mjs` (import from `./lib/risks.mjs`, `runRisks(ctx)` next to `runMigrate`, a `COMMANDS` entry after `events`, `now` on `ctx` in `run()`)
- Modify: `scripts/goldens.test.mjs` (`CASES`)
- Create: `scripts/cli-risks.test.mjs`
- Regenerate: `scripts/__goldens__/{basic,team,messy-merge,no-sprints}/risks.txt`

**Interfaces:**
- Consumes: Tasks 1 to 4. Tracker reads `searchIssues({ archived: true })`, `currentCycle()`, `eventsByIssue()`, `listDeliverables()`, `listStatusUpdates(id)`. `defaultBranch(ctx)` and `problemLine` already in `pmkit.mjs`.
- Produces: `COMMANDS` entry `{ name: 'risks', summary: 'blockers, stalled issues and PRs, late or silent epics and broken CI; reads only', flags: [], run: runRisks }` (not `write`), and `runRisks(ctx) -> { data: report, text: risksText(report), warnings }`.

`runRisks(ctx)`:

1. `today`, N, W as in Global Constraints.
2. `const { issues: all, problems } = tracker.searchIssues({ archived: true })`. `byId` and `problemsById` from them. `activeSprintId = tracker.currentCycle()?.id ?? null`. `eventsByIssue = tracker.eventsByIssue()`. `issuesByBranch`: the first non-archived issue (creation order) with each `branch`.
3. Host: `try { host = ctx.host() } catch (error)`. On `NOT_SUPPORTED`, `gitHost` is unavailable with that error as `reason`. Any other error is rethrown. With a host: `prs = host.listPullRequests()`, `openPrsByBranch = prsByBranch(prs)`, then for each issue of `needsPrLookup(all, ...)`, `pr = host.getPullRequest({ head: issue.branch })`, kept in `closedPrsByBranch[issue.branch]` when `pr !== null && pr.state !== 'OPEN'`. Then `runs = host.listRuns({ branch: defaultBranch(ctx) })`. In this task, let every host error other than `NOT_SUPPORTED` propagate. Task 6 adds the rest.
4. `epics = tracker.listDeliverables()`. For each epic, `listStatusUpdates(epic.id)`. A `PmkitError` there gives `[]` for that epic, a `problems` entry and warning 7 (Review Focus 5).
5. Build the report in the key order of Global Constraints, and the warnings in their order.

- [ ] **Step 1: Write the failing tests.**

  In `scripts/goldens.test.mjs`, add `risks: () => [[]],` to `CASES`, after `events`.

  Create `scripts/cli-risks.test.mjs`. Copy the setup of `scripts/cli-pr.test.mjs` lines 1 to 53 that the tests need (`envWith`, `git`, `teamRepo`, `call`, `callJson`, `VIEW`, `view`, `scratch`) and set `PMKIT_NOW` from a parameter: `envWith(gh, now = '2026-10-23T12:00:00Z')`. Add:

```js
// Sets a branch on an issue by editing its file, so no event is appended and idle days stay as the fixture has them.
function setBranch(root, id, branch) {
  const file = path.join(root, '.issues/issues', id, 'issue.md')
  fs.writeFileSync(file, fs.readFileSync(file, 'utf8').replace('\ncreated: ', `\nbranch: ${branch}\ncreated: `))
}
const PR_LIST = 'pr list --state open --limit 200 --json number,url,title,headRefName,isDraft,updatedAt,author,statusCheckRollup'
const RUN_LIST = 'run list --branch main --limit 50 --json databaseId,workflowName,status,conclusion,url,createdAt,headSha'
```

  Tests:
  - `risks without a git host lists tracker risks and marks pull requests and CI as not checked` (criterion 2): `teamRepo({ github: false })`, `envWith(fakeGh({}))`. JSON: `today` `'2026-10-23'`, `thresholds` `{ stuckBusinessDays: 3, statusUpdateWindowDays: 14 }`, `gitHost.system` `'none'`, `gitHost.available` `false`, `gitHost.reason.code` `'NOT_SUPPORTED'`. `blocked` deep-equals `[{ id: 'ISS-2X6D', title: 'Billing export to CSV', status: 'in_progress', assignee: 'ana', estimate: 8, blockers: [{ id: 'ISS-5N1R', category: 'in_progress' }] }]`. `stalledIssues` deep-equals `[{ id: 'ISS-2X6D', title: 'Billing export to CSV', status: 'in_progress', assignee: 'ana', estimate: 8, lastActivity: '2026-10-14T09:00:00Z', idleBusinessDays: 7, reason: 'idle', pr: null }]`. `stalledPullRequests` and `ci` are `null`. `epics.map((e) => [e.id, e.reasons, e.lastUpdate])` deep-equals `[['EPC-2M9D', ['no_recent_update'], null]]`. `problems.map((p) => [p.id, p.code])` deep-equals `[['ISS-3Q6T', 'CONFLICT']]`. Exit 0. `stderr` includes `warning: no git host is configured, so issues are stalled by tracker activity only and pull requests and CI are not checked`. The text run (no `--json`) starts with `risks on 2026-10-23: stalled after 3 business days without activity, status updates due every 14 days\ngit host: none, so issues are stalled by tracker activity only and PRs and CI are not checked\n`.
  - `risks with the GitHub host lists stalled pull requests, merged branches and failing checks` (criterion 1): `teamRepo()`, `setBranch` `ISS-2X6D` to `feat-csv` and `ISS-8C4W` to `feat-dlq`, `PMKIT_NOW` `'2026-10-28T12:00:00Z'` (a Wednesday). Fake `gh`:
    - `PR_LIST`: PR 11 (`headRefName: 'feat-csv'`, `isDraft: true`, `updatedAt: '2026-10-27T10:00:00Z'`, `statusCheckRollup: []`), PR 12 (`'feat-old'`, `updatedAt: '2026-10-15T10:00:00Z'`, `[]`), PR 14 (`'feat-lint'`, `updatedAt: '2026-10-27T10:00:00Z'`, rollup `[{ __typename: 'CheckRun', name: 'lint', status: 'COMPLETED', conclusion: 'FAILURE' }]`). Each with `url`, `title` and `author: { login: 'fred' }`.
    - `view('feat-dlq')`: `prJson({ number: 9, state: 'MERGED', mergedAt: '2026-10-24T10:00:00Z', headRefName: 'feat-dlq' })`, with `prJson` copied from `cli-pr.test.mjs`.
    - `RUN_LIST`: `[]`.

    Expect: `gitHost` deep-equals `{ system: 'github', available: true }`. `stalledIssues.map((r) => [r.id, r.reason, r.idleBusinessDays, r.pr])` deep-equals `[['ISS-5N1R', 'idle', 4, null], ['ISS-8C4W', 'pr_merged', 5, 9]]`. `ISS-2X6D` is not stalled, because PR 11 counts as its activity. `stalledPullRequests.map((r) => [r.number, r.idleBusinessDays, r.issue])` deep-equals `[[12, 9, null]]`. `ci` deep-equals `{ defaultBranch: { branch: 'main', workflows: 0, failing: [] }, pullRequests: [{ number: 14, title: <its title>, url: <its url>, failing: ['lint'] }] }`. `ghCalls(gh)` deep-equals `[PR_LIST, view('feat-dlq'), RUN_LIST]`. `stderr.trim().split('\n')` has one line, and it starts with `warning: ISS-3Q6T: CONFLICT` (the fixture's unreadable issue).
  - `risks writes nothing` (criterion 3): the same repo, branches and fake `gh` as the test above. `const before = readTree(root)` (from `./scenario-helpers.mjs`, which skips `.git` and `.issues/.cache`). Run `risks --json`, exit 0. `readTree(root)` deep-equals `before`. Every line of `ghCalls(gh)` matches `/^(pr list|pr view|run list) /`. Then, to show the comparison can fail, run `issues assign ISS-5N1R ana --json` (exit 0) and assert `readTree(root)` does not deep-equal `before`.
  - `risks keeps the report when an epic's status updates cannot be read` (Review Focus 5): `teamRepo({ github: false })`, then write `.issues/epics/EPC-2M9D/updates/2026-10-20-fred.md` with the text `not a status update\n`. Exit 0. `epics[0].reasons` deep-equals `['no_recent_update']` and `epics[0].lastUpdate` is `null`. `problems` includes `{ id: 'EPC-2M9D', code: 'INVALID_INPUT', message: 'The status update file has no frontmatter.' }`. `stderr` includes `warning: EPC-2M9D: INVALID_INPUT The status update file has no frontmatter.` (checked while writing this plan: `epic updates EPC-2M9D` on that file exits 2 with this error).

- [ ] **Step 2: Run to verify they fail**

Run: `node --test scripts/cli-risks.test.mjs scripts/goldens.test.mjs`
Expected: the four `cli-risks` tests FAIL with exit 2 and `unknown command "risks"`. `CASES covers exactly COMMANDS` FAILS with `CASES entry "risks" names no command in COMMANDS`.

- [ ] **Step 3: Implement** `runRisks(ctx)`, the `COMMANDS` entry and `now` on `ctx`, as described above.

- [ ] **Step 4: Run to verify they pass**

Run: `node --test scripts/cli-risks.test.mjs`
Expected: PASS.

- [ ] **Step 5: Generate the goldens**

Run: `UPDATE_GOLDENS=1 node --test scripts/goldens.test.mjs`, then `git status --short scripts/__goldens__`.
Expected: four new files, `scripts/__goldens__/{basic,team,messy-merge,no-sprints}/risks.txt`, and no modified file. Read each one. Every fixture has no git host, so each run exits 0 and its stderr holds the `no git host is configured` warning. `team/risks.txt` lists `ISS-2X6D` as blocked and stalled (7 idle days), `EPC-2M9D` with `no_recent_update`, and the `ISS-3Q6T` warning. `basic/risks.txt` has `none` in the three tracker sections.

- [ ] **Step 6: Run the whole suite**

Run: `npm test`
Expected: PASS, 1135 tests (the four CLI tests, the `risks` golden subtest of each of the four fixtures).

- [ ] **Step 7: Commit**

```bash
git add scripts/pmkit.mjs scripts/goldens.test.mjs scripts/cli-risks.test.mjs scripts/__goldens__/*/risks.txt
git commit -m "feat: add the risks command, read only and without a git host (PMK-21)" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task 6: host failures degrade the report

**Files:**
- Modify: `scripts/pmkit.mjs` (`runRisks`)
- Test: `scripts/cli-risks.test.mjs`

**Interfaces:**
- Consumes: `runRisks` of Task 5.
- Produces: the failure rules of Global Constraints. `NOT_CONFIGURED` or `AUTH` from any host call stops the host calls and drops every host-backed value. `RATE_LIMITED` or `UPSTREAM` affects only the call that raised it.

- [ ] **Step 1: Write the failing tests** in `scripts/cli-risks.test.mjs`. Reuse the Task 5 fake `gh` responses as a `cannedGh()` helper that returns a fresh object, so each test can override one key.
  - `risks with a logged out gh lists tracker risks and says how to log in` (criterion 2): `teamRepo()`, `PR_LIST` answers `{ status: 4, stderr: 'To get started with GitHub CLI, please run:  gh auth login\n' }`. Exit 0. `gitHost` deep-equals `{ system: 'github', available: false, reason: { code: 'AUTH', message: 'GitHub CLI is not logged in', nextStep: 'gh auth login' } }`. `stalledPullRequests` and `ci` are `null`. `stalledIssues` IDs are `['ISS-2X6D']` (at `2026-10-23`). `ghCalls(gh)` deep-equals `[PR_LIST]`. `stderr` includes `warning: GitHub CLI is not logged in, so issues are stalled by tracker activity only and pull requests and CI are not checked; next: gh auth login`.
  - `risks with no gh on the PATH reports NOT_CONFIGURED`: `env = { ...envWith(fakeGh({})), PATH: scratch() }`. Exit 0, `gitHost.reason.code` `'NOT_CONFIGURED'`, `stalledPullRequests` `null`.
  - `risks drops every host list when gh logs out after pr list` (Review Focus 4): the Task 5 GitHub setup at `2026-10-28`, with `RUN_LIST` answering the `gh auth login` stderr with status 4. Exit 0. `gitHost.reason.code` `'AUTH'`, `stalledPullRequests` `null`, `ci` `null`. The stalled issues use tracker activity only, so PR 11 no longer counts for `ISS-2X6D` and the merged lookup for `ISS-8C4W` is dropped: `stalledIssues.map((r) => [r.id, r.reason, r.pr])` deep-equals `[['ISS-2X6D', 'idle', null], ['ISS-5N1R', 'idle', null], ['ISS-8C4W', 'idle', null]]`.
  - `risks keeps the pull request lists when only run list fails`: the Task 5 GitHub setup, `RUN_LIST` answering `{ status: 1, stderr: 'HTTP 502: Bad Gateway\n' }`. Exit 0. `gitHost.available` `true`. `stalledPullRequests` is a list with PR 12. `ci.pullRequests` is a list with PR 14. `ci.defaultBranch` deep-equals `{ branch: 'main', error: { code: 'UPSTREAM', message: 'gh run list failed: HTTP 502: Bad Gateway', nextStep: 'Check the output of the same command in a terminal' } }`. `stderr` includes `warning: CI on main not checked: gh run list failed: HTTP 502: Bad Gateway`.
  - `risks keeps the CI on main when only pr list fails`: `PR_LIST` answering `{ status: 1, stderr: 'API rate limit exceeded\n' }`, `RUN_LIST` `[]`. Exit 0. `stalledPullRequests` and `ci.pullRequests` are both `{ error: { code: 'RATE_LIMITED', message: 'GitHub rate limit reached', nextStep: 'Wait a few minutes and retry' } }`. `ci.defaultBranch.workflows` is `0`. No `pr view` call is in `ghCalls(gh)`. `stderr` includes `warning: pull requests not checked: GitHub rate limit reached`.
  - `risks keeps an issue idle when its pull request lookup fails`: the Task 5 GitHub setup, `view('feat-dlq')` answering `{ status: 1, stderr: 'GraphQL: boom\n' }`. Exit 0. The `ISS-8C4W` row has `reason: 'idle'` and `pr: null`. `stderr` includes `warning: ISS-8C4W: the pull request of feat-dlq could not be read: gh pr view failed: GraphQL: boom`.
  - `risks warns when it reads 200 open pull requests`: `teamRepo()`, `PR_LIST` answering 200 PRs, numbered 1 to 200, branches `b1` to `b200`, `updatedAt: '2026-10-22T10:00:00Z'`, `statusCheckRollup: []`. `RUN_LIST` `[]`. Exit 0, and `stderr` includes `warning: only the 200 most recently created open pull requests were read`.

- [ ] **Step 2: Run to verify they fail**

Run: `node --test scripts/cli-risks.test.mjs`
Expected: the seven new tests FAIL. The `AUTH`, `NOT_CONFIGURED`, `UPSTREAM` and `RATE_LIMITED` cases exit 2 with the host error, because Task 5 lets it propagate. The 200 PR case exits 0 with no warning. The Task 5 tests PASS.

- [ ] **Step 3: Implement** the failure handling in `runRisks`:
  - Wrap the host phase (from `listPullRequests` to `listRuns`) in one `try`. On a `PmkitError` with code `NOT_CONFIGURED` or `AUTH`, discard everything the phase read (`openPrsByBranch = {}`, `closedPrsByBranch = {}`, PR and run lists `null`) and set `gitHost` unavailable with that error as `reason`. Rethrow any other error that reaches it.
  - Inside, give `listPullRequests`, each `getPullRequest` and `listRuns` their own `try`. On `RATE_LIMITED` or `UPSTREAM`, record the error for that value and the warning of Global Constraints, then go on. Rethrow `NOT_CONFIGURED` and `AUTH` to the outer `try`. Skip the lookups when `listPullRequests` failed.
  - Add the 200 PR warning.

- [ ] **Step 4: Run to verify they pass**

Run: `node --test scripts/cli-risks.test.mjs`
Expected: PASS.

- [ ] **Step 5: Run the whole suite**

Run: `npm test`
Expected: PASS, 1142 tests. No golden changes (the goldens have no host).

- [ ] **Step 6: Commit**

```bash
git add scripts/pmkit.mjs scripts/cli-risks.test.mjs
git commit -m "feat: keep the risk radar running when gh fails (PMK-21)" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task 7: the `/pmkit:team:risk-radar` command

**Files:**
- Create: `commands/team/risk-radar.md`, `scripts/__scenarios__/team-risk-radar.mjs`
- Regenerate: `scripts/__scenarios__/team-risk-radar.after.txt`
- Modify: `scripts/scenarios.test.mjs` (the count), `scripts/plugin.test.mjs` (`COMMANDS.team`), `skills/pmkit/SKILL.md`, `README.md`

**Interfaces:**
- Consumes: `risks --json` from Tasks 5 and 6.

- [ ] **Step 1: Write the failing tests.**
  - `scripts/scenarios.test.mjs`: the test `there are 24 command files` becomes `there are 25 command files`, with `assert.equal(FILES.length, 25, ...)`.
  - `scripts/plugin.test.mjs`: `team: ['standup']` becomes `team: ['standup', 'risk-radar']`.
  - Create `scripts/__scenarios__/team-risk-radar.mjs`:

```js
// /pmkit:team:risk-radar on the team fixture with the GitHub host, on 2026-10-23. The setup writes branches into two issue
// files by hand, so no event is appended. ISS-2X6D is blocked and idle even with its draft PR, PR 9 is stalled with a
// failing check, and the test workflow fails on main.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'

const PR_LIST = 'pr list --state open --limit 200 --json number,url,title,headRefName,isDraft,updatedAt,author,statusCheckRollup'
const RUN_LIST = 'run list --branch main --limit 50 --json databaseId,workflowName,status,conclusion,url,createdAt,headSha'
const pr = (number, branch, isDraft, updatedAt, conclusion) => ({
  number, url: `https://github.com/o/r/pull/${number}`, title: `PR ${number}`, headRefName: branch, isDraft, updatedAt, author: { login: 'ana' },
  statusCheckRollup: [{ __typename: 'CheckRun', name: 'test', status: 'COMPLETED', conclusion }],
})
const run = (id, workflowName, status, conclusion, createdAt) => ({ databaseId: id, workflowName, status, conclusion, url: `https://github.com/o/r/actions/runs/${id}`, createdAt, headSha: `sha${id}` })

export default {
  command: 'team/risk-radar',
  fixture: 'team',
  github: true,
  gh: {
    [PR_LIST]: { stdout: JSON.stringify([pr(9, 'feat-dlq', false, '2026-10-15T10:00:00Z', 'FAILURE'), pr(11, 'feat-csv', true, '2026-10-16T10:00:00Z', 'SUCCESS')]) },
    [RUN_LIST]: { stdout: JSON.stringify([
      run(4, 'lint', 'in_progress', '', '2026-10-23T09:00:00Z'),
      run(3, 'test', 'completed', 'failure', '2026-10-22T10:00:00Z'),
      run(2, 'lint', 'completed', 'success', '2026-10-22T09:00:00Z'),
      run(1, 'test', 'completed', 'success', '2026-10-21T10:00:00Z'),
    ]) },
  },
  async setup({ root }) {
    for (const [id, branch] of [['ISS-2X6D', 'feat-csv'], ['ISS-8C4W', 'feat-dlq']]) {
      const file = path.join(root, '.issues/issues', id, 'issue.md')
      fs.writeFileSync(file, fs.readFileSync(file, 'utf8').replace('\ncreated: ', `\nbranch: ${branch}\ncreated: `))
    }
  },
  prompt: '/pmkit:team:risk-radar',
  answers: [],
  steps: [
    { step: '1', read: ['risks'], save: 'risks' },
  ],
  skip: {},
  notHit: {},
  expect(repo, saved) {
    const { risks } = saved
    for (const id of ['ISS-2X6D', 'ISS-5N1R', 'ISS-8C4W']) assert.deepEqual(repo.newEvents(id), [], `${id}: a read-only command appends no event`)
    assert.deepEqual(repo.ghCalls(), [PR_LIST, RUN_LIST], 'only the two list calls, and no write')
    assert.equal(risks.gitHost.available, true)
    assert.deepEqual(risks.blocked.map((row) => row.id), ['ISS-2X6D'])
    assert.deepEqual(risks.stalledIssues.map((row) => [row.id, row.reason, row.idleBusinessDays, row.pr]), [['ISS-2X6D', 'idle', 5, 11]])
    assert.deepEqual(risks.stalledPullRequests.map((row) => [row.number, row.isDraft, row.idleBusinessDays, row.issue]), [[9, false, 6, 'ISS-8C4W'], [11, true, 5, 'ISS-2X6D']])
    assert.deepEqual(risks.epics.map((row) => [row.id, row.reasons]), [['EPC-2M9D', ['no_recent_update']]])
    assert.deepEqual(risks.ci.defaultBranch.failing.map((row) => [row.workflow, row.conclusion]), [['test', 'failure']])
    assert.equal(risks.ci.defaultBranch.workflows, 2)
    assert.deepEqual(risks.ci.pullRequests.map((row) => [row.number, row.failing]), [[9, ['test']]])
  },
}
```

- [ ] **Step 2: Run to verify they fail**

Run: `node --test scripts/scenarios.test.mjs scripts/plugin.test.mjs`
Expected: FAIL. `there are 25 command files` gets 24. `every command file has a scenario` reports `rule 1: scenario module team-risk-radar.mjs names no command file`. `the 2 commands in commands/team exist` gets `['standup']`. `every command is listed in the skill table and in the README` fails on `team:risk-radar`.

- [ ] **Step 3: Write `commands/team/risk-radar.md`** with this exact text:

````markdown
---
description: Blockers, stalled issues and PRs, late or silent epics and broken CI, in one read-only report
argument-hint: ""
disable-model-invocation: true
---

# Risk radar

Arguments: `$ARGUMENTS`

## Parameters

None. The radar covers the whole tracker.

## Steps

Read `${CLAUDE_PLUGIN_ROOT}/skills/pmkit/references/conventions.md` first.

1. Run `node "${CLAUDE_PLUGIN_ROOT}/scripts/pmkit.mjs" risks --json`. It reads the tracker and, when `git_host.system` is `github`, the open pull requests and the workflow runs on the default branch. It writes nothing and asks nothing, so it also runs headless.
2. When `gitHost.available` is false, say in one line why, from `gitHost.reason.message`, and that issues are stalled by tracker activity only. When `gitHost.reason.code` is `NOT_CONFIGURED` or `AUTH`, add `gitHost.reason.nextStep` to that line.
3. Show six sections in this order: blocked issues (`blocked`), stalled issues (`stalledIssues`), stalled pull requests (`stalledPullRequests`), epics at risk (`epics`), failing CI on the default branch (`ci.defaultBranch`) and pull requests with failing checks (`ci.pullRequests`). Put the sections that have rows first and keep that order inside each group. A `null` list was not checked, so write `not checked` and the reason from step 2. A value with an `error` was not checked either, so write `not checked` and `error.message`. Write `none` for an empty list.
4. For an epic, name each reason: `late` (its target is before today), `at_risk` or `off_track` (the health of its last status update), `no_recent_update` (no status update for more than `thresholds.statusUpdateWindowDays` days).
5. For a stalled issue with the reason `pr_merged`, say that its pull request is merged and that `/pmkit:team:standup` or `pmkit pr sync` moves it to `done`. Do not run the sync, because this command writes nothing. For `pr_closed`, say that its pull request was closed without a merge.
6. Show each entry of `problems` as a warning with its ID.

## Confirmation points

None. The command only reads.

## Output

A head line with the date, the thresholds (stalled after `thresholds.stuckBusinessDays` business days without activity, status updates due every `thresholds.statusUpdateWindowDays` days) and the count per section. Then the sections, ready to paste into a channel. Issue tables use the columns ID, title, status, assignee and estimate, plus "blocked by" for blocked issues and "idle days" and "reason" for stalled issues. Every issue and epic shows its full ID, and every pull request its number.

## If something is missing

- No risks in any section: say so in one line, with the date and the thresholds.
- The git host is `none`: one line, as in step 2. The tracker sections still show.
- `gh` is missing or logged out: one line with `gitHost.reason.nextStep`, as in step 2.
- An error from the CLI: apply the rules for reading errors in the conventions.
````

- [ ] **Step 4: Add the command to the skill table and the README.**
  - `skills/pmkit/SKILL.md`: a new row right before the `/pmkit:team:standup` row:
    `| see what could make the team miss: blockers, stalled issues and PRs, late or silent epics, broken CI | \`/pmkit:team:risk-radar\` | \`${CLAUDE_PLUGIN_ROOT}/commands/team/risk-radar.md\` |`
  - `README.md`, the command list: a new line right before the `/pmkit:team:standup` line:
    `` - `/pmkit:team:risk-radar`: Blockers, stalled issues and PRs, late or silent epics and broken CI, in one read-only report. ``
  - `README.md`, the CLI table: a new row right after the `events` row:
    `` | `risks` | blockers, stalled issues and PRs, late or silent epics and broken CI; reads only. With `git_host.system: none`, or when `gh` is missing or logged out, it lists issues stalled by tracker activity and marks pull requests and CI as not checked | ``

- [ ] **Step 5: Generate the scenario snapshot**

Run: `UPDATE_GOLDENS=1 node --test scripts/scenarios.test.mjs`, then `git status --short scripts/__scenarios__`.
Expected: one new file, `scripts/__scenarios__/team-risk-radar.after.txt`, and no modified file. It shows `$ pmkit risks --json  [step 1, read]`, `exit 0`, `(no file changed)` and the two `gh` calls `PR_LIST` and `RUN_LIST`.

- [ ] **Step 6: Run to verify they pass**

Run: `node --test scripts/scenarios.test.mjs scripts/plugin.test.mjs`
Expected: PASS. Rule 8 confirms the read changed no file outside `.git` and `.issues/.cache`.

- [ ] **Step 7: Run the whole suite**

Run: `npm test`
Expected: PASS, with more tests than the 1142 of Task 6 (the scenario of the new command file adds its own test).

- [ ] **Step 8: Commit**

```bash
git add commands/team/risk-radar.md scripts/__scenarios__/team-risk-radar.mjs scripts/__scenarios__/team-risk-radar.after.txt scripts/scenarios.test.mjs scripts/plugin.test.mjs skills/pmkit/SKILL.md README.md
git commit -m "feat: add the /pmkit:team:risk-radar command (PMK-21)" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task 8: the design spec and the glossary

**Files:**
- Modify: `docs/superpowers/specs/2026-10-23-pmkit-design.md`, `CONTEXT.md`

**Interfaces:** none. Docs only, so this task has no failing test. `npm test` must stay green.

- [ ] **Step 1: Update the design spec.**
  - CLI table: a new row right after the `events [--since d] [--until d]` row:
    `` | `risks` | blockers, stalled issues and PRs, late or silent epics and broken CI; reads only, and without a git host lists issues stalled by tracker activity **(builder's call)** | ``
  - Commands table: a new row right after the `/pmkit:team:standup` row:
    `` | `/pmkit:team:risk-radar` | `commands/team/risk-radar.md` | `risks` | ``
  - Right after the Commands table, before the paragraph that starts with `` `/pmkit:setup` runs safely more than once``, a new paragraph:
    `Phase 2 adds command files beyond the 24 of the MVP. The first is \`/pmkit:team:risk-radar\` (PMK-21).`
  - `The MVP ships 24 command files.` stays as it is.

- [ ] **Step 2: Add the Stalled term to `CONTEXT.md`**, right after the **Blocked** entry, with one blank line before it:

```markdown
**Stalled**:
An issue in `in_progress` or `in_review`, or an open pull request, with no activity for more than `stuck_business_days` business days. An issue's activity is its newest event and, with a git host, the last update of the open pull request of its branch. `pmkit risks` lists stalled issues and pull requests.
_Avoid_: stale (backlog grooming's term for old backlog issues), idle
```

- [ ] **Step 3: Check the prose**

Run: `grep -n "—\|“\|”" CONTEXT.md docs/superpowers/specs/2026-10-23-pmkit-design.md commands/team/risk-radar.md README.md skills/pmkit/SKILL.md`
Expected: no line added by this branch (compare with `git diff main -- <file>`).

- [ ] **Step 4: Run the whole suite**

Run: `npm test`
Expected: PASS, the same count as Task 7.

- [ ] **Step 5: Commit**

```bash
git add docs/superpowers/specs/2026-10-23-pmkit-design.md CONTEXT.md
git commit -m "docs: add risks and the risk radar to the design spec and the glossary (PMK-21)" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Final check

- [ ] Run `npm test`. Expected: PASS, more than 1093 tests.
- [ ] Run `git diff main --stat`. Expected: only the files listed under Global Constraints, Files.
- [ ] Run `git diff main -- scripts/__goldens__ scripts/__scenarios__ --stat`. Expected: four new `risks.txt` files and `team-risk-radar.after.txt`, nothing modified.
- [ ] Run `PMKIT_USER=fred node scripts/pmkit.mjs risks` in this repository. It must exit 0 and print the report. This repository has `git_host.system: github`, so with `gh` logged in the PR and CI sections show real data, and without it the head line says why. Then run `git status --short .issues`. Expected: no change.
