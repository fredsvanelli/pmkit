---
description: Apply one change to every issue a filter returns, after a full preview that the write cannot differ from
argument-hint: "<change> <value> <filter>"
disable-model-invocation: true
---

# Bulk change

Arguments: `$ARGUMENTS`

## Parameters

- `change` and `value` (required): one change for every matched issue.
  - `move <category>` (with `--status <name>` to pick the status), `assign <member|me|none>`, `priority <priority|none>`, `estimate <n|none>`.
  - `due <YYYY-MM-DD|none>`, `type <type|none>` (`none` is refused on the Local tracker, where every issue has a type) and `archive`, which takes no value (`issues bulk archive --label legacy`): archived issues leave every list and a bulk change never matches them again, and the preview says so in `warnings`.
  - `label-add <label>`, `label-remove <label>` (one label per call, values are trimmed; `label-add` refuses a comma, `label-remove` takes a label that has one), `milestone <id|none>`, `release <id|none>`, `sprint <id|current|none>`, `parent <issue id|none>`.
  - `link <issue id>` with `--kind blocks|related|duplicate` and optionally `--remove`. Each matched issue is the `from` side.
- The filter (required): the flags of `/pmkit:issues:find` (`--text`, `--category`, `--type`, `--assignee`, `--label`, `--sprint`, `--parent`, `--blocked`, `--updated-before`, `--updated-after`), or `--view <name>` for a saved view. Without a criterion that narrows the set the command stops, because a bulk change never means every issue. An empty value (`--text ""`, `--text " "`) is refused. Archived issues are never matched. `--limit`, `--sort` and `--archived` do not exist as flags, and a saved view with `archived` or `limit` is refused, because a cut set is not the set the user means. A saved view may carry a `sort` next to a criterion, which only orders the table.
- `--max <n>` (optional): the largest set one call takes. The default is 50 and the highest is 200. A larger match stops the command, and nothing is cut.

## Steps

Read `${CLAUDE_PLUGIN_ROOT}/skills/pmkit/references/conventions.md` first.

1. Turn the request into one change and one filter, and say them back in one line. When the user asked for several changes, take them one at a time: this command applies one. When the request does not fit a change above, say which fields `/pmkit:issues:update` edits one by one.
2. Optionally look at the set first. Run `node "${CLAUDE_PLUGIN_ROOT}/scripts/pmkit.mjs" issues list <flags> --json`. This step only reads.
3. Run `node "${CLAUDE_PLUGIN_ROOT}/scripts/pmkit.mjs" issues bulk <change> <value> <flags> --dry-run --json`. Nothing changes on disk. Each operation runs as its one-by-one command does (`issues move`, `issues assign`, `issues update`, `cycle add`, `issues parent`, `issues link`), so the preview is what those commands would write.
4. Read the result.
   - The call failed with `INVALID_INPUT`: the filter is missing or does not narrow the set (a view with `archived` or `limit`, or with only a `sort`, counts), the set is above the cap, the tracker cut the read (more matching issues than pmkit read), or the value of the change is wrong for every issue (an unknown member, an estimate off the scale, a sprint that does not exist, a date that is not `YYYY-MM-DD`, an unknown type, `archive` given a value, a Linear milestone of another project). Show `error.message` and `error.nextStep`, and ask for a corrected value or a narrower filter. Do not raise `--max` on your own.
   - The call failed with `NOT_FOUND` or `CONFLICT` and the filter matched exactly one issue: the code is the operation's own, not a rule of the batch. `NOT_FOUND` means the value names something that does not exist (a sprint, a member, a parent), or the issue itself is gone. `CONFLICT` means the state of the issue or of the target does not allow the change (a closed sprint, for example). Nothing was written. Show `error.message` and `error.nextStep`, read the issue again with `issues get` when the message names its state, and ask for another value. Do not run the same dry run again, and do not take this `CONFLICT` for the digest `CONFLICT` of step 7: that one only comes from a real run. Any other code from a one-issue batch is the operation's error: show it and stop.
   - The call failed with `NOT_SUPPORTED`: the tracker does not write this change. On Linear that is `release`, because pmkit does not map Linear releases yet. Show `error.message` and stop. A Linear `milestone` needs a milestone id (a UUID from `pmkit milestone list`) of the project the issues are in: another project is one `INVALID_INPUT`.
   - `blockers` is not empty: show each line. A blocker means an issue file that does not parse (it may match the filter), or an issue the operation rejected for its own reasons (a link to itself, a parent loop). Offer `pmkit validate` and `/pmkit:local:doctor` for unreadable files. Do not ask to write, because the real run refuses.
   - `writes` is `0`: say that nothing would change and stop.
5. Show the full preview. One table with a row per matched issue: ID, title, status, assignee, estimate and the change as `field: before → after`. Mark the `unchanged` issues, which are never written. Under it show the count to write, the filter, the `digest` and every warning. Show every entry of `warnings`, such as a release that is already released, and the `note:` lines as the CLI printed them.
6. Ask once with `AskUserQuestion`: "Apply <change> to <n> issues?", with the options apply and cancel. This is a bulk change, so the full preview and the question come first, whatever `write_policy.confirm` says. When the user declines, stop and change nothing. When the user wants fewer issues, go back to step 3 with a narrower filter. The earlier digest is no longer valid.
7. When the user approves, run `node "${CLAUDE_PLUGIN_ROOT}/scripts/pmkit.mjs" issues bulk <change> <value> <flags> --expect <digest> --json`, which is the command of step 3 without `--dry-run` and with the digest of the preview the user approved. The CLI reads the set again and writes only when its digest equals the one the user saw.
   - Look at `result` first, whatever `error.code` says. When `result.failed` is present, the batch stopped at the first failure after some writes, and the code is the one the failing write raised, which can be `CONFLICT` too. Show `error.message`, then `result.applied` (written), `result.failed` and `result.remaining` (not written). Do not retry. Offer a new dry run, which lists what is left.
   - `result.applied` without `result.failed`: every write succeeded and only the `auto_commit` commit failed, so this is not a stop midway. Show `error.message` and `result.applied` as written, say that `remaining` is empty, do not offer a new dry run, and tell the user to commit the changed files in `.issues/` by hand.
   - `CONFLICT` without `result` on a real run with `--expect`: an issue changed since the preview, or the filter now returns another issue. Nothing was written. Say so, and go back to step 3. The `digest` the error returns is what the tracker holds now, and it is never an `--expect` value: the way forward is a new dry run, a new preview and a new confirmation.
8. Show the issues written, from `applied`.

## Confirmation points

- Step 6: the full preview, always asked. `write_policy.confirm: none` does not skip it. Declining changes nothing.

## Output

The change in one line, the table of the issues written (ID, title and the change), the issues left unchanged, and the digest the write used. On a stop, the lists of applied, failed and remaining issues. End with `/pmkit:issues:find` as the way to check the result.

## If something is missing

- No issue matches the filter: say so and stop.
- The tracker is Linear: `release` is not written, `milestone` takes the id of a milestone of the issues' project, an epic works as `parent`, and a filter with more than 1000 matches is refused.
- An error from the CLI: apply the rules for reading errors in the conventions.
