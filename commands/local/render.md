---
description: Render a board, roadmap or sprint view of the tracker as Markdown or HTML for people outside the agent
argument-hint: "[board|roadmap|sprint] [md|html] [sprint id] [path]"
disable-model-invocation: true
---

# Render a view of the tracker

Arguments: `$ARGUMENTS`

## Parameters

- `view` (required): `board`, `roadmap` or `sprint`. When it is missing, ask for it in step 2.
- `format` (optional): `md` or `html`. Defaults to `md`.
- `sprint id` (optional): the sprint the sprint view shows. Defaults to the active sprint. Only the sprint view takes it.
- `path` (optional): the file to write. Without it, the view goes to the default location under the tracker folder.

## Steps

Read `${CLAUDE_PLUGIN_ROOT}/skills/pmkit/references/conventions.md` first.

1. Read the conventions, as the line above says.
2. Take the view, the format, the sprint and the destination from the arguments or the request. When the view is missing, ask with `AskUserQuestion` and offer board, roadmap and sprint. The format defaults to `md`. The destination defaults to `--save`. A path the user names goes to `--out`. When the user asks only to see the view in the chat, run without a destination.
3. Run `node "${CLAUDE_PLUGIN_ROOT}/scripts/pmkit.mjs" render <view> [--format f] [--sprint id] [--save | --out <path>] --json`.
4. Report the `path`, whether the call replaced an earlier rendered file (`overwrote`), the `asOf` time, and every issue in `problems` with `/pmkit:local:doctor` as the next step. A `--save` file stays out of git: to share it, attach the file, or render again with `--out` to a path the user commits. For a render without a destination, show the Markdown `content` in the chat.
5. When the user asks for all three views, run step 3 once per view.

## Confirmation points

None. Render changes no tracker file, writes only files git ignores with `--save`, and refuses to replace any file it did not render. A `--out` path the user named counts as their request.

## Output

For a file: the path, whether it replaced an earlier render, the tracker state time, and the issues that could not be read. For a render without a destination: the Markdown view itself. With all three views, one line per file.

## If something is missing

- No active sprint for the sprint view: say so, and offer `/pmkit:cycle:plan`, or a sprint id from the sprints the tracker lists, passed as `--sprint <id>`.
- A `CONFLICT` on `--out`: the file exists and pmkit did not render it. Ask for another path.
- A `--out` path inside the tracker folder: offer `--save` instead.
- An error from the CLI: apply the rules for reading errors in the conventions.
