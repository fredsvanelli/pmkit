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

1. Collect the decision. Keep the user's words. Ask for what is missing: the context that forced the choice, the alternatives that were rejected and the consequences the user already knows. Do not invent a consequence or an alternative.
2. Check the related issues. Run `node "${CLAUDE_PLUGIN_ROOT}/scripts/pmkit.mjs" issues get <id> --json` for each one. When an ID does not exist, the CLI answers `NOT_FOUND`: stop before any write and ask for a corrected ID.
3. Pick the place. Check whether the repository has a `docs/adr/` folder, and run `node "${CLAUDE_PLUGIN_ROOT}/scripts/pmkit.mjs" capabilities --json` to read the `documents` entry.
   - The repository has `docs/adr/`: the ADR is the repository file `docs/adr/NNNN-<slug>.md`, whatever the tracker is. This is the format of pmkit's own ADRs, and it wins.
   - There is no `docs/adr/` and `detail.unsupported` of `documents` does not list `createDocument` (the Local tracker): the ADR is a tracker document at `adr/NNNN-<slug>.md`, which is the file `.issues/docs/adr/NNNN-<slug>.md`.
   - There is no `docs/adr/` and `detail.unsupported` lists `createDocument` (Linear), or `documents` is `absent`: the ADR is the repository file `docs/adr/NNNN-<slug>.md`, and the command creates the folder. This is the degradation to a Markdown file in the repository. Say so in one line.
4. Pick the number. Run `git fetch origin`. Take the highest `NNNN` among the file names in the chosen folder, in the working tree and in `origin/<default branch>` (`git ls-tree --name-only origin/<default branch> <folder>/`), add one and write it in four digits. For the tracker document, read the working tree with `node "${CLAUDE_PLUGIN_ROOT}/scripts/pmkit.mjs" docs list --json` and keep the paths that start with `adr/`. A folder with no ADR starts at `0001`. A gap in the numbers does not matter, the next number is the highest plus one. Ignore a file whose name has no leading number and mention it. When `origin` is missing or unreachable, use the working tree only and say so. The `<slug>` is the title in lowercase words joined by hyphens.
5. Draft the ADR. Follow the files in `docs/adr/`, with these sections: the title as the first heading, a `Status:` line (`accepted`, or `proposed` when the user says it is not final), `## Context`, `## Decision`, `## Considered options` (only when the user named rejected alternatives), `## Consequences` and `## Related issues` (the full IDs, one per line, or `none`). Write the draft to a temporary file outside `.issues/`.
6. Confirm and write. Show the path, the number and the full text, and ask once with `AskUserQuestion`, whatever `write_policy.confirm` says, because an ADR is a permanent record. Read the folder again right before the write. When another ADR took the number meanwhile, pick the next one and show the new path. When the user declines, stop and change nothing.
   - For a tracker document, run `node "${CLAUDE_PLUGIN_ROOT}/scripts/pmkit.mjs" docs create adr/NNNN-<slug>.md --body-file <file> --dry-run --json`, show the result with the text, and after approval run the same command without `--dry-run`.
   - For a repository file, write it with the file tools. Do not commit it. Say that it is uncommitted and that it belongs in the commit of the related work.
7. Link the issues. The ADR lists the issue IDs, and each related issue gets a comment with the number, the title and the path, written to a temporary file. For a tracker document the path is `.issues/docs/adr/NNNN-<slug>.md`. For a repository file the path is `docs/adr/NNNN-<slug>.md`, and the comment says the file is on the branch of the current work until it merges. For each issue run `node "${CLAUDE_PLUGIN_ROOT}/scripts/pmkit.mjs" issues comment <id> --body-file <file> --dry-run --json`. One issue is a single write: show the comment and ask once. More than one issue is a bulk change: show every comment first and ask once, whatever `write_policy.confirm` says. When the user declines, post nothing and say that the ADR is written and not linked. After approval, run each command without `--dry-run`, in the order of the IDs.
8. When a comment fails, stop. Do not retry and do not delete the ADR. List the issues that got the comment and the ones that did not, with the error, and offer to run the missing ones again.
9. Remove the temporary files.

Two branches that write an ADR at the same time can pick the same number, and git does not report it because the slugs differ. When a merge leaves two ADRs with one number, the later PR renames its file to the next number and updates the comments it posted.

## Confirmation points

- Step 6: the ADR, its path and its text. `write_policy.confirm: none` does not skip it.
- Step 7: one comment, as a single write (`write_policy.confirm: none` skips it), or the preview of several comments, as a bulk change (it always asks).

## Output

The ADR number, title and path, which of the three places was used (and the line about the degradation on Linear), whether the file is committed (a tracker document is committed by `auto_commit`, a repository file is not), and one line per related issue that got the comment. When a comment failed, the list of what is missing.

## If something is missing

- No decision text: ask for it. Do not write an empty ADR.
- A related issue that does not exist: `NOT_FOUND`. Ask for a corrected ID, and write nothing until all the IDs exist.
- `CONFLICT` from `docs create` because the path exists: read the folder again, pick the next number and show the new path. Never overwrite.
- `NOT_SUPPORTED` from `docs create`: use the repository file of step 3.
- `NOT_CONFIGURED`, or no `.pmkit/config.yaml`: offer `/pmkit:setup`.
- An error from the CLI: apply the rules for reading errors in the conventions.
