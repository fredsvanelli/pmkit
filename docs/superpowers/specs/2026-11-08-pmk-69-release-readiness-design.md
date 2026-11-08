# PMK-69: the release-readiness command

Source: PM catalog `release-readiness` ("What's left for a release: open issues, PRs, deploys"; degradation "Milestone or cycle").
Decisions below were taken without asking the user (non-interactive run) and are marked as calls.

## Goal

`/pmkit:release:readiness`-style report: for one release, the open issues, the open pull requests and the deploys. When the tracker has no releases, the same report for a milestone or a sprint, and the output says which basis it used and why.

## Non-goals

No writes. No release-notes (that is `release-notes`). No go/no-go decision made by the agent beyond the `ready` flag the CLI computes.

## Design

New CLI command `release-readiness [--release id | --milestone id | --sprint current|id]` (flags exclusive). The file is `commands/report/release-readiness.md` (call: next to `release-notes`).

Basis choice (`chooseReadinessBasis`, pure, in `scripts/lib/release-readiness.mjs`):
1. A selector wins (`reason: requested`).
2. Else the first planned release by version order (`next_planned`), if the `releases` capability is on.
3. Else the milestone with the earliest due date (undated last) that still has an open issue (`earliest_due_milestone`).
4. Else the active sprint (`active_sprint`).
5. Else `INVALID_INPUT` "nothing to check". Every rung passed over is in `skipped` with its reason (`releases_absent`, `no_planned_release`, `no_open_milestone`, `cycles_absent`/`no_active_sprint`), so the agent can say why a milestone or sprint was used (acceptance criterion 2). `--release` on a tracker without releases is `NOT_SUPPORTED`.

Issues: `searchIssues({ release | sprint })`, or all issues filtered by `issue.milestone` for a milestone (Local and Linear both lack a milestone filter; call). Archived issues are left out. `open` = category not done/canceled. Result has `issues.open` (rows), `issues.counts { open, done, canceled, total }`.

Pull requests: the open PRs (`host.listPullRequests`) whose `headRefName` equals the `branch` of a basis issue. Each row: number, title, url, isDraft, issue, checks summary (reuse `failingPullRequests`-style data when cheap, else only the failing names).

Deploys: `host.listDeploys({ limit: 20 })`. GitHub deployments belong to the repository, not to a release, so each row has `matchesRelease` (true only on a release basis whose `tag` equals the deploy `ref`) and the text says the list is repository-wide.

Unknown is never zero (round 3 lessons): no host → `pullRequests: null`, `deploys: null`, `gitHost.reason`; a failed call → `{ error }`; 200 open PRs read → `pullRequestsIncomplete: true`; issue files that do not parse → `problems` and `complete: false`. `ready` is `true` only when nothing is open and everything was read; `false` when something is open; `null` when nothing is open but a read was incomplete or unchecked.

Linear: `releases` is absent there, so the release rungs are skipped with a path note, as `release-notes` does; milestone and sprint work. `SERVED_BY.releases`, `cycles` and `linked_code` list the command; no `unsupported` operation is needed because every read has a fallback.

## Tests

Unit tests for `chooseReadinessBasis` and the builders; CLI tests on Local (release, milestone, sprint, fallback order, errors, no host, gh logged out, 200 PRs, unparsable issue); one scenario `report-release-readiness`; capability and plugin counts.
