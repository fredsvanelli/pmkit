# PMK-65: the record-decision command

## Intent

`/pmkit:spec:record-decision` writes an architecture decision record (ADR) from a decision the user describes, and links it to the issues it affects. The source is the Dev catalog entry `record-decision`: "Writes an ADR and links it to issues", degraded to a Markdown file in the repository.

## Scope

A command file, a scenario, and the counts and tables that list commands. No new CLI command and no change to the tracker store. The CLI already has `docs create`, `docs list`, `issues comment` and `issues get`.

## Decisions

These decisions were made without a user round trip, so they are the implementer's calls.

1. **Where the file goes.** One rule picks the place, and the ADR number comes from that place only.
   - The repository already has `docs/adr/`: the ADR is the file `docs/adr/NNNN-slug.md`, written with the agent's file tools. This is pmkit's own layout, and the repository format wins on every tracker.
   - No `docs/adr/` and the tracker can create documents (Local, where `capabilities` lists `documents` without `createDocument` under `detail.unsupported`): `docs create adr/NNNN-slug.md`, which writes `.issues/docs/adr/NNNN-slug.md`.
   - No `docs/adr/` and `createDocument` is unsupported (Linear): the command creates `docs/adr/NNNN-slug.md` in the repository. This is the degradation "Markdown file in the repo".
   The output says which of the three was used and the real path.
2. **Format.** `# NNNN. Title`, then Status, Context, Decision, Consequences and Related issues, matching `docs/adr/0001-*.md`. Status is `proposed` or `accepted`. The `domain-modeling` skill allows a one-paragraph ADR, but the repository format has the sections, so the command keeps them and fills Consequences only with what the user said.
3. **Numbering.** The next number is the highest `NNNN` found in the chosen folder in the working tree and in `origin/<default branch>`, plus one, in four digits. A folder with no ADR starts at `0001`. The command fetches `origin` before it reads, and reads the folder again right before the write. Two branches can still pick the same number at the same time, and git does not report it because the slugs differ. The command says so, and the later PR renames its file and the links. A file whose name has no number is ignored and mentioned.
4. **Linking.** An issue has no field for documents, so the link is a comment on each related issue with the ADR number, title and path. The ADR also lists the issue IDs in Related issues, so the link goes both ways. One related issue is a single write. More than one is a bulk change, which shows every comment first and asks once, whatever `write_policy.confirm` says. A failed comment stops the loop, and the command lists the comments posted and the ones missing. The ADR stays.
5. **Related issues.** The user names them, or the command suggests the issue of the current branch. It checks each one with `issues get`, and an unknown ID stops the command before any write.
6. **Confirmation.** The ADR text is shown in full and the command asks once before it writes, even when `write_policy.confirm` is `none`, because the file is permanent.
7. **No commit for a repository file.** A tracker document is committed by `auto_commit` like any write. A repository file stays uncommitted, and the output says so.

## Non-goals

An ADR editor, a status change for an existing ADR, a `docs` field on issues, and a check that two ADRs share a number.

## Acceptance criteria mapping

- "Writes an ADR as a document after confirmation": the ADR steps of the command.
- "Links the ADR to the related issues": the comment steps and the Related issues section.
