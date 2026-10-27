---
description: Write release notes for a release, a sprint or a period, and save them as a document after you confirm
argument-hint: "[release | sprint | since=<date>[,until=<date>]]"
disable-model-invocation: true
---

# Release notes

Arguments: `$ARGUMENTS`

## Parameters

- One optional argument: a release ID, a sprint ID, `current` for the active sprint, or `since=<date>[,until=<date>]`. An empty argument means the CLI picks the basis.

## Steps

Read `${CLAUDE_PLUGIN_ROOT}/skills/pmkit/references/conventions.md` first.

1. Sync merged pull requests. This is a bulk write, so preview it first. Run `node "${CLAUDE_PLUGIN_ROOT}/scripts/pmkit.mjs" pr sync --dry-run --json`. When `moved` is empty, skip to step 2. Otherwise show each issue in `moved` with its PR and the change from `in_review` to `done`, and ask once with `AskUserQuestion`, whatever `write_policy.confirm` says. When the user approves, run the same command without `--dry-run`. When the user declines, change nothing and carry on. Show each entry of `problems` as a warning. When the call fails with `NOT_SUPPORTED`, `NOT_CONFIGURED` or `AUTH`, say in one line that PR data is unavailable and why, and continue without it. When it fails with `INVALID_INPUT` and `error.message` starts with `.pmkit/config.yaml is not valid`, say in one line that `.pmkit/config.yaml` is not valid, so the sync is skipped, and go on with step 2.
2. Pick the selector from the argument. `since=...` is a period, so pass `--since` and `--until`. `current` is the active sprint, so pass `--sprint current`. Any other value is tried as a release first, then as a sprint when the CLI answers `NOT_FOUND`. Run `node "${CLAUDE_PLUGIN_ROOT}/scripts/pmkit.mjs" release-notes [--release <id> | --sprint <id|current> | --since <date> [--until <date>]] --json`. Every later step reads this result. Compute nothing it does not hold.
3. Lead with one line that names the basis in words. When `skipped` is not empty, say which step was skipped and why in the same line or the next, so the user sees why the notes use a sprint or a period. When `draft` is true, say the release is not released yet or the sprint is not closed, and that the notes are a draft.
4. Write the notes from `groups`. Use plain headings: `feature` is "New", `bug` is "Fixed", and `task` and the untyped group are "Improved". Write one bullet per issue, in one sentence, from the title and `description`, for a user of the product. Say what they can now do or no longer suffer, not how it was built. Add no claim the issue does not state. Merge two bullets only when their issues say the same thing. Write in the language of the issues. The bullets carry no ID.
5. End the notes with a section "Included issues" that lists every ID of `groups`, so a reader inside the team can trace each bullet. Show the issue table in the chat too, with the standard columns from the conventions (ID, title, status, assignee, estimate) and the type.
6. When `counts.excluded.chore` is above zero, say "N internal changes not listed". When `counts.excluded.open`, `counts.excluded.after_close` or `counts.excluded.canceled` is above zero, say how many issues the notes leave out and why: not done, done after the sprint closed, or canceled. An issue done after the sprint closed did not ship with it, and the user can look at it with `/pmkit:issues:find`. For a release, offer `release issues <id>` or `/pmkit:issues:find` to look at them. Show each entry of `problems` once as a warning.
7. Offer to save the notes. Run `node "${CLAUDE_PLUGIN_ROOT}/scripts/pmkit.mjs" capabilities --json`. When `documents` is `absent`, skip the save and offer the text to copy. Otherwise write the notes to a temporary file outside `.issues/` and run `node "${CLAUDE_PLUGIN_ROOT}/scripts/pmkit.mjs" docs create release-notes/<name>.md --body-file <file> --dry-run --json`, where `<name>` is the release ID, the sprint ID (the `source.id` of the result, also for `current`), or `<since>_<until>`, built from `period.since` and `period.until` cut to their first 10 characters so the name holds dates only. Show the document and ask once with `AskUserQuestion`, whatever `write_policy.confirm` says, because readers outside the team will read it. When the user declines, save nothing. After approval, run `node "${CLAUDE_PLUGIN_ROOT}/scripts/pmkit.mjs" docs create release-notes/<name>.md --body-file <file> --json`.
8. Remove the temporary file.

## Confirmation points

- Step 1: the preview of `pr sync` when it would move issues. Declining leaves them as they are.
- Step 7: the full document, always asked. Declining saves nothing.

Producing the notes only reads. The `pr sync` of step 1 and the save of step 7 are the only writes.

## Output

The notes as plain text first, then the table, the left-out lines and the path of the saved document.

## If something is missing

- No done issues: say so, say no notes were written, offer another release, sprint or period, and write no empty document.
- The git host is `none`: skip PR data and say so in one line.
- `NOT_FOUND`: say so and ask for a corrected ID.
- `CONFLICT` from `docs create` because the path exists: ask for another name and never overwrite.
- An error from the CLI: apply the rules for reading errors in the conventions.
