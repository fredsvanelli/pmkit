---
description: Turn a spec or PRD into an epic with milestones, issues, sub-issues, estimates and blockers
argument-hint: "<file> [epic-id]"
disable-model-invocation: true
---

# Import a spec

Arguments: `$ARGUMENTS`

## Parameters

- `file` (required): the spec. A path under the tracker's `docs/` folder (read with `docs read`), any other local file, or pasted text.
- `epic-id` (optional): an existing epic (`EPC-` by default) to add the issues to. Without it, the command proposes a new epic.

## Steps

Read `${CLAUDE_PLUGIN_ROOT}/skills/pmkit/references/conventions.md` first.

1. Read the spec. For a path under `.issues/docs/`, run `node "${CLAUDE_PLUGIN_ROOT}/scripts/pmkit.mjs" docs read <path> --json` (the path is relative to the `docs/` folder) and use `body`. For any other local file, read it with the Read tool. For pasted text, use it as given. Extract the goals, the scope, what the spec leaves out, the requirements and the acceptance criteria. Collect every open question the spec leaves, and keep them in a separate list.
2. Run `node "${CLAUDE_PLUGIN_ROOT}/scripts/pmkit.mjs" discover --json` for the allowed types, priorities, labels and the estimate scale. Run `node "${CLAUDE_PLUGIN_ROOT}/scripts/pmkit.mjs" milestone list --json` for the milestones that already exist. When an `epic-id` was given, run `node "${CLAUDE_PLUGIN_ROOT}/scripts/pmkit.mjs" epic get <epic-id> --json` and `node "${CLAUDE_PLUGIN_ROOT}/scripts/pmkit.mjs" issues list --parent <epic-id> --json`, so the proposal does not repeat issues that exist.
3. Propose the tree. It has one epic (the existing one, or a new one with a title and optional start and target dates), milestones when the spec has phases, and issues with sub-issues. Mark each milestone existing or new. A milestone is existing when `milestone list` returns it. A new one has an id that follows the id rule (it starts and ends with a letter or digit and holds only letters, digits, `.`, `_` and `-`), a name, and a due date when the spec gives one. A name that issues use as free text, with no milestone file, is new. Each issue has a title, a type, an estimate from the scale, a milestone, the acceptance criteria from the spec and the issues that block it. A requirement with no acceptance criteria in the spec gets no invented criteria. Mark it "needs criteria" in the tree. Check the `labels` from step 2 and see whether `needs-criteria` is in the tracker's `labels`. When it is, the issue gets that label. When it is not, the CLI rejects the label, so no `issues create` call passes it. Say so in the proposal, and list those issues under "needs criteria" in the Output.

   A new epic also gets a description in this template. The headings stay in English and use `###`, as in the issue template of `/pmkit:issues:create`, and the text follows the language of the spec. Purpose comes from the goals of the spec. Scope (in) and Out of scope come from the spec when it has them. Documents lists the path of the spec. Leave out a section with nothing to say, except Purpose. With an `epic-id`, no description is drafted and the epic is left as it is. The spec is still stored before the issues.

   ```markdown
   ### Purpose

   One short paragraph: the problem, and who it is for.

   ### Scope (in)

   - One line per item of the first version

   ### Out of scope

   - One line per item left out on purpose

   ### Documents

   - Spec: .issues/docs/specs/<name>.md
   ```

   Every path in Documents is relative to the repository root and names the file where it really is. A tracker document on the local tracker is `.issues/docs/<path>`, such as `.issues/docs/specs/<name>.md`. A repository file keeps its repository path, such as `docs/specs/<name>.md`. A bare `specs/<name>.md`, the path `docs read` takes, leads nowhere for someone who reads the epic on GitHub or Linear.

   When the spec came from outside the tracker's `docs/` folder, as a local file or pasted text, pick where it would be stored before anything is shown. Take the name from the spec title: lowercase words joined by `-`, with only letters, digits and `-`. Write the spec text to a temporary file outside `.issues/` with the file tool, as the conventions say for files with text from data, and run `node "${CLAUDE_PLUGIN_ROOT}/scripts/pmkit.mjs" docs create specs/<name>.md --body-file <file> --dry-run --json` to check that the path is free. The dry run writes nothing.
   - `CONFLICT`: the path exists. Ask for another name and run the dry run again. Never overwrite. A new name follows the same rule as the title.
   - `NOT_SUPPORTED`: the tracker cannot create documents (Linear and GitHub). The spec goes to the repository file `docs/specs/<name>.md` instead. Check with the file tools that the file does not exist yet, and ask for another name when it does.

   The path is settled here, so the description shown in step 5 cites the real path, and nothing after the approval changes it. When the spec is already under the tracker's `docs/` folder, it is not stored again, and Documents cites the path it has.
4. Show the full tree as a table (milestone, title, type, estimate, parent, blocked by) with the total estimate per milestone. Show the new milestones above the issue rows, with their id, name and due date, and mark them as new. Above the tree, show the full description of a new epic and the path of the spec, where step 3 would store it or where it already is. Let the user edit the description, or edit, remove, merge or add rows, then show it again.
5. This is a bulk create, so it always shows the full tree, with the description and the spec path, and asks, whatever `write_policy.confirm` says. Ask once with `AskUserQuestion`. When the spec came from outside the tracker's `docs/` folder, the question has three choices: create everything and store the spec, create everything without storing the spec, or stop. When the user creates everything without storing the spec, the Documents section of a new epic's description cites the path of the source file when the spec came from a local file, and is left out when the spec was pasted. Show the tree again with that change and ask whether to create everything or stop. When the spec is already under the tracker's `docs/` folder, nothing is stored and the question has two choices: create everything, or stop. When the user stops, stop and create nothing.
6. Check the values before any write. For a new epic, write its title to a temporary file outside `.issues/` (one line, as the conventions say for files with text from data) and its description to another temporary file outside `.issues/` with the file tool, and run `node "${CLAUDE_PLUGIN_ROOT}/scripts/pmkit.mjs" epic create --title-file <epic title file> --description-file <epic description file> [--start <date>] [--target <date>] --dry-run --json`. For each new milestone, write its name to its own temporary file the same way and run `node "${CLAUDE_PLUGIN_ROOT}/scripts/pmkit.mjs" milestone create <id> --name-file <name file> [--due <date>] --dry-run --json`. For each top-level issue, write its title to its own temporary file outside `.issues/` (one line, as the conventions say for files with text from data) and run `node "${CLAUDE_PLUGIN_ROOT}/scripts/pmkit.mjs" issues create --title-file <title file> --type <type> --estimate <n> [--milestone <milestone>] [--label needs-criteria, only when the label is configured] --dry-run --json`, leaving out `--parent` because the new epic does not exist yet. Pass `--milestone` only for an existing milestone, because a new one has no file until step 7. On Linear `--milestone` needs `--parent <epic>`, so this dry run without `--parent` is refused with `Add --parent <epic>` when it carries a milestone: leave the milestone out of it and check it in step 8. When a dry run fails, show the error, ask for a corrected value and, when the change alters the tree, show the tree again and ask again. A sub-issue cannot be checked before its parent exists, so it is checked when it is created in step 8.
7. Create the records in this order, whatever the epic:
   1. When the user chose in step 5 to store the spec, store it at the path of step 3. For a tracker document, run `node "${CLAUDE_PLUGIN_ROOT}/scripts/pmkit.mjs" docs create specs/<name>.md --body-file <file> --json`, with the spec file of step 3. A tracker document gets a commit from `auto_commit`. For the repository file of `NOT_SUPPORTED`, write `docs/specs/<name>.md` with the file tools, with the same content. When this write fails, including a `CONFLICT` because the path was taken since step 3, stop before the epic, with nothing else created. Skip this sub-step when the spec is already under the tracker's `docs/` folder or the user chose not to store it.
   2. When the epic is new, run `node "${CLAUDE_PLUGIN_ROOT}/scripts/pmkit.mjs" epic create --title-file <epic title file> --description-file <epic description file> [--start <date>] [--target <date>] --json`, with the files of step 6, and note the new ID. When the epic is existing, skip this sub-step.
   3. For each new milestone, run `node "${CLAUDE_PLUGIN_ROOT}/scripts/pmkit.mjs" milestone create <id> --name-file <name file> [--due <date>] --json`, with the file of step 6, and note its id. This sub-step runs for a new epic and for an existing one alike, and it always finishes before step 8.

   When one fails, stop, list what was created and what was not, and do not retry it.
8. Create the issues in order, parents before their sub-issues. For each, run `node "${CLAUDE_PLUGIN_ROOT}/scripts/pmkit.mjs" issues create --title-file <title file> --type <type> --estimate <n> [--milestone <milestone>] --parent <epic id or issue id> [--label needs-criteria, only when the label is configured] [--description-file <file>] [--criteria-file <file>] --json`, with the title, description and criteria files written outside `.issues/`, the title as one line with nothing else (the dry run of step 6 uses the same title file), and note the new ID. Pass `--milestone` only when the issue has a milestone (on Linear only a top-level issue, whose parent is the epic, takes it), which is either an existing one or one created in step 7. When one fails, stop, list what was created and what was not, and do not retry it.
9. For each blocker in the tree, run `node "${CLAUDE_PLUGIN_ROOT}/scripts/pmkit.mjs" issues link <blocking id> <blocked id> --kind blocks --json`, using the new IDs. The approval of step 5 covers the spec write, the creates and the links, because the tree showed them.
10. Remove the temporary files.

## Confirmation points

- Step 5: the full tree, with the description of a new epic and the spec path, always asked because it creates more than one record. It covers the spec write of step 7, the epic, the new milestones, the issues and the links of step 9. When the spec came from outside `docs/`, the same question asks whether to store it. Declining creates nothing.
- Step 6: a corrected value after a failed dry run, and the tree again when the correction changes it.

## Output

The ids of the milestones it created, then the created tree with full IDs and the totals per milestone (issues and estimate). List the open questions from the spec separately, and list the issues that need criteria, labeled or not. End with the path of the spec next to the epic ID, because the CLI has no field that links a document to an epic, and say whether the stored spec has a commit: a tracker document gets one from `auto_commit`, and the repository file `docs/specs/<name>.md` has no commit yet, so it exists only in this working tree until the user commits it.

## If something is missing

- No file and no pasted text: ask for one.
- The path is not under `docs/` and `docs read` answers `NOT_FOUND`: try it as a local file, and ask for a corrected path when that fails too.
- The spec has no requirements the command can extract: say so and ask what to import.
- The spec has no goals to draw the Purpose of a new epic from: ask for the purpose in one or two sentences.
- `NOT_SUPPORTED` from `docs create` in step 3: the spec goes to the repository file `docs/specs/<name>.md`, as step 3 says.
- An error from the CLI: apply the rules for reading errors in the conventions.
