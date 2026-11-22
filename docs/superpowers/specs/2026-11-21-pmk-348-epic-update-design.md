# PMK-348: epic update, to edit the title and the description of an existing epic

## Problem

Epics created before `epic create` took a description (EPC-10, for example) have no written purpose, and the CLI cannot edit an existing epic. The tracker contract only creates epics, so the only way out is to edit `.issues/` by hand, which the conventions forbid.

## Approaches

1. **A contract operation `updateDeliverable(id, { title, description }, actor, { dryRun })` in the three trackers, and a CLI command `epic update`** (chosen). It has the same shape as `moveDeliverable` (PMK-353): a dry run with `before` and `after`, the actor, and the three adapters behind one contract case. Each tracker writes where `epic create` already writes the same fields.
2. A Local-only command. EPC-10 is Local, but the issue asks for Linear and GitHub, and a command that refuses on two of three trackers splits the contract.
3. Reuse `epic goal`'s frontmatter edit for the description too. The description is the body of `epic.md`, not frontmatter, so it needs its own edit anyway.

## Design

### Contract

- `updateDeliverable` joins `TRACKER_OPERATIONS` (`scripts/lib/contract.mjs`) and the `deliverables` capability's command list (`scripts/lib/capabilities.mjs`), beside `createDeliverable` and `moveDeliverable`.
- Input: `title` and/or `description`, nothing else (`INVALID_INPUT` names the allowed keys). The title rules are those of create: required when given, one line. An empty description clears it.
- The result is `{ before, after }`, as for every write.
- **No change → `INVALID_INPUT`.** That covers no field given, and fields equal to what the epic already holds (`epic ${id} already has this title and description`), as `epic move` refuses the category the epic already has. (My call: the acceptance criterion says "sem nenhuma mudança", and both readings refuse.)
- An epic that does not exist is `NOT_FOUND`, from each tracker's own read.

### Local (`scripts/lib/local/tracker.mjs`)

- The title is set with `editEpicFrontmatter` and `setScalar(yaml, ['title'], …)`. The description replaces the body. Every other key, comment and the frontmatter stay as they are.
- Events: one `update` event per changed field, `{ at, by, op: 'update', field: 'title' | 'description', from, to }`, the shape `setEpicGoal` already writes. `CONTEXT.md` says that an epic's `update` event covers its title and description too.

### Linear (`scripts/lib/linear/`)

- A `PROJECT_UPDATE` document, `mutation PmkitProjectUpdate($id: String!, $input: ProjectUpdateInput!) { projectUpdate(id: $id, input: $input) { success project { ...PmkitProjectFields } } }`, with `name` and/or `content`, the fields `projectCreate` writes (`projectInput`). The fake gains the route and refuses other input keys.
- The live guard: `SUITE_INPUT_KEYS.projectUpdate` grows from `['statusId']` (PMK-356) to `['statusId', 'name', 'content']`, still only on a project the run created. The contract case runs live in `deliverable-writes`.

### GitHub (`scripts/lib/github/`)

- `UPDATE_PROJECT` (`updateProjectV2`) with `title` and/or `readme`. `epic create` writes the description into the readme, and `getDeliverable` reads it from there. The fake handles `title` too. A Project of another owner that the token cannot write answers as the other GitHub writes do.

### CLI (`scripts/pmkit.mjs`)

- `epic update <id> [--title t | --title-file f] [--description-file f]`, write, dry-run. The text shows the `before` and `after` of the changed fields, as `writeText` does for the other epic writes. It commits on Local, as `epic move` does.
- No flag → `INVALID_INPUT` with the usage.

### Flow, docs and tests

- Runbook `docs/runbooks/epic-update.md`, verified by `scripts/runbook-epic-update.test.mjs` with the real CLI on a Local fixture. It changes the description, then the title, then runs a dry run that writes nothing, an unknown id and a call with no change.
- Contract case in `scripts/contract-suite.mjs`, family `deliverable-writes`: edit the title, then the description; the read shows both; an unchanged update refuses.
- Unit tests per adapter for what the contract does not see: the Local events, and the exact Linear and GitHub inputs.
- README command table, `skills/pmkit/SKILL.md` if it lists the epic commands, the CHANGELOG, and the golden case for `epic update` if `golden-cases.mjs` lists every write.

## Interview

- **Where does the description go on each tracker?** Where `epic create` put it: the Local body, Linear `content`, and the GitHub readme. Then a read after an update shows what a read after a create shows.
- **Does the Local history need a new op?** No. `update` with `field` exists for the goal.
- **A title equal to another epic's?** Allowed, as on create.
- **Does an update on Linear need the actor to be the key owner?** It uses `requireViewer(actor)`, as every Linear write does.
- **Live Linear run.** The key the owner gave for PMK-356 and the same sandbox team. Only the contract case's projects, which the run creates, are written.
- New terms: the `CONTEXT.md` line on epic events gains the title and description edit. ADRs: none, since nothing here is hard to reverse.
- Approval: no open product question. The acceptance criteria fix the flags, the dry run, the history, the remote writes and the two refusals.
