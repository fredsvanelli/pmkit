# PMK-21 design: the risk-radar command

Issue PMK-21, epic EPC-3. Status: approved. The author answered the four questions of the brainstorm on 2026-10-26 and took every recommendation. "Answered questions" at the end records them.

## Problem

An engineering manager wants one answer to "what could make us miss?" Today the pieces are spread across commands. `/pmkit:team:standup` lists stuck and blocked issues and PRs with failing checks, but only for the people and the period of a digest. `/pmkit:report:status` judges one epic at a time. Nothing lists the epics that are past their target or that nobody has reported on, and nothing reads CI on the default branch.

Sources: Unified model, EM catalog (`risk-radar`: "Blockers, stalled issues and PRs, late deliverables, broken CI"; degradation "Issues stalled by time"). Linear tab ("projects at risk or without updates").

Acceptance criteria:

1. Lists blockers, stalled issues, stalled PRs, late epics, epics without a recent status update and broken CI.
2. Without a git host it lists issues stalled by time, and says so.
3. Writes nothing.

PMK-26 ("Run digests on a schedule") is blocked by this issue. It needs risk-radar to run headless from cron or a CI schedule, so the radar must not depend on a question to the user.

## What exists today

- `issues list --blocked` returns open issues with a `blockedBy` issue that is not `done` or `canceled`, or that is missing (`isBlocked` in `scripts/lib/model.mjs`). The CONTEXT.md term **Blocked** has the same rule.
- Standup step 3 defines "stuck" in prose: an issue in `in_progress` or `in_review` with no event since a cutoff `defaults.stuck_business_days` business days before today (3 by default). `businessDaysBetween` in `scripts/lib/metrics.mjs` counts Monday to Friday days.
- Epics have `status`, `start` and `target`. `epic updates <id>` lists status updates newest first, each with `at` and `health` (`on_track`, `at_risk`, `off_track`). `/pmkit:report:status` uses `defaults.status_update_window_days` (14 by default) as the reporting period.
- The GitHub host (`scripts/lib/github/host.mjs`) reads one PR by branch or number (`gh pr view`), its checks (`gh pr checks`) and its reviews. It cannot list open PRs, it does not return `updatedAt`, and it reads no workflow runs.
- `makeHost` in `scripts/pmkit.mjs` throws `NOT_SUPPORTED` when `git_host.system` is not `github`. A missing `gh` throws `NOT_CONFIGURED`, a logged-out one `AUTH`.
- ADR-0002: commands never compute. A command that needs a computation the CLI lacks waits for a CLI change.

## Goals

- One CLI read, `pmkit risks`, that returns the six lists of criterion 1 as JSON and as a pasteable text report.
- One command file, `/pmkit:team:risk-radar` (question 4), that runs it and presents the result.
- The radar covers the whole tracker. `risks` takes no filter flags (question 3).
- With `git_host.system: none`, or when `gh` is missing or logged out, the radar still runs. It lists issues stalled by tracker activity alone, marks the PR and CI lists as not checked, and says why in one line.
- Nothing under `.issues/` changes, no event is appended, and no git or `gh` call writes.

## Non-goals

- `pr sync`. Standup and status run it first. The radar must write nothing, so it reports an `in_review` issue whose PR is merged and points to `pmkit pr sync` instead.
- Blocker chains and critical paths. That is PMK-20 (`dependency-map`).
- Aging, lead time and throughput. That is PMK-18.
- Forecasts of whether an epic will meet its target. `/pmkit:report:status` step 5 does that per epic.
- A schedule or an output destination. That is PMK-26.
- Milestones past their due date. The criteria name epics. A follow-up can add milestones.
- CI that does not run on GitHub Actions, for the default branch (question 1).
- Filters by epic, sprint or person (question 3). A follow-up can add them.

## Anti-goals

- No question to the user, no `AskUserQuestion`, no dry run. A headless run must get the full report.
- A git host failure must not fail the radar. Tracker risks are the base of the report and must always print.
- No new config key. The thresholds come from `stuck_business_days` and `status_update_window_days`, which every tracker already has.
- No tracker format bump. Nothing on disk changes shape.

## Approaches

1. **Command file only.** The command calls `issues list --blocked`, `events`, `epic list`, `epic updates` per epic and `pr status` per branch, and computes the rest in prose, as standup does. It cannot meet criterion 1. No CLI call lists open PRs with their last activity or reads CI on the default branch. It also breaks ADR-0002 and gives PMK-26 nothing to run headless.
2. **A `risks` CLI command plus a thin command file.** Pure functions in a new `scripts/lib/risks.mjs` compute each list. Two new read methods on the GitHub host list open PRs and recent workflow runs. The command file runs `risks --json` once and formats the result. PMK-26 can call `pmkit risks` from cron with no agent.
3. **One CLI command per list** (`risks blocked`, `risks stalled`, and so on). Each list could be called alone, but the command file would make six calls, and the host would list PRs twice (stalled issues and stalled PRs both need them).

Recommended: approach 2.

## Design

### Definitions

Today is the date of the CLI clock (`PMKIT_NOW` in tests), in UTC. N is `defaults.stuck_business_days`. W is `defaults.status_update_window_days`. An open category is any category other than `done` and `canceled`.

**Idle business days.** `businessDaysBetween(lastActivity, today)`, which counts the Monday to Friday days after the last activity, up to and including today. An item is stalled when its idle business days exceed N. With N = 3 and today Monday 2026-10-26, activity on Wednesday 2026-10-21 gives 3 and is not stalled. Activity on Tuesday 2026-10-20 gives 4 and is stalled. This is the standup rule ("no event since the cutoff") written as a count.

**Blocked issue.** An issue that is not archived, has an open blocker, and is either in `todo`, `in_progress` or `in_review`, or in the active sprint in any open category. An open blocker is a `blockedBy` ID whose issue is in an open category or cannot be read, the rule of `isBlocked`. A blocked issue in the backlog and outside the sprint is not a near-term risk, so the radar leaves it out (builder's call).

**Stalled issue.** An issue that is not archived, is in `in_progress` or `in_review`, and whose last activity is more than N business days ago. Its last activity is the newest of:

- the `at` of the last event in its event log (any op, so comments and logged time count);
- with a git host, the `updatedAt` of the open PR whose head branch equals the issue's `branch`.

Each stalled issue carries a reason:

- `idle`: the rule above.
- `pr_merged`: the issue is `in_review` and its branch's PR is merged. The CLI looks for a merged PR only when the issue has been idle for more than N business days with no open PR, so a merged PR on a recently active issue is not listed. The next step is `pmkit pr sync`.
- `pr_closed`: the issue is `in_review` and its branch's PR is closed without a merge. Found the same way as `pr_merged`.

Without a git host, only `idle` applies, and last activity is the event log alone. The report says the issues are stalled by tracker activity only (criterion 2).

**Stalled PR.** An open PR, draft or not, whose `updatedAt` is more than N business days ago. The row names the linked issue when an issue's `branch` equals the PR's head branch. Drafts are listed with a draft flag, because a paused issue's draft PR that nobody resumes is a risk too (builder's call).

**Epic risks.** For each epic in an open category, the radar lists the reasons that apply, in this order:

- `late`: the epic has a `target` before today.
- `at_risk` or `off_track`: the health of its newest status update.
- `no_recent_update`: the epic is checked for updates, and its newest status update is more than W calendar days old, or it has none. An epic is checked when it is in `in_progress`, or when it is in another open category and its `start` is more than W calendar days before today (question 2). An epic with no update whose `start` is W or fewer days before today is not flagged, because it has had no time to report.

An epic with no reason is left out.

**Broken CI.** Two lists (question 1):

- Default branch: for each workflow, the newest completed run on `git_host.default_branch` (`main` when unset). The workflow is failing when that run's conclusion is `failure`, `timed_out` or `startup_failure`.
- Open PRs: each open PR with at least one failing check in its status check rollup. A check run fails with conclusion `FAILURE`, `TIMED_OUT`, `STARTUP_FAILURE` or `ACTION_REQUIRED`. A status context fails with state `FAILURE` or `ERROR`.

### GitHub host

Two read methods in `scripts/lib/github/host.mjs`, with the error mapping the host already has (`AUTH`, `RATE_LIMITED`, `UPSTREAM`, `NOT_CONFIGURED`):

| Method | `gh` call | Returns |
|---|---|---|
| `listPullRequests()` | `gh pr list --state open --limit 200 --json number,url,title,headRefName,isDraft,updatedAt,author,statusCheckRollup` | the parsed array |
| `listRuns({ branch })` | `gh run list --branch <branch> --limit 50 --json databaseId,workflowName,status,conclusion,url,createdAt,headSha` | the parsed array |

`refArg` checks the branch, as it does for other refs. When `listPullRequests` returns exactly 200 PRs, the CLI adds the warning `only the 200 most recently created open pull requests were read` (builder's call). A repository with no workflows returns `[]`, and the report says "no workflow runs on main".

For an `in_review` issue that is idle by tracker events, has a `branch`, and has no open PR, the CLI calls the existing `getPullRequest({ head })` to tell `pr_merged` and `pr_closed` apart. It makes that call only for those issues, so a typical run makes two or three `gh` calls.

### Host failures

The CLI calls `makeHost` inside a try block.

- `NOT_SUPPORTED` (`git_host.system` is `none`): no host call runs. `gitHost` in the output is `{ system: "none", available: false, reason }`.
- `NOT_CONFIGURED` or `AUTH` from any host call: the CLI stops calling the host, as `pr sync` does. Every host-backed list becomes `null`, stalled issues fall back to tracker activity, and `gitHost.reason` holds `{ code, message, nextStep }`.
- `RATE_LIMITED` or `UPSTREAM` from one call: only the list that needed it becomes `null`, with its own `error`. The other lists stay.

Each case adds one line to the CLI's `warnings`, so it prints on stderr and the JSON on stdout keeps its shape. `risks` exits 0 whenever the tracker reads. It exits 2 only for errors the tracker raises, as every read does.

A `null` list means "not checked". An empty list means "checked, nothing found". The text report prints `not checked: <reason>` for a `null` list and `none` for an empty one.

### `pmkit risks`

A new entry in `COMMANDS`, not `write: true`, with no flags and no arguments:

```text
risks    blockers, stalled issues and PRs, late or silent epics and broken CI; reads only
```

JSON shape (`--json`):

```json
{
  "today": "2026-10-26",
  "thresholds": { "stuckBusinessDays": 3, "statusUpdateWindowDays": 14 },
  "gitHost": { "system": "github", "available": true },
  "blocked": [
    { "id": "ISS-1", "title": "...", "status": "in_progress", "assignee": "fred", "estimate": 3,
      "blockers": [{ "id": "ISS-2", "category": "todo" }, { "id": "ISS-9", "error": "NOT_FOUND" }] }
  ],
  "stalledIssues": [
    { "id": "ISS-3", "title": "...", "status": "in_review", "assignee": "ana", "estimate": 2,
      "lastActivity": "2026-10-19T14:02:11Z", "idleBusinessDays": 5, "reason": "idle", "pr": 12 }
  ],
  "stalledPullRequests": [
    { "number": 12, "title": "...", "url": "...", "branch": "feat-x", "isDraft": false,
      "updatedAt": "2026-10-19T14:02:11Z", "idleBusinessDays": 5, "issue": "ISS-3" }
  ],
  "epics": [
    { "id": "EPC-1", "title": "...", "status": "in_progress", "target": "2026-10-20",
      "lastUpdate": { "at": "2026-10-01T10:00:00Z", "health": "at_risk" },
      "reasons": ["late", "at_risk", "no_recent_update"] }
  ],
  "ci": {
    "defaultBranch": { "branch": "main", "failing": [{ "workflow": "test", "conclusion": "failure", "url": "...", "createdAt": "...", "headSha": "..." }] },
    "pullRequests": [{ "number": 14, "title": "...", "url": "...", "failing": ["test", "lint"] }]
  },
  "problems": []
}
```

- Without a host, `stalledPullRequests` and `ci` are `null`. With a per-call failure, the affected value carries `"error": { code, message, nextStep }` in place of its list, so the reader sees why: `stalledPullRequests` and `ci.pullRequests` become `{ "error": ... }`, and `ci.defaultBranch` becomes `{ "branch": "main", "error": ... }`.
- `problems` holds issue files that do not parse, from `searchIssues`, as `issues list` reports them. An unreadable blocker is in the blocker row with its error.
- Every list goes in creation order, oldest first (conventions, Issue tables). PRs go by number. Epics go in the order of `listDeliverables`.

The text output has one section per list, in the order of criterion 1, each a table or `none` or `not checked: <reason>`. Issue tables use the five convention columns (ID, title, status, assignee, estimate) and add their own: "blocked by" for blockers, "idle days" and "reason" for stalled issues. A head line gives the date, the thresholds and the git host path, for example `git host: none, so issues are stalled by tracker activity only and PRs and CI are not checked`.

### `scripts/lib/risks.mjs`

Pure functions with no file and no host access, as `metrics.mjs` is. The CLI gathers the inputs and passes them in.

- `blockedIssues(issues, { byId, problemsById, activeSprintId })`
- `prsByBranch(prs)` and `needsPrLookup(issues, { eventsByIssue, openPrsByBranch, today, stuckBusinessDays })`
- `stalledIssues(issues, { eventsByIssue, openPrsByBranch, closedPrsByBranch, today, stuckBusinessDays })`
- `stalledPullRequests(prs, { issuesByBranch, today, stuckBusinessDays })`
- `epicRisks(epics, { updatesByEpic, today, windowDays })`
- `failingWorkflows(runs)` and `failingPullRequests(prs)`
- `risksText(report)`, the text output

Issues and epics carry `status.category`, so no function needs `categoryOf`. The plan gives the exact parameters and return shapes. `businessDaysBetween` comes from `metrics.mjs`. The CLI reads events with `eventsByIssue()`, as `metrics cycle-time` does, and updates with `listStatusUpdates`, as `epic updates` does.

### The command file

`commands/team/risk-radar.md` (question 4), in the shape of the other command files:

- Frontmatter: `description: Blockers, stalled issues and PRs, late or silent epics and broken CI, in one read-only report`, `argument-hint: ""` (as `commands/local/doctor.md` has, because `scripts/plugin.test.mjs` requires the key), `disable-model-invocation: true`.
- Parameters: none.
- Steps: read the conventions. Run `node "${CLAUDE_PLUGIN_ROOT}/scripts/pmkit.mjs" risks --json`. When `gitHost.available` is false, say in one line why, and that issues are stalled by tracker activity only. Show each section in the order of criterion 1. For a `pr_merged` row, offer `pmkit pr sync` as the next step, through `/pmkit:team:standup` or by hand, and do not run it.
- Confirmation points: none. The command only reads.
- Output: a short head line with the count per section, then the sections, ready to paste into a channel. Lead with the sections that have rows.
- If something is missing: no risks found (say so in one line), git host `none` (one line, as above), `gh` missing or logged out (one line with `nextStep`), an error from the CLI (the conventions).

### Docs and registration

- `skills/pmkit/SKILL.md`: a table row, "see what could make the team miss: blockers, stalled issues and PRs, late or silent epics, broken CI".
- `README.md`: the command in the command list and `risks` in the CLI table, with a note that it runs with `git_host.system: none` and degrades.
- `docs/superpowers/specs/2026-10-23-pmkit-design.md`: `risks` in the CLI table, the command in the Commands table with its call (`risks`), and "The MVP ships 24 command files" left as it is, since this is a phase 2 command. The builder adds a line under the table for phase 2 commands.
- `CONTEXT.md`: a **Stalled** term. An issue in `in_progress` or `in_review`, or an open PR, with no activity for more than `stuck_business_days` business days. _Avoid_: stale (backlog grooming's term for old backlog issues), idle.
- `SERVED_BY` in `scripts/lib/capabilities.mjs` does not change. `risks` reads capabilities that other commands already serve, so the manifest counts stay as they are.
- `CHANGELOG.md`: no change on this branch. The release adds the line, with no `Tracker format:` line.

### Tests

- `scripts/risks.test.mjs`: each pure function. The idle boundary (3 days not stalled, 4 stalled, across a weekend). A missing blocker counts as open. A backlog blocked issue in the active sprint is listed, one outside it is not. `stalledIssues` lists `pr_merged` and `pr_closed` for any issue whose closed PR it is given; `needsPrLookup` picks only idle issues. PR activity clears an idle issue. Epic `late`, `at_risk`, `off_track`, `no_recent_update`, a new epic within W days, a done epic left out. Failing conclusions and states.
- `scripts/github-host.test.mjs`: `listPullRequests` and `listRuns` with the fake `exec`, the `refArg` check, `AUTH` and a missing `gh`.
- `scripts/cli-risks.test.mjs`, beside `cli-pr.test.mjs` and with its fake `gh` setup: `risks` with `git_host.system: none`, with a fake `gh` that returns PRs and runs, with `AUTH`, and with an `UPSTREAM` error on `run list` only. Each case checks the JSON shape and the stderr warning.
- Writes nothing (criterion 3): a CLI test copies a fixture, runs `risks --json` with the fake `gh`, and compares `readTree` of the copy before and after, ignoring `.issues/.cache/`, which git ignores and the query index rewrites on any read. It also checks that the `gh` call log holds only `pr list`, `run list` and `pr view` calls. To show the comparison can fail, the same test then runs one write and asserts the trees differ.
- Goldens: a `risks` case per fixture, so `CASES covers exactly COMMANDS` passes. Every fixture has `git_host.system: none` and the golden runner has no fake `gh`, so each golden records the report without a host. The fake `gh` cases live in `cli-risks.test.mjs` and the scenario.
- Scenario `scripts/__scenarios__/team-risk-radar.mjs` on the `team` fixture with `github: true`: one step, `read: ['risks']`. `expect` asserts no new events, no file changes, and that the fake `gh` saw no write. `there are 24 command files` becomes 25.

## Decisions

| Decision | Reason |
|---|---|
| A `risks` CLI command computes every list, and the command file only presents it. | ADR-0002. The PR and CI lists need host reads no CLI call has today. PMK-26 needs a headless entry point. |
| One CLI command, not one per list. | Stalled issues and stalled PRs share one `gh pr list` call. The command file makes one call. |
| No `pr sync`, and merged PRs show as `pr_merged` with a next step. | Criterion 3. Standup and status already offer the sync with a preview. |
| Stalled uses `stuck_business_days`, the standup rule, for issues and PRs. | Standup's "stuck" and the radar's "stalled" then agree, and no new config key or schema change is needed. |
| PR activity counts as issue activity when a host is available. | A developer who pushes to the branch every day is not stalled, even with no tracker event. Without a host, the event log is the only signal, which is criterion 2's degradation. |
| "No recent update" uses `status_update_window_days` in calendar days. | It is the period `/pmkit:report:status` reports on, so an epic is flagged when its next status report is due. |
| Epics with health `at_risk` or `off_track` are listed. | The Linear tab names "projects at risk", and the data is already in `epic updates`. |
| A host failure degrades the report and never fails it, and `null` means not checked. | A headless run must still deliver the tracker risks. The reader must tell "no stalled PRs" from "PRs not read". |
| Blocked issues are limited to `todo`, `in_progress`, `in_review` and the active sprint. | A blocked backlog issue outside the sprint is not at risk yet, and listing every one makes the report long in a groomed backlog. |
| No new config key and no format bump. | Anti-goals. The thresholds already exist, and nothing on disk changes. |
| `SERVED_BY` does not change. | `risks` serves no capability that other commands do not already serve. |

## Acceptance criteria map

| Criterion | Part of the design |
|---|---|
| Lists blockers, stalled issues, stalled PRs, late epics, epics without a recent status update and broken CI | `pmkit risks`: `blocked`, `stalledIssues`, `stalledPullRequests`, `epics` with `late` and `no_recent_update`, `ci`; the command file shows each section |
| Without a git host it lists issues stalled by time, and says so | Host failures: `gitHost.available: false` with a reason, `stalledIssues` from the event log alone, the head line and the command's one-line note |
| Writes nothing | `risks` is not `write: true`; the tree comparison test, the `gh` call log check, and the scenario's no-events and no-changes assertions |

## Related work in the same epic

- PMK-18 adds aging (how long an open issue has been in progress) to the CLI. The radar's stalled rule measures time since the last activity, which is a different number, so it does not wait for PMK-18. When PMK-18 lands, the stalled table could add an age column. That is a follow-up.
- PMK-20 adds the blocker chain and critical path. The radar lists direct blockers only. When PMK-20 lands, the command file can point each blocked row to `dependency-map`. That is a follow-up. Neither sibling's code is on `main`, and this design uses none of it.

## Answered questions

The brainstorm left four questions for the author. The author chose option A, the recommendation, for each one on 2026-10-26. The options stay here for the record.

1. **What counts as broken CI.** Answer: A.
   - A. The newest completed GitHub Actions run per workflow on the default branch (`gh run list`), plus open PRs with failing checks from `gh pr list`. Chosen.
   - B. The check runs and statuses of the default branch's head commit (`gh api repos/{owner}/{repo}/commits/<branch>/check-runs` and `/status`), plus open PRs. It covers CI outside Actions, but a head commit with checks still running shows nothing, and it needs two API calls and more parsing.
   - C. Open PRs with failing checks only. Simplest, but it misses a broken main, which is the usual meaning of "broken CI".
2. **Which epics must have a recent status update.** Answer: A.
   - A. Epics in `in_progress`, plus epics in another open category whose `start` is more than W days ago. Chosen: it skips planned epics, and an epic that started without moving its status still gets flagged.
   - B. Every epic in an open category. Simple, but backlog epics such as EPC-3 in this repository would be flagged before anyone works on them.
   - C. Only epics in `in_progress`. Misses an epic whose status nobody moved.
3. **What the radar covers.** Answer: A.
   - A. The whole tracker, with no filter flags in this issue. Chosen: a radar is an overview, Local trackers are small, and filters can come later.
   - B. The active sprint's issues only, plus every epic and CI. Shorter, but it hides stalled work outside the sprint.
   - C. The whole tracker with `--epic <id>` and `--sprint current` filters on `risks`. More flags to test and to explain in the command.
4. **The command's name and group.** Answer: A.
   - A. `/pmkit:team:risk-radar` in `commands/team/`, next to standup, the other EM digest. Chosen: PMK-26 groups the two, and the catalog lists risk-radar for the EM.
   - B. `/pmkit:report:risk-radar` in `commands/report/`, next to the epic status report.
   - C. `/pmkit:report:risks`, a shorter name that matches the CLI command.

## Follow-up candidates

1. Milestones past their `due` date with open issues, as a seventh list.
2. An age column in the stalled table once PMK-18 ships aging.
3. A pointer from each blocked row to `dependency-map` once PMK-20 ships.
4. Standup step 3 could read `risks --json` for its stuck and blocked lists, so the two commands share one rule in code instead of in prose.

## Self-review

- Placeholders: none. The builder's calls (the PR list limit warning, drafts in stalled PRs, the backlog cut for blocked issues) do not change what the user sees in a normal run.
- Consistency: N and W have one meaning in every section. "Not checked" is `null` in JSON and `not checked: <reason>` in text everywhere. The command file never writes and never asks.
- Scope: one pure module, two host methods, one CLI command, one command file, docs, tests. No config key, no format change, no capability change.
- Builder check: read as the builder, with no subagent. The questions raised were how "stalled" treats a merged PR (answered: `pr_merged`), how the CLI tells merged from closed (answered: `getPullRequest` for idle `in_review` issues only), what happens when Actions is off (answered: empty runs, "no workflow runs"), and whether `.issues/.cache/` counts as a write (answered: no, git ignores it and every read can rebuild it). The author answered the four questions only the author could answer (see "Answered questions").
