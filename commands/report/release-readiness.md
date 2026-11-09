---
description: What is left for a release - open issues, open pull requests and deploys. Without releases it uses a milestone or a sprint and says so
argument-hint: "[release | milestone=<id> | sprint=<id|current>]"
disable-model-invocation: true
---

# Release readiness

Arguments: `$ARGUMENTS`

## Parameters

- One optional argument: a release ID, `milestone=<id>`, `sprint=<id>` or `sprint=current`. An empty argument means the CLI picks the basis.

## Steps

Read `${CLAUDE_PLUGIN_ROOT}/skills/pmkit/references/conventions.md` first.

1. Pick the selector from the argument. `milestone=...` is `--milestone`, `sprint=...` is `--sprint` (`current` works), and any other value is `--release`. Run `node "${CLAUDE_PLUGIN_ROOT}/scripts/pmkit.mjs" release-readiness [--release <id> | --milestone <id> | --sprint <id|current>] --json`. Every later step reads this result. Compute nothing it does not hold.
2. Lead with one line that names the basis in words: the release, milestone or sprint, with its target, due date or dates. When `reason` is not `requested`, say why in the same line or the next, from `skipped`: `releases_absent` is "this tracker has no releases", `no_planned_release` is "no planned release", `no_open_milestone` is "no milestone with an open issue", `no_active_sprint` is "no active sprint", `releases_not_read`, `milestones_not_read` and `cycles_not_read` are "the releases (milestones, sprints) could not be read" (a read failed, so the report is incomplete: step 7). The user must see that the report uses a milestone or a sprint and not a release.
3. State the verdict from `ready`: `true` is "ready: nothing is open", `false` is "not ready: work is still open" and `null` is "unknown: nothing was found open, but not everything was read", or, when `empty` is true, "unknown: the release has no issues, so nothing says it is ready". Never write "ready" for `null`, and never write "nothing found open" while the issue table or the pull requests list something.
4. Show the open issues from `issues.open` as a table with the standard columns from the conventions (ID, title, status, assignee, estimate) and the counts from `issues.counts` (open, done, canceled). With no open issue, say so.
5. Show the open pull requests from `pullRequests` (number, title, issue, draft or ready) and its `checks`: name the failing checks, say how many are `pending`, and never call a pull request green while a check is pending or failing. A `null` value was not checked, so write `not checked` and the reason from `gitHost.reason.message`, adding `gitHost.reason.nextStep` for `NOT_CONFIGURED` or `AUTH`; with `gitHost.system` `none`, say there is no git host. A value with an `error` was not checked either: write `not checked` and `error.message`. When `pullRequestsIncomplete` is true, say that only the 200 newest open pull requests were read, so the list may be incomplete. Only pull requests whose branch belongs to an issue of the basis are listed.
6. Show the deploys from `deploys` (environment, state, ref, date). They are the deployments of the whole repository, newest first, not of the release. Mark a row with `matchesRelease` true as the deploy of this release's tag. For a release with a tag the list also holds its deploys older than the newest 20, found by their ref (`<tag>` or `refs/tags/<tag>`). Treat `null` and `error` as in step 5.
7. When `truncated` is true, say that the tracker has more issues than pmkit read, so the basis and the open work may be incomplete, and do not call the release ready. Show each entry of `problems` once as a warning with its ID (an `id` of `releases`, `milestones` or `cycles` is a read that failed with its `code`, so say it was not read and the report is incomplete): an issue file that does not parse is not in the lists, so the report is incomplete (`complete` is false).
8. Offer the next step: `/pmkit:issues:find` for a closer look at the open issues, `/pmkit:report:release-notes` for the notes once the release is done.

## Confirmation points

None. The command only reads.

## Output

The basis line, the verdict, then the open issues, the open pull requests and the deploys, ready to paste into a channel. Every issue shows its full ID and every pull request its number.

## If something is missing

- `INVALID_INPUT` because there is nothing to check: say there is no planned release, no milestone with an open issue and no active sprint, and offer `/pmkit:cycle:plan` or creating a release.
- The git host is `none`, or `gh` is missing or logged out: the issues still show, the pull requests and deploys are `not checked` with the reason (steps 5 and 6).
- `NOT_SUPPORTED` for `sprint=current` on a tracker without cycles: say so and offer a release or `milestone=<id>`.
- `NOT_FOUND`: say so and ask for a corrected ID.
- `NOT_SUPPORTED` for a release on a tracker without releases: say so and offer `--milestone` or `--sprint`.
- An error from the CLI: apply the rules for reading errors in the conventions.
