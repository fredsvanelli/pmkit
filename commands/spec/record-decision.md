---
description: Write an ADR from a decision and link it to the issues it affects
argument-hint: "[decision] [--issues id,id]"
disable-model-invocation: true
---

# Record a decision

Arguments: `$ARGUMENTS`

## Parameters

- `decision` (optional): what was decided and why, in the user's words. When it is empty, ask for it.
- `issues` (optional): the IDs of the issues the decision affects. When it is empty, suggest the issue of the current branch and ask which others apply. A decision may have no related issue.

## Steps

Read `${CLAUDE_PLUGIN_ROOT}/skills/pmkit/references/conventions.md` first.

1. Collect the decision. Keep the user's words. Ask for what is missing: the context that forced the choice, the alternatives that were rejected and the consequences the user already knows. Do not invent a consequence or an alternative. Pick a short title in the user's words.
2. Check the related issues. Run `node "${CLAUDE_PLUGIN_ROOT}/scripts/pmkit.mjs" issues get <id> --json` for each one. When an ID does not exist, the CLI answers `NOT_FOUND`: stop before any write and ask for a corrected ID.
3. Pick the place and the number. Run `node "${CLAUDE_PLUGIN_ROOT}/scripts/pmkit.mjs" docs next-adr --title "<title>" --json`. The CLI computes the number, the slug and the path, so do not work them out yourself. `destination` is `repo` for the repository file `docs/adr/NNNN-<slug>.md` (the repository has `docs/adr/`, or the tracker cannot create documents, as on Linear) and `tracker` for a tracker document that `docs create` writes at `docPath`. On Linear, say in one line that the ADR is a Markdown file in the repository, because the tracker cannot create documents. `INVALID_INPUT` means the title has no letter or digit, so ask for another title. Show every line of `notes`. Then, when `gitHost` is not `none`, run `GIT_TERMINAL_PROMPT=0 git fetch origin <defaultBranch>` (the CLI returns only a valid branch name, `main` with a note otherwise) with a limit of 20 seconds and run `docs next-adr` again, so the number sees the ADRs merged meanwhile. When the fetch fails or times out, go on: the CLI reads the `origin/<defaultBranch>` that is already here and says so in `notes`. With `gitHost: none`, skip the fetch.
4. Draft the ADR in the format of the ADRs already in the folder. Read the newest one with the file tools and follow it. When the folder has none, use the format of `docs/adr/` in this repository: the title as the first heading, one paragraph with the context, the decision and why, `## Considered options` (only when the user named rejected alternatives) and `## Consequences`. Add one section at the end, `## Related issues`, with the full IDs one per line, or `none`, because that is how the ADR points back to the issues. Write the draft to a temporary file outside the tracker folder.
5. Confirm and write. Run `node "${CLAUDE_PLUGIN_ROOT}/scripts/pmkit.mjs" docs next-adr --title "<title>" --json` once more right before the write. When `number` or `path` changed, tell the user, update the file name and the draft, and treat the new path as the one to confirm. Run `node "${CLAUDE_PLUGIN_ROOT}/scripts/pmkit.mjs" docs create <docPath> --body-file <file> --dry-run --json` for a tracker document, show it, and ask once with `AskUserQuestion`, whatever `write_policy.confirm` says, because an ADR is a permanent record. For a repository file there is no dry run, so show the path, the number, the slug and the full text and ask once. Ask again after every change of the number or the path. When the user declines, stop and change nothing. After approval, run the same `docs create` command without `--dry-run`, or write the repository file with the file tools. `CONFLICT` from `docs create` means the path appeared meanwhile: go back to this step.
6. Link the issues. Skip this step when there is no related issue. Each related issue gets a comment with the number, the title and the `path` of the result of step 5, written to a temporary file. When `destination` is `repo`, the comment also says that the file is on the branch of the current work until it merges. For each issue run `node "${CLAUDE_PLUGIN_ROOT}/scripts/pmkit.mjs" issues comment <id> --body-file <file> --dry-run --json`. When `destination` is `repo`, say before the preview that the ADR file has no commit yet, so the comments point to a file that exists only in this working tree until the user commits and pushes it. One issue is a single write: show the comment and ask once, unless `write_policy.confirm` is `none`, which skips that question. More than one issue is a bulk change: show every comment first and ask once, whatever `write_policy.confirm` says. When the user declines, post nothing and say that the ADR is written and not linked. After approval, run each command without `--dry-run`, in the order of the IDs.
7. When a comment fails, stop. Do not retry and do not delete the ADR. List the issues that got the comment and the ones that did not, with the error, and offer to run the missing ones again.
8. Remove the temporary files.

Two branches that write an ADR at the same time can pick the same number, and git does not report it because the slugs differ. When a merge leaves two ADRs with one number, the later PR renames its file to the next number from `docs next-adr` and updates the comments it posted.

## Confirmation points

- Step 5: the ADR, its path and its text. `write_policy.confirm: none` does not skip it. It asks again when the number or the path changes before the write.
- Step 6: one comment, as a single write (`write_policy.confirm: none` skips it), or the preview of several comments, as a bulk change (it always asks).

## Output

The ADR number, title and path, which place was used (`repo` or `tracker`, and the line about the degradation on Linear), whether the file has a commit (a tracker document gets one from `auto_commit`, a repository file does not), the notes of `docs next-adr`, and one line per related issue that got the comment. When a comment failed, the list of what is missing.

## If something is missing

- No decision text: ask for it. Do not write an empty ADR.
- A related issue that does not exist: `NOT_FOUND`. Ask for a corrected ID, and write nothing until all the IDs exist.
- `INVALID_INPUT` from `docs next-adr`: the title has no letter or digit. Ask for another title.
- `NOT_SUPPORTED` from `docs create`: write the file `docs/adr/<filename>` in the repository with the same number and say that the tracker could not create it.
- `NOT_CONFIGURED`, or no `.pmkit/config.yaml`: offer `/pmkit:setup`.
- An error from the CLI: apply the rules for reading errors in the conventions.
