# EPC-6 follow-ups

The implementers and reviewers of EPC-6 ("Remaining generic commands") suggested these improvements. None of them is a defect. The defects found in the same reviews are issues PMK-175 to PMK-186. This list stays here until each item becomes an issue or is dropped.

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

## PMK-175: alerts list on Windows

- Tests for status 9009 outside `win32` and for a `null` status.
- The CHANGELOG and the plan describe only the text check, not the 9009 exit code.
