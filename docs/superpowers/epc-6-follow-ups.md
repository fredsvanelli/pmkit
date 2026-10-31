# EPC-6 follow-ups

The implementers and reviewers of EPC-6 ("Remaining generic commands") suggested these improvements. None of them is a defect. The defects found in the same reviews are issues PMK-175 to PMK-200. This list stays here until each item becomes an issue or is dropped.

## PMK-48: alerts list

- Read other scanners: `pip-audit`, `cargo audit`, `yarn audit` and `pnpm audit`.
- Read a saved scanner report, so the command works offline.
- Decide in PMK-73 whether a transitive advisory that reaches the repository through three packages opens one issue or three.

## PMK-49: deploys list and ci logs

- Read the deployment statuses in one GraphQL query instead of one `gh api` call per deployment. Today one failed call loses the whole list.
- Link the failing check of a pull request to its `ci logs` run.
- `ci logs` without `--run` can return an old failure when a newer run of the same workflow passed, while `risks` reads only the newest run. Show `createdAt` and `headSha` so the age of the failure is visible.
- `--tail` splits the whole log in memory, which is heavy for logs of hundreds of MB.

## PMK-50: docs list

- Serve `listDocuments` on the Linear adapter.
- Add a `listDocuments` case to `scripts/contract-suite.mjs`.
- Update the documents table in `docs/superpowers/specs/2026-10-23-pmkit-design.md`, which lists only read and create.

## PMK-51: issues time-entries

- Share one "positive integer" rule between `logTime` and `listTimeEntries`.
- Check `ignored` in `scripts/contract-suite.mjs`.
- Totals per person and per sprint.
- Use `time-entries` in `/pmkit:issues:progress`.

## PMK-44: saved views

- `views delete` and `views rename`.
- `validate` reports two view names that differ only in case, and `filter: {}`, and counts views in `checked`.
- Let `views run` override the limit and the sort.
- Serve Linear saved views through the API.

## PMK-45: goals

- A `goal_prefix` config key.
- Commands to update, close and delete a goal.
- A goal status or owner.
- Serve Linear initiatives.
- Warn in `goal progress` when a linked epic file does not parse.
- `validate` counts goals in `checked`.

## PMK-57: delegate

- Native delegation on Linear, through its `delegate` field for installed app agents.
- An agent member in the `team` fixture, so the goldens show a real delegation.
- Make `delegate` atomic. Today the assignment is written before the comment.
- Teach `/pmkit:issues:work` about delegated issues, so the agent run skips the "assigned to someone else" question.
- `scripts/contract-suite.mjs:135` requires `run === 'local'`, so an adapter with native delegation fails it.

## PMK-58: track-agents (not done yet)

- Read the newest root delegation comment, and check that the agent is still the assignee.

## PMK-59: estimate-issue

- A scenario with a tracker that has no estimate field, to cover the comment path.
- Find similar issues by similarity instead of `--text` keywords.

## PMK-61: review-pr-against-issue

- Comment on the pull request itself, with inline findings.
- Read the diff file by file when it is cut.
- Read `ci logs` and `pr status` into the review, so a failing check shows as a gap.

## PMK-62: unblock-pr

- Read repository rulesets (`rules/branches`) as well as classic branch protection.
- Page past the first 100 review threads.
- Show the blockers in `pr status` and `/pmkit:issues:mine`.
- Read the pull request once instead of three `gh pr view` calls, and stop downloading thread bodies that nothing reads.

## PMK-64: todos-to-issues

- More tags, such as `HACK` and `XXX`.
- Show the owner of a TODO through `git blame`.
- Offer to reference the new issue in the code comment.
- A full comment parser per language: comments in `<script>` and `<style>` of html and vue, a lone quote that hides a comment, `@todo`, Python docstrings.
- Keep the `todo-key` in an issue field instead of the body.
- The warning about unread file types is noisy (425 files in this repository, 372 of them `.txt`).

## PMK-71: team load

- A config key for the 1.5 overload threshold.
- A column with the issues each person delivered in the sprint.
- Count blocked issues when the command proposes moves.
- Read capacity, days off and the flow history once.

## PMK-46: customers and requests

- `customers update` (tier, revenue, owner) and editing the text of a request.
- `requests accept --create`, which creates the issue and links the request in one call.
- The generic customer and request operations on Linear, built on top of `linear customers`.
- Local prints `customers show X` and Linear `show --customer X`; give PMK-68 and PMK-70 one shape on both trackers.

## PMK-52: issues delete

- Scan `docs/` and the code for the deleted ID.
- Restore an issue from the Linear trash.
- Let `issues link --remove` take several targets, to clear the references in one call.
- Run the delete in the Linear live sandbox (PMK-39).
- Tests for an ID with `../`, an epic ID and `issueDelete` with `success: false`.

## PMK-53: link-repo

- GitHub Enterprise hosts.
- A way to skip the confirmation for a host-only change.
- Re-check the team in the file.

## PMK-72: team capacity

- Recompute the capacity when the days off change. Today the command only says the capacity does not change by itself.
- `--sprint current` in `cycle capacity`, and the team check there on Linear (`writeEntry` takes any workspace user).
- Build the load report once on the write path.

## PMK-47: user inbox

- Key the inbox check by git remote instead of checkout path, so two worktrees of one repository share it.
- Read Linear `Notification` objects, so the Linear adapter can serve `user_inbox`.
- Count review requests and status changes, which PMK-55 may need.
- Add a `/pmkit` command file and a scenario for the inbox, together with PMK-55.
- Show the mention text and whether an item was seen in the text table.
- Lock the user store file on write, so two `mark-read` calls at once cannot drop each other's check.

## PMK-56: bulk operation

- `due`, `type` and `archive` as bulk changes.
- Resume a stopped batch.
- Linear `milestone` and `release`.
- Keep the digest and the filter in one object, so the agent does not pass the flags twice.
- A cheaper preview for very large sets, and a cheaper `link --kind blocks` on Local.

## PMK-60: log-time

- A scenario against a Linear fixture for the comment path.
- Show the time in readable form (`1h30`) in `time-entries`.
- Make `progress` step 8 follow `log-time` directly, if scenario rule 5 (explicit CLI calls per step) is relaxed.

## PMK-65: record-decision

- A `validate` or `/pmkit:local:doctor` check that no two ADRs share a number.
- A `docs` field on issues, so a link to an ADR is not only a comment.
- A command to change the status of an existing ADR (superseded, deprecated).
- Read `origin/HEAD` when `default_branch` is not set.

## PMK-58: track-agents

- A Linear fallback that finds pull requests by agent authors, instead of `NOT_SUPPORTED`.
- An `--agent` filter.

## PMK-63: investigate-bug

- Have `ci logs` return the run's `createdAt`, `conclusion` and `headSha`, so a stale failure does not depend on `pr status`.
- Scenarios for the degraded paths (no branch, `git_host: none`).
- A `--redact` flag on `issues comment`, so the CLI redacts any comment body.
- Read the code of the issue's branch instead of the working tree.

## PMK-73: security-alerts

- Fold transitive advisories into the root package's issue, once `alerts list` carries the `via` graph.
- Comment on or close an issue whose alert is gone from the audit.
- Show the current priority of a matched issue and flag a severity that went up.
- A scenario with a fake npm, and scanners besides `npm audit`.

## PMK-175: alerts list on Windows

- Tests for status 9009 outside `win32` and for a `null` status.
- The CHANGELOG and the plan describe only the text check, not the 9009 exit code.
