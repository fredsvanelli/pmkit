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

1. Read the spec. For a path under `.issues/docs/`, run `node "${CLAUDE_PLUGIN_ROOT}/scripts/pmkit.mjs" docs read <path> --json` (the path is relative to the `docs/` folder) and use `body`. For any other local file, read it with the Read tool. For pasted text, use it as given. Extract the goals, the scope, the requirements and the acceptance criteria. Collect every open question the spec leaves, and keep them in a separate list.
2. Run `node "${CLAUDE_PLUGIN_ROOT}/scripts/pmkit.mjs" discover --json` for the allowed types, priorities, labels and the estimate scale. When an `epic-id` was given, run `node "${CLAUDE_PLUGIN_ROOT}/scripts/pmkit.mjs" epic get <epic-id> --json` and `node "${CLAUDE_PLUGIN_ROOT}/scripts/pmkit.mjs" issues list --parent <epic-id> --json`, so the proposal does not repeat issues that exist.
3. Propose the tree. It has one epic (the existing one, or a new one with a title and optional start and target dates), milestones when the spec has phases, and issues with sub-issues. Each issue has a title, a type, an estimate from the scale, a milestone, the acceptance criteria from the spec and the issues that block it. A requirement with no acceptance criteria in the spec gets no invented criteria. Mark it "needs criteria" in the tree. Check the `labels` from step 2 and see whether `needs-criteria` is in the tracker's `labels`. When it is, the issue gets that label. When it is not, the CLI rejects the label, so no `issues create` call passes it. Say so in the proposal, and list those issues under "needs criteria" in the Output.
4. Show the full tree as a table (milestone, title, type, estimate, parent, blocked by) with the total estimate per milestone. Let the user edit, remove, merge or add rows, then show it again.
5. This is a bulk create, so it always shows the full tree and asks, whatever `write_policy.confirm` says. Ask with `AskUserQuestion` whether to create everything. When the user declines, stop and create nothing.
6. Check the values before any write. For a new epic, run `node "${CLAUDE_PLUGIN_ROOT}/scripts/pmkit.mjs" epic create --title "<title>" [--start <date>] [--target <date>] --dry-run --json`. For each top-level issue, run `node "${CLAUDE_PLUGIN_ROOT}/scripts/pmkit.mjs" issues create --title "<title>" --type <type> --estimate <n> [--milestone <milestone>, only when the tree has milestones] [--label needs-criteria, only when the label is configured] --dry-run --json`, leaving out `--parent` because the new epic does not exist yet. A sub-issue cannot be checked before its parent exists, so it is checked when it is created in step 8. When a dry run fails, show the error, ask for a corrected value and, when the change alters the tree, show the tree again and ask again.
7. When the epic is new, run `node "${CLAUDE_PLUGIN_ROOT}/scripts/pmkit.mjs" epic create --title "<title>" [--start <date>] [--target <date>] --json` and note the new ID.
8. Create the issues in order, parents before their sub-issues. For each, run `node "${CLAUDE_PLUGIN_ROOT}/scripts/pmkit.mjs" issues create --title "<title>" --type <type> --estimate <n> [--milestone <milestone>, only when the tree has milestones] --parent <epic id or issue id> [--label needs-criteria, only when the label is configured] [--description-file <file>] [--criteria-file <file>] --json`, with description and criteria files written outside `.issues/`, and note the new ID. When one fails, stop, list what was created and what was not, and do not retry it.
9. For each blocker in the tree, run `node "${CLAUDE_PLUGIN_ROOT}/scripts/pmkit.mjs" issues link <blocking id> <blocked id> --kind blocks --json`, using the new IDs. The approval of step 5 covers the creates and the links, because the tree showed them.
10. Keep the spec with the epic. When the spec came from outside the `docs/` folder, ask with `AskUserQuestion` whether to store it, then run `node "${CLAUDE_PLUGIN_ROOT}/scripts/pmkit.mjs" docs create specs/<name>.md --body-file <file> --dry-run --json`, show the path and ask once, and run it without `--dry-run`. The CLI has no field that links a document to an epic, so say the path next to the epic ID in the output. When the user declines, skip this step.
11. Remove the temporary files.

## Confirmation points

- Step 5: the full tree, always asked because it creates more than one record. It covers the epic, the issues and the links of step 9. Declining creates nothing.
- Step 6: a corrected value after a failed dry run, and the tree again when the correction changes it.
- Step 10: whether to store a spec from outside `docs/`, then one write ask for `docs create`.

## Output

The created tree with full IDs, then the totals per milestone (issues and estimate). List the open questions from the spec separately, and list the issues that need criteria, labeled or not. End with the path of the stored spec, when there is one.

## If something is missing

- No file and no pasted text: ask for one.
- The path is not under `docs/` and `docs read` answers `NOT_FOUND`: try it as a local file, and ask for a corrected path when that fails too.
- The spec has no requirements the command can extract: say so and ask what to import.
- An error from the CLI: apply the rules for reading errors in the conventions.
