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
  - `label-add <label>`, `label-remove <label>`, `milestone <id|none>`, `release <id|none>`, `sprint <id|current|none>`, `parent <issue id|none>`.
  - `link <issue id>` with `--kind blocks|related|duplicate` and optionally `--remove`. Each matched issue is the `from` side.
- The filter (required): the flags of `/pmkit:issues:find` (`--text`, `--category`, `--type`, `--assignee`, `--label`, `--sprint`, `--parent`, `--blocked`, `--updated-before`, `--updated-after`), or `--view <name>` for a saved view. Without a filter the command stops, because a bulk change never means every issue. Archived issues are never matched, and `--limit` and `--sort` do not exist here, because a cut set is not the set the user means.
- `--max <n>` (optional): the largest set one call takes. The default is 50 and the highest is 200. A larger match stops the command, and nothing is cut.

## Steps

Read `${CLAUDE_PLUGIN_ROOT}/skills/pmkit/references/conventions.md` first.

1. Turn the request into one change and one filter, and say them back in one line. When the user asked for several changes, take them one at a time: this command applies one. When the request does not fit a change above, say which fields `/pmkit:issues:update` edits one by one.
2. Optionally look at the set first. Run `node "${CLAUDE_PLUGIN_ROOT}/scripts/pmkit.mjs" issues list <flags> --json`. This step only reads.
3. Run `node "${CLAUDE_PLUGIN_ROOT}/scripts/pmkit.mjs" issues bulk <change> <value> <flags> --dry-run --json`. Nothing changes on disk. Each operation runs as its one-by-one command does (`issues move`, `issues assign`, `issues update`, `cycle add`, `issues parent`, `issues link`), so the preview is what those commands would write.
4. Read the result.
   - The call failed with `INVALID_INPUT`: the filter is missing, matches more than the cap, or the view has a limit. Show `error.message` and `error.nextStep`, and ask for a narrower filter. Do not raise `--max` on your own.
   - The call failed with `NOT_SUPPORTED`: the tracker does not write this change. On Linear that is `milestone`, `release` and an epic as `parent`. Show `error.message` and stop.
   - `blockers` is not empty: show each line. A blocker means an issue file that does not parse (it may match the filter), a set the tracker cut, or an issue the operation rejected. Offer `pmkit validate` and `/pmkit:local:doctor` for unreadable files. Do not ask to write, because the real run refuses.
   - `writes` is `0`: say that nothing would change and stop.
5. Show the full preview. One table with a row per matched issue: ID, title, status, assignee, estimate and the change as `field: before → after`. Mark the `unchanged` issues, which are never written. Under it show the count to write, the filter, the `digest` and every warning. Show the `note:` lines as the CLI printed them.
6. Ask once with `AskUserQuestion`: "Apply <change> to <n> issues?", with the options apply and cancel. This is a bulk change, so the full preview and the question come first, whatever `write_policy.confirm` says. When the user declines, stop and change nothing. When the user wants fewer issues, go back to step 3 with a narrower filter. The earlier digest is no longer valid.
7. When the user approves, run `node "${CLAUDE_PLUGIN_ROOT}/scripts/pmkit.mjs" issues bulk <change> <value> <flags> --expect <digest> --json`, which is the command of step 3 without `--dry-run` and with the digest of the preview the user approved. The CLI reads the set again and writes only when its digest equals the one the user saw.
   - `CONFLICT`: an issue changed since the preview, or the filter now returns another issue. Nothing was written. Say so, and go back to step 3. The user approves the new preview. Never reuse the old digest.
   - Another error after some writes: the batch stopped at the first failure. Show `error.message`, then `result.applied` (written), `result.failed` and `result.remaining` (not written). Do not retry. Offer a new dry run, which lists what is left.
8. Show the issues written, from `applied`.

## Confirmation points

- Step 6: the full preview, always asked. `write_policy.confirm: none` does not skip it. Declining changes nothing.

## Output

The change in one line, the table of the issues written (ID, title and the change), the issues left unchanged, and the digest the write used. On a stop, the lists of applied, failed and remaining issues. End with `/pmkit:issues:find` as the way to check the result.

## If something is missing

- No issue matches the filter: say so and stop.
- The tracker is Linear: `milestone` and `release` are not written, and a saved view or a filter over 1000 matches is refused.
- An error from the CLI: apply the rules for reading errors in the conventions.
