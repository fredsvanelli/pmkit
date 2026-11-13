---
description: Mark an existing ADR accepted, deprecated or superseded by a newer one
argument-hint: "<number> <accepted|deprecated|superseded> [--by number]"
disable-model-invocation: true
---

# Change the status of an ADR

Arguments: `$ARGUMENTS`

## Parameters

- `number` (required): the number of the ADR, such as `3` or `0003`.
- `status` (required): `accepted`, `deprecated` or `superseded`.
- `--by` (required with `superseded`, refused otherwise): the number of the newer ADR that replaces it.

When `number` or `status` is missing, ask for it. When the status is `superseded` and `--by` is missing, ask which ADR replaces it.

## Steps

Read `${CLAUDE_PLUGIN_ROOT}/skills/pmkit/references/conventions.md` first.

1. Preview. Run `node "${CLAUDE_PLUGIN_ROOT}/scripts/pmkit.mjs" docs adr-status <number> <status> [--by <number>] --dry-run --json`. The CLI finds the file in `docs/adr/` or in the tracker's `docs/adr/`, and computes the new status in the form the ADR already uses (a `status:` key in YAML front matter, a `## Status` section, a `Status:` or `**Status:**` line, and every one of them when the ADR holds more than one), so do not work them out yourself. Show `path` (a path that starts with `tracker:` is in a tracker folder outside the repository, so it never equals the repository's), `place` (`repo` or `tracker`), `status.before` (or "no status yet") and `status.after`. Show every line of `notes`, such as the one that says `--by` names an older ADR. When `before` equals `after`, the ADR already has that status: say so and stop.
2. Confirm. Ask once with `AskUserQuestion`, whatever `write_policy.confirm` says, because an ADR is a permanent record. When `place` is `repo`, say that the file will have no commit until the user commits it. When the user declines, stop and change nothing.
3. Write. Run `node "${CLAUDE_PLUGIN_ROOT}/scripts/pmkit.mjs" docs adr-status <number> <status> [--by <number>] --json`.

## Confirmation points

- Step 2: the new status line of the ADR. `write_policy.confirm: none` does not skip it.

## Output

The ADR path, the status before and after, the place, whether the file has a commit (a tracker document gets one from `auto_commit`, a repository file does not), and every `note:` of the CLI. For `superseded`, offer `/pmkit:spec:record-decision` when the newer decision has no ADR yet.

## If something is missing

- `NOT_FOUND`: no ADR has that number (or the `--by` number). Show `error.message` and ask for another number.
- `CONFLICT`: two ADR files share the number. Show both paths and offer `/pmkit:local:doctor` on the Local tracker, or `pmkit validate`, to sort out the numbers first.
- `INVALID_INPUT` with a message that says setting the status "would delete" lines and "nothing was written": the `## Status` section of the ADR holds text besides the status (a comment, a list item such as `Supersedes ...`, a date line, a paragraph, a fence, or an HTML block or fence that takes a heading into it). Show `error.message` and `error.nextStep` to the user as they are and stop. Do not edit the ADR yourself and do not retry: the user moves that text out of the section (or deletes it), and then runs the command again. The dry run in step 1 gives the same refusal, so nothing was written.
- Any other `INVALID_INPUT`: a number that is not one to four digits, a status that is not one of the three, `superseded` without `--by`, `--by` with another status, or `--by` naming the same ADR. Ask for a corrected value.
- An error from the CLI: apply the rules for reading errors in the conventions.
