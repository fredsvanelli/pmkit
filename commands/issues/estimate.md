---
description: Propose an estimate for an issue from the code it affects and from similar completed issues, and save it after confirmation
argument-hint: "<id>"
disable-model-invocation: true
---

# Estimate an issue

Arguments: `$ARGUMENTS`

## Parameters

- `id` (required): the issue to estimate. An epic ID (`EPC-` by default) is not accepted, because epics have no estimate. For an epic, ask which of its issues to estimate, or use `/pmkit:issues:breakdown`.

## Steps

Read `${CLAUDE_PLUGIN_ROOT}/skills/pmkit/references/conventions.md` first.

1. Run `node "${CLAUDE_PLUGIN_ROOT}/scripts/pmkit.mjs" capabilities --json` and read the entry `estimation`. The team of the issue is the prefix of the issue ID (`ENG` in `ENG-12`). Choose the path:
   - `absent`: the tracker has no estimate field, so the command comments the estimate (step 8) and never calls `issues update --estimate`.
   - `conditional`: some teams estimate and some do not, and `detail.teams` lists the teams that do. When the team of the issue is in `detail.teams`, take the save path (step 7). Otherwise that team has estimates off, so take the comment path (step 8).
   - `native`: take the save path (step 7). Step 3 and step 7.1 can still send the command to the comment path.

   Say which path it takes in one line, and show the entry's `enableHint` when it has one.
2. Run `node "${CLAUDE_PLUGIN_ROOT}/scripts/pmkit.mjs" issues get <id> --json`. Note the title, the type, the description, the acceptance criteria, the parent, the `children` and the current estimate. When the issue is `done` or `canceled`, say so and ask with `AskUserQuestion` whether to continue. When the user declines, stop.
3. Run `node "${CLAUDE_PLUGIN_ROOT}/scripts/pmkit.mjs" discover --json` for the estimate scale. Use the scale of the team of the issue: the entry of `teams` whose `key` is the prefix of the issue ID (its `estimate.unit` and `estimate.scale`). When `teams` has no such entry (the prefix is not a known team key, as on the Local tracker), use the top-level `estimate`, which is the scale of the configured team or the scale every team shares. The proposal uses a value of this scale. A scale of `scale: []`, or no `scale`, is no scale, except for the unit `hours`, which takes any positive number of hours: the tracker cannot take a value for this issue. In that case take the comment path (step 8) and state the estimate in ideal days, and say it is a number of days. Never pass days to `issues update --estimate`, because the tracker would save them as points or sizes.
4. Read the code the issue affects. Name the files and modules it touches, how many of them there are, and what is new against what is changed. Cover every acceptance criterion.
5. Find similar completed issues. Pick two or three keywords from the title and the description. For each, run `node "${CLAUDE_PLUGIN_ROOT}/scripts/pmkit.mjs" issues list --category done --text <keyword> --json`. Merge the results without duplicates, drop the issue itself, and keep at most five that look alike in size and kind of work. Run `node "${CLAUDE_PLUGIN_ROOT}/scripts/pmkit.mjs" issues get <similar id> --json` for any of them whose estimate the list did not show. An issue with no estimate is not evidence, so list its ID apart.
6. Propose the estimate. Write one value from the scale, the code that supports it, and the similar issues as a table with the five columns of the issue tables in the conventions. Say how far the value is from the current estimate, unless the comment path states the estimate in ideal days: days and the tracker's points or sizes are not comparable, so do not compare them or measure a distance. When there are no similar completed issues with an estimate, base the value on the code alone and say so. When the proposed value equals the current estimate, say that the estimate already fits and go on to step 7 on the save path, because that is where the user can keep the estimate or pick another value. On the comment path go on to step 8.
7. Save the estimate. Skip this step, and go to step 8, unless step 1 and step 3 both chose the save path. That holds whatever step 6 found: `absent`, `conditional` without the team of the issue, an empty scale and `NOT_SUPPORTED` always take the comment path.
   1. Run `node "${CLAUDE_PLUGIN_ROOT}/scripts/pmkit.mjs" issues update <id> --estimate <value> --dry-run --json`. When it fails with `NOT_SUPPORTED` (the tracker maps no estimate field) or with `INVALID_INPUT` saying the team's estimates are off, do not retry. Say that the tracker refused the estimate field and take the comment path (step 8).
   2. Show the proposal of step 6 and the `before` and `after` of the estimate together. Ask once with `AskUserQuestion` whether to save it, following "How to show a write" in the conventions. The user can pick another value of the scale. In that case run the dry run again with that value and show it again. When the proposal equals the current estimate, `before` and `after` are the same, so the question offers to keep the current estimate or pick another value of the scale. Keeping it stops with nothing changed. With `write_policy.confirm: none` the question is skipped, so an equal proposal stops here without writing: say that the estimate already fits, run no `issues update` and change nothing. When the user declines, stop and change nothing.
   3. When the user approves, run `node "${CLAUDE_PLUGIN_ROOT}/scripts/pmkit.mjs" issues update <id> --estimate <value> --json`.
8. Comment the estimate. Run this step only when step 1, step 3 or step 7.1 sent the command to the comment path. The comment always states the unit: ideal days, or the points, sizes or hours of the scale. Write the estimate, its basis in the code and the similar issues to a temporary file outside `.issues/`. Run `node "${CLAUDE_PLUGIN_ROOT}/scripts/pmkit.mjs" issues comment <id> --body-file <file> --dry-run --json`. Show the proposal of step 6 and the comment together, and ask once with `AskUserQuestion` whether to post it. When the user approves, run `node "${CLAUDE_PLUGIN_ROOT}/scripts/pmkit.mjs" issues comment <id> --body-file <file> --json`, then remove the temporary file. When the user declines, stop and post nothing.

## Confirmation points

- Step 7: the proposed estimate with the `before` and `after` of the field, and the choice of another value of the scale. `write_policy.confirm: none` skips this question. The proposal still shows.
- Step 8: the estimate comment, when the tracker has no usable estimate field for the issue's team. The same setting skips this question.
- Step 2: whether to estimate an issue that is `done` or `canceled`.

## Output

The proposed estimate and its basis, the similar issues as a table, and the result: the estimate saved, with the issue as a one-row issue table, the estimate kept, or the comment posted. Say which path was used and why. End with `/pmkit:issues:breakdown` when the estimate is the largest value of the scale.

## If something is missing

- No ID: ask for it.
- An epic ID: do not estimate. Say why and point to the issues of the epic.
- The issue has no description and no acceptance criteria: ask the user what the work covers before proposing.
- No completed issues with an estimate: propose from the code alone and say so.
- The tracker has no estimate field (`estimation` is `absent`), the team of the issue has estimates off (`conditional`), or the tracker refuses the field (`NOT_SUPPORTED`): comment the estimate, and show the `enableHint` of the manifest to turn estimates on.
- The team of the issue has an empty scale: comment the estimate in ideal days, and never save days with `--estimate`.
- An error from the CLI: apply the rules for reading errors in the conventions.
