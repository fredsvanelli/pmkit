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

1. Run `node "${CLAUDE_PLUGIN_ROOT}/scripts/pmkit.mjs" validate --json`. The result has `checked` and `problems`, each with `path`, `code` and `message`. Group the problems by `code` and show them with their paths. When there are none, go to step 6.
2. Resolve the conflicts first. For each problem with the code `conflict`, one file at a time:
   1. Read the file. Show both sides of every conflict block, labeled "ours" and "theirs", and show the lines around it. For an issue file, run `node "${CLAUDE_PLUGIN_ROOT}/scripts/pmkit.mjs" issues get <id> --history --json` as well when it parses, and say which value is newer.
   2. Propose the resolved content and show it as the whole result for that file.
   3. Ask with `AskUserQuestion` whether to write it. When the user declines, leave that file as it is, say it stays in conflict, and go to the next file.
   4. After approval, edit the file to remove the markers and keep the approved content. This is the only hand edit any command makes, and it applies to a file with conflict markers only. Never edit a file without markers.
   5. Run `node "${CLAUDE_PLUGIN_ROOT}/scripts/pmkit.mjs" validate --json` again. When the file still has problems, show them.
3. Settle the config and the format before any fix, because every write and every dry run fails while the tracker config is invalid or the format is old.
   - `config` problems: show each message and say which setting to correct in `.issues/config.yaml` or `.pmkit/config.yaml`. The command does not edit config files. The user edits them. Ask with `AskUserQuestion` to continue once the user has done it, then run `node "${CLAUDE_PLUGIN_ROOT}/scripts/pmkit.mjs" validate --json` again. When a `config` problem remains, stop here, say the CLI fixes need a valid config, and go to step 6.
   - `FORMAT` problems with an older tracker format: run `node "${CLAUDE_PLUGIN_ROOT}/scripts/pmkit.mjs" migrate --dry-run --json`, show the files it would touch and ask once with `AskUserQuestion`. After approval, run `node "${CLAUDE_PLUGIN_ROOT}/scripts/pmkit.mjs" migrate --json`. When the user declines, change nothing and go to step 6. Run `node "${CLAUDE_PLUGIN_ROOT}/scripts/pmkit.mjs" validate --json` again.
   - `FORMAT` problems with a newer tracker format: the installed pmkit is older than the tracker. Tell the user to run `/pmkit:upgrade`, and go to step 6.
4. Fix what the CLI can fix. For each remaining problem, propose a fix that uses a command, and skip the problems that have none.
   - `value` (a priority, type or status that is not allowed): for a priority or a type, `node "${CLAUDE_PLUGIN_ROOT}/scripts/pmkit.mjs" issues update <id> --priority <value> --dry-run --json` or `--type <value>`. For a status, `node "${CLAUDE_PLUGIN_ROOT}/scripts/pmkit.mjs" issues move <id> <category> --status <name> --dry-run --json`. Take the values from `node "${CLAUDE_PLUGIN_ROOT}/scripts/pmkit.mjs" discover --json`.
   - `reference` (a parent, blocker, milestone, release or sprint that does not exist): for a parent, `node "${CLAUDE_PLUGIN_ROOT}/scripts/pmkit.mjs" issues parent <id> none --dry-run --json`. For a milestone, group the problems by the milestone name and propose one `node "${CLAUDE_PLUGIN_ROOT}/scripts/pmkit.mjs" milestone create <name> --dry-run --json` per name. A name that breaks the id rule cannot be a milestone id. For such a name, ask the user for an id that follows the rule, then propose `node "${CLAUDE_PLUGIN_ROOT}/scripts/pmkit.mjs" milestone create <new id> --name "<old name>" --dry-run --json` first, and `node "${CLAUDE_PLUGIN_ROOT}/scripts/pmkit.mjs" issues update <id> --milestone <new id> --dry-run --json` for each issue that names the old name. When the user names an existing milestone instead, only the issue updates run. `--milestone none` stays an option for each issue. An epic names its milestone in `epic.md`, which no command edits, so the create is the only CLI fix for an epic. For a release, group the problems by the release name and propose one `node "${CLAUDE_PLUGIN_ROOT}/scripts/pmkit.mjs" release create <name> --dry-run --json` per name, or `node "${CLAUDE_PLUGIN_ROOT}/scripts/pmkit.mjs" issues update <id> --release none --dry-run --json` for each issue. A name that breaks the id rule gets the same steps as a milestone name: ask for a valid id, propose `release create <new id> --name "<old name>"` first, then `issues update <id> --release <new id>` for each issue. For a blocker that no longer exists, name the missing issue first and the issue that lists it second: `node "${CLAUDE_PLUGIN_ROOT}/scripts/pmkit.mjs" issues link <missing id> <id> --kind blocks --remove --dry-run --json`. For a missing target of `related` or `duplicate`, name the issue that lists it first: `node "${CLAUDE_PLUGIN_ROOT}/scripts/pmkit.mjs" issues link <id> <missing id> --kind related --remove --dry-run --json`, or `--kind duplicate`. A sprint reference moves scope, so use `node "${CLAUDE_PLUGIN_ROOT}/scripts/pmkit.mjs" cycle add <id> --to none --dry-run --json`.
   - `cycle` (a blocker loop): remove one link of the loop with `node "${CLAUDE_PLUGIN_ROOT}/scripts/pmkit.mjs" issues link <from> <to> --kind blocks --remove --dry-run --json`. Ask which one.
5. Show the dry-run results for all proposed fixes in one preview, with before and after per issue, and ask once with `AskUserQuestion`. When the user declines, change nothing. After approval, run the same commands without `--dry-run`. Then report what the CLI cannot fix, with the manual step.
   - `drift`: no fix needed. The next write to that issue records the change as an event.
   - `id` (a duplicate ID, or a folder that does not match its ID): the user renames the folder or changes the `id` and runs this command again. Reassigning IDs and updating references wait for phase 2.
   - `frontmatter`, `events`, `sprint`, `milestone`, `release`, `goal`, `customer`, `request` and `view`: the user opens the file named in the problem and corrects the field the message names, or renames the file when its id or name breaks the rule. The command does not edit these files. The one exception is a view: ask the user which filter the view should have, then propose `node "${CLAUDE_PLUGIN_ROOT}/scripts/pmkit.mjs" views save <name> <filter flags> --overwrite --dry-run --json`, which replaces the file with that filter.
6. Rebuild the query index. Run `node "${CLAUDE_PLUGIN_ROOT}/scripts/pmkit.mjs" reindex --json`. With `written: true`, report how many issues it indexed (`issues`) and how many files it could not read (`problems`). With `written: false`, report the `reason` and say that searches still work, because they read every issue file. Ask nothing, because the rebuild changes only files git ignores. When the config does not load, the command fails like any other. Report the error and go on.
7. Run `node "${CLAUDE_PLUGIN_ROOT}/scripts/pmkit.mjs" validate --json` a last time and compare with step 1.

## Confirmation points

- Step 2.3: each conflicted file, one question per file, before it is edited. Declining leaves the file as it is.
- Step 3: the continue question after the user edits the config, and the `migrate` run. Declining the migration changes nothing.
- Step 5: the preview of all CLI fixes, asked once. Declining changes nothing.
- Step 6 asks nothing, because `reindex` changes only files git ignores.

## Output

A health report. It has the files checked (from `checked`), the problems found, the problems fixed, the problems left with the manual step for each, and the index rebuild (how many issues it indexed, or why it could not write the index). Say when the problem count is zero.

## If something is missing

- No `.pmkit/config.yaml`: the conventions stop the command and offer `/pmkit:setup`.
- A conflicted file the user declines to resolve: list it under the problems left.
- An error from the CLI: apply the rules for reading errors in the conventions.
