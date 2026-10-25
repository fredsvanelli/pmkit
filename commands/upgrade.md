---
description: Update the installed pmkit plugin to the latest version and move .issues/ to the current tracker format
argument-hint: ""
disable-model-invocation: true
---

# Upgrade pmkit

Arguments: `$ARGUMENTS`

## Parameters

None. Run `/pmkit:upgrade` from the project that uses the plugin. It updates the installs that apply there.

It changes the plugin install and, after approval, migrates the tracker files to the current format. It never edits the project config.

## Steps

Read `${CLAUDE_PLUGIN_ROOT}/skills/pmkit/references/conventions.md` first.

Its first rule does not apply here. Without a config, steps 1 to 4 still run and step 5 is skipped.

### 1. Find the installs

1. Run `claude plugin list --json`. Keep the entries whose `id` starts with `pmkit@`. The part after `@` is the marketplace.
2. An install applies here when its `scope` is `user`, or when its `projectPath` is the current project root. Keep the others for the summary.
3. When `${CLAUDE_PLUGIN_ROOT}` is not the `installPath` of any entry, this session loads pmkit from a folder (`claude --plugin-dir`). Say so and give `git -C "${CLAUDE_PLUGIN_ROOT}" pull` as the way to update it. After the user pulls, skip to step 5 and run the CLI from `${CLAUDE_PLUGIN_ROOT}`, which now holds the pulled code.

Done when you hold the installs to update, each with its version, scope and marketplace.

### 2. Fetch the latest version

1. For each marketplace of those installs, run `claude plugin marketplace update <marketplace>`.
2. Find the marketplace's local copy with `claude plugin marketplace list --json` and read its `installLocation`.
3. Read the `pmkit` entry in `<installLocation>/.claude-plugin/marketplace.json` and find the latest files from its `source`:
   - A relative path such as `./pmkit`: the marketplace copy holds them, in `<installLocation>/<source>`.
   - A `github` source with a `repo`: the marketplace copy holds only the entry. Clone the repository into a new temporary folder with `git clone --depth 1 --quiet https://github.com/<repo>.git <folder>`, and add `--branch <ref>` when the source has a `ref`.

Call that folder `<latest>`. Step 3 reads the new `.claude-plugin/plugin.json` and `CHANGELOG.md` from it before any install changes.

### 3. Show what changes

1. Read the latest version from `<latest>/.claude-plugin/plugin.json`.
2. When it equals the installed version, say "already up to date" and go to step 5. The repository may still need a migration.
3. Otherwise run the installed CLI against the new changelog: `node "${CLAUDE_PLUGIN_ROOT}/scripts/pmkit.mjs" changelog --file "<latest>/CHANGELOG.md" --since <installed version> --json`.
4. Show the installed version, the latest version, and each returned section from oldest to newest: version, date and body. When a section has a `trackerFormat`, add the line "this version migrates `.issues/` to format N".
5. Ask once whether to update. When the user declines, stop and change nothing: do not run steps 4 and 5.

### 4. Update

1. For each install that applies, run `claude plugin update pmkit@<marketplace> --scope <scope> --json` from the project root.
2. When the result reports a marketplace-declared command to confirm (`shownCommand`), show the command to the user and ask with `AskUserQuestion`. After approval, run the update again with `--accept-command <sha256>`. Never pass the skip-confirmation flag. A failing command stops the upgrade. Show its output.
3. Run `claude plugin list --json` again and read the new `version` and `installPath` of each install.

With more than one install that applies (a user install and a project install), steps 3 to 5 use the newest resulting version.

### 5. Migrate

1. Skip this step when `.pmkit/config.yaml` is missing or its tracker is not `local`.
2. Run the CLI of the new version, from its `installPath`. The session still runs the old code. Take `installPath` from the list read again in step 4, or from step 1 when step 4 did not run. When step 1 found a folder install (`claude --plugin-dir`), use `${CLAUDE_PLUGIN_ROOT}` as `installPath`. Use `node "<installPath>/scripts/pmkit.mjs" migrate --dry-run --json`.
3. When `from` equals `to` and `steps` is empty, say that the tracker is already on the current format.
4. Otherwise show every file under `steps[].changes` with its action, and ask once. After approval, run `node "<installPath>/scripts/pmkit.mjs" migrate --json`. Show the commit message when the result has a `commit`. When the user declines, change nothing and go to step 6.
5. `CONFLICT` means the tracker path has uncommitted changes. Show the message and ask the user to commit or discard them. When the user has done so, run `node "<installPath>/scripts/pmkit.mjs" migrate --dry-run --json` again, show its files and ask again before migrating, as in sub-step 4. `NOT_CONFIGURED` means the project is not a git repository, and the migration needs git history as the way back.

### 6. Next steps

1. One line per install: scope, old version and new version, or "already up to date". List the installs left alone in step 1 with their `projectPath` and version.
2. Print how to load the new version:
   - Claude Code: `/reload-plugins`, and "restart Claude Code if the new commands do not show".
   - Codex, only when `codex` is on the `PATH`: `codex plugin marketplace upgrade fredsvanelli`, then restart Codex.
   - OpenCode, only when `opencode` is on the `PATH`: "pmkit for OpenCode arrives with build step 3".
3. For each `Setup:` reason in the sections of step 3, show the reason and suggest `/pmkit:setup`.

## Confirmation points

- Step 3: once, to update, after the changelog.
- Step 4: once per `shownCommand`, with the command shown.
- Step 5: once, to migrate, after the full list of files.

## Output

The per-install lines, the migration result, the reload commands and the `Setup:` lines, in that order. Keep it short.

## If something is missing

- `claude` is not on the `PATH` or no `pmkit@` install exists: say so. When the session loads pmkit from a folder, use the `git pull` path of step 1.
- `<latest>` has no `CHANGELOG.md`: show the two versions without the changelog and say so.
- No `.pmkit/config.yaml`: skip step 5 and offer `/pmkit:setup`.
- An error from the CLI: apply the rules for reading errors in the conventions.
