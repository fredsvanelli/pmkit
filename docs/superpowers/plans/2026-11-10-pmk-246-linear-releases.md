# PMK-246 Linear releases Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Map Linear releases in the Linear adapter: list them, read and write an issue's release (one per issue), filter by release, and list a release's issues.

**Architecture:** A new `scripts/lib/linear/releases.mjs` holds the mapping and the release operations. The issue fake in `scripts/fake-linear-api.mjs` learns releases and pipelines. `issue-ops.mjs` reads an issue's releases with one extra query only when `raw.flags.releasesEnabled` is true, and `writes.mjs` turns `patch.release` into `addedReleaseIds` and `removedReleaseIds`.

**Tech Stack:** Node.js ESM, `node:test`, no dependencies (ADR-0003).

**Spec:** `docs/superpowers/specs/2026-11-10-pmk-246-linear-releases-design.md`

## Global Constraints

- Releases off message: `Linear releases are off in this workspace`, next step the manifest hint `Linear releases need the Business or Enterprise plan and releases turned on in the workspace settings`.
- Two or more releases: `INVALID_INPUT` `the issue is in <n> Linear releases, and pmkit sets one release per issue`, next step `Change the releases of the issue in Linear`.
- Canceled release read: `NOT_FOUND` `release <id> was canceled in Linear`, next step `pmkit release list`.
- Create: `NOT_SUPPORTED` `issues create does not set a Linear release`, next step `Create the issue, then run pmkit issues update <id> --release <release>`.
- A release id is a UUID; any other value is `NOT_FOUND` `release <id> does not exist` with no request.
- No release query when releases are off. Commit messages carry `(PMK-246)` and end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

- An issue whose only release is canceled: no `release`, and `--release X` adds X without removing the canceled one. Test in Task 3.
- `--release` set to the release the issue already has: no mutation. Test in Task 3.
- `--release none` on an issue with no release: no mutation. Test in Task 3.
- A bulk change where one issue has two releases and the others one: the two-release issue is blocked, the others change. Test in Task 4.
- `release list` with more than one page of releases. Test in Task 2.

---

### Task 1: The fake learns releases

**Files:**
- Modify: `scripts/fake-linear-api.mjs` (`fakeLinearIssues`)
- Test: `scripts/fake-linear-api.test.mjs`

**Interfaces:**
- Produces: `fakeLinearIssues({ ..., releases = [], pipelines = [] })`. A pipeline is `{ id, name, teams: [teamId] }`. A release is `{ id, name, version = null, pipeline: pipelineId, stage = 'planned', targetDate = null, completedAt = null, description = null }`. `seed(input)` accepts `releaseIds`. Routes: `PmkitReleases({ filter, first, after })` answers `{ releases: connection }`, honouring `filter.pipeline.teams.some.key.eq`; `PmkitRelease({ id })` answers `{ release }` or an `Entity not found: Release` input error; `PmkitIssueReleases({ id, first, after })` answers `{ issue: { releases: connection } }`. A release node is `{ id, name, version, description, targetDate, completedAt, stage: { type }, pipeline: { id } }`. `PmkitIssueUpdate` takes `addedReleaseIds` and `removedReleaseIds` (an unknown release id is `Could not find referenced Release.`). The issue filter takes `releases: { some: { id: { eq } } }`.

- [ ] **Step 1: Write the failing tests** `releases are listed by team, read by id, and an issue's releases change with added and removed ids` and `the releases filter matches an issue in any of its releases`.
- [ ] **Step 2: Run** `node --test scripts/fake-linear-api.test.mjs`. Expected: FAIL.
- [ ] **Step 3: Implement** the store, the three routes, the two update fields and the `releases` comparator.
- [ ] **Step 4: Run** the same command. Expected: PASS.
- [ ] **Step 5: Commit** `test(linear): teach the fake Linear releases (PMK-246)`.

### Task 2: Release reads and the manifest

**Files:**
- Create: `scripts/lib/linear/releases.mjs`, `scripts/lib/linear/releases.test.mjs`
- Modify: `scripts/lib/linear/documents.mjs`, `scripts/lib/linear/tracker.mjs`, `scripts/lib/linear/manifest.mjs`, `scripts/lib/linear/tracker.test.mjs`, `scripts/lib/linear/manifest.test.mjs`

**Interfaces:**
- Consumes: Task 1 routes.
- Produces: `RELEASES_HINT` (manifest.mjs); `releasesOff()` returns the PmkitError; `toRelease(node)`; `issueReleaseFields(nodes)` returns `{}`, `{ release }` or `{ releases }`; `releaseOperations({ client, config })` returns `{ listReleases({ state }), getRelease(id), resolveRelease(id) }` where `resolveRelease` returns the raw node and refuses unknown, malformed and canceled ids.

- [ ] **Step 1: Write the failing tests:** in `releases.test.mjs`, `toRelease maps a completed release to released and a planned one to planned`, `issueReleaseFields ignores canceled releases and lists two or more as releases`; in `tracker.test.mjs`, `listReleases lists the scope team's releases, oldest version first, without canceled ones, across pages`, `listReleases rejects a bad state`, `getRelease answers a release, NOT_FOUND for an unknown or malformed id, and NOT_FOUND for a canceled one`; replace the stub test of `listReleases` with `createRelease` (still the stub). In `manifest.test.mjs` the Business entry becomes `{ id: 'releases', path: 'native', detail: { unsupported: ['createRelease', 'markReleased'] } }`.
- [ ] **Step 2: Run** `node --test scripts/lib/linear/releases.test.mjs scripts/lib/linear/tracker.test.mjs scripts/lib/linear/manifest.test.mjs`. Expected: FAIL.
- [ ] **Step 3: Implement.** Sort with `compareReleaseIds(a.version ?? a.name, b.version ?? b.name)` from `../local/releases.mjs`, then the id. `tracker.mjs` `releaseRead` calls the real operation when the entry is not absent.
- [ ] **Step 4: Run** the same command. Expected: PASS.
- [ ] **Step 5: Commit** `feat(linear): list and read Linear releases (PMK-246)`.

### Task 3: An issue's release, read and written

**Files:**
- Modify: `scripts/lib/linear/issues.mjs`, `scripts/lib/linear/writes.mjs`, `scripts/lib/linear/issue-ops.mjs`, `scripts/lib/linear/tracker.mjs`
- Test: `scripts/lib/linear/tracker.test.mjs`, `scripts/lib/linear/writes.test.mjs`

**Interfaces:**
- Consumes: `issueReleaseFields`, `resolveRelease`, `releasesOff`, `ISSUE_RELEASES_QUERY`.
- Produces: `issueOperations({ ..., resolveRelease })`; `toInput(patch, { ..., releaseNode })` reads `beforeNode.releases`; `applyInput(node, input, context, { release })`.

- [ ] **Step 1: Write the failing tests** (tracker, with the fake and `releasesEnabled: true`): `getIssue shows the one release, releases for two, and nothing on a workspace with releases off (no release query)`; `updateIssue --release swaps the release, previews it in a dry run, and reads the releases again after the write`; `updateIssue --release none removes it, and the same release or none on no release sends no mutation`; `an issue whose only release is canceled gets the new release without removing the canceled one`; `an issue in two releases is refused with the count`; `a canceled or unknown target release is refused before any mutation`; `releases off: --release and none refuse NOT_SUPPORTED with the hint and send no release query`; `createIssue with a release refuses NOT_SUPPORTED`.
- [ ] **Step 2: Run** `node --test scripts/lib/linear/tracker.test.mjs scripts/lib/linear/writes.test.mjs`. Expected: FAIL.
- [ ] **Step 3: Implement.** Remove `LATER` from `writes.mjs`. The release target is read once per run (a Map, as `milestoneReads`).
- [ ] **Step 4: Run** the same command. Expected: PASS.
- [ ] **Step 5: Commit** `feat(linear): read and set the release of a Linear issue (PMK-246)`.

### Task 4: The release filter, release issues and the commands

**Files:**
- Modify: `scripts/lib/linear/filter.mjs`, `scripts/lib/linear/releases.mjs`, `scripts/lib/linear/tracker.mjs`
- Test: `scripts/lib/linear/filter.test.mjs`, `scripts/cli-bulk-linear.test.mjs`, `scripts/cli-linear.test.mjs` (or the file that runs `release-readiness` and `release-notes` on Linear)

**Interfaces:**
- Consumes: Tasks 1 to 3.
- Produces: `translateFilter` emits `{ releases: { some: { id: { eq } } } }` when `context.raw.flags.releasesEnabled`, else throws `releasesOff()`; `releaseIssues(id, { archived })` = `getRelease` then `searchIssues({ release: id, archived })`.

- [ ] **Step 1: Write the failing tests:** filter `release becomes a releases clause` and `release refuses when releases are off`; bulk `release is previewed and written on Linear, and an issue in two releases is blocked`, replacing the old NOT_SUPPORTED test, plus `release on a workspace with releases off refuses NOT_SUPPORTED`; CLI `issues list --release lists the issues of a Linear release`, `release issues lists them`, `release-readiness --release reads a Linear release`, `release-notes --release reads a Linear release`.
- [ ] **Step 2: Run** the files. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** the files. Expected: PASS.
- [ ] **Step 5: Commit** `feat(linear): filter by Linear release and list a release's issues (PMK-246)`.

### Task 5: Docs, verification record and the full suite

**Files:**
- Modify: `scripts/lib/linear/API-VERIFICATION.md` (section "Releases (PMK-246)"), `CHANGELOG.md`, `README.md`, `commands/issues/bulk.md` and every other doc that says Linear releases are not mapped (`grep -rn "not mapped" commands skills README.md docs/adr`), `scripts/lib/linear/migrate-fields.mjs` wording if it claims no mapping.

- [ ] **Step 1:** Write the API-VERIFICATION section: the schema source and date, the mapping table, and the checks still open for a Business workspace.
- [ ] **Step 2:** Update the docs and the CHANGELOG line under `## Unreleased`, which names the scope change of PMK-246-2.
- [ ] **Step 3: Run** `npm test` in the foreground. Expected: exit code 0.
- [ ] **Step 4: Commit** `docs(linear): record the Linear release mapping (PMK-246)`.
