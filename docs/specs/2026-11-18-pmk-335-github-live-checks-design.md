# PMK-335 design: live checks of the GitHub adapter

Issue PMK-335, epic EPC-8 (GitHub Issues tracker adapter), milestone `github-issues`. Status: approved by the user on 2026-11-18, with the `PmkitDraftProject` fix in scope. The user answered four questions before the approval and widened the scope twice after it; "Decisions from the user" records every answer. Calls marked **(builder's call)** were made while writing this spec and change no acceptance criterion.

## Problem

The GitHub client's error mapping, `discover`, adding a sprint iteration and converting draft issues are tested only against an injected runner and the fake `gh`. Nothing checks them against GitHub itself. PMK-88 relies on the schema description alone for `openCycle` keeping each item's iteration, and PMK-91 checked the draft conversion only against the published GHES schema.

Acceptance criteria:

1. A `PMKIT_LIVE` check runs the GitHub client against github.com and confirms the error shapes.
2. A `PMKIT_LIVE` check runs `discover` against a github.com repository with a Project.
3. A `PMKIT_LIVE` check confirms that `openCycle` keeps item iteration assignments on a throwaway Project.
4. A `PMKIT_LIVE` check converts a draft issue on GHES 3.19, skipped with a note when no GHES host is configured.

The user's rule for this issue: build the checks, but nobody runs them during the work. No call reaches api.github.com or a GHES host from this branch. The user runs them later against an account and repository of their choice. The work proves the gating, the skip messages and the check logic with ordinary tests, and validates every GraphQL document the checks send against GitHub's published schemas.

## Decisions already made

- pmkit reaches GitHub through `gh api graphql` with the user's `gh` login and holds no token (ADR 0007). The client maps errors to `AUTH`, `RATE_LIMITED`, `NOT_FOUND` and `UPSTREAM`, retries a query but never a mutation, and passes the host as `--hostname`.
- The minimum GHES version is 3.19 (ADR 0007). `openCycle` is native on github.com and refuses GHES, because the GHES schemas have no iteration `id` input (ADR 0010, PMK-88).
- The Linear live checks set the pattern: a file whose name does not end in `.test.mjs`, so `npm test` never loads it; `PMKIT_LIVE=1` plus named variables open the gate; every test is skipped with one reason when the gate is closed; a guard refuses any write the check did not plan; no secret appears in output (`scripts/lib/linear/client-live.mjs`, `contract-live.mjs`, `sandbox.mjs`, ADR 0005). `scripts/run-tests.mjs` already strips `PMKIT_LIVE` from the test child.
- No new dependency (ADR 0003). Tests use `node:test`.

## Decisions from the user

1. **The throwaway Project.** The user creates it once and names it in a variable: `PMKIT_LIVE_GITHUB_PROJECT` on github.com and `PMKIT_LIVE_GHES_PROJECT` on GHES. A check refuses a Project whose title does not start with `pmkit-live`, and refuses one that holds any item. It adds its own draft items and removes them afterwards, and it restores the iteration list it changed. It never creates or deletes a Project.
2. **The missing `project` scope.** An optional variable, `PMKIT_LIVE_GITHUB_SCOPELESS_TOKEN`, holds a classic personal access token with the `repo` scope and without `project`. The check passes it to `gh` as `GH_TOKEN` for one read of the Project and expects `AUTH` with the next step `gh auth refresh -s project`. Without the variable, that one test is skipped with a note that names it. The token never appears in output, arguments, error text or `details`. The other error shapes need no extra secret.
3. **The converted GHES issue.** The check deletes it with pmkit's `PmkitDeleteIssue`. When GitHub refuses (only repository admins may delete issues), it closes the issue as not planned with `PmkitCloseIssue` and prints its number and URL, and the runbook says to delete it by hand. The Project item is always removed.
4. **Document validation.** A one-off check outside the repository: GitHub's published schemas, downloaded unauthenticated from the public `github/docs` repository, and graphql-js installed in a scratch folder, never in the repository. This spec records the result per document and per schema. No introspection call.
5. **Both schema findings are fixed here** (after the approval). `PmkitDraftProject` reads through `... on ProjectV2Owner`, and the issue fragment aliases the two issue field values as `numberValue: value` and `dateValue: value`, with every reader updated. The fake GitHub refuses both invalid forms, as PMK-88 made it refuse `owner { login }`, and tests fail without the fixes. The validation covers every GraphQL document of `scripts/lib/github/`, not only the ones the checks send.
6. **The GHES findings of the full validation** (after the approval). (a) The Project read sends `isIssueField` and the `ProjectV2MultiSelectField` fragment only on github.com and GHE.com, since no GHES schema has either. (b) pmkit asks GHES for issue fields from 3.22, not 3.21: one constant, with ADR 0007 amended by a dated note; Status change events stay at 3.21. The fake GitHub encodes both schema facts on its own, apart from `hostFeatures`.

## Facts checked

GitHub's published schemas from `github/docs` (`src/graphql/data/fpt/schema.docs.graphql` for github.com, `src/graphql/data/ghes-3.19/schema.docs-enterprise.graphql` for GHES 3.19), downloaded on 2026-11-18 and validated with graphql-js 16:

- `addProjectV2DraftIssue(input: { projectId, title, body, assigneeIds })` returns `{ projectItem }` on both.
- `ProjectV2Item.fieldValueByName(name:)` and `ProjectV2ItemFieldIterationValue { iterationId title startDate }` exist on both.
- `RepositoryOwner` has no `projectV2` field. Only `ProjectV2Owner` (`User`, `Organization`) has one, so a read must go through `... on ProjectV2Owner`, as `PmkitProject` in `discovery.mjs` does.

Two existing documents fail the validation of the documents the checks send. Neither was ever sent to GitHub by a test:

- `PmkitDraftProject` (`scripts/lib/github/draft-issues.mjs`) selects `repositoryOwner { projectV2 }` without the fragment. Both schemas reject it, so `github draft-issues list` and `convert` would fail on GitHub with "GitHub rejected pmkit's query". The GHES check sends this document, so this issue fixes it (see "Design").
- `PmkitIssue`, `PmkitIssues` and the issue mutations that return an issue select `value` on both `IssueFieldNumberValue` (`Float!`) and `IssueFieldDateValue` (`String!`) in one selection. graphql-js rejects that ("Fields value conflict because they return conflicting types"). graphql-ruby, which GitHub runs, has the same rule (`FieldsWillMerge`), so github.com very likely rejects these documents whenever the host has issue fields. Decision 5 fixes it with aliases.

The validation of every document per host (decision 5) found two more, on GHES only (decision 6). The GHES 3.20, 3.21 and 3.22 schemas were downloaded the same way:

- `PmkitProject` fails on every GHES schema: no GHES schema has the type `ProjectV2MultiSelectField`, and from 3.21, where pmkit asked for it, none has `isIssueField` either. `discover` failed on any GHES host with a Project.
- `PmkitRepo` fails on GHES 3.21: the 3.21 schema has `Issue.issueFieldValues` and `setIssueFieldValue`, but `Repository.issueFields` and `IssueFieldMultiSelect` first appear in 3.22.

One fact did not lead to a change: `ProjectV2ItemStatusChangedEvent` is already in the GHES 3.20 schema, while pmkit reads Status events from 3.21. pmkit only misses those events on 3.20; it is a follow-up candidate.

The list of every document the checks send, each validated against both schemas, goes into "Validation of the documents" once the checks exist. It is collected by running each check against the stateful fake GitHub and recording the documents it sends.

## Approaches

- A. One opt-in `node --test` entry, `scripts/lib/github/client-live.mjs`, over a module of check functions, `scripts/lib/github/live-checks.mjs`, that take an injected `exec`. Chosen. It matches the Linear `client-live.mjs`, and the injected `exec` lets ordinary tests drive every check against the stateful fake GitHub.
- B. Live tests inside the `.test.mjs` files, skipped without `PMKIT_LIVE`. Rejected. `npm test` would load files that can reach GitHub, and `run-tests.mjs` strips `PMKIT_LIVE` only by convention.
- C. A script outside `node:test` that prints a report, like `verify-api.mjs`. Rejected. The criteria ask for checks with pass or fail, and `node --test` gives a skip reason per test.

## Design

### Files

- `scripts/lib/github/live-checks.mjs`: the targets read from the environment, the skip reasons, the write guard, the preflight of a throwaway Project, the new documents and the four checks. Each check takes `{ env, exec, write }` and returns what it asserted.
- `scripts/lib/github/client-live.mjs`: the `node --test` entry. Four groups, one per criterion, each skipped with its reason. `npm test` does not load it (the name does not end in `.test.mjs`).
- `scripts/lib/github/live-checks.test.mjs`: unit tests of the gate, the guard, the preflight and each check against the stateful fake GitHub.
- `docs/runbooks/live-checks-github.md` and `scripts/runbook-live-checks-github.test.mjs`: how the user prepares, runs and cleans up, and its E2E test, which runs the entry as a subprocess with a fake `gh` first on `PATH`.
- `scripts/fake-github-drafts.mjs`: routes for the check's new documents (additive). `scripts/fake-gh-live.mjs`: the fake `gh` of the checks, over two fake GitHubs, that answers a logged-out `gh`, a rejected token and a scopeless token.
- `scripts/lib/github/draft-issues.mjs`: `PmkitDraftProject` gains `... on ProjectV2Owner`.
- `scripts/lib/github/documents.mjs`, `issues.mjs`, `writes.mjs`: the aliased issue field values. `scripts/lib/github/discovery.mjs`: the Project read per host and the 3.22 threshold. `scripts/fake-github-issues.mjs`: the schema rules. `docs/adr/0007-...`: the dated amendment.

### Variables

| Variable | Needed by | Value |
|---|---|---|
| `PMKIT_LIVE` | every check | `1` |
| `PMKIT_LIVE_GITHUB_REPO` | discover, openCycle | `owner/name` on github.com |
| `PMKIT_LIVE_GITHUB_PROJECT` | discover, openCycle | `owner/number`, a Project linked to the repository, title starting with `pmkit-live`, no item, with an iteration field |
| `PMKIT_LIVE_GITHUB_SCOPELESS_TOKEN` | the scope test only | a classic token with `repo` and without `project` |
| `PMKIT_LIVE_GHES_HOST` | the GHES check | the GHES host name, such as `github.example.com` |
| `PMKIT_LIVE_GHES_REPO` | the GHES check | `owner/name` on that host, a throwaway repository with issues turned on |
| `PMKIT_LIVE_GHES_PROJECT` | the GHES check | `owner/number` on that host, same rules as the github.com Project |

The `gh` login for github.com and for the GHES host (`gh auth login -h <host>`) must have the `project` scope. A value of the wrong form (`owner/name`, `owner/number`, a host name) is a skip reason that names the variable, so a typo never reaches GitHub **(builder's call)**.

Skip reasons, the first that applies:

- Every group: `set PMKIT_LIVE=1 to run the live check`.
- discover and openCycle: `set PMKIT_LIVE_GITHUB_REPO to owner/name of a github.com repository`, then `set PMKIT_LIVE_GITHUB_PROJECT to owner/number of a throwaway Project whose title starts with pmkit-live`.
- The scope test: `set PMKIT_LIVE_GITHUB_SCOPELESS_TOKEN to a classic token without the project scope to check the missing-scope error`.
- GHES: `no GHES host configured: set PMKIT_LIVE_GHES_HOST, PMKIT_LIVE_GHES_REPO and PMKIT_LIVE_GHES_PROJECT to convert a draft on GHES`, then the reason of the first missing one of the other two.

### The write guard

Every check runs `gh` through a guard over `exec` **(builder's call)**. A read-only group (error shapes, discover) refuses any GraphQL mutation and any REST call other than `GET`. A writing group allows only its own mutation names, and only with the `projectId` that the preflight checked: openCycle allows `PmkitLiveAddDraft`, `PmkitSetProjectField`, `PmkitDeleteProjectItem` and `PmkitUpdateIterations` (only for the iteration field it read); the GHES check allows `PmkitLiveAddDraft`, `PmkitConvertDraftItem`, `PmkitDeleteProjectItem`, `PmkitDeleteIssue` and `PmkitCloseIssue` (only for the issue it converted). A refused call throws before `gh` runs and fails the test.

### The preflight of a throwaway Project

`PmkitLiveProject` reads `repositoryOwner(login) { ... on ProjectV2Owner { projectV2(number) { id title items(first: 1) { totalCount } } } }`. The check stops, with nothing written, when the Project does not exist, when its title does not start with `pmkit-live`, or when `totalCount` is not 0. The message names the variable and the fix, such as `the Project acme/9 holds 3 items; empty it, or name another Project in PMKIT_LIVE_GITHUB_PROJECT`.

### Criterion 1: the error shapes (github.com)

Each test builds a client with `createGithubClient` over the guarded `exec` and an `env` the test controls. No Project, repository or write is needed.

- No login: `env` without `GH_TOKEN`, `GITHUB_TOKEN`, `GH_ENTERPRISE_TOKEN` and `GITHUB_ENTERPRISE_TOKEN`, and `GH_CONFIG_DIR` set to a new empty folder. `gh` answers before it calls GitHub. Expect `AUTH`, `GitHub CLI is not logged in`, next step `gh auth login`.
- A rejected token: `GH_TOKEN` set to a made-up `ghp_` value. GitHub answers HTTP 401. Expect `AUTH`, `GitHub rejected the token of the gh login`.
- Not found: `repository(owner, name)` for an owner name that GitHub cannot have (`pmkit-live-no-such-owner-<random>`). Expect `NOT_FOUND` and `details.github.errors[0].type` `NOT_FOUND`.
- Rate limit headers: one `viewer { login }` query with the user's login, then `client.rateLimit()` has a number `limit`, `remaining` and `used`, `resource` `graphql`, and an ISO `resetAt`. The check never drains the limit.
- Missing scope (optional): `viewer { projectsV2(first: 1) { totalCount } }` with `GH_TOKEN` set to `PMKIT_LIVE_GITHUB_SCOPELESS_TOKEN`. Expect `AUTH` with the next step `gh auth refresh -s project`, and the token in no message, next step or `details`. Reading the viewer's Projects needs no Project variable **(builder's call)**.

### Criterion 2: discover (github.com)

`createGithubTracker` with `tracker.scope` `{ host: 'github.com', repo, project }`, `mappings.fields.sprint` unset, and `PMKIT_HOME` in a temporary folder the check removes. `HOME` and `XDG_CONFIG_HOME` stay, because `gh` reads its login from them **(builder's call)**. `discover({ refresh: true })` must return the view keys of `discoveryView`, a Status field with at least one option, the issue types and issue fields as arrays, and the Project's fields with at least one iteration field. `capabilities()` must build the manifest with no error. The test prints counts only, never a name, as the Linear checks do. Read-only.

### Criterion 3: openCycle keeps item iterations (github.com)

1. The preflight of the Project. Then `fetchProject` finds the first iteration field **(builder's call)**; none, or one with no iteration, stops the check with a message that says to add one.
2. Read the field's configuration with `ITERATION_FIELD_QUERY` and keep it, ids included.
3. For each iteration, completed and current, up to 6 **(builder's call)**: add a draft item (`PmkitLiveAddDraft`, title `pmkit-live openCycle check <n>`) and set its iteration (`PmkitSetProjectField`, `value: { iterationId }`).
4. Run `openCycle` through `createGithubTracker` with `mappings.fields.sprint: project:<field name>`, the viewer as actor, a start the day after the last iteration ends and the name `pmkit-live <start>`.
5. Read every item with `PmkitLiveItems` (`fieldValueByName(name: <field>)`). Each item must still hold the iteration id it had, and the field must list the new iteration.
6. Cleanup, in a `finally` that runs after any failure: delete each draft item (`PmkitDeleteProjectItem`), then send the kept configuration back with `PmkitUpdateIterations`, every iteration with its id, so the added iteration goes. A cleanup step that fails does not stop the others, and the check prints what is left and the runbook's cleanup section.

### Criterion 4: converting a draft on GHES

1. `checkGhesVersion` reads `gh api meta` on the host and the check prints the version. A host below 3.19 fails, as `discover` does. A note says when the host is not 3.19 exactly, since the criterion names 3.19.
2. The preflight of `PMKIT_LIVE_GHES_PROJECT` on the host.
3. Add one draft (`PmkitLiveAddDraft`, title `pmkit-live conversion check`, body `Created by the pmkit live checks. Safe to delete.`).
4. `draftIssueOperations({ client, scope: { host, repo, project } }).convert([item])`, first as a dry run, then for real. Expect one converted issue with a number and a URL on the host, and `PmkitDraftItem` reads the same item as type `ISSUE`. `PmkitLiveIssue` reads the issue's node id by its number, which the delete needs **(builder's call)**.
5. Cleanup in a `finally`: delete the Project item, then `PmkitDeleteIssue`. When GitHub refuses the delete, `PmkitCloseIssue` with `stateReason: NOT_PLANNED`, and print the issue number and URL to delete by hand.

### What the checks print

Counts, ids GitHub made for the check's own drafts, the GHES version and the issue number and URL of the GHES check. Never a token, a name read from the user's repository, or a body. Every error is a `PmkitError` whose text and `details` are checked for the scopeless token before the test reports it.

### How the work proves the checks without GitHub

- Unit tests (`live-checks.test.mjs`): each skip reason, the guard's refusals, the preflight refusals (no marker, items present), each check passing against the stateful fake GitHub through `exec`, the openCycle cleanup restoring the configuration and leaving the Project empty after a failure in the middle, the GHES fallback from delete to close, and the scopeless token absent from every output.
- The runbook's E2E test spawns `node --test scripts/lib/github/client-live.mjs` three times: without `PMKIT_LIVE` (every group skipped with its reason, exit 0), with the github.com variables only (three groups pass against a fake `gh` on `PATH`, the GHES group skipped with its note), and with the GHES variables too (all pass). The fake `gh` wrapper of that test answers the no-login and rejected-token cases from the environment it receives, and delegates every other call to the stateful fake.
- `npm test` stays at 0 failures and never loads `client-live.mjs`.

## Validation of the documents

Run on 2026-11-18 after the fixes, over every GraphQL document of `scripts/lib/github/`, the live checks' own included. Method, outside the repository: the schemas `fpt/schema.docs.graphql` and `ghes-3.19` to `ghes-3.22/schema.docs-enterprise.graphql` of the public `github/docs` repository, fetched without a login, and graphql-js 16 in a scratch folder. Each document is built per host as the code builds it (`hostFeatures`, `issueDocuments` with and without every Project field alias, `repoQuery`, `projectQuery`, the epic reads over the host's issue fragment) and validated against that host's schema; the documents that do not depend on the host are validated against all five. To catch a document no export builds, the GitHub unit, CLI and runbook tests ran with every document the fake `gh` received logged (1,815 tests). The documents tests send in a broken form on purpose (`query PmkitRepo { x }`, the `owner { login }`, bare `projectV2` and bare `value` forms of the fake's guard tests, and `PmkitNope`) are left out; each one appears only in a `.test.mjs` file.

Result: 68 documents, 0 failures. "not sent" marks a host the code never sends the document to: `relatesTo` exists only on github.com, and `setIssueFieldValue` is sent from GHES 3.22.

Before the fixes, these failed: the `value` conflict (`PmkitIssue`, `PmkitIssues`, `PmkitIssueNodes`, `PmkitEpicItems` and the four mutations that return an issue, on github.com, GHES 3.21 and 3.22), `PmkitDraftProject` (every host), `PmkitProject` (every GHES) and `PmkitRepo` (GHES 3.21).

| Document | github.com (fpt) | GHES 3.19 | GHES 3.20 | GHES 3.21 | GHES 3.22 |
|---|---|---|---|---|---|
| `PmkitAddBlockedBy` | ok | ok | ok | ok | ok |
| `PmkitAddComment` | ok | ok | ok | ok | ok |
| `PmkitAddDiscussionComment` | ok | ok | ok | ok | ok |
| `PmkitAddLabels` | ok | ok | ok | ok | ok |
| `PmkitAddProjectItem` | ok | ok | ok | ok | ok |
| `PmkitAddRelatesTo` | ok | not sent | not sent | not sent | not sent |
| `PmkitAddSubIssue` | ok | ok | ok | ok | ok |
| `PmkitArchiveItem` | ok | ok | ok | ok | ok |
| `PmkitAssignableUsers` | ok | ok | ok | ok | ok |
| `PmkitBranchHead` | ok | ok | ok | ok | ok |
| `PmkitClearProjectField` | ok | ok | ok | ok | ok |
| `PmkitCloseIssue` | ok | ok | ok | ok | ok |
| `PmkitComments` | ok | ok | ok | ok | ok |
| `PmkitConvertDraftItem` | ok | ok | ok | ok | ok |
| `PmkitCreateIssue` | ok | ok | ok | ok | ok |
| `PmkitCreateLinkedBranch` | ok | ok | ok | ok | ok |
| `PmkitCreateProject` | ok | ok | ok | ok | ok |
| `PmkitCreateStatusUpdate` | ok | ok | ok | ok | ok |
| `PmkitDeleteIssue` | ok | ok | ok | ok | ok |
| `PmkitDeleteProjectItem` | ok | ok | ok | ok | ok |
| `PmkitDiscussion` | ok | ok | ok | ok | ok |
| `PmkitDiscussionCategories` | ok | ok | ok | ok | ok |
| `PmkitDiscussions` | ok | ok | ok | ok | ok |
| `PmkitDraftItem` | ok | ok | ok | ok | ok |
| `PmkitDraftItems` | ok | ok | ok | ok | ok |
| `PmkitDraftProject` | ok | ok | ok | ok | ok |
| `PmkitDraftTarget` | ok | ok | ok | ok | ok |
| `PmkitEpic` | ok | ok | ok | ok | ok |
| `PmkitEpicItems` | ok | ok | ok | ok | ok |
| `PmkitEpics` | ok | ok | ok | ok | ok |
| `PmkitIssue` | ok | ok | ok | ok | ok |
| `PmkitIssueMore_blockedBy` | ok | ok | ok | ok | ok |
| `PmkitIssueMore_blocking` | ok | ok | ok | ok | ok |
| `PmkitIssueMore_labels` | ok | ok | ok | ok | ok |
| `PmkitIssueMore_projectItems` | ok | ok | ok | ok | ok |
| `PmkitIssueMore_relatesTo` | ok | not sent | not sent | not sent | not sent |
| `PmkitIssueMore_subIssues` | ok | ok | ok | ok | ok |
| `PmkitIssueNodes` | ok | ok | ok | ok | ok |
| `PmkitIssues` | ok | ok | ok | ok | ok |
| `PmkitIterationField` | ok | ok | ok | ok | ok |
| `PmkitLinkedProjects` | ok | ok | ok | ok | ok |
| `PmkitLiveAddDraft` | ok | ok | ok | ok | ok |
| `PmkitLiveIssue` | ok | ok | ok | ok | ok |
| `PmkitLiveItems` | ok | ok | ok | ok | ok |
| `PmkitLiveProject` | ok | ok | ok | ok | ok |
| `PmkitLiveScope` | ok | ok | ok | ok | ok |
| `PmkitLiveViewer` | ok | ok | ok | ok | ok |
| `PmkitMetricIssues` | ok | ok | ok | ok | ok |
| `PmkitMilestones` | ok | ok | ok | ok | ok |
| `PmkitProject` | ok | ok | ok | ok | ok |
| `PmkitRemoveBlockedBy` | ok | ok | ok | ok | ok |
| `PmkitRemoveLabels` | ok | ok | ok | ok | ok |
| `PmkitRemoveRelatesTo` | ok | not sent | not sent | not sent | not sent |
| `PmkitRemoveSubIssue` | ok | ok | ok | ok | ok |
| `PmkitReopenIssue` | ok | ok | ok | ok | ok |
| `PmkitRepo` | ok | ok | ok | ok | ok |
| `PmkitSetIssueField` | ok | not sent | not sent | not sent | ok |
| `PmkitSetProjectField` | ok | ok | ok | ok | ok |
| `PmkitStatusUpdates` | ok | ok | ok | ok | ok |
| `PmkitTimeline` | ok | ok | ok | ok | ok |
| `PmkitTimelines` | ok | ok | ok | ok | ok |
| `PmkitUnmarkDuplicate` | ok | ok | ok | ok | ok |
| `PmkitUpdateIssue` | ok | ok | ok | ok | ok |
| `PmkitUpdateIterations` | ok | ok | ok | ok | ok |
| `PmkitUpdateProjectReadme` | ok | ok | ok | ok | ok |
| `STATUS_QUERY` (host.mjs) | ok | ok | ok | ok | ok |
| `THREADS_QUERY` (host.mjs) | ok | ok | ok | ok | ok |


## Non-goals

- Running the checks. The user runs them.
- Live checks of other families (relations, history, discussions, milestones, epics).
- `closeCycle` (`NOT_SUPPORTED` everywhere) and `openCycle` on GHES (`NOT_SUPPORTED`, ADR 0010).
- A capability change of its own. The manifest code is untouched; on GHES 3.21 the field roles can no longer pick an issue field, because discovery no longer lists any there (decision 6).

## Risks

- The user names a real Project by mistake. The title marker and the empty-Project rule stop the check before any write.
- A run stops in the middle (Ctrl-C, a network loss). The drafts carry the `pmkit-live` prefix, and the runbook's cleanup section lists the `gh` commands that find and delete them and that restore an iteration list.
- The restored iteration configuration changes the field's `startDate` or `duration` when GitHub derives them differently. The check sends the kept `duration` and the first iteration's start, as `appendIteration` does, and compares the restored list with the kept one.
- `PmkitDraftProject` gains a fragment. The fake answers by operation name, so its tests do not change; the published schemas accept the new form.
