---
description: Set up pmkit in this project, or bring an existing setup in line with the installed version
argument-hint: ""
disable-model-invocation: true
---

# Set up pmkit

Arguments: `$ARGUMENTS`

## Parameters

None. Run `/pmkit:setup` from the root of the repository. The command asks for what it cannot detect: the ID prefix, the ID style, the estimate unit, the members and the `needs-criteria` label.

It is safe to run again. When `.pmkit/config.yaml` exists, it only updates and never starts over.

## Steps

Read `${CLAUDE_PLUGIN_ROOT}/skills/pmkit/references/conventions.md` first.

Its first rule (stop when there is no config) does not apply here, because this command creates the config.

1. Check whether `.pmkit/config.yaml` exists. When it does, go to "Existing config" below. Otherwise continue with "First run".

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

6. Preview with `node "${CLAUDE_PLUGIN_ROOT}/scripts/pmkit.mjs" init --git-host <github|none> --prefix <P> --id-style <random|numbered> --estimate-unit <unit> --members-file - --dry-run --json`. Use `--git-host github` only when step 2 found a GitHub remote. On yes, add `--label needs-criteria` to the same command. A new tracker has no issues, so no labels in use are passed.
7. Show one summary: git host, prefix, ID style, estimate unit, the members, the label (`needs-criteria` or none) and the files the dry run lists. When the git host is `none`, add one line naming the commands that lose features: `/pmkit:issues:work`, `/pmkit:issues:mine`, `/pmkit:issues:pause`, `/pmkit:report:status`, `/pmkit:cycle:close` and `/pmkit:team:standup`.
8. After the user approves, run the same command without `--dry-run`, with the same members file and the same `--label` flag, if any.
9. Run `node "${CLAUDE_PLUGIN_ROOT}/scripts/pmkit.mjs" validate --json`, `node "${CLAUDE_PLUGIN_ROOT}/scripts/pmkit.mjs" discover --json` and `node "${CLAUDE_PLUGIN_ROOT}/scripts/pmkit.mjs" capabilities --json`.
10. Go to "Output".

### Existing config

Never run `init` without `--update` when a config exists.

2. Run `node "${CLAUDE_PLUGIN_ROOT}/scripts/pmkit.mjs" validate --json`. Show each problem with its path and message. A problem does not stop the update, but say that it stays until the user fixes it.
3. Handle the `needs-criteria` label.
   - Read the `labels` field of `node "${CLAUDE_PLUGIN_ROOT}/scripts/pmkit.mjs" discover --json`. When it lists `needs-criteria`, skip the question and go to step 4 without label flags.
   - Otherwise ask once with `AskUserQuestion` whether to add the `needs-criteria` label, with yes first and marked "(Recommended)".
   - On no, add one line: `/pmkit:spec:import` then lists those issues under "needs criteria". Go to step 4 without label flags.
   - On yes, and only when `labels` is empty, run `node "${CLAUDE_PLUGIN_ROOT}/scripts/pmkit.mjs" issues list --archived --json` and take the union of `issues[].labels`. Then split the union:
     - Names that match `^[a-z0-9][a-z0-9_-]*$` get one `--label` each, next to `--label needs-criteria`, in the commands of steps 4 and 8. Say which labels setup adds besides `needs-criteria`.
     - Names that do not match are not passed. Name them to the user. Say that once the list has a label, `validate` rejects the issues that use these labels. Offer to rename them, with `node "${CLAUDE_PLUGIN_ROOT}/scripts/pmkit.mjs" issues update <id> --label <labels>`. That flag replaces the whole label list, so pass every label the issue keeps. Then run setup again.
4. Run `node "${CLAUDE_PLUGIN_ROOT}/scripts/pmkit.mjs" init --update --dry-run --json`. Add `--git-host`, `--id-style` or `--estimate-unit` only when the user asks to change them. Add the `--label` flags from step 3, when there are any. `--update` refuses `--prefix`, so tell the user the prefix cannot change. A new ID style applies to the issues and epics created after it, and the existing IDs stay as they are.
5. Show every file the dry run marks `change` or `differs` with its diff. List the `create` and `replace` files by path. Say how many files were `keep`.
6. For each `differs` file, ask with `AskUserQuestion` whether to replace it. A `differs` file is one the user edited, and the command replaces it only when asked.
7. When no file is `create`, `change`, `replace` or `differs`, say "already up to date", skip the write and go to step 9. Otherwise ask once with `AskUserQuestion` whether to apply the `create`, `change` and `replace` files shown, plus the `differs` files approved in step 6. When the user declines, stop and change nothing.
8. Run `node "${CLAUDE_PLUGIN_ROOT}/scripts/pmkit.mjs" init --update --replace <path> --json`, with one `--replace <path>` per approved file and the same flags as the dry run. Without approved files, leave `--replace` out.
9. Run `node "${CLAUDE_PLUGIN_ROOT}/scripts/pmkit.mjs" validate --json`, `node "${CLAUDE_PLUGIN_ROOT}/scripts/pmkit.mjs" discover --json` and `node "${CLAUDE_PLUGIN_ROOT}/scripts/pmkit.mjs" capabilities --json`. Go to "Output".

## Confirmation points

- First run: the one summary of step 7 of the first run, before any file is written.
- Existing config: one question per `differs` file (step 6), then one question to apply everything shown (step 7), before `init --update` runs. With nothing to write, there is no question.
- The questions of step 4 of the first run and the label question of step 3 of the existing config are inputs, not confirmations.

## Output

Lead with what was created or updated. Then:

- the active capabilities, from `capabilities`, in one line, and any capability that is derived or absent, with one line saying so;
- the validation result: "no problems", or the problems still open;
- three next commands, for example `/pmkit:issues:create`, `/pmkit:cycle:plan` and `/pmkit:help`.

## If something is missing

- `gh` is not installed or not logged in: continue with the git host `github` when the remote is GitHub, and say that pull request features need `gh auth login`.
- No GitHub remote: run with `--git-host none` and name the commands that lose features, as in step 7 of the first run.
- Not a git repository: say that `/pmkit:upgrade` and the commit step need git, and continue only if the user wants a tracker without it.
- An error from the CLI: apply the rules for reading errors in the conventions.
