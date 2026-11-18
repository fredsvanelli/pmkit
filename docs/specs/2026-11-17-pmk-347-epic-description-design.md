# Design: an epic description from `epic create`, `/pmkit:spec:from-prd` and `/pmkit:spec:import`

Issue PMK-347, epic EPC-6 (Remaining generic commands). Status: approved by the user on 2026-11-17. The builder check ran on 2026-11-17; its four questions are answered below as my calls, and its two corrections are applied. Calls marked **(my call)** were made while writing this spec; the user can change them.

## Problem

`/pmkit:spec:from-prd` and `/pmkit:spec:import` create the epic with a title and nothing else. A person who opens the epic later cannot tell what it is for, what stays out of the first version, or where the PRD lives. EPC-10 is an example: its `epic.md` holds only the frontmatter.

The cause is in the CLI. `epic create` takes `--title`, `--title-file`, `--start`, `--target` and `--goal` (`scripts/pmkit.mjs:1428`), and passes nothing else to the tracker. The three trackers already accept a `description` in `createDeliverable`:

- local: the body of `.issues/epics/<id>/epic.md` (`scripts/lib/local/tracker.mjs:1423`);
- Linear: the project's `content` (`scripts/lib/linear/project-ops.mjs:154`);
- GitHub: the Project's readme, set right after the create (`scripts/lib/github/project-ops.mjs:300`).

`epic get` already prints the description under the fields (`scripts/lib/format.mjs:68`). Only `spec/import.md` calls `epic create` among the commands, and Stage 4 of `spec/from-prd.md` runs steps 6 and 7 of `import`.

## Intent

Every epic that these two flows create says what it is for and links to its source, so the epic stands on its own for a reader who was not in the room.

## Goals

- `epic create --description-file <file>` passes the file's text as the epic description, on the three trackers, in the dry run too.
- `/pmkit:spec:from-prd` Stage 4 drafts the description from the refined PRD and shows it in the epic approval.
- `/pmkit:spec:import` drafts the description from the spec and shows it in the tree approval.
- The description cites the stored PRD or spec path, and in `from-prd` the ADRs of the run.
- `import` stores the spec before it creates the epic, so the path exists when the description cites it (decided with the user).

## Non-goals

- Editing the description of an existing epic. PMK-348 adds `epic update`.
- Changing an existing epic passed as `epic-id`, or one matched on a `from-prd` resume. Those keep their description as it is.
- Filling the description of old epics such as EPC-10. That waits for PMK-348.

## Anti-goals

- A description that copies the whole PRD. It goes stale the first time someone edits the PRD, and it hides the link to the real source.
- A description with content the PM did not see. The approval always shows the full text before the write.

## Constraints

- No dependencies (ADR 0003). Tests run on `node:test`.
- Text from data never goes on the shell command line. The description goes through a file written with the file tool, as `skills/pmkit/references/conventions.md` says for `--description-file`.
- Commands are the source for every agent (ADR 0002), so the change lives in the Markdown procedures and the CLI, not in an agent-specific skill.
- The CLI has no `docs update`, so the spec or PRD must be stored before the epic description can cite it.

## Approaches

For the CLI flag:

1. **`--description-file` only (chosen, my call).** Same flag and the same reading as `issues create` (`readInput`, `-` for stdin). Text from data never reaches the shell.
2. `--description` inline as well. Rejected: the conventions forbid text from data on the command line, and no command would use it.

For the text of the description:

1. **A short summary in a fixed template, with links (chosen, my call).** The purpose, the scope, what stays out, and the documents. Short enough to read on the epic page, and the PRD stays the full source.
2. A copy of the whole refined PRD. Rejected: it duplicates the PRD and goes stale (see Anti-goals).
3. Only a link to the PRD. Rejected: a reader without access to the tracker's documents, or on GitHub where the readme is the first thing shown, still sees no purpose.

For where `import` gets the path it cites, the user chose to store the spec before the epic, over citing the source file or citing nothing.

## The description template

The headings stay in English, as in the issue template of `/pmkit:issues:create`, and use `###`. The text follows the language of the PRD or spec. A section with nothing to say is left out, except Purpose.

```markdown
### Purpose

One short paragraph: the problem, and who it is for.

### Scope (in)

- One line per item of the first version

### Out of scope

- One line per item left out on purpose

### Documents

- Refined PRD: .issues/docs/specs/<slug>-prd.md
- ADR 0007: <title> (docs/adr/0007-<slug>.md)
```

Every path in Documents is relative to the repository root, written where the file really is **(my call)**. A tracker document on the local tracker is `.issues/docs/<path>`. A repository file, as the refined PRD on Linear or GitHub or an ADR in `docs/adr/`, keeps its repository path. A bare `specs/<slug>-prd.md`, the path `docs read` takes, leads nowhere for someone reading the epic on GitHub or Linear, while a repository path can be found in the repository.

In `from-prd` the sections come from the refined PRD: Purpose from Problem and Users, then Scope (in) and Out of scope as they are. Documents lists the stored refined PRD path of Stage 3b and every ADR of Stage 3 and of the Resume step, with number, title and path. A declined ADR is not listed.

In `import` Purpose comes from the spec's goals, Scope (in) and Out of scope from the spec when it has them, and Documents lists the stored spec path. `import` writes no ADRs.

## The CLI change

`epic create` gets `--description-file <file>`. The usage line becomes `(--title t | --title-file f) [--start d] [--target d] [--goal id] [--description-file f]`. The command reads the file with `readInput` and passes `description` in the input of `createDeliverable`. The dry run shows the description in its preview on the three trackers: the local and GitHub previews already include it, and the Linear preview includes it when it is not empty.

An empty file means no description, as the three trackers already treat `''` as blank **(my call, the same as `issues create`)**. A missing file answers `INVALID_INPUT` from `readInput`.

## `/pmkit:spec:from-prd`, Stage 4

- A new epic's proposal has the title, the dates when the PRD gives them, the milestones, and the description in the template above.
- The approval shows the full description, whatever `write_policy.confirm` says, because the text is Claude's writing. An edit to the description changes the file, and the proposal is shown and asked again, as for any edit.
- The dry run and the write of `import` steps 6 and 7 pass `--description-file`. The description file is written outside `.issues/` with the file tool and removed with the other temporary files.
- With an `epic-id`, or an epic matched on resume, Stage 4 shows the existing epic as today and drafts no description.
- Stage 4 follows the epic and milestone sub-steps of `import` step 7 and skips its new spec sub-step, because Stage 3b already stored the refined PRD. Every reference to the numbers of `import` step 7, in `from-prd.md` (Stages 4 and 5, "step 7.2") and in `docs/runbooks/spec-from-prd.md`, follows the new numbering.

### When GitHub creates the Project but not its readme

On GitHub the readme is a second request after the create. When it fails, `epic create` answers `UPSTREAM` with the new Project's ID in the message (`scripts/lib/github/project-ops.mjs:300`). The flow stops there, as `import` step 7 says for any failed write. The stop names the new epic ID, says that it has no description, and shows the drafted description, so the PM can paste it into the Project's readme by hand until PMK-348 adds `epic update` **(my call)**. The continue command names that epic ID, so a resume adds the issues to it and drafts no new description, as the Non-goals say.

## `/pmkit:spec:import`, new order

Today step 10 asks whether to store the spec after the issues and links exist. It moves before the epic:

1. Step 3 adds the description of a new epic to the proposal. When the spec came from outside the tracker's `docs/` folder, step 3 also picks where it would be stored and checks that path before anything is shown, as `from-prd` Stage 2 does **(my call)**. It runs `docs create specs/<name>.md --body-file <file> --dry-run --json`, which writes nothing:
   - `CONFLICT`: ask for another name and run the dry run again.
   - `NOT_SUPPORTED` (Linear and GitHub cannot create documents): the spec goes to the repository file `docs/specs/<name>.md` instead, as in `from-prd` Stage 2 **(my call)**. Check with the file tools that the file does not exist yet, and ask for another name when it does.

   Because the path is settled here, the step 5 approval shows the description with the real path, and nothing after the approval can change it.
2. Step 4 shows the description and the spec path above the tree.
3. Step 5 asks once. When the spec came from outside `docs/`, it has three choices: create everything and store the spec, create everything without storing the spec, or stop. When the PM does not store the spec, the description's Documents section cites the source file path when the spec came from a local file, and is left out when the spec was pasted **(my call)**, and the proposal is shown again with that change. When the spec is already under the tracker's `docs/` folder, nothing is stored, Documents cites that path, and step 5 has two choices: create everything, or stop **(my call)**.
4. Step 6 keeps the dry runs of the epic, the milestones and the top-level issues. The epic dry run carries `--description-file`.
5. Step 7 gets a new first sub-step that stores the spec, with `docs create` for a tracker document or the file tool for the repository file. Then the epic is created with `--description-file`, then the milestones. When the spec write fails, the flow stops before the epic, with nothing else created.
6. The old step 10 goes away. Its confirmation points become part of step 5.
7. A repository file has no commit yet. The output says so, as `from-prd` does, so it exists only in this working tree until the PM commits it.

With an `epic-id` the new order still stores the spec before the issues, but no description is drafted and the epic is left as it is.

## Files

- `scripts/pmkit.mjs`: the flag, the usage line and the input.
- `scripts/*.test.mjs` for the CLI: `epic create --description-file` on local, and with the fakes of Linear and GitHub, dry run and write.
- `commands/spec/from-prd.md`: Stage 4, Stage 5 (the step numbers of `import`), Confirmation points and Output.
- `commands/spec/import.md`: steps 3 to 7, the removed step 10, Confirmation points, Output and If something is missing.
- `scripts/from-prd-command.test.mjs`: static checks of the new text.
- `scripts/__scenarios__/spec-import*`: the scenario records the calls written in `import.md`, so its snapshot gains the spec dry run in step 3, the spec write before the epic, and `--description-file` on the epic. The `from-prd` snapshots do not change, because they record only the calls written in `from-prd.md` and none of their entries creates a new epic. The `from-prd` description is checked by the static tests and the runbook.
- `docs/runbooks/spec-from-prd.md` and `scripts/runbook-spec-from-prd.test.mjs`: the epic is created with a description, and `epic get` shows it.
- `docs/runbooks/spec-import.md` and `scripts/runbook-spec-import.test.mjs`: new, because the flow has no runbook yet. It covers the stored spec before the epic, the epic with its description, the issues and the links, on a local tracker.
- `skills/pmkit/references/conventions.md`: `epic create` joins the list of commands that take `--description-file`.
- `CHANGELOG.md`: an Unreleased entry.

## Left to the builder

- The wording of the procedure text, within the decisions above.
- How the CLI tests reach the Linear and GitHub fakes, following the existing epic tests.
- Whether the scenario modules need a new input file for a spec with an Out of scope section.

## Open questions

None.
