# PMK-89 GitHub Issues without a Project implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Without a Project, the GitHub tracker reads and writes statuses and types through repository labels, and the manifest reports what a Project would add.

**Architecture:** `label:<name>` values in `mappings.status` (no Project) and `mappings.types` (no issue types) are parsed in `mappings.mjs`, resolved once per discovery in `makeContext`, and used by the read (`issues.mjs`), write (`writes.mjs`, `issue-ops.mjs`), search (`filter.mjs`) and history (`history.mjs`) paths. Setup proposes the label questions; the manifest and discover report the degrade.

**Tech Stack:** Node ESM, `node:test`, no dependencies (ADR 0003). Fakes: `scripts/fake-github-api.mjs` (discovery) and `scripts/fake-github-issues.mjs` (stateful issues).

**Spec:** `docs/specs/2026-11-17-pmk-89-github-issues-without-a-project-design.md`

## Global constraints

- Every commit message carries `(PMK-89)` and ends with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- No new dependency. Tests use `node:test` and `node:assert/strict`.
- Never commit `package-lock.json`. Never touch `scripts/fake-gh.mjs`.
- Edits to `manifest.mjs`, `discovery.mjs` and setup code stay inside the branch without a Project or inside new functions (PMK-88 edits them in parallel).
- The label prefix is exactly `label:`; label names compare without case.
- Prose follows the Unslop rules: no em dashes, sentence-case headings, active voice.
- Known failures that are not ours: `github-host` "default exec throws ENOENT", `cli-pr` "pr diff local fallback of a stacked pull request" and "pr open counts only what the branch lacks", and the `validate-views` case clash.

## Review focus

- A config with a Project that still holds `label:` values from an earlier run without one: every operation must stop with `NOT_CONFIGURED` naming the path, not read labels silently. Test in Task 1.
- A label renamed on GitHub after setup: the mapping check refreshes once and then reports the path as broken. Test in Task 2 (cached discovery without the label, fresh one without it either).
- `issues update --labels a,b` on an issue in `in_review`: the status label must survive. Test in Task 4.
- An issue that a person labeled by hand with two status labels, then moved with pmkit: the move removes both others and the history shows one move. Tests in Tasks 4 and 6.
- A repository with issue types and no Project: statuses use labels, types use issue types, and a `label:` type value is broken. Test in Task 1 and Task 3.

---

### Task 1: Label values and the mapping check

**Files:**
- Modify: `scripts/lib/github/mappings.mjs` (`parseLabelValue`, `problemOf`)
- Modify: `scripts/lib/github/adapter.mjs` (`githubConfigProblems`)
- Test: `scripts/lib/github/mappings.test.mjs`, `scripts/github-host.test.mjs` or the existing `githubConfigProblems` test file (find it with `git grep -l githubConfigProblems -- '*.test.mjs'`)

**Interfaces:**
- Produces: `export function parseLabelValue(value: unknown): string | null` in `mappings.mjs`; `export const LABEL_PREFIX = 'label:'`; `export const labelOf = (raw, name) => { id, name } | null` (case-insensitive lookup in `raw.labels`).

- [ ] **Step 1: Write the failing tests** in `mappings.test.mjs`:
  - `parseLabelValue reads label:<name>`: `'label:Doing'` gives `'Doing'`; `'label: In review '` gives `'In review'`; `'label:'`, `'label:  '`, `'Label:x'`, `'Doing'`, `3` give `null`.
  - `brokenGithubMappings reports label values a Project or issue types rule out`: with a Project raw, `status.in_progress: 'label:Doing'` gives the problem `mappings.status.in_progress names label Doing, but statuses come from the Status field of acme/7`. Without a Project and a raw whose labels lack `Doing`: `mappings.status.in_progress names label Doing, which acme/widgets no longer has`. Without a Project, `status.in_progress: 'In Progress'` gives `mappings.status.in_progress names Status option In Progress, but tracker.scope.project is none`. With issue types, `types.bug: 'label:bug'` gives `mappings.types.bug names label bug, but acme/widgets has issue types`. Without issue types and no such label: `mappings.types.bug names label bug, which acme/widgets no longer has`. A label that exists under another case (`label:doing` vs `Doing`) is not broken.
  - `githubConfigProblems refuses label: with no name`: `mappings.status.backlog: 'label: '` gives `mappings.status.backlog must be label:<name> with a name`; same for `mappings.types.bug`.
- [ ] **Step 2: Run** `node --test scripts/lib/github/mappings.test.mjs`. Expected: FAIL (`parseLabelValue` is not exported).
- [ ] **Step 3: Implement** `parseLabelValue`, `labelOf`, the five problems in `problemOf` (status and types groups), and the shape rule in `githubConfigProblems`. A value that starts with `label:` but has an empty name is a config problem, not a broken mapping.
- [ ] **Step 4: Run** the two test files. Expected: PASS. Then `node --test scripts/lib/github/*.test.mjs`. Expected: PASS (fixtures with a Project and bare names are unchanged).
- [ ] **Step 5: Commit** `feat: read label:<name> values in the GitHub mappings and report the ones a Project or issue types rule out (PMK-89)`.

### Task 2: Discovery reads mapped labels and lists label statuses

**Files:**
- Modify: `scripts/lib/github/discovery.mjs` (repository query, `statusesOf` branch without a Project)
- Modify: `scripts/fake-github-api.mjs` (answer `label(name:)` aliases)
- Test: `scripts/lib/github/discovery.test.mjs`, `scripts/lib/github/tracker.test.mjs`

**Interfaces:**
- Consumes: `parseLabelValue` (Task 1).
- Produces: `fetchDiscovery(client, { ..., labels?: string[] })`: the label names to read by name. The tracker passes the names of every `label:` value of `mappings.status` and `mappings.types`. Found labels are merged into `raw.labels` without duplicates (case-insensitive).

- [ ] **Step 1: Write the failing tests:**
  - `fetchDiscovery reads mapped labels past the first page`: a fixture with 120 labels and `labels: ['Label 115']` yields a `raw.labels` holding `Label 115`; the request carries one alias `l0: label(name: "Label 115") { id name }`.
  - `discover without a Project lists status labels`: config `status: { in_progress: 'label:Doing', in_review: 'label:Review' }`, labels `Doing`, `Review`: `statuses` equals `[{ name: 'Doing', category: 'in_progress' }, { name: 'Review', category: 'in_review' }, { name: 'Open', category: 'todo' }, { name: 'Closed', category: 'done' }, { name: 'Closed as not planned', category: 'canceled' }]`, and no warning mentions PMK-89.
  - `discover without a Project and no status label warns once`: the warning `tracker.scope.project is none and no status label is mapped; issues read open as todo and closed as done`.
  - In `tracker.test.mjs`, `a mapped label missing from a cached discovery refreshes once, then reports the broken path`.
- [ ] **Step 2: Run** `node --test scripts/lib/github/discovery.test.mjs scripts/lib/github/tracker.test.mjs`. Expected: FAIL.
- [ ] **Step 3: Implement.** Label names go into the query as GraphQL string literals through `JSON.stringify`, never by concatenation. `createGithubTracker.fetchFresh` passes `labels`. `statusesOf` without a Project builds the label rows from `mappings.status` (order: `triage`, `backlog`, `todo`, `in_progress`, `in_review`), skipping `none`.
- [ ] **Step 4: Run** the same tests, then `node --test scripts/lib/github/*.test.mjs`. Expected: PASS.
- [ ] **Step 5: Commit** `feat: read mapped labels by name and list label statuses in GitHub discover (PMK-89)`.

### Task 3: The context and the read rule

**Files:**
- Modify: `scripts/lib/github/issues.mjs` (`makeContext`, `statusOf`, `toIssue`)
- Modify: `scripts/lib/github/issue-ops.mjs` (`searchIssues` result warnings)
- Test: `scripts/lib/github/issues.test.mjs`, `scripts/lib/github/issue-ops.test.mjs`

**Interfaces:**
- Consumes: `parseLabelValue`, `labelOf` (Task 1).
- Produces on the context:
  - `statusLabels: Map<category, { id, name }>` (empty with a Project);
  - `typeLabels: Map<pmkitType, { id, name }>` (empty when the repository has issue types);
  - `mappedLabelIds: Set<string>` (ids of every status and type label);
  - `readLabels(names: string[]) => { status: { name, category } | null, type: string | undefined, warnings: string[] }`.
- `READ_ORDER = ['triage', 'backlog', 'todo', 'in_progress', 'in_review']` exported from `issues.mjs`.
- `toIssueWithWarnings(node, context) => { issue, warnings }`; `toIssue` stays and returns `.issue`.

- [ ] **Step 1: Write the failing tests** in `issues.test.mjs`:
  - `status rule with status labels`: no Project, map `in_progress: 'label:Doing', in_review: 'label:Review'`. Open with no label: `{ name: 'Open', category: 'todo' }`. Open with `doing` (other case): `{ name: 'Doing', category: 'in_progress' }`. Open with `Doing` and `Review`: `in_review`, and the warning `12 has several status labels (Doing, Review); pmkit reads Review`. Closed with `Review`: `{ name: 'Closed', category: 'done' }`.
  - `a Project ignores label values`: the same labels with a Project read the option rule.
  - `type from a type label`: no issue types, `types: { bug: 'label:bug', feature: 'label:enhancement' }`; an issue with `bug` reads `type: 'bug'`; one with `enhancement` and `bug` reads the first in the config's `types` list (`['feature','bug',...]`), so `feature`, with a warning; with issue types, the label is ignored and `issueType` wins.
  - `status and type labels stay in issue.labels`.
  - In `issue-ops.test.mjs`: `searchIssues carries the several-label warnings` in `result.warnings`; the key is absent when there are none.
- [ ] **Step 2: Run** the two files. Expected: FAIL.
- [ ] **Step 3: Implement.** `getIssue` returns the issue only, as the contract says; only `searchIssues` returns `warnings` **(plan call: the contract's getIssue has no warning channel)**.
- [ ] **Step 4: Run** the two files, then `node --test scripts/lib/github/*.test.mjs`. Expected: PASS.
- [ ] **Step 5: Commit** `feat: read GitHub statuses and types from labels without a Project or issue types (PMK-89)`.

### Task 4: Writes: moves, types, labels patches and archive

**Files:**
- Modify: `scripts/lib/github/writes.mjs` (`pickOption`, `planMove`, `planWrite`, `planLabels`, `issueTypeId`, `PREVIEW_STEP`)
- Modify: `scripts/lib/github/issue-ops.mjs` (`moveStep` for `addLabels` and `removeLabels`; `archive` message)
- Modify: `scripts/lib/github/documents.mjs` (`ADD_LABELS`, `REMOVE_LABELS` mutations)
- Modify: `scripts/fake-github-issues.mjs` (`addLabelsToLabelable`, `removeLabelsFromLabelable` routes; reuse `setLabels` so events are recorded)
- Test: `scripts/lib/github/writes.test.mjs`, `scripts/lib/github/issue-ops.test.mjs`, `scripts/fake-github-issues.test.mjs`

**Interfaces:**
- Consumes: the context of Task 3.
- Produces: move steps `{ op: 'removeLabels', labelIds: string[], names: string[] }` and `{ op: 'addLabels', labelIds, names }`, run before `reopen` and `close`.

- [ ] **Step 1: Write the failing tests** in `writes.test.mjs`:
  - `planMove without a Project moves through status labels`: map `backlog: label:Backlog, in_progress: label:Doing, in_review: label:Review`. An open issue with `Doing` to `in_review`: steps `removeLabels [Doing]`, `addLabels [Review]`, after reads `in_review`. To `done`: `removeLabels [Doing]`, `close COMPLETED`. To `todo`: `removeLabels [Doing]`, no state step. A closed issue with no label to `backlog`: `addLabels [Backlog]`, `reopen`. With `Doing` and `Review` to `backlog`: one `removeLabels [Doing, Review]` then `addLabels [Backlog]`.
  - `planMove without a label for the category fails`: `triage` unmapped gives `NOT_SUPPORTED`, `no label of acme/widgets stands for triage`, next step `/pmkit:setup`.
  - `planMove takes --status as the category label or a state status`: `status: 'Doing'` for `in_progress` works; `status: 'Review'` for `in_progress` gives `INVALID_INPUT`.
  - `mappings.status.todo as a label adds it on a move to todo`.
  - `planWrite swaps type labels`: no issue types, type `bug` on an issue with `enhancement` gives a `labelIds` without `enhancement` and with `bug`; `type: null` drops both; create with `type: 'bug'` sends `labelIds` with `bug`.
  - `a labels patch keeps mapped labels and refuses them`: issue with `Doing` and `x`, patch `labels: ['y']` gives `labelIds` `[Doing, y]`; patch `labels: ['Doing']` gives `INVALID_INPUT` `label Doing holds a status; use pmkit issues move`; a type label gives `... holds a type; use --type`.
  - In `issue-ops.test.mjs`: `archive without a Project names the repository and the move`: `NOT_SUPPORTED`, message `acme/widgets has no Project, and GitHub has no archive for an issue outside one`, next step `Close it with pmkit issues move 12 canceled, or set tracker.scope.project with /pmkit:setup`. And `moveToCategory sends addLabelsToLabelable and removeLabelsFromLabelable` against the stateful fake, with the issue reading `in_review` after.
- [ ] **Step 2: Run** the three files. Expected: FAIL.
- [ ] **Step 3: Implement.** On create, `labelIds` is the type label plus the patch labels; a status label never goes in on create. On update, `labelIds` is sent only when the set changes.
- [ ] **Step 4: Run** the three files, then `node --test scripts/lib/github/*.test.mjs scripts/fake-github-issues.test.mjs`. Expected: PASS.
- [ ] **Step 5: Commit** `feat: move GitHub issues through status labels and swap type labels without a Project (PMK-89)`.

### Task 5: Search by type label

**Files:**
- Modify: `scripts/lib/github/filter.mjs` (`types` handler)
- Test: `scripts/lib/github/filter.test.mjs`

- [ ] **Step 1: Write the failing tests:** `a single type with type labels filters by label on GitHub`: `filterBy.labels` is `['bug']`, `filterBy.type` absent. `a type and labels together filter on the client`: `filterBy.labels` holds only the label filter, and a client step keeps `issue.type === 'bug'`.
- [ ] **Step 2: Run** `node --test scripts/lib/github/filter.test.mjs`. Expected: FAIL.
- [ ] **Step 3: Implement** with `context.typeLabels`.
- [ ] **Step 4: Run** it again. Expected: PASS.
- [ ] **Step 5: Commit** `feat: filter GitHub search by type label (PMK-89)`.

### Task 6: History replays status and type labels

**Files:**
- Modify: `scripts/lib/github/history.mjs` (`toEvents`)
- Test: `scripts/lib/github/history.test.mjs`

- [ ] **Step 1: Write the failing tests:**
  - `status label items become moves when the read status changes`: timeline `LabeledEvent Doing`, then `UnlabeledEvent Doing` and `LabeledEvent Review` at the same second gives moves `Open -> Doing` and `Doing -> Review`, and no `update labels` event for either label.
  - `a second status label further back changes nothing`: `Review` present, `LabeledEvent Backlog` gives no event.
  - `label items while closed give no move`.
  - `removing the last status label moves to Open`.
  - `type label items become type updates`: `LabeledEvent bug` gives `{ op: 'update', field: 'type', from: null, to: 'bug' }`.
  - `other labels keep update labels events`.
- [ ] **Step 2: Run** `node --test scripts/lib/github/history.test.mjs`. Expected: FAIL.
- [ ] **Step 3: Implement** the replay: walk items in timeline order with a label set and a closed flag (from `ClosedEvent` and `ReopenedEvent`); after each status label item, read the status with `context.readLabels` and emit a move when the name differs from the last one read.
- [ ] **Step 4: Run** it, then `node --test scripts/lib/github/history-ops.test.mjs`. Expected: PASS.
- [ ] **Step 5: Commit** `feat: turn GitHub status and type label events into moves and type updates (PMK-89)`.

### Task 7: The manifest without a Project

**Files:**
- Modify: `scripts/lib/github/manifest.mjs`, `scripts/lib/github/tracker.mjs` (`capabilities` warning)
- Test: `scripts/lib/github/manifest.test.mjs`, `scripts/lib/github/tracker.test.mjs`

- [ ] **Step 1: Write the failing tests:**
  - `without a Project, Project-only capabilities are absent with the Project hint`: `cycles`, `capacity`, `deliverables`, `status_update` each `{ path: 'absent', enableHint: 'Needs a GitHub Project: set tracker.scope.project with /pmkit:setup' }`.
  - `a triage label makes native_triage derived`: `{ path: 'derived', detail: { source: 'label' } }`; without one, `{ path: 'absent', enableHint: 'Map a triage label with /pmkit:setup' }`.
  - `with a Project nothing changes`: the existing expectations hold.
  - In `tracker.test.mjs`: `capabilities() without a Project warns` `tracker.scope.project is none, so cycles, capacity, deliverables and status_update are absent`.
- [ ] **Step 2: Run** both files. Expected: FAIL.
- [ ] **Step 3: Implement** inside one `if (raw.project === null)` block in `buildGithubCapabilities`.
- [ ] **Step 4: Run** both files. Expected: PASS.
- [ ] **Step 5: Commit** `feat: report what a GitHub Project would add in the manifest (PMK-89)`.

### Task 8: Setup asks label questions

**Files:**
- Modify: `scripts/lib/github/mappings.mjs` (`proposeGithubSetup`, new `statusLabelValue`, `typeLabelValue`)
- Modify: `scripts/pmkit.mjs` only if `parseMappingFlags` rejects `label:` (check first)
- Test: `scripts/lib/github/mappings.test.mjs`, `scripts/cli-github-init.test.mjs`

**Interfaces:**
- Consumes: `parseLabelValue`, `labelOf` (Task 1).
- Produces: `LABEL_STATUS_KEYS = ['triage', 'backlog', 'in_progress', 'in_review']`; name matches add `triage: ['triage', 'needs triage']`.

- [ ] **Step 1: Write the failing tests:**
  - `setup without a Project asks the four status label questions`: paths `mappings.status.triage|backlog|in_progress|in_review`, candidates the labels with the match first, `recommended` the match or `none`, no `required`.
  - `--status in_progress=Doing and =label:Doing both write label:Doing`; an unknown label gives `INVALID_INPUT` listing the labels and `none`.
  - `--status todo=Doing without a Project is refused`: `todo needs no label without a Project`.
  - `one label cannot answer two categories`.
  - `without issue types, type questions offer the labels no status took`, `--type-label bug=bug` writes `label:bug`, and the PMK-89 note is gone.
  - `with a Project and issue types nothing changes` (existing tests hold).
  - In `cli-github-init.test.mjs`: `init --project none --status in_progress=Doing --type-label bug=bug --dry-run --json` shows `label:Doing` and `label:bug` in the config.
- [ ] **Step 2: Run** both files. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** both files. Expected: PASS.
- [ ] **Step 5: Commit** `feat: ask status and type labels in GitHub setup without a Project (PMK-89)`.

### Task 9: ADR, glossary, docs and runbooks

**Files:**
- Create: `docs/adr/0009-github-issues-without-a-project-reads-statuses-and-types-from-labels.md` (renumber if PMK-88 takes 0009 first)
- Create: `scripts/adr-github-labels.test.mjs`
- Modify: `CONTEXT.md` (**Status label**), `commands/setup.md` (GitHub steps 4, 5, 7, 9), `README.md`, `CHANGELOG.md`, `schemas/pmkit.config.schema.json` (descriptions of `mappings.status` and `mappings.types`)
- Modify: `docs/runbooks/setup-github.md`, `docs/runbooks/issues-github.md` (a flow without a Project) and their tests `scripts/runbook-setup-github.test.mjs`, `scripts/runbook-issues-github.test.mjs`; `scripts/cli-issues-github.test.mjs`

- [ ] **Step 1: Write the failing tests:**
  - `adr-github-labels.test.mjs`: the ADR exists with a title, `## Status`, `## Considered options`, `## Consequences`; it names `label:<name>`, `addLabelsToLabelable`, `removeLabelsFromLabelable`, `NOT_CONFIGURED`; `CONTEXT.md` defines **Status label**.
  - Runbook tests: setup without a Project writes `label:` mappings; `issues move` from `todo` through `in_progress`, `in_review`, `done`; `issues create --type bug`; `issues history` shows the moves; `capabilities --json` shows the four absent entries and the warning; `issues archive` gives the new message.
- [ ] **Step 2: Run** `node --test scripts/adr-github-labels.test.mjs scripts/runbook-setup-github.test.mjs scripts/runbook-issues-github.test.mjs scripts/cli-issues-github.test.mjs`. Expected: FAIL.
- [ ] **Step 3: Write** the ADR (options: labels chosen; Project required rejected; issue fields rejected), the term, the doc changes and the runbook steps. Remove every "until PMK-89" line.
- [ ] **Step 4: Run** the same tests. Expected: PASS. Then `npm test`. Expected: only the known failures.
- [ ] **Step 5: Commit** `docs: record ADR 0009, the Status label term and the runbooks for GitHub without a Project (PMK-89)`.
