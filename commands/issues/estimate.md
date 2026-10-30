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

1. Run `node "${CLAUDE_PLUGIN_ROOT}/scripts/pmkit.mjs" capabilities --json` and read the entry `estimation`. A `path` of `absent` means the tracker has no estimate field. In that case the command comments the estimate (step 8) and never calls `issues update --estimate`. Say which path it takes in one line, and show the entry's `enableHint`.
2. Run `node "${CLAUDE_PLUGIN_ROOT}/scripts/pmkit.mjs" issues get <id> --json`. Note the title, the type, the description, the acceptance criteria, the parent, the `children` and the current estimate. When the issue is `done` or `canceled`, say so and ask with `AskUserQuestion` whether to continue. When the user declines, stop.
3. Run `node "${CLAUDE_PLUGIN_ROOT}/scripts/pmkit.mjs" discover --json` for the estimate scale (`estimate.unit` and `estimate.scale`). The proposal uses a value of this scale. When `discover` returns no scale, state the estimate in ideal days.
4. Read the code the issue affects. Name the files and modules it touches, how many of them there are, and what is new against what is changed. Cover every acceptance criterion.
5. Find similar completed issues. Pick two or three keywords from the title and the description. For each, run `node "${CLAUDE_PLUGIN_ROOT}/scripts/pmkit.mjs" issues list --category done --text <keyword> --json`. Merge the results without duplicates, drop the issue itself, and keep at most five that look alike in size and kind of work. Run `node "${CLAUDE_PLUGIN_ROOT}/scripts/pmkit.mjs" issues get <similar id> --json` for any of them whose estimate the list did not show. An issue with no estimate is not evidence, so list its ID apart.
6. Propose the estimate. Write one value from the scale, the code that supports it, and the similar issues as a table with the five columns of the issue tables in the conventions. Say how far the value is from the current estimate. When there are no similar completed issues with an estimate, base the value on the code alone and say so. When the proposed value equals the current estimate, say that the estimate already fits and stop.
7. Save the estimate. Skip this step when step 1 found `absent`.
   1. Run `node "${CLAUDE_PLUGIN_ROOT}/scripts/pmkit.mjs" issues update <id> --estimate <value> --dry-run --json`.
   2. Show the proposal of step 6 and the `before` and `after` of the estimate together. Ask once with `AskUserQuestion` whether to save it, following "How to show a write" in the conventions. The user can pick another value of the scale. In that case run the dry run again with that value and show it again. When the user declines, stop and change nothing.
   3. When the user approves, run `node "${CLAUDE_PLUGIN_ROOT}/scripts/pmkit.mjs" issues update <id> --estimate <value> --json`.
8. Comment the estimate. Run this step only when step 1 found `absent`. Write the estimate, its basis in the code and the similar issues to a temporary file outside `.issues/`. Run `node "${CLAUDE_PLUGIN_ROOT}/scripts/pmkit.mjs" issues comment <id> --body-file <file> --dry-run --json`. Show the proposal of step 6 and the comment together, and ask once with `AskUserQuestion` whether to post it. When the user approves, run `node "${CLAUDE_PLUGIN_ROOT}/scripts/pmkit.mjs" issues comment <id> --body-file <file> --json`, then remove the temporary file. When the user declines, stop and post nothing.

## Confirmation points

- Step 7: the proposed estimate with the `before` and `after` of the field, and the choice of another value of the scale. `write_policy.confirm: none` skips this question. The proposal still shows.
- Step 8: the estimate comment, when the tracker has no estimate field. The same setting skips this question.
- Step 2: whether to estimate an issue that is `done` or `canceled`.

## Output

The proposed estimate and its basis, the similar issues as a table, and the result: the estimate saved, with the issue as a one-row issue table, or the comment posted. Say which path was used. End with `/pmkit:issues:breakdown` when the estimate is the largest value of the scale.

## If something is missing

- No ID: ask for it.
- An epic ID: do not estimate. Say why and point to the issues of the epic.
- The issue has no description and no acceptance criteria: ask the user what the work covers before proposing.
- No completed issues with an estimate: propose from the code alone and say so.
- The tracker has no estimate field (`estimation` is `absent`): comment the estimate, and show the `enableHint` of the manifest to turn estimates on.
- An error from the CLI: apply the rules for reading errors in the conventions.
