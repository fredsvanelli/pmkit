---
description: Show what pmkit can do in this project, explain a capability, or find the command for a task
argument-hint: "[capability or text]"
disable-model-invocation: true
---

# Help with pmkit

Arguments: `$ARGUMENTS`

## Parameters

- Nothing: show the overview.
- A capability ID, for example `cycles` or `time_tracking`: explain that capability.
- Free text, such as a question, a command name or a task: find the commands that match.

## Steps

Read `${CLAUDE_PLUGIN_ROOT}/skills/pmkit/references/conventions.md` first.

Its first rule does not apply here. Without a config, this command still answers.

1. Check whether `.pmkit/config.yaml` exists. When it does, run `node "${CLAUDE_PLUGIN_ROOT}/scripts/pmkit.mjs" capabilities --json`. Without a config, skip this call and go to "If something is missing".
2. No argument: show the tracker and the git host from the config, the capabilities that are available, and the commands grouped by persona. Take the commands from the files under `${CLAUDE_PLUGIN_ROOT}/commands`: read the `description` in the frontmatter of each file. The folder name is the group (`issues`, `spec`, `backlog`, `report`, `cycle`, `team`, `local`), and the files at the top level are the foundation commands.
3. A capability: when the argument equals an ID in the manifest, explain what it is, its path in this project (native, derived, conditional or absent), the commands that use it, and how to enable it when it is missing (plan, tier or configuration). Read `${CLAUDE_PLUGIN_ROOT}/README.md` and `${CLAUDE_PLUGIN_ROOT}/CONTEXT.md` for the wording of the terms.
4. Free text: match the text against command names, their `description` and the capability IDs. Answer with the best one to three matches, each with what it does and two example invocations.
5. No match: say so, show the closest commands and suggest `/pmkit:help` for the full list.
6. A capability the manifest marks absent: say which trackers support it.

## Confirmation points

None. The command only reads.

## Output

A short answer that ends with one command the user can run now.

## If something is missing

- No `.pmkit/config.yaml`: explain in two sentences what pmkit is (issue tracking from the terminal, with the Local tracker keeping issues as files in the repository) and point to `/pmkit:setup`.
- No capability manifest: say so and offer `/pmkit:setup`.
- A capability the project does not have: say which trackers support it and how to get it.
