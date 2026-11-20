# PMK-335 live checks of the GitHub adapter: implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Opt-in `PMKIT_LIVE` checks of the GitHub client, `discover`, `openCycle` and the GHES draft conversion, plus fixes for the GraphQL documents the published schemas reject.

**Architecture:** `scripts/lib/github/live-checks.mjs` holds the gate, the write guard, the Project preflight and one function per check, all over an injected `makeExec(env)`. `scripts/lib/github/client-live.mjs` is the `node --test` entry that `npm test` never loads. Unit tests drive the checks against the stateful fake GitHub; the runbook's E2E test spawns the entry with a fake `gh` on `PATH`.

**Tech stack:** Node 22+, `node:test`, no dependency (ADR 0003).

**Spec:** `docs/specs/2026-11-18-pmk-335-github-live-checks-design.md`

## Global constraints

- No new dependency. Tests use `node:test` and `node:assert/strict`.
- No call reaches api.github.com or a GHES host from this branch. Nobody runs `client-live.mjs` with `PMKIT_LIVE=1` against a real `gh`.
- Every commit message carries `PMK-335` and ends with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Prose follows the Unslop rules: no em dashes, sentence-case headings, active voice.
- Edits to shared fake files (`scripts/fake-github-*.mjs`) stay additive and local.
- `npm test` ends with 0 failures after every task.

## Review focus

- A Project named by mistake: a title without the `pmkit-live` prefix, or a Project with items, must stop the check before any write. Tested in Task 5.
- A failure in the middle of the openCycle check must still delete the drafts and restore the iteration list. Tested in Task 8.
- The scopeless token must not appear in any message, next step, `details` or diagnostic. Tested in Task 6.
- A malformed variable (`acme` for a repository, `acme/x` for a Project, `https://host` for a host) must be a skip reason, not a request. Tested in Task 5.
- A delete refused on GHES must fall back to a close and print the number and URL. Tested in Task 9.

---

### Task 1: PmkitDraftProject through ProjectV2Owner

**Files:**
- Modify: `scripts/fake-github-issues.mjs` (`schemaError`), `scripts/lib/github/draft-issues.mjs` (`DRAFT_DOCUMENTS.PROJECT`)
- Test: `scripts/fake-github-issues.test.mjs`

- [ ] **Step 1: Failing test** `the fake refuses projectV2 selected on RepositoryOwner without a ProjectV2Owner fragment`: `fake.handle('PmkitDraftProject', vars, DRAFT_DOCUMENTS.PROJECT)` must answer `{ data }`; the same document without the fragment answers `errors[0].message` `Field 'projectV2' doesn't exist on type 'RepositoryOwner'`.
- [ ] **Step 2:** Run `node --test scripts/fake-github-issues.test.mjs`. Expected: FAIL (the fake accepts the bare form today, so `npm test` would hide the bug).
- [ ] **Step 3:** Add the rule `[false, /\brepositoryOwner\s*\([^)]*\)\s*\{\s*projectV2\b/, "Field 'projectV2' doesn't exist on type 'RepositoryOwner'"]` to `schemaError`. Wrap the selection in `DRAFT_DOCUMENTS.PROJECT` with `... on ProjectV2Owner { }`.
- [ ] **Step 4:** Run the fake tests, `scripts/lib/github/draft-issues.test.mjs` and `scripts/runbook-draft-issues-github.test.mjs`. Expected: PASS.
- [ ] **Step 5:** Commit `fix: read the draft Project through ProjectV2Owner (PMK-335)`.

### Task 2: alias the issue field values

**Files:**
- Modify: `scripts/lib/github/documents.mjs` (`ISSUE_FIELD_VALUES`), `scripts/lib/github/issues.mjs` (`estimateOf`, `dueOf`), `scripts/lib/github/writes.mjs` (`numberWrite`, `dateWrite`), `scripts/fake-github-issues.mjs` (`issueFieldNodes`, `schemaError`)
- Test: `scripts/fake-github-issues.test.mjs`, `scripts/lib/github/issues.test.mjs`, `scripts/lib/github/writes.test.mjs`

- [ ] **Step 1: Failing tests.** Fake: a document with `... on IssueFieldNumberValue { value }` and `... on IssueFieldDateValue { value }` answers `Field 'value' has a return_type conflict: Float! or String!`, and the aliased form answers `numberValue` and `dateValue`. Issues: `toIssue` of a node with `{ __typename: 'IssueFieldNumberValue', numberValue: 3 }` gives `estimate: 3`, and `{ __typename: 'IssueFieldDateValue', dateValue: '2026-12-01' }` gives `due: '2026-12-01'`. Writes: the `shown` value of an issue field write is `{ numberValue }` or `{ dateValue }`.
- [ ] **Step 2:** Run them. Expected: FAIL.
- [ ] **Step 3:** Select `numberValue: value` and `dateValue: value`. Read `value.numberValue` and `value.dateValue` (the Project field keys `number` and `date` stay). The fake returns the aliased keys and rejects a bare `value` in either fragment (regex on `IssueField(Number|Date)Value\s*\{\s*value\b`).
- [ ] **Step 4:** Run every GitHub test and every `runbook-*github*` test. Expected: PASS. Fix the fixtures that still hand `value` to the readers.
- [ ] **Step 5:** Commit `fix: alias the number and date issue field values (PMK-335)`.

### Task 3: the Project read on GHES

**Files:**
- Modify: `scripts/lib/github/discovery.mjs` (`projectQuery`, `fetchProject`, `fetchDiscovery`), `scripts/fake-github-issues.mjs` (`schemaError`)
- Test: `scripts/lib/github/discovery.test.mjs`, `scripts/fake-github-issues.test.mjs`

- [ ] **Step 1: Failing tests.** `projectQuery({ issueFields: true, ghes: true })` holds neither `isIssueField` nor `ProjectV2MultiSelectField`; `projectQuery({ issueFields: true, ghes: false })` holds both. A GHES fake (any version) refuses either with `Field 'isIssueField' doesn't exist on type 'ProjectV2Field'` or `No such type ProjectV2MultiSelectField, so it can't be a fragment condition`. `fetchDiscovery` on a GHES 3.22 fake reads the Project.
- [ ] **Step 2:** Run. Expected: FAIL.
- [ ] **Step 3:** `projectQuery({ issueFields, ghes })`: `isIssueField` only when `issueFields && !ghes`, the multi-select fragment only when `!ghes`. `fetchProject(client, project, { issueFields, ghes })`; `fetchDiscovery` passes `ghes: needsVersionCheck(host)`.
- [ ] **Step 4:** Run the GitHub tests and the GitHub runbooks. Expected: PASS.
- [ ] **Step 5:** Commit `fix: read the Project fields GHES has (PMK-335)`.

### Task 4: issue fields on GHES from 3.22 (only when the user answers A)

**Files:**
- Modify: `scripts/lib/github/discovery.mjs` (`ISSUE_FIELDS_GHES`), `scripts/lib/github/documents.mjs` (`hostFeatures`: `statusEvents` stays at 3.21), `docs/adr/0007-github-issues-reuses-the-gh-login-and-needs-ghes-3-19.md`, the tests that pin 3.21 for issue fields (`documents.test.mjs`, `discovery.test.mjs`, `manifest.test.mjs`, `adr-github-auth.test.mjs`, `cli-github-init.test.mjs`)

- [ ] **Step 1: Failing test.** `hostFeatures({ host: 'git.acme.dev', ghesVersion: '3.21.0' })` is `{ issueFields: false, relatesTo: false, statusEvents: true, iterationIds: false }`; `3.22.0` has `issueFields: true`.
- [ ] **Step 2:** Run. Expected: FAIL.
- [ ] **Step 3:** Set the constant to `'3.22'`, compute `statusEvents` from `3.21` on its own, and amend ADR 0007 with the schema evidence (3.21 has `Issue.issueFieldValues` but no `Repository.issueFields`).
- [ ] **Step 4:** Run `npm test`. Expected: PASS.
- [ ] **Step 5:** Commit `fix: ask GHES for issue fields from 3.22 (PMK-335)`.

### Task 5: the gate, the guard and the preflight

**Files:**
- Create: `scripts/lib/github/live-checks.mjs`, `scripts/lib/github/live-checks.test.mjs`
- Modify: `scripts/fake-github-drafts.mjs` (routes `PmkitLiveViewer`, `PmkitLiveProject`, `PmkitLiveAddDraft`, `PmkitLiveItems`, `PmkitLiveScope`)

**Interfaces (produces):**
- `LIVE_DOCUMENTS`: `VIEWER` (`query PmkitLiveViewer { viewer { login } }`), `SCOPE` (`query PmkitLiveScope { viewer { projectsV2(first: 1) { totalCount } } }`), `PROJECT` (`query PmkitLiveProject($owner: String!, $number: Int!)` through `... on ProjectV2Owner`, selecting `id title items(first: 1) { totalCount }`), `ADD_DRAFT` (`mutation PmkitLiveAddDraft($input: AddProjectV2DraftIssueInput!) { addProjectV2DraftIssue(input: $input) { projectItem { id } } }`), `ITEMS` (`query PmkitLiveItems($project: ID!, $field: String!, $first: Int!, $after: String)`, each node `id type fieldValueByName(name: $field) { ... on ProjectV2ItemFieldIterationValue { iterationId title startDate } }`).
- `MARKER = 'pmkit-live'`, `BAD_TOKEN` (a made-up `ghp_` value of 40 characters).
- `liveTargets(env)` returns `{ github: { repo, project, scopeless }, ghes: { host, repo, project } }`, each value checked with `parseRepo`, `parseProject` and `HOST_NAME` or null.
- `skipReasons(env)` returns `{ errors, scope, discover, openCycle, ghes }`, each `false` or the exact text of the spec's "Variables" section.
- `guardExec(exec, allow)`: `allow` maps a mutation name to `(variables) => boolean`. It refuses a mutation not in `allow`, one whose predicate is false, and a REST call with a method other than GET, by throwing `Error('the live check refused <name>')` before `exec` runs.
- `preflightProject(client, value, variable)` returns `{ id, title }` or throws `PmkitError('INVALID_INPUT', ...)` naming `variable`.

- [ ] **Step 1: Failing tests:** each skip reason in order (`PMKIT_LIVE` unset first, then each variable missing or malformed); the guard's three refusals and one pass; the preflight's refusals for a missing Project, a title without the marker and one item present, each with nothing in `fake.mutations`.
- [ ] **Step 2:** Run `node --test scripts/lib/github/live-checks.test.mjs`. Expected: FAIL (module missing).
- [ ] **Step 3:** Implement, and add the five routes to the fake (`PmkitLiveItems` reads through the fake's `projectValue`, passed in as a helper).
- [ ] **Step 4:** Run. Expected: PASS.
- [ ] **Step 5:** Commit `feat: gate, guard and preflight of the GitHub live checks (PMK-335)`.

### Task 6: error shapes (criterion 1)

**Files:**
- Modify: `scripts/lib/github/live-checks.mjs`, its test
- Create: `scripts/fake-gh-live.mjs`: `liveGhExec({ github, ghes, scopelessToken })` over fakes, by `--hostname`, and `liveGhOnPath(fixture)` for the E2E test. With `GH_CONFIG_DIR` set to a folder without `hosts.yml` and no token, it answers as a logged-out `gh`. `BAD_TOKEN` gets HTTP 401 `Bad credentials`. The scopeless token gets `INSUFFICIENT_SCOPES` for a Project read. Every GraphQL answer carries `X-Ratelimit-Limit`, `-Remaining`, `-Used`, `-Resource: graphql` and `-Reset`.

**Interfaces (produces):** `checkNoLogin`, `checkRejectedToken`, `checkNotFound`, `checkRateHeaders`, `checkMissingScope`, each `async ({ env, makeExec }) => { asserted: string[] }`, throwing an `AssertionError` on a wrong shape.

- [ ] **Step 1: Failing tests:** each check passes over `liveGhExec`; each fails when the fake answers another shape (for example a logged-in `gh` for `checkNoLogin`); the scopeless token is in no output of `checkMissingScope`.
- [ ] **Step 2:** Run. Expected: FAIL.
- [ ] **Step 3:** Implement with `createGithubClient({ env, host: 'github.com', exec: guardExec(makeExec(env), {}), retries: 0 })`. `checkNotFound` reads `DRAFT_DOCUMENTS.TARGET` for `pmkit-live-no-such-owner-<8 random hex>/x`.
- [ ] **Step 4:** Run. Expected: PASS.
- [ ] **Step 5:** Commit `feat: live check of the GitHub error shapes (PMK-335)`.

### Task 7: discover (criterion 2)

**Interfaces (produces):** `checkDiscover({ env, makeExec, write })`.

- [ ] **Step 1: Failing test:** against a fake Project titled `pmkit-live checks` with an iteration field, the check returns asserted lines and writes counts only (no repository, field or option name in `write`'s lines).
- [ ] **Step 2:** Run. Expected: FAIL.
- [ ] **Step 3:** Implement as the spec's "Criterion 2" says, with a temporary `PMKIT_HOME`, `HOME` and `XDG_CONFIG_HOME` removed in `finally`.
- [ ] **Step 4:** Run. Expected: PASS.
- [ ] **Step 5:** Commit `feat: live check of discover on github.com (PMK-335)`.

### Task 8: openCycle keeps item iterations (criterion 3)

**Interfaces (produces):** `checkOpenCycle({ env, makeExec, write, today })`.

- [ ] **Step 1: Failing tests:** with one completed and one current iteration, the check adds two drafts, runs `openCycle`, passes, and leaves the fake Project with no item and the original iteration ids; when `PmkitUpdateIterations` is made to drop ids (a fake run with `iterationIds` off answers new ids), the check fails with a message naming the item that lost its iteration and still cleans up; when `failNext('PmkitSetProjectField')` breaks step 3, the drafts are still deleted.
- [ ] **Step 2:** Run. Expected: FAIL.
- [ ] **Step 3:** Implement the spec's six steps. The guard allows `PmkitLiveAddDraft` and `PmkitSetProjectField` and `PmkitDeleteProjectItem` only for the checked `projectId`, and `PmkitUpdateIterations` only for the iteration field id read in step 2.
- [ ] **Step 4:** Run. Expected: PASS.
- [ ] **Step 5:** Commit `feat: live check that openCycle keeps item iterations (PMK-335)`.

### Task 9: draft conversion on GHES (criterion 4)

**Interfaces (produces):** `checkGhesConversion({ env, makeExec, write })`.

- [ ] **Step 1: Failing tests:** on a GHES 3.19 fake the check converts one draft, passes, and leaves no item and no issue; with `failNext('PmkitDeleteIssue', <FORBIDDEN reply>)` it closes the issue as `NOT_PLANNED` and writes its number and URL; on a 3.18 fake it fails before any write; on 3.20 it passes and writes a note that the host is not 3.19.
- [ ] **Step 2:** Run. Expected: FAIL.
- [ ] **Step 3:** Implement the spec's five steps with `draftIssueOperations` and `issueDocuments(hostFeatures({ host, ghesVersion }))` for the delete and close.
- [ ] **Step 4:** Run. Expected: PASS.
- [ ] **Step 5:** Commit `feat: live check of the draft conversion on GHES (PMK-335)`.

### Task 10: the entry, the runbook and its E2E test

**Files:**
- Create: `scripts/lib/github/client-live.mjs`, `docs/runbooks/live-checks-github.md`, `scripts/runbook-live-checks-github.test.mjs`

- [ ] **Step 1: Failing E2E test** with three runs of `node --test scripts/lib/github/client-live.mjs` (spawned, `liveGhOnPath` first on `PATH`, TAP reporter): without `PMKIT_LIVE` every test is skipped with `set PMKIT_LIVE=1 to run the live check` and the exit code is 0; with the github.com variables, the error, scope, discover and openCycle tests pass and the GHES test is skipped with `no GHES host configured`; with every variable, all pass. The runbook's commands are the ones the test runs.
- [ ] **Step 2:** Run. Expected: FAIL.
- [ ] **Step 3:** Write the entry (one `test` per check, `{ skip: reason }`, diagnostics through `t.diagnostic`, `makeExec = (env) => defaultExec({ root: os.tmpdir(), env })`) and the runbook: prepare the account and Projects, set the variables, run, read the result, clean up after an interrupted run with `gh` commands.
- [ ] **Step 4:** Run the E2E test, then `npm test`. Expected: PASS, and `npm test` lists no test of `client-live.mjs`.
- [ ] **Step 5:** Commit `feat: entry and runbook of the GitHub live checks (PMK-335)`.

### Task 11: record the validation

- [ ] **Step 1:** Rerun the scratchpad validator over every document of `scripts/lib/github/` (static per host, plus the documents the tests send) against `fpt` and GHES 3.19 to 3.22. Expected: no failing cell, except the documents GitHub-only by design (`PmkitAddRelatesTo`, `PmkitRemoveRelatesTo`, `PmkitSetIssueField` before 3.22), which the code never sends on those hosts.
- [ ] **Step 2:** Fill "Validation of the documents" in the design doc with the per-document table, and add the CHANGELOG entry.
- [ ] **Step 3:** Commit `docs: record the schema validation of the GitHub documents (PMK-335)`.
