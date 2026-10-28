---
description: Set up pmkit in this project, or bring an existing setup in line with the installed version
argument-hint: ""
disable-model-invocation: true
---

# Set up pmkit

Arguments: `$ARGUMENTS`

## Parameters

None. Run `/pmkit:setup` from the root of the repository. The command asks for what it cannot detect. With the Local tracker, that is the ID prefix, the ID style, the estimate unit, the members and the `needs-criteria` label. With Linear, it is the team when you belong to several, the status that means in review, the status that means blocked, the label for each issue type, and a field only when the workspace offers more than one.

It is safe to run again. When `.pmkit/config.yaml` exists, it only updates and never starts over.

## Steps

Read `${CLAUDE_PLUGIN_ROOT}/skills/pmkit/references/conventions.md` first.

Its first rule (stop when there is no config) does not apply here, because this command creates the config.

1. Check whether `.pmkit/config.yaml` exists. When it does, read its `tracker.system`. `local` goes to "Existing config" and `linear` goes to "Existing Linear config". When it does not exist, ask with `AskUserQuestion` which tracker holds the issues. Offer "Local (Recommended)", for files in this repository, and "Linear", for a Linear workspace reached with a personal API key. Local continues with "First run". Linear goes to "Linear first run".

### First run

2. Detect the git host. Run `git remote get-url origin`. When the URL points to GitHub, run `gh auth status` and note whether the login works. When there is no remote, or the remote is not GitHub, the git host is `none`.
3. Collect the members. Run `git log --format='%aN|%aE'`, drop duplicate emails and propose one member per author. Derive the member ID from the name in lowercase with hyphens, for example `ana-souza`.
4. Ask with `AskUserQuestion`, and only these five questions:
   - the ID prefix (default `ISS`, 2 to 5 uppercase letters);
   - the ID style of issues and epics, `random` (`ISS-7K3Q`) or `numbered` (`ISS-1`, `ISS-2`). The recommended option depends on the tracker, and it goes first with "(Recommended)":
     - a local tracker recommends `random`. Two branches that each create an issue get different IDs. With `numbered`, both take the next number, and the merge conflicts;
     - a remote tracker (Linear, Jira, GitHub Issues, GitLab, Azure DevOps) recommends `numbered`, the numbering the tracker gives its own issues;
   - the estimate unit, `points` (default), `hours` or `sizes`;
   - the members, prefilled from step 3, so the user can remove or fix a row;
   - whether to add the `needs-criteria` label, with yes first and marked "(Recommended)". `/pmkit:spec:import` marks the requirements that have no acceptance criteria with this label. On no, setup changes nothing and says in one line that `/pmkit:spec:import` then lists those issues under "needs criteria".
5. Build the members file as a YAML map and send it on standard input:

   ```
   ana-souza:
     name: Ana Souza
     email: ana@example.com
   ```

6. Preview with `node "${CLAUDE_PLUGIN_ROOT}/scripts/pmkit.mjs" init --git-host <github|none> --prefix <P> --id-style <random|numbered> --estimate-unit <unit> --members-file - [--label needs-criteria] --dry-run --json`. Use `--git-host github` only when step 2 found a GitHub remote. On yes, add `--label needs-criteria` to the same command. A new tracker has no issues, so no labels in use are passed.
7. Show one summary: git host, prefix, ID style, estimate unit, the members, the label (`needs-criteria` or none) and the files the dry run lists. When the git host is `none`, add one line naming the commands that lose features: `/pmkit:issues:work`, `/pmkit:issues:mine`, `/pmkit:issues:pause`, `/pmkit:report:status`, `/pmkit:cycle:close` and `/pmkit:team:standup`. The first line of each config file is a schema line that points editors at the pmkit schema, and the CLI ignores it.
8. After the user approves, run the same command without `--dry-run`, with the same members file and the same `--label` flag, if any.
9. Run `node "${CLAUDE_PLUGIN_ROOT}/scripts/pmkit.mjs" validate --json`, `node "${CLAUDE_PLUGIN_ROOT}/scripts/pmkit.mjs" discover --json` and `node "${CLAUDE_PLUGIN_ROOT}/scripts/pmkit.mjs" capabilities --json`.
10. Go to "Output".

### Existing config

Never run `init` without `--update` when a config exists.

2. Run `node "${CLAUDE_PLUGIN_ROOT}/scripts/pmkit.mjs" validate --json`. Show each problem with its path and message. A problem in `.issues/config.yaml` or `.pmkit/config.yaml` makes `init --update` refuse, so ask the user to fix that file by hand first (see `/pmkit:local:doctor`) and run the check again. Other problems do not stop the update, but say that they stay until the user fixes them.
3. Handle the `needs-criteria` label.
   - Read the `labels` field of `node "${CLAUDE_PLUGIN_ROOT}/scripts/pmkit.mjs" discover --json`. When it lists `needs-criteria`, skip the question and go to step 4 without label flags.
   - Otherwise ask once with `AskUserQuestion` whether to add the `needs-criteria` label, with yes first and marked "(Recommended)".
   - On no, add one line: `/pmkit:spec:import` then lists those issues under "needs criteria". Go to step 4 without label flags.
   - On yes, and only when `labels` is empty, run `node "${CLAUDE_PLUGIN_ROOT}/scripts/pmkit.mjs" issues list --archived --json` and take the union of `issues[].labels`. Then split the union:
     - Names that match `^[a-z0-9][a-z0-9_-]*$` get one `--label` each, next to `--label needs-criteria`, in the commands of steps 4 and 8. Say which labels setup adds besides `needs-criteria`.
     - Names that do not match are not passed. Name them to the user. Say that once the list has a label, `validate` rejects the issues that use these labels. Offer to rename them. For each issue, run `node "${CLAUDE_PLUGIN_ROOT}/scripts/pmkit.mjs" issues update <id> --label <labels> --dry-run --json`, show the before and after, and ask once with `AskUserQuestion` for all of them. After approval, run the same commands without `--dry-run`. That flag replaces the whole label list, so pass every label the issue keeps. Then run setup again.
4. Run `node "${CLAUDE_PLUGIN_ROOT}/scripts/pmkit.mjs" init --update [--label <name>] --dry-run --json`. Add `--git-host`, `--id-style` or `--estimate-unit` only when the user asks to change them. Add the `--label` flags from step 3, when there are any. `--update` refuses `--prefix`, so tell the user the prefix cannot change. When the dry run fails because `.issues/config.yaml` or `.pmkit/config.yaml` is not valid, it writes nothing and names the problems. Show it and tell the user to fix the file by hand, then run the dry run again. A new ID style applies to the issues and epics created after it, and the existing IDs stay as they are.
5. Show every file the dry run marks `change` or `differs` with its diff. A one-line `change` on the first line of a config file is the schema line. List the `create` and `replace` files by path. Say how many files were `keep`.
6. For each `differs` file, ask with `AskUserQuestion` whether to replace it. A `differs` file is one the user edited, and the command replaces it only when asked.
7. When no file is `create`, `change`, `replace` or `differs`, say "already up to date", skip the write and go to step 9. Otherwise ask once with `AskUserQuestion` whether to apply the `create`, `change` and `replace` files shown, plus the `differs` files approved in step 6. When the user declines, stop and change nothing.
8. Run `node "${CLAUDE_PLUGIN_ROOT}/scripts/pmkit.mjs" init --update [--label <name>] --replace <path> --json`, with one `--replace <path>` per approved file and the same flags as the dry run. Without approved files, leave `--replace` out.
9. Run `node "${CLAUDE_PLUGIN_ROOT}/scripts/pmkit.mjs" validate --json`, `node "${CLAUDE_PLUGIN_ROOT}/scripts/pmkit.mjs" discover --json` and `node "${CLAUDE_PLUGIN_ROOT}/scripts/pmkit.mjs" capabilities --json`. Go to "Output".

### Linear first run

2. Detect the git host as in step 2 of "First run".
3. Run `node "${CLAUDE_PLUGIN_ROOT}/scripts/pmkit.mjs" init --tracker linear --git-host <github|none> --dry-run --json`. It reads the workspace with the key in `LINEAR_API_KEY` and writes nothing. On `AUTH`, tell the user to create a personal API key in Linear (Settings, Security & access) with read and write access and to export it as `LINEAR_API_KEY` in the shell profile or in `~/.claude/settings.json`, never in a file inside the repository. Never ask for the key and never write it. Then stop and ask the user to run setup again.
4. When `questions` holds `tracker.scope.team`, ask it alone with `AskUserQuestion`. Offer up to four of its `candidates`, and the user can type another team key. Then run `node "${CLAUDE_PLUGIN_ROOT}/scripts/pmkit.mjs" init --tracker linear --git-host <github|none> --workspace <key> --team <key> --dry-run --json`, with `workspace.urlKey` from step 3 and the team the user picked. Step 5 asks the `questions` of this dry run.
5. Ask every other item of `questions` with `AskUserQuestion`, one question per item, in the order given. Name what each one decides: which status means in review, which status means blocked, which field holds the estimate, which label stands for each issue type. `AskUserQuestion` takes four questions per call, so ask them in batches of four. Each question has two to four options:
   - When `recommended` is one of the `candidates`, offer it first with "(Recommended)", then the next `candidates` in order, at most two of them, then `none` last with the label in the item's `none`.
   - When `recommended` is `none` and `candidates` is not empty, offer `none` first with its label and "(Recommended)", then the first three `candidates`. Do not offer `none` a second time.
   - When `candidates` is empty, offer two options: `none` with its label and "(Recommended)", and "Stop setup", for a user who wants to add the status or turn on the field in Linear first. On "Stop setup", write nothing, tell the user to run `/pmkit:setup` again after the change in Linear, and stop.

   An answer with the `none` label passes `none`. The user can type another candidate in the free-text answer.
6. Run `node "${CLAUDE_PLUGIN_ROOT}/scripts/pmkit.mjs" init --tracker linear --git-host <github|none> --workspace <key> --team <key> --status <key>=<value> --field <key>=<value> --type-label <type>=<value> --dry-run --json`, with one `--status`, `--field` or `--type-label` per answer and the team from step 3 or 4. On `INVALID_INPUT` naming a value, ask that question again with the values its next step lists.
7. Show one summary: the workspace and its plan, the team, the git host, each status of the team with its category, the status that means blocked, the estimate, the label of each type, the `notes`, and `.pmkit/config.yaml` as the dry run would create it. Say that Linear numbers its own issues, so setup asks for no prefix and no ID style, and that setup creates no label in Linear.
8. After the user approves, run the command of step 6 without `--dry-run`.
9. Run `node "${CLAUDE_PLUGIN_ROOT}/scripts/pmkit.mjs" validate --json`, `node "${CLAUDE_PLUGIN_ROOT}/scripts/pmkit.mjs" discover --json` and `node "${CLAUDE_PLUGIN_ROOT}/scripts/pmkit.mjs" capabilities --json`. Go to "Output".

### Existing Linear config

2. Run `node "${CLAUDE_PLUGIN_ROOT}/scripts/pmkit.mjs" validate --json`. A problem in `.pmkit/config.yaml` makes `init --update` refuse, so ask the user to fix the file by hand first and run the check again.
3. Run `node "${CLAUDE_PLUGIN_ROOT}/scripts/pmkit.mjs" init --update --dry-run --json`. On `AUTH`, follow step 3 of "Linear first run". `broken` lists each mapping that names a team, status, field or label the workspace no longer has, and `questions` holds each of them plus any mapping never answered. Add `--git-host`, `--team`, `--status` or `--field` only when the user asks to change them.
4. When `questions` is empty and the file is `keep`, say "already up to date" and go to step 7. When `questions` holds `tracker.scope.team`, ask it alone as step 4 of "Linear first run" does, then run `node "${CLAUDE_PLUGIN_ROOT}/scripts/pmkit.mjs" init --update --team <key> --dry-run --json` with the flags of step 3, and take its `questions`. Ask the other questions as step 5 of "Linear first run" does. For a broken mapping, name its old value and its `problem` in the question.
5. Run `node "${CLAUDE_PLUGIN_ROOT}/scripts/pmkit.mjs" init --update --team <key> --status <key>=<value> --field <key>=<value> --type-label <type>=<value> --dry-run --json` with the answers of step 4 and the flags of step 3. Show the diff of `.pmkit/config.yaml` and the summary of step 7 of "Linear first run", and ask once with `AskUserQuestion` whether to apply it. When the user declines, stop and change nothing.
6. After the user approves, run the command of step 5 without `--dry-run`.
7. Run `node "${CLAUDE_PLUGIN_ROOT}/scripts/pmkit.mjs" validate --json`, `node "${CLAUDE_PLUGIN_ROOT}/scripts/pmkit.mjs" discover --json` and `node "${CLAUDE_PLUGIN_ROOT}/scripts/pmkit.mjs" capabilities --json`. Go to "Output".

## Confirmation points

- First run: the one summary of step 7 of the first run, before any file is written.
- Existing config: one question per `differs` file (step 6), then one question to apply everything shown (step 7), before `init --update` runs. With nothing to write, there is no question.
- Existing config step 3: the label renames, shown with their dry runs and asked once before any issue changes. Declining leaves the labels as they are.
- Linear first run: the one summary of step 7, before `.pmkit/config.yaml` is written.
- Existing Linear config: one question in step 5 before `init --update` writes. With nothing to write, there is no question.
- The tracker question of step 1, the questions of step 4 of the first run, the label question of step 3 of the existing config, the questions of steps 4 and 5 of the Linear first run and the questions of step 4 of the existing Linear config are inputs, not confirmations.

## Output

Lead with what was created or updated. Then:

- the active capabilities, from `capabilities`, in one line, and any capability that is derived or absent, with one line saying so;
- the validation result: "no problems", or the problems still open;
- three next commands, for example `/pmkit:issues:create`, `/pmkit:cycle:plan` and `/pmkit:help`.

## If something is missing

- `gh` is not installed or not logged in: continue with the git host `github` when the remote is GitHub, and say that pull request features need `gh auth login`.
- No GitHub remote: run with `--git-host none` and name the commands that lose features, as in step 7 of the first run.
- Not a git repository: say that `/pmkit:upgrade` and the commit step need git, and continue only if the user wants a tracker without it.
- `LINEAR_API_KEY` is not set, or belongs to another workspace: follow step 3 of "Linear first run". Never ask for the key.
- An error from the CLI: apply the rules for reading errors in the conventions.
