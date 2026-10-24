---
description: Check the tracker files, fix what can be fixed and resolve git conflict markers with your approval
argument-hint: ""
disable-model-invocation: true
---

# Check the tracker

Arguments: `$ARGUMENTS`

## Parameters

None.

## Steps

Read `${CLAUDE_PLUGIN_ROOT}/skills/pmkit/references/conventions.md` first.

1. Run `node "${CLAUDE_PLUGIN_ROOT}/scripts/pmkit.mjs" validate --json`. The result has `checked` and `problems`, each with `path`, `code` and `message`. Group the problems by `code` and show them with their paths. When there are none, go to "Output".
2. Resolve the conflicts first. For each problem with the code `conflict`, one file at a time:
   1. Read the file. Show both sides of every conflict block, labeled "ours" and "theirs", and show the lines around it. For an issue file, run `node "${CLAUDE_PLUGIN_ROOT}/scripts/pmkit.mjs" issues get <id> --history --json` as well when it parses, and say which value is newer.
   2. Propose the resolved content and show it as the whole result for that file.
   3. Ask with `AskUserQuestion` whether to write it. When the user declines, leave that file as it is, say it stays in conflict, and go to the next file.
   4. After approval, edit the file to remove the markers and keep the approved content. This is the only hand edit any command makes, and it applies to a file with conflict markers only. Never edit a file without markers.
   5. Run `node "${CLAUDE_PLUGIN_ROOT}/scripts/pmkit.mjs" validate --json` again. When the file still has problems, show them.
3. Fix what the CLI can fix. For each remaining problem, propose a fix that uses a command, and skip the problems that have none.
   - `value` (a priority, type or status that is not allowed): `node "${CLAUDE_PLUGIN_ROOT}/scripts/pmkit.mjs" issues update <id> --priority <value> --dry-run --json` or the matching field, with a value from `node "${CLAUDE_PLUGIN_ROOT}/scripts/pmkit.mjs" discover --json`.
   - `reference` (a parent, blocker or milestone that does not exist): `node "${CLAUDE_PLUGIN_ROOT}/scripts/pmkit.mjs" issues parent <id> none --dry-run --json`, `node "${CLAUDE_PLUGIN_ROOT}/scripts/pmkit.mjs" issues link <from> <to> --kind blocks --remove --dry-run --json`, or `node "${CLAUDE_PLUGIN_ROOT}/scripts/pmkit.mjs" issues update <id> --milestone <name> --dry-run --json`. A sprint reference moves scope, so use `node "${CLAUDE_PLUGIN_ROOT}/scripts/pmkit.mjs" cycle add <id> --to none --dry-run --json`.
   - `cycle` (a blocker loop): remove one link of the loop with `node "${CLAUDE_PLUGIN_ROOT}/scripts/pmkit.mjs" issues link <from> <to> --kind blocks --remove --dry-run --json`. Ask which one.
4. Show the dry-run results for all proposed fixes in one preview, with before and after per issue, and ask once with `AskUserQuestion`. When the user declines, change nothing. After approval, run the same commands without `--dry-run`.
5. Report what the CLI cannot fix, with the manual step.
   - `drift`: no fix needed. The next write to that issue records the change as an event.
   - `id` (a duplicate ID, or a folder that does not match its ID): rename the folder or change the `id` by hand, then run this command again. Reassigning IDs and updating references wait for phase 2.
   - `frontmatter`, `events`, `config`, `sprint` and `FORMAT`: open the file named in the problem and correct it. Say which field the message names.
   - Cache: `.issues/.cache/` does not exist in this version. A `reindex` command waits for phase 2.
6. Run `node "${CLAUDE_PLUGIN_ROOT}/scripts/pmkit.mjs" validate --json` a last time and compare with step 1.

## Confirmation points

- Step 2.3: each conflicted file, one question per file, before it is edited. Declining leaves the file as it is.
- Step 4: the preview of all CLI fixes, asked once. Declining changes nothing.

## Output

A health report. It has the files checked (from `checked`), the problems found, the problems fixed, and the problems left with the manual step for each. Say when the problem count is zero.

## If something is missing

- No `.pmkit/config.yaml`: the conventions stop the command and offer `/pmkit:setup`.
- A conflicted file the user declines to resolve: list it under the problems left.
- An error from the CLI: apply the rules for reading errors in the conventions.
