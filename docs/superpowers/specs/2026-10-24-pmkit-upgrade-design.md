# pmkit: `/pmkit:upgrade`

Decisions from the brainstorming session of 2026-10-24. This document adds one command to the pmkit spec (`docs/superpowers/specs/2026-10-23-pmkit-design.md`) and changes a few rules there. The plan for build step 2 reads both. Calls marked **(builder's call)** were made by Claude while writing this document and the user has not confirmed them. Everything else the user decided.

## Why

The user sees that a new pmkit version is out on the marketplace. Today nothing tells them what changed, whether their repository's `.issues/` still matches what the new version expects, or what to do after updating. `/runbooks:upgrade` updates the plugin install, but it shows no changelog, migrates nothing, and only suggests setup in cases written by hand into the command.

`/pmkit:upgrade` is the one command to run in that moment. It shows the installed version, the new version and the changelog between them, updates the plugin, migrates `.issues/` when the tracker format changed, and ends with the next steps: how each agent tool loads the new version, and whether to run `/pmkit:setup` again.

## Goals

- Show the installed version, the latest version and the changelog entries between them, before anything changes.
- Update the plugin's Claude Code installs that apply to the current project.
- Migrate `.issues/` to the tracker format of the new version, with a full preview first.
- Tell the user how to load the new version in each agent tool, and when to run `/pmkit:setup` again and why.
- Keep a team safe while its members run different pmkit versions against the same repository.

## Non-goals

- No pmkit install for Codex or OpenCode in build step 2. Until build step 3 exists, `/pmkit:upgrade` only prints the command each of those tools uses. It never runs them.
- No automatic upgrade check. The user decides when to run the command.
- No downgrade and no rollback of a migration. Git history is the way back.

## Anti-goals

- A new version never migrates `.issues/` on its own. Migration happens only inside `/pmkit:upgrade` (or its CLI step), after the user approves the preview.
- The command never migrates over uncommitted changes in the tracker folder.
- An old version never reads a tracker format it does not know. Misreading shared files is worse than refusing.
- The command never passes `-y` to `claude plugin update` and never accepts a marketplace-declared command without asking.

## Constraints

- It ships in build step 2, together with `/pmkit:setup`, the other commands and the pmkit entry in `.claude-plugin/marketplace.json`. The step 2 plan covers all of step 2, with this command as one of its parts.
- No pmkit version is in users' hands yet: the first marketplace entry is the release that ships this command. No installed pmkit exists that would misread a newer tracker format.
- The pmkit marketplace entry uses a relative source, `"source": "./pmkit"`, like `runbooks` and `utils`, so the marketplace's local copy holds the plugin's files before install.
- Everything in the main spec's Constraints section applies: Node 18+, no dependencies, commands are Markdown procedures with `disable-model-invocation: true` that call the CLI for every computation and write.
- The command follows the shape of `runbooks/commands/upgrade.md`, which already handles finding installs through `claude plugin list --json`, scopes, `--plugin-dir` sessions and `shownCommand` confirmation. Reuse its procedure for those parts.

## The flow

`/pmkit:upgrade` takes no parameters and runs from the project that uses the plugin.

1. **Find the installs.** As in `/runbooks:upgrade`: `claude plugin list --json`, keep entries whose `id` starts with `pmkit@`, keep those with `scope: user` or whose `projectPath` is the current project root, list the others for the summary. When `${CLAUDE_PLUGIN_ROOT}` is no install's `installPath`, the session loads pmkit from a folder: say so, give `git -C "${CLAUDE_PLUGIN_ROOT}" pull`, and after the user pulls, continue at step 5 with the CLI at `${CLAUDE_PLUGIN_ROOT}`, which now runs the pulled code.
2. **Refresh the marketplace.** `claude plugin marketplace update <marketplace>` for each marketplace of those installs. This downloads the whole marketplace, so the new `pmkit/.claude-plugin/plugin.json` and `pmkit/CHANGELOG.md` are on disk in the marketplace's local copy before any install changes. The builder finds that copy's path from Claude Code's own output (`claude plugin marketplace list --json` or the `installLocation` it records) **(builder's call)**.
3. **Show what changes.** Read the latest version from the marketplace copy's `plugin.json`. When it equals the installed version, say "already up to date" and skip to step 5, because the repository may still need a migration (a teammate's clone, a format left behind). Otherwise show the installed version, the latest version, and the changelog sections newer than the installed version, from oldest to newest, then ask once whether to update.
4. **Update.** `claude plugin update pmkit@<marketplace> --scope <scope> --json` per install, from the project root. A `shownCommand` result is shown to the user and confirmed with `AskUserQuestion` before running again with `--accept-command <sha256>`. A failing update stops the command and shows its output. Then `claude plugin list --json` again to read each install's new `version` and `installPath`.
5. **Migrate.** Skip when `.pmkit/config.yaml` is missing or its tracker is not `local`. Otherwise run the CLI from the new version's `installPath`, not from `${CLAUDE_PLUGIN_ROOT}`, because the session still runs the old code: `node "<installPath>/scripts/pmkit.mjs" migrate --dry-run --json`. When it reports nothing to do, say the tracker is already on the current format. Otherwise show the full list of files it would change, ask once, and run it again without `--dry-run`.
6. **Next steps.** One line per install: scope, old version, new version or "already up to date". Then the reload commands (below), then the `Setup:` lines of the changelog sections shown in step 3, each with its reason and the suggestion to run `/pmkit:setup`.

With more than one install that applies (a user install and a project install), steps 3 to 5 use the newest resulting version **(builder's call)**.

## Tracker format and migrations

The `version` key of `.issues/config.yaml` is the Local tracker's format version. It goes up only when the tracker's files change shape, not with every plugin release. The CLI holds one constant, the format it reads and writes **(builder's call: `FORMAT_VERSION` in `scripts/lib/local/`)**.

The first release ships the machinery with no real migration: `FORMAT_VERSION` is 1 and the list of migrations is empty. `migrate` and the loader take that list as an argument, so tests run them against migrations defined only in the tests **(builder's call)**.

The tracker path is `tracker.path` from `.pmkit/config.yaml`, never a literal `.issues`. Every rule below that says "the tracker path" means that value.

The `version` key of `.pmkit/config.yaml` stays outside migrations. That file belongs to setup, so a change to its shape is announced with a `Setup:` line **(builder's call)**.

Each migration takes the format from one number to the next. `migrate` applies them in order until the tracker reaches `FORMAT_VERSION`, and its last change in each step is the new `version` in `.issues/config.yaml`.

A migration changes many files, so it follows the main spec's bulk-change rule: `migrate --dry-run` prints every file it would create, change or delete, and writes nothing. The real run goes through the same plan, so what it writes equals what the dry run showed **(builder's call)**. The commit follows `auto_commit` like every other write, with the message `pmkit: migrate tracker format <from> to <to>` **(builder's call)**.

`migrate` refuses with `CONFLICT` when `git status --porcelain` reports changes under the tracker path, with the next step to commit or discard them first **(builder's call for the code)**. Outside a git repository, or without `git`, it refuses with `NOT_CONFIGURED`, because git history is the only way back from a migration **(builder's call)**.

`migrate --json` prints `{ "from": 1, "to": 2, "steps": [{ "from": 1, "to": 2, "changes": [{ "path": ".issues/config.yaml", "action": "change" }] }] }`, with `action` one of `create`, `change`, `delete` and paths relative to the repository root, as `validate` does. With nothing to do, `from` equals `to` and `steps` is empty. The real run prints the same shape, plus `commit` with the commit message when `auto_commit` made one **(builder's call)**.

Comments in `.issues/config.yaml` survive a migration: the main spec says config files keep their comments because the adapter never rewrites them, and a migration that has to touch the config edits only the lines it changes **(builder's call)**.

### Mixed versions on one repository

- **Older format than the CLI's.** Reads work. The loader applies the pending migrations in memory, so readers only ever see the current shape and never carry code for old shapes **(builder's call)**. Writes refuse with `NOT_SUPPORTED`, message "this repository uses tracker format N, this pmkit writes format M", next step `/pmkit:upgrade`.
- **Newer format than the CLI's.** Reads and writes refuse with `NOT_SUPPORTED`, message "this repository uses tracker format N, this pmkit reads up to format M", next step `/pmkit:upgrade`. Today the config validator reports `version must be 1`, which stops writes but lets reads through. This changes that.
- `validate` reports a format mismatch as one problem with the same next step.
- The loader checks the format before validating the rest of `.issues/config.yaml`, because the other checks assume the current shape. A mismatch is reported alone, as `NOT_SUPPORTED`, ahead of any `INVALID_INPUT` from the other checks. For an older format, the loader validates the config after the in-memory migration. `migrate` skips both checks and reads the files as the format they declare **(builder's call)**.

## Changelog

`pmkit/CHANGELOG.md` holds one section per version, newest first:

An example of a later release (the first release's section has no `Tracker format:` line, because the format stays 1):

```markdown
# Changelog

## 0.2.0 - 2026-11-03

- Adds `/pmkit:upgrade`.
- `issues list` accepts `--archived` with other filters.

Tracker format: 2
Setup: setup now writes `.issues/.gitattributes` with `*.yaml text eol=lf`.
```

- The heading is `## <version> - <YYYY-MM-DD>`. The body is a Markdown list in plain words, written for the user, not a commit log.
- `Tracker format: N` appears in the section of a version that changes the tracker format. Step 3 shows it as "this version migrates `.issues/` to format N".
- `Setup: <reason>` appears, one line per reason, when the version changes something only setup writes: a config key setup asks about, a file setup copies into `.issues/` or `.pmkit/`, or the block setup writes in the agent instructions file, if step 2 creates one. A tracker format change never needs a `Setup:` line, because the migration covers it.
- The author of the release writes both lines. Nothing infers them.
- `node scripts/pmkit.mjs changelog --file <path> --since <version> --json` parses the file and returns the sections newer than `<version>`, each with its version, date, body, tracker format and setup reasons **(builder's call)**. Step 3 runs the installed CLI against the new file, so the format of this file stays stable across versions.
- Tests check that `CHANGELOG.md` has a section for the version in `plugin.json`, and that the newest `Tracker format:` line equals `FORMAT_VERSION` (or that no such line exists while it is 1) **(builder's call)**.

## Reloading in each tool

Step 6 prints, for each tool:

- **Claude Code.** `/reload-plugins`. `claude plugin update` itself says "restart required to apply", so the builder checks whether `/reload-plugins` loads a new version of an installed plugin and prints "restart Claude Code" instead if it does not.
- **Codex.** `codex plugin marketplace upgrade fredsvanelli`, then restart Codex. Printed only when `codex` is on the `PATH` **(builder's call)**.
- **OpenCode.** The command that build step 3's packaging defines. Until then, a line saying pmkit for OpenCode arrives with build step 3. Printed only when `opencode` is on the `PATH` **(builder's call)**.

## Changes to the main spec

The step 2 plan carries these into `docs/superpowers/specs/2026-10-23-pmkit-design.md`:

- The Commands table gains `/pmkit:upgrade`, file `commands/upgrade.md`, calls `changelog`, `migrate`.
- The CLI table gains `migrate [--dry-run]` and `changelog --file f --since v`.
- `/pmkit:setup` runs safely more than once: it shows the diff of every file it would change and writes only after the user approves, as `/runbooks:setup` does. Today `init` refuses when the config exists, so setup needs a path that reconfigures an existing project. That path keeps the answers already in `.pmkit/config.yaml`, keeps the comments in both config files, adds missing template files, and shows a diff before replacing a template file the user edited. Its CLI shape belongs to the setup part of the step 2 plan **(builder's call)**.
- The Local tracker section records the format rules above, including the reads that now refuse on a newer format.
- The README's command list and install section gain the command.

## Left to the builder

- Where the procedure lives in `commands/upgrade.md` and how much of `runbooks/commands/upgrade.md` it copies.
- The internal shape of a migration module and how `migrate` finds them.
- How the command finds the marketplace's local copy.
- Whether `/reload-plugins` is enough for Claude Code (see above).
- How the tests fake `claude plugin` output for the command's CLI parts.
