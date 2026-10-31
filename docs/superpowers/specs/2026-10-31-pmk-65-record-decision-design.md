# PMK-65: the record-decision command

## Intent

`/pmkit:spec:record-decision` writes an architecture decision record (ADR) from a decision the user describes, and links it to the issues it affects. The source is the Dev catalog entry `record-decision`: "Writes an ADR and links it to issues", degraded to a Markdown file in the repository.

## Scope

A command file, a read-only CLI command `docs next-adr`, a scenario and the tables that list commands. ADR 0002 says commands never compute, so the slug, the number and the place are computed in `scripts/lib/adr.mjs` and the command file only calls them. No change to the tracker store. The CLI already has `docs create`, `docs list`, `issues comment` and `issues get`.

## Decisions

These decisions were made without a user round trip, except the CLI command, which the review asked for.

1. **Where the file goes.** `docs next-adr` returns `destination`.
   - `docs/adr/` exists in the working tree or in `origin/<default branch>`: `repo`, the file `docs/adr/NNNN-slug.md`, written with the agent's file tools. This is pmkit's own layout and it wins on every tracker.
   - No `docs/adr/`, a Local tracker that can create documents: `tracker`, `docs create adr/NNNN-slug.md`, which writes `<tracker.path>/docs/adr/NNNN-slug.md`.
   - No `docs/adr/` and a hosted tracker (Linear, which cannot create documents): `repo`. This is the degradation "Markdown file in the repo".
2. **Format.** The format of the ADRs in `docs/adr/`: the title as the heading, one paragraph with the context, the decision and why, Considered options (only when the user named rejected ones) and Consequences. The command follows the newest ADR of the folder when there is one. It adds a Related issues section so the ADR points back to the issues. There is no Status line, because no ADR of the repository has one.
3. **Slug.** `[a-z0-9-]`: accents transliterated (NFD without marks), quotes dropped, every other run of characters one hyphen, 60 characters at most and cut at a word boundary. A title with nothing left is refused with `INVALID_INPUT`.
4. **Numbering.** The highest `NNNN` among `docs/adr/` and `<tracker.path>/docs/adr/` (Local only), each in the working tree and in the local ref `origin/<git_host.default_branch>`, plus one, in four digits. A gap does not matter. A name with no number is not counted and appears in `notes`. The default branch is `git_host.default_branch`, or `main` with a note. The command fetches `origin <default branch>` with `GIT_TERMINAL_PROMPT=0` and a 20 second limit unless `git_host.system` is `none`, and a failed fetch keeps the old ref. The CLI never fetches. It reads the number again right before the write, and a changed number or path means a new dry run and a new confirmation. Two branches can still pick the same number, and the later PR renames its file and its comments.
5. **Linking.** An issue has no field for documents, so the link is a comment on each related issue with the number, title and `path`. The ADR lists the issue IDs in Related issues. One issue is a single write. More than one is a bulk change with a full preview and one question, whatever `write_policy.confirm` says. A repository file has no commit yet, and the preview says so before the comments are posted. A failed comment stops the loop and the command lists what was and was not posted.
6. **Related issues.** The user names them, or the command suggests the issue of the current branch. Each one is checked with `issues get`, and an unknown ID stops the command before any write.
7. **Confirmation.** The ADR is shown in full and the command asks once before it writes, even when `write_policy.confirm` is `none`.
8. **No commit for a repository file.** A tracker document is committed by `auto_commit`. A repository file stays uncommitted, and the output says so.

## Non-goals

An ADR editor, a status change for an existing ADR, a `docs` field on issues, and a check that two ADRs share a number.

## Acceptance criteria mapping

- "Writes an ADR as a document after confirmation": the ADR steps of the command.
- "Links the ADR to the related issues": the comment steps and the Related issues section.
