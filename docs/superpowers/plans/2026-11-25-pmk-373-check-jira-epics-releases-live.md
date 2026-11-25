# PMK-373 Check the Jira epic, release and status-update flows live: Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the Jira release filter exact and a taken release name a `CONFLICT`, then leave an opt-in live test that runs the epics-releases-jira runbook's flows on a real site.

**Architecture:** Two small fixes in the Jira adapter (`filter.mjs` + `issue-ops.mjs` client step; `releases.mjs` name check), each with the stateful fake made to behave as the live site did. Then one more `PMKIT_LIVE` test in `scripts/lib/jira/client-live.mjs`, and the runbook updated.

**Tech Stack:** Node 18+ ES modules, `node:test`, no dependencies.

**Spec:** `docs/superpowers/specs/2026-11-25-pmk-373-check-jira-epics-releases-live-design.md`

## Global Constraints

- No dependencies (ADR 0003); `npm test` and `npm run lint` pass.
- The site host, the email and the token never reach the repository, the PR or the issue; live output prints keys, ids and counts only.
- The live test writes only to `PMKIT_LIVE_JIRA_SPACE`, deletes every work item and version it made, and turns Releases off again when it turned it on.
- Every commit message names `(PMK-373)`.

## Review Focus

- A release whose name is all digits and equals another version's id: `issues list --release` must list only that release's items (Task 1 test uses a version named like another's id).
- A release with two live fix versions on one issue: the client step must keep it under either name (Task 1 test: an issue in `releases: [a, b]`).
- `--release` combined with `--limit`: the client step disables `serverLimit`, so the limit still counts kept issues only (Task 1 filter test asserts `serverLimit: undefined`).
- `release create` of the exact live name keeps today's `CONFLICT` message `release <id> already exists` (Task 2 test).
- The live run failing halfway still restores Releases and deletes versions (Task 3 `finally`).

---

### Task 1: the release filter is exact

**Files:**
- Modify: `scripts/lib/jira/filter.mjs` (`HANDLERS.release`, `STEP_ORDER`)
- Modify: `scripts/lib/jira/issue-ops.mjs` (`STEPS.release`)
- Modify: `scripts/fake-jira-issues.mjs` (`fixVersion =` matches a version id or a version name, as the site does)
- Test: `scripts/lib/jira/filter.test.mjs`, `scripts/lib/jira/issue-ops.test.mjs`, `scripts/runbook-epics-releases-jira.test.mjs` + `docs/runbooks/epics-releases-jira.md`

**Interfaces:**
- Produces: `translateFilter({ release }, ctx, { versionId })` returns `{ jql: '... AND fixVersion = "<versionId>" ...', clientSteps: ['release'], serverLimit: undefined }`; `STEPS.release(issue, filter)` is true when `issue.release === filter.release` or `issue.releases` includes it.

- [ ] **Step 1: Failing tests.** `filter.test.mjs` "release is the version id in JQL, and an unknown name matches nothing": expect `clientSteps: ['release']`. `issue-ops.test.mjs` new test "a release search leaves out a version named like the release's id": on the fake, version `2.0` (id `10100`) on issue A, version named `10100` on issue B; `searchIssues({ release: '2.0' })` ids are `[A]`; an issue with both `2.0` and `3.0` is found by either. Make the fake's `fixVersion = "<v>"` match an entry whose id or name is `<v>` (so the second test fails before the fix).
- [ ] **Step 2: Run** `node --test scripts/lib/jira/filter.test.mjs scripts/lib/jira/issue-ops.test.mjs`: both new expectations FAIL.
- [ ] **Step 3: Implement.** `HANDLERS.release` adds `out.steps.add('release')`; `STEP_ORDER` gains `'release'`; `STEPS.release` as above. Comment: Jira matches `fixVersion = <id>` against names too (PMK-373, seen live).
- [ ] **Step 4: Run** the two files: PASS.
- [ ] **Step 5: Runbook.** `epics-releases-jira.md` step 8 gains: a version named like `2.0`'s id holds another item, and `issues list --release 2.0` still lists only `ENG-2`; mirror it in `scripts/runbook-epics-releases-jira.test.mjs` (seed the name-alike through the fake's state or a raw call, as the test file does for other setup). Run it: PASS.
- [ ] **Step 6: Commit** `fix: keep only the release's own items when Jira matches a version by name (PMK-373)`.

### Task 2: a taken release name is CONFLICT

**Files:**
- Modify: `scripts/lib/jira/releases.mjs` (`createRelease`)
- Modify: `scripts/fake-jira-issues.mjs` (`POST /version` refuses a name taken case-insensitively, archived versions included, with 400 as the site does)
- Test: `scripts/lib/jira/releases.test.mjs`; `docs/runbooks/epics-releases-jira.md` Failures table

**Interfaces:**
- Consumes: `readVersions(client, spaceKey)` (every version, archived included).
- Produces: `createRelease` errors: exact live name: `CONFLICT` `release <id> already exists`, next `pmkit release get <id>` (unchanged); live name in another case: `CONFLICT` `release <id> is taken by version <name>, which differs only in case`, next `pmkit release get <name>`; archived (any case): `CONFLICT` `release <id> is taken by archived version <name>`, next `Unarchive or rename version <name> in Jira`.

- [ ] **Step 1: Failing test** in `releases.test.mjs` "createRelease refuses a name taken in another case or by an archived version, before any write": versions `Beta` (live) and `old` (archived); `createRelease({ id: 'Beta' })` (exact), `({ id: 'beta' })` (case), `({ id: 'old' })` and `({ id: 'OLD' })` (archived) each reject with the code, message and next step above, and no POST is sent.
- [ ] **Step 2: Run** `node --test scripts/lib/jira/releases.test.mjs`: FAIL.
- [ ] **Step 3: Implement** in `createRelease`: read all versions once (`readVersions`), find `version.name.toLowerCase() === id.toLowerCase()`; branch on exact live / live other case / archived. The fake refuses those names with 400 too.
- [ ] **Step 4: Run** the file and `node --test scripts/runbook-epics-releases-jira.test.mjs`: PASS.
- [ ] **Step 5: Runbook** Failures table: two rows for the new `CONFLICT` cases.
- [ ] **Step 6: Commit** `fix: answer CONFLICT for a Jira release name taken in another case or by an archived version (PMK-373)`.

### Task 3: the live test and the record

**Files:**
- Modify: `scripts/lib/jira/client-live.mjs` (header line; new test `epic, status update and release flows on the throwaway space`)
- Modify: `docs/runbooks/epics-releases-jira.md` (live-check line, notes), design doc "Result" section, PMK-373 comment

**Interfaces:**
- Consumes: `liveRepo`, `INIT`, `acceptAll`, `discoverSpace`, `eventually`, `removeAll`, `client`, `FEATURE.releases`, `assertNoSecret` from the same file.

- [ ] **Step 1: Write the test** following design steps 1 to 14 exactly (Releases toggle via `PUT /rest/agile/1.0/board/{id}/features { boardId, feature: FEATURE.releases, enabling }`; versions recorded by id from the start; `finally`: `removeAll`, delete versions not in the before list, restore the feature, then assert nothing is left).
- [ ] **Step 2: Run without `PMKIT_LIVE`**: `node --test scripts/lib/jira/client-live.mjs` skips every test with its reason; `npm run lint` passes.
- [ ] **Step 3: Run live** (env loaded at runtime from the git-ignored settings file, never printed): `PMKIT_LIVE=1 ... node --test scripts/lib/jira/client-live.mjs`; every check passes, the output holds no host, email or token; Kudos ends with no work item, no version, Releases off. A failure that shows a new difference goes back through a failing unit test first.
- [ ] **Step 4: Record** the result: design doc "Result" table (pass/fail/skipped per AC), runbook live-check line and notes (versions made with Releases off; archived fix versions kept on any write), comment on PMK-373 via `pmkit issues comment`.
- [ ] **Step 5: Commit** `test: check the Jira epic, release and status-update flows live (PMK-373)`.
