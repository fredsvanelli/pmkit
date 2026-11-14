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
- `INVALID_INPUT` with a message that says setting the status "would delete" lines and "nothing was written": an HTML block or a code fence takes a heading into the `## Status` section when the whole section would be replaced, or when it never closes (an unclosed `<!--` or fence); a comment or fence that closes after a status line of its own is kept and is not a cause. Or the section has more than one line and no top-level status line to replace (the status is inside a comment, a fence, indented code, a list item or a quote, comes after a `Date:` or `Supersedes` line, or is a word that is not a known status such as accepted, proposed, rejected, draft). The command replaces only the status line of the section, a plain top-level line, and keeps the others (a MADR date line, a Nygard `Supersedes ...` line), so text beside such a status is not a cause; a hard line break at the end of the status line (two or more spaces, or a backslash) stays. Show `error.message` and `error.nextStep` to the user as they are and stop. Do not edit the ADR yourself and do not retry: the user fixes what the message names, and then runs the command again. The dry run in step 1 gives the same refusal, so nothing was written. Show every line of `notes` of the preview too: one says when a plain line under the status may be the rest of a status broken over two lines.
- Any other `INVALID_INPUT`: a number that is not one to four digits, a status that is not one of the three, `superseded` without `--by`, `--by` with another status, or `--by` naming the same ADR. Ask for a corrected value.
- An error from the CLI: apply the rules for reading errors in the conventions.
