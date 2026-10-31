---
description: Log time worked on an issue after confirmation, and show the issue total. When the tracker has no time tracking, suggest a comment
argument-hint: "<id> [time]"
disable-model-invocation: true
---

# Log time on an issue

Arguments: `$ARGUMENTS`

## Parameters

- `id` (required): the issue to log time on. An epic ID (`EPC-` by default) is not accepted, because epics have no time entries. Ask which of its issues to use.
- `time` (optional): the time worked. The CLI reads `90` or `45m` as minutes and `2h`, `1h30`, `1h30m` or `1.5h` as hours. One entry is at least 1 minute. There is no upper limit, but an entry above 24 hours comes with a `note:` to check. When it is empty, ask for it in step 3.

## Steps

Read `${CLAUDE_PLUGIN_ROOT}/skills/pmkit/references/conventions.md` first.

1. Run `node "${CLAUDE_PLUGIN_ROOT}/scripts/pmkit.mjs" capabilities --json` and read the entry `time_tracking`. A `path` of `absent` means the tracker has no time tracking. In that case the command suggests a comment (step 6) and never calls `issues log-time`. Say which path it takes in one line, and show the entry's `enableHint`.
2. Run `node "${CLAUDE_PLUGIN_ROOT}/scripts/pmkit.mjs" issues get <id> --json` and note the title and the status. Logging time on an issue in `done` or `canceled` is allowed, so do not ask.
3. Get the time. When `time` is empty, ask for it with `AskUserQuestion`. When the user gives none, stop and change nothing. Pass the text to the CLI as the user wrote it. Do not convert it, because the CLI reads the formats above.
4. Preview the entry. Skip this step and step 5 when step 1 found `absent`, because the CLI refuses a tracker with no time tracking before it reads the time. Run `node "${CLAUDE_PLUGIN_ROOT}/scripts/pmkit.mjs" issues log-time <id> <time> --dry-run --json`. The result has `minutes`, the time as the CLI read it, `note`, and the `before` and `after` of the issue. When `note` is not empty, the entry is above 24 hours. Repeat the note and ask the user to check the time. A time the CLI cannot read, such as `0`, a negative value, text, or `1.5` with no unit, fails with `INVALID_INPUT`. Show `error.message` and `error.nextStep`, ask for a corrected time, and run the dry run again. Never fix the time yourself.
5. Write the entry. Show `minutes` next to what the user typed, for example "1h30 is 90 minutes", and ask once with `AskUserQuestion` whether to log it, following "How to show a write" in the conventions. When the user declines, stop and change nothing. When the user approves, run `node "${CLAUDE_PLUGIN_ROOT}/scripts/pmkit.mjs" issues log-time <id> <time> --json`, then run `node "${CLAUDE_PLUGIN_ROOT}/scripts/pmkit.mjs" issues time-entries <id> --json` and read `total`. When `ignored` is above 0, say that this many entries are left out of the total because their minutes are not a positive integer.
6. Suggest a comment. Run this step only when step 1 found `absent`. First read the time. Run `node "${CLAUDE_PLUGIN_ROOT}/scripts/pmkit.mjs" issues parse-time <time> --json`. It needs no tracker and writes nothing. The result has `minutes` and `note`. An invalid time fails with `INVALID_INPUT`. Show `error.message` and `error.nextStep`, ask for a corrected time and read it again. Post nothing for a time the CLI cannot read. When `note` is not empty, repeat it. Then write one line to a temporary file outside `.issues/`: "Time worked: <minutes> minutes (<time as the user wrote it>)." Run `node "${CLAUDE_PLUGIN_ROOT}/scripts/pmkit.mjs" issues comment <id> --body-file <file> --dry-run --json`. Show the comment with the minutes read, and say this tracker keeps no time entries and no total. Ask once with `AskUserQuestion` whether to post it. When the user approves, run the same command without `--dry-run`, then remove the temporary file. When the user declines, post nothing and remove the file.

## Confirmation points

- Step 5: the time entry, with the minutes the CLI read. `write_policy.confirm: none` skips this question. The preview still shows.
- Step 6: the comment, when the tracker has no time tracking. The same setting skips this question.
- Step 3: the time, when it was not given. This question is an input and stays.

## Output

The entry logged, as minutes and as the text the user typed, and the new total of the issue from `time-entries`. On a tracker with no time tracking, the comment posted and a `note:` that no time entry was written and no total exists. Say which path was used. `/pmkit:issues:progress` is the command that also posts a progress comment and ticks criteria.

## If something is missing

- No ID: ask for it.
- An epic ID: do not log. Say why and point to the issues of the epic.
- The time is invalid: show the error of the CLI and ask again. Do not guess a value.
- The tracker has no time tracking (`time_tracking` is `absent`): suggest the comment of step 6 and show the `enableHint`.
- An error from the CLI: apply the rules for reading errors in the conventions.
