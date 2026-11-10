---
description: Run a saved view by name and show its issues table
argument-hint: "[name]"
disable-model-invocation: true
---

# Run a saved view

Arguments: `$ARGUMENTS`

## Parameters

- `name` (optional): the name of a saved view, for example `open-bugs`, or the id of a Linear view. When it is empty, the command lists the views (step 2) and asks which one to run.
- `--limit n`, `--sort s` (optional): replace the limit and the order the view stored, for this run only. The view does not change.

## Steps

Read `${CLAUDE_PLUGIN_ROOT}/skills/pmkit/references/conventions.md` first.

1. Run `node "${CLAUDE_PLUGIN_ROOT}/scripts/pmkit.mjs" capabilities --json`. When `saved_views` is `absent`, the tracker has no saved views. Say so, do not run `views run`, and offer `/pmkit:issues:find` with the filter the user describes, which runs `issues list` with the same flags. Stop there.
2. When there is no `name`, run `node "${CLAUDE_PLUGIN_ROOT}/scripts/pmkit.mjs" views list --json`. Its `views` hold the names with their filters: show them and ask with `AskUserQuestion` which view to run. Show every entry of `warnings` and say how many `problems` there are: a view file that does not parse, or whose file name breaks the name rule, is skipped, and `pmkit validate` lists it. When `views` is empty but `problems` is not, do not say there are no views: say the files that could not be read. When `hasMore` is `true`, Linear has more views than pmkit read: say the list is not complete and never that a view does not exist. On Linear a view has `filter: null` and its Linear filter in `linear.filterData`, which Linear runs as it is: show it as stored, do not turn it into flags. When there are no views and the list is complete, say so, offer `/pmkit:issues:find` and stop.
3. Run `node "${CLAUDE_PLUGIN_ROOT}/scripts/pmkit.mjs" views run <name> --json`, with `--limit n` and `--sort s` when the user gave them. This only reads, and this command never changes a view. The result keeps the stored filter in `view` and the values the run replaced in `overrides`.
4. Read the result. The `INVALID_INPUT` errors of a view, and the `NOT_FOUND` of a cut Linear list, carry `error.reason` in the JSON. Branch on that reason, never on the text of `error.message`.
   - `NOT_FOUND` with `error.reason` `view_list_incomplete`: Linear has more views than pmkit read, and the name is not among those read. Do not say the view does not exist. Ask for the view's id from Linear and run it by id.
   - `INVALID_INPUT` with `error.reason` `view_list_incomplete`: the name was found once among the views read, but the list is cut, so another view may have the name. `error.nextStep` names the id found: show it, say why, and run that id only when the user confirms it is the view.
   - `NOT_FOUND` without a reason: the view does not exist. Show the closest names from `views list` (the result of step 2 when it ran, otherwise run it now) and name `pmkit views list` as the way to see them all. Do not guess a name.
   - `INVALID_INPUT` with `error.reason` `invalid_view_name`: the name is not a valid view name. State the rule (it starts and ends with a letter or a digit and holds only letters, digits, ".", "_" and "-", for example `open-bugs`) and suggest `views list`. No file was read.
   - `INVALID_INPUT` with `error.reason` `view_out_of_date`: the view names a type, member, sprint or label the tracker no longer has. Show `error.message` and read the stored filter as structured data from `views list --json` (the entry of `views` with this name, its `filter` map). Offer to run that filter as `issues list` without the stale value. To repair the view, build the `views save <name> <flag for each key of filter> --overwrite` call from those keys and values, and show it. Do not run it without the user asking.
   - `INVALID_INPUT` with `error.reason` `ambiguous_view_name`: two or more Linear views have this name. `error.message` lists their ids: show them and ask with `AskUserQuestion` which one to run, then run it by id.
   - `INVALID_INPUT` without a reason: a `--limit` or `--sort` value is wrong. Show `error.message` and the allowed values; the view is not at fault.
   - `INVALID_INPUT` with `error.reason` `view_file_broken`: the view file is broken. Show `error.message`, name the file `.issues/views/<name>.yaml`, and offer `pmkit validate` and `/pmkit:local:doctor`. Do not run a filter in its place.
   - `NOT_SUPPORTED`: the tracker has no saved views. Do as in step 1.
5. Show the result as an issue table (see the conventions), then "N issues", the filter the view stored and the `overrides` the run used. Show every entry of `warnings` as the CLI printed it: an issue file that does not parse, a Linear read cut at 1000 issues, and "no active sprint" for a `sprint: current` view. A cut or incomplete read is not a complete list, so say that.
6. When the list is empty and there are no warnings, say so and name the part of the stored filter that is likely too narrow.

## Confirmation points

- Step 2: which view to run, only when no name was given.
- Step 4: which Linear view to run, only when two have the name or when the name was found in a cut list. The command only reads, so it never asks to write.

## Output

The view name, its stored filter and the overrides, the issue table and "N issues", then every warning. End with `/pmkit:issues:find` to refine the filter and, for a Local view, `/pmkit:issues:bulk --view <name>` to change the issues the view returns. A Linear view keeps Linear's filter, so `issues bulk --view` refuses it: offer `/pmkit:issues:bulk` with filter flags.

## If something is missing

- The view does not exist: `views list` shows the names that do.
- The tracker is Linear: pmkit reads and runs the custom views of the team and of the workspace. It does not create, rename or delete them (`saveView`, `deleteView` and `renameView` are in `detail.unsupported`): that is done in Linear.
- An error from the CLI: apply the rules for reading errors in the conventions.
