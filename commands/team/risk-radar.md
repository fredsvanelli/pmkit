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
5. The CLI finds a merged or closed pull request only for an `in_review` issue that has been idle for more than `thresholds.stuckBusinessDays` business days and has no open pull request. For a stalled issue with the reason `pr_merged`, say that its pull request is merged and that `/pmkit:team:standup` or `pmkit pr sync` moves it to `done`. Do not run the sync, because this command writes nothing. For `pr_closed`, say that its pull request was closed without a merge.
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
