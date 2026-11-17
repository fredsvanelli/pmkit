# PMK-89 design: GitHub Issues without a Project

Issue PMK-89, epic EPC-8 (GitHub Issues tracker adapter), milestone `github-issues`. Status: draft, waiting for the user's approval. The user answered five questions on 2026-11-17, and "Decisions from the user" records the answers. Calls marked **(builder's call)** were made while writing this spec and change no acceptance criterion.

## Problem

With `tracker.scope.project: none`, the GitHub tracker reads only open and closed. An open issue is `todo`, a closed one `done` or `canceled`, and `issues move` to any other category fails with `NOT_SUPPORTED`. A repository with no enabled issue type maps no pmkit type, so every issue reads with no type and `issues create --type bug` fails. `archive` fails with a message that only says to set a Project. The capability manifest says "The GitHub adapter does not serve <id> yet (EPC-8)" for sprints, capacity, epics and status updates, whether or not the repository has a Project.

Acceptance criterion:

1. Without a Project, the adapter works from labels and milestones and reports the capabilities that are absent.

Source: GitHub tab, Open questions ("Teams without a project: how EM skills degrade using only labels and milestones").

## Decisions already made

ADR 0007, ADR 0008 and the PMK-84 to PMK-87 specs settle these, and this spec does not reopen them:

- The config holds `tracker.scope.host`, `tracker.scope.repo` and `tracker.scope.project` (`owner/number` or `none`). A repository without a Project needs no `project` scope (ADR 0007).
- Reading rule for the state: a closed issue is `done`, or `canceled` when GitHub's state reason is not planned or duplicate, whatever else it carries. `move_to_category` closes with reason completed for `done` and not planned for `canceled`.
- `mappings.types.<pmkit type>` names a GitHub issue type when the repository has issue types (PMK-86).
- Archive works on the Project item; `unarchive` and `restore` answer `NOT_SUPPORTED` (ADR 0008).
- Every operation runs the mapping check first; a broken mapping fails with `NOT_CONFIGURED` and the next step `/pmkit:setup` (PMK-87).
- From PMK-88, running in parallel: an epic is a Project linked to the repository, other than `tracker.scope.project`, with Project status updates. Sprints come from a Project's iteration field. GitHub milestones are pmkit milestones, with the milestone title as the id, created through REST. Milestones belong to the repository, so they work with or without a Project.

## Decisions from the user

1. **Statuses from labels.** Without a Project, `mappings.status.<category>` may name a repository label, written `label:<name>`. With a Project, values stay bare Status option names, and a `label:` value is a broken mapping.
   - Read: a closed issue stays `done` or `canceled` whatever its labels. An open issue takes the category of its status label. An open issue with no status label is `todo`. An issue with several status labels reads the one furthest along backlog, todo, in_progress, in_review, with a warning.
   - Write: `moveToCategory` removes the other status labels, adds the target's label (`addLabelsToLabelable`, `removeLabelsFromLabelable`), then opens or closes the issue. `done` and `canceled` close the issue and remove the labels of the open categories. A category with no label fails with `NOT_SUPPORTED` and the next step `/pmkit:setup`.
   - History: a `LabeledEvent` or `UnlabeledEvent` of a status label becomes a move event.
   - Setup without a Project asks `backlog`, `in_progress`, `in_review` and `triage`, with the repository labels as candidates, the label whose name matches recommended, and `none` allowed. `todo`, `done` and `canceled` need no label.
2. **Types from labels.** The fallback follows the repository's issue types, not the Project. When the repository has no enabled issue type, `mappings.types.<type>` may name a label, written `label:<name>`. When it has issue types, values stay bare issue type names, and a `label:` value is a broken mapping.
   - Read: the issue takes the pmkit type of its type label. No type label reads no type. Several type labels read the first in the order of the config's `types` list, with a warning.
   - Write: create and update with a type remove the other type labels and add the target's label. `type: null` removes them all.
   - Setup asks one question per pmkit type, with the repository labels as candidates, the label of the same name (ignoring case) recommended, and `none` allowed. One label answers at most one type, and a label that answers a status cannot answer a type.
   - Labels that hold a status or a type stay in `issue.labels`. A labels patch keeps them and changes only the other labels, so `issues update --labels` cannot drop a status or a type.
3. **Archive.** `archive` keeps answering `NOT_SUPPORTED` without a Project, as ADR 0008 says. Only the message and the next step change: `<repo> has no Project, and GitHub has no archive for an issue outside one`, next step `Close it with pmkit issues move <id> canceled, or set tracker.scope.project with /pmkit:setup`. No new config key and no ADR change.
4. **Milestones.** No stand-in. Milestones stay pmkit milestones in every repository, and PMK-88 serves them. PMK-89 adds no milestone code. Without a Project, the repository has no epics and no sprints, and the manifest says so.
5. **Capability manifest.** The same 20 entries and the same shape; only paths and hints change, so no command changes:
   - `cycles`, `capacity`, `deliverables` and `status_update` are `absent` with the `enableHint` `Needs a GitHub Project: set tracker.scope.project with /pmkit:setup`. PMK-89 sets this only for the branch without a Project in `manifest.mjs`; PMK-88 owns the branch with a Project.
   - `native_triage` is `derived` with `detail: { source: 'label' }` when `mappings.status.triage` names a label, and otherwise `absent` with `Map a triage label with /pmkit:setup`.
   - Every other entry keeps its current rule.
   - `discover` lists each status label with its category. `capabilities --json` adds one warning that names the capabilities absent for lack of a Project.

## Design

### Mapping values

A new helper in `scripts/lib/github/mappings.mjs`, `parseLabelValue(value)`, returns the label name of a `label:<name>` value, or null. The prefix is lowercase and exact, and the name is the rest of the string, trimmed, and not empty. `githubConfigProblems` rejects `label:` with an empty name (`mappings.status.<key> must be label:<name> with a name`). It does not decide whether `label:` is allowed; the mapping check does, because that depends on what GitHub has.

`brokenGithubMappings` gains these problems:

| Value | Repository | Problem |
| --- | --- | --- |
| `mappings.status.<key>: label:<name>` | has a Project | `mappings.status.<key> names label <name>, but statuses come from the Status field of <owner/number>` |
| `mappings.status.<key>: label:<name>` | no Project, label missing | `mappings.status.<key> names label <name>, which <repo> no longer has` |
| `mappings.status.<key>: <bare name>` | no Project | `mappings.status.<key> names Status option <name>, but tracker.scope.project is none` |
| `mappings.types.<type>: label:<name>` | has issue types | `mappings.types.<type> names label <name>, but <repo> has issue types` |
| `mappings.types.<type>: label:<name>` | no issue types, label missing | `mappings.types.<type> names label <name>, which <repo> no longer has` |

Label names compare without case, as GitHub keeps them unique without case. The third row is new: today a bare status value without a Project is ignored, and after PMK-89 it is reported, so setup asks it again **(builder's call)**. `mappings.status.blocked` keeps its current meaning and is not asked without a Project **(builder's call)**.

### Labels in discovery

Discovery reads the first 100 labels and warns when there are more (PMK-86). A mapped label past the first 100 would read as broken. The repository query therefore also reads each label the config maps, by name, through one `label(name: "<name>")` alias per mapped label, and adds the ones found to `raw.labels` **(builder's call)**. The raw discovery keeps its format version, since the cache check already compares the Project, and a cached discovery that lacks a mapped label triggers the one refresh the mapping check already does.

### Context

`makeContext` gains two maps, built once per discovery:

- `statusLabels`: category to label (`{ id, name }`), from `mappings.status` without a Project.
- `typeLabels`: pmkit type to label, from `mappings.types` when the repository has no issue type.

It also exposes `categoryOfLabels(names)`, which returns the category of the status labels an issue carries, and `typeOfLabels(names)`, which returns the pmkit type. Both return a warning when several labels match.

### Reading an issue

`statusOf` keeps its closed rule. Without a Project, an open issue reads its status labels:

- no status label: `{ name: 'Open', category: 'todo' }`, as today;
- one: `{ name: <label name>, category }`;
- several: the one furthest along `triage`, `backlog`, `todo`, `in_progress`, `in_review`, with the warning `<id> has several status labels (<names>); pmkit reads <name>`. `triage` comes first in that order, since it is the earliest category **(builder's call)**.

`toIssue` reads the type from the issue type when the repository has issue types, and from the type labels otherwise. Search and get carry the warnings of the issues they return in the result's `warnings`, as other read warnings do.

### Writes

`planMove` without a Project builds label steps before the state steps:

- `removeLabels` for every status label the issue has other than the target's;
- `addLabels` for the target's label, when the category has one and the issue lacks it;
- the existing open and close steps.

`done` and `canceled` close the issue and remove the labels of the open categories. Moving to `todo` removes all status labels, unless `mappings.status.todo` names a label, which setup does not ask but a hand-written config may hold; then it adds that label **(builder's call)**. A category that is not terminal, is not `todo`, and has no label fails with `NOT_SUPPORTED`, `no label of <repo> stands for <category>`, next step `/pmkit:setup`. `moveToCategory(id, category, actor, { status })` accepts `status` only when it names the category's label (or `Open`, `Closed` and `Closed as not planned`, as today) **(builder's call)**.

`planWrite` for `type` without issue types swaps type labels the same way. A `labels` patch is applied to the labels that hold no status and no type, and the mapped labels the issue has stay. A label in the patch that holds a status or a type fails with `INVALID_INPUT`, `label <name> holds a status; use pmkit issues move` (or `holds a type; use --type`) **(builder's call)**. Create sends the type label and the labels in one `createIssue` call, and a status label is added only through `issues move`.

`archive` without a Project changes only its message and next step (decision 3).

### Search

The `categories` step already filters on the issue's read status, so it works with label statuses. The `types` step, with one type and type labels, puts the label into `filterBy.labels` instead of `filterBy.type`. When the filter also has labels, it adds a client step instead **(builder's call)**.

### History

`toEvents` replays the status labels the issue carries, in timeline order, from the `LabeledEvent` and `UnlabeledEvent` items. After each label item, it reads the status by the rule above, and it emits `{ op: 'move', field: 'status', from, to }` only when the read status name changes. A label change while the issue is closed changes nothing. A `LabeledEvent` or `UnlabeledEvent` of a status label never also yields an `update labels` event. A type label item becomes `{ op: 'update', field: 'type', from, to }` the same way. Other labels keep their `update labels` events. `ReopenedEvent` reads the status the issue reads now, as today.

### Discover

`statusesOf` without a Project lists each mapped status label with its category, then `Open`, `Closed` and `Closed as not planned`. The warning `statuses are open and closed only until PMK-89 adds the rest` goes away. When no status label is mapped, discover warns `tracker.scope.project is none and no status label is mapped; issues read open as todo and closed as done`.

### Capabilities

`buildGithubCapabilities(raw, pmkit)` takes the branch without a Project (`raw.project === null`) for the five entries in decision 5. `capabilities()` in `tracker.mjs` adds the warning `tracker.scope.project is none, so cycles, capacity, deliverables and status_update are absent`.

### Setup

`proposeGithubSetup` without a Project:

- asks `triage`, `backlog`, `in_progress` and `in_review` as label questions: candidates are the repository labels in their discovery order with the name match first (`triage`: `triage`, `needs triage`; the existing names for the others), recommended the match, else `none`; no question is `required`;
- writes the answer as `label:<name>`, and `--status <key>=<label name>` and `--status <key>=label:<name>` both mean the label;
- refuses `--status todo|done|canceled=<label>` with `INVALID_INPUT`, `<key> needs no label without a Project` **(builder's call)**;
- refuses one label for two categories, as it refuses one option for two categories today.

When the repository has no enabled issue type, setup asks one type question per pmkit type with the labels no status took, and `--type-label <type>=<label name>` writes `label:<name>`. The note `PMK-89 adds labels as a fallback` goes away. When the label list is cut at 100, each label question carries a note that the user can type another label name.

`commands/setup.md` changes its GitHub steps 4, 5 and 7: "No Project" no longer means open and closed only; step 5 names the label questions; the summary shows each category's label and each type's label.

### Files

- Changed: `scripts/lib/github/mappings.mjs`, `issues.mjs`, `writes.mjs`, `issue-ops.mjs` (archive message only), `filter.mjs`, `history.mjs`, `discovery.mjs` (`statusesOf` and the label aliases), `manifest.mjs` (the branch without a Project), `tracker.mjs` (the capabilities warning), `scripts/lib/github/adapter.mjs` (the `label:` shape check).
- Fakes: `scripts/fake-github-issues.mjs` gains `addLabelsToLabelable`, `removeLabelsFromLabelable` and the `label(name:)` read. Edits stay local, and `scripts/fake-gh.mjs` is not touched.
- Docs: `commands/setup.md`, `docs/runbooks/setup-github.md` and `docs/runbooks/issues-github.md` (a flow without a Project), `README.md`, `CHANGELOG.md`, the config schema description of `mappings.status` and `mappings.types`.
- ADR 0009, `GitHub Issues without a Project reads statuses and types from labels`. The `label:<name>` value is a config format that users will write by hand and that a later change cannot drop without a migration, so it is hard to reverse. `CONTEXT.md` gains the term **Status label**: a repository label that `mappings.status` names, on a GitHub tracker without a Project.

PMK-88 edits `manifest.mjs`, `discovery.mjs` and setup code at the same time. PMK-89 keeps each edit inside the branch without a Project, or inside new functions, so the two branches merge with small conflicts.

## Tests

Unit tests next to each changed module (`node:test`), in particular:

- `mappings.test.mjs`: `parseLabelValue`; the five broken rows; setup without a Project asks the four label questions with the name match recommended; one label for two categories and a status label as a type are refused; type questions come from labels only without issue types.
- `issues.test.mjs`: the read rule for no, one and several status labels; closed issues ignore labels; type from a type label; several type labels.
- `writes.test.mjs` or `issue-ops.test.mjs`: the move steps for each category; `done` removes the open labels; a category without a label fails; a labels patch keeps mapped labels and refuses a mapped one; a type swap.
- `history.test.mjs`: the replay rule, with an unlabel and label pair from one move giving one move event.
- `manifest.test.mjs` and `tracker.test.mjs`: the five entries and the warning without a Project; with a Project, nothing changes.
- `filter.test.mjs`: a single type filter on labels.

E2E (`scripts/cli-issues-github.test.mjs`, `scripts/runbook-issues-github.test.mjs`, and the setup runbook test) on the stateful fake GitHub: setup without a Project writes `label:` mappings; `issues move` through every category on a repository without a Project; `issues create --type bug` with a type label; `issues history` shows the moves; `capabilities --json` reports the absent entries; `archive` gives the new message.

## Out of scope

- Milestone operations (PMK-88).
- Priority, estimate and dates from labels. Without a Project and without issue fields, those roles stay `none`. Candidate follow-up.
- An archive label (decision 3).
- Creating missing labels on GitHub. Setup creates nothing on GitHub, as today.
- `mappings.status.blocked` without a Project.
