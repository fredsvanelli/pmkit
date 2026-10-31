---
description: Run a saved view by name and show its issues table
argument-hint: "[name]"
disable-model-invocation: true
---

# Run a saved view

Arguments: `$ARGUMENTS`

## Parameters

- `name` (optional): the name of a saved view, for example `open-bugs`. When it is empty, the command lists the views (step 2) and asks which one to run.

## Steps

Read `${CLAUDE_PLUGIN_ROOT}/skills/pmkit/references/conventions.md` first.

1. Run `node "${CLAUDE_PLUGIN_ROOT}/scripts/pmkit.mjs" capabilities --json`. When `saved_views` is `absent`, the tracker has no saved views, as on Linear. Say so, do not run `views run`, and offer `/pmkit:issues:find` with the filter the user describes, which runs `issues list` with the same flags. Stop there.
2. When there is no `name`, run `node "${CLAUDE_PLUGIN_ROOT}/scripts/pmkit.mjs" views list --json`. Show the names with their filters and ask with `AskUserQuestion` which view to run. Show every entry of `warnings`: a view file that does not parse is skipped, and `pmkit validate` lists it. When there are no views, say so, offer `/pmkit:issues:find` and stop.
3. Run `node "${CLAUDE_PLUGIN_ROOT}/scripts/pmkit.mjs" views run <name> --json`. This only reads. The view format is the one `views save` writes, and this command never changes a view.
4. Read the result.
   - `NOT_FOUND`: the view does not exist. Show the closest names from `views list` (the result of step 2 when it ran, otherwise run it now) and name `pmkit views list` as the way to see them all. Do not guess a name.
   - `INVALID_INPUT` with `must start and end with a letter or digit` in `error.message`: the name is not a valid view name. State the rule (it starts and ends with a letter or a digit and holds only letters, digits, ".", "_" and "-", for example `open-bugs`) and suggest `views list`. No file was read.
   - `INVALID_INPUT` with `out of date` in `error.message`: the view names a type, member, sprint or label the tracker no longer has. Show `error.message` and read the stored filter as structured data from `views list --json` (the entry with this name, its `filter` map). Offer to run that filter as `issues list` without the stale value. To repair the view, build the `views save <name> <flag for each key of filter> --overwrite` call from those keys and values, and show it. Do not run it without the user asking.
   - `INVALID_INPUT` with `does not parse` or `needs a "filter" map` in `error.message`: the view file is broken. Show `error.message`, name the file `.issues/views/<name>.yaml`, and offer `pmkit validate` and `/pmkit:local:doctor`. Do not run a filter in its place.
   - `NOT_SUPPORTED`: the tracker has no saved views. Do as in step 1.
5. Show the result as an issue table (see the conventions), then "N issues" and the filter the view stored. Show every entry of `warnings` as the CLI printed it: an issue file that does not parse, a Linear read cut at 1000 issues, and "no active sprint" for a `sprint: current` view. A cut or incomplete read is not a complete list, so say that.
6. When the list is empty and there are no warnings, say so and name the part of the stored filter that is likely too narrow.

## Confirmation points

- Step 2: which view to run, only when no name was given. The command only reads, so it never asks to write.

## Output

The view name, its stored filter, the issue table and "N issues", then every warning. End with `/pmkit:issues:find` to refine the filter and `/pmkit:issues:bulk --view <name>` to change the issues the view returns.

## If something is missing

- The view does not exist: `views list` shows the names that do.
- The tracker is Linear: `saved_views` is `absent` and pmkit does not create Linear views and the view cannot be read there. Offer `/pmkit:issues:find` with the filter the user describes.
- An error from the CLI: apply the rules for reading errors in the conventions.
