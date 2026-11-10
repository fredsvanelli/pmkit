# PMK-228 Improve record-decision Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the four PMK-65 follow-ups: duplicate ADR numbers in `validate`, a `docs` field on issues, `docs adr-status`, and `origin/HEAD` as the default branch when none is configured.

**Architecture:** ADR folder and file listing move into `scripts/lib/adr.mjs` and serve `docs next-adr`, `validate` and `docs adr-status`. The `docs` field follows the `branch` pattern (optional, Local only, Linear refuses). `resolveDefaultBranch` gets an injected `originHead` reader.

**Tech Stack:** Node.js ESM, `node:test`, no dependencies.

**Spec:** `docs/superpowers/specs/2026-11-10-pmk-228-improve-record-decision-design.md`

## Global Constraints

- No new dependency (ADR 0003). Commands do not compute (ADR 0002).
- Every commit message carries `(PMK-228)` and ends with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- `spawnSync` reads use `GIT_READ_TIMEOUT_MS` and `GIT_READ_MAX_OUTPUT`; writes never get a timeout.
- Text read from files is CRLF-normalized.
- Never run the CLI inside `scripts/__fixtures__/`; copy fixtures to a temp dir.
- `npm test` must exit 0 (leak guard included), run in the foreground.

## Review Focus

- An ADR folder with `0003-a.md`, `0003-b.md` and `0003-c.md`: `validate` reports each of the three, and `docs adr-status 3` refuses with `CONFLICT` naming all three. Test in Tasks 1 and 4.
- `tracker.path: .` (the tracker ADR folder is `docs/adr`): one file is not reported as its own duplicate. Test in Task 1.
- `--add-doc` of a path already present and `--remove-doc` of an absent path: `before` equals `after`, no event. Test in Task 2.
- `docs adr-status` on an ADR with CRLF line endings and an existing `Status:` line: the line is replaced, not added twice. Test in Task 4.
- `origin/HEAD` pointing at a name `validBranch` refuses: falls back to `main`, no note. Test in Task 5.

---

### Task 1: Duplicate ADR numbers in `validate`

**Files:**
- Modify: `scripts/lib/adr.mjs` (export `adrFolders`, `adrFiles`; `planNextAdr` keeps its output)
- Modify: `scripts/lib/validate.mjs` (`validateRepo`, also before the hosted early return)
- Modify: `commands/local/doctor.md` (step 5 bullet for `adr`)
- Test: `scripts/adr.test.mjs`, `scripts/validate.test.mjs` (or the file that tests `validateRepo`)

**Interfaces:**
- Produces: `adrFolders({ root, trackerDir, trackerFolder }) -> [{ place: 'repo'|'tracker', dir, label }]` where `label` is the repo-relative folder (`docs/adr`, `.issues/docs/adr`) or `docs/adr` relative to an outside tracker folder; tracker folder dropped when it resolves to the repo folder.
- Produces: `adrFiles(folders) -> [{ number: 'NNNN', name, path: '<label>/<name>', place, file }]` (direct children matching `NUMBERED`, hidden entries skipped, sorted by path).
- Produces: `duplicateAdrs(files) -> [{ path, number, others: [path] }]`.

- [ ] Test: `duplicateAdrs` on three `0003-*` files and one `0004-*` returns three entries for 0003, each naming the other two; `adrFolders` with `trackerDir === root/docs/adr` returns one folder.
- [ ] Test: `validateRepo` on a temp Local tracker with `docs/adr/0003-a.md` and `.issues/docs/adr/0003-b.md` reports two problems with code `adr` and message `ADR number 0003 is also used by <other path>`; a hosted config with two `docs/adr/0002-*` files reports them too.
- [ ] Run, see them fail; implement; run, see them pass; existing `adr.test.mjs` stays green.
- [ ] Doctor bullet: `adr` problems: the user renames the later file to the number `docs next-adr` gives and updates the comments and `docs` fields that cite it.
- [ ] Commit `feat(validate): report two ADRs with the same number (PMK-228)`.

### Task 2: `docs` field on issues (Local)

**Files:**
- Modify: `scripts/lib/issue-fields.mjs` (`UPDATE_KEYS` gets `docs`)
- Modify: `scripts/lib/model.mjs` (`@property {string[]} [docs]`)
- Modify: `scripts/lib/local/issue-file.mjs` (`ISSUE_KEYS` after `branch`, parse, `toFrontmatter` omits empty)
- Modify: `scripts/lib/local/tracker.mjs` (`NORMALIZE.docs`, empty list deletes)
- Modify: `scripts/pmkit.mjs` (`issues update --add-doc`, `--remove-doc`; usage line)
- Modify: `scripts/lib/format.mjs` (`docs` line in issue text)
- Test: `scripts/issue-file.test.mjs`, `scripts/cli.test.mjs` (or a new `scripts/cli-issue-docs.test.mjs`)

**Interfaces:**
- Produces: issue `docs?: string[]`; CLI `issues update <id> --add-doc <path> | --remove-doc <path>`.

- [ ] Test: `parseIssueFile` reads `docs: [docs/adr/0001-a.md]`; `toFrontmatter` omits `docs` when absent or empty.
- [ ] Test (CLI on a temp copy of a fixture): `--add-doc docs/adr/0001-a.md` adds it with one `update` event `field: docs`; repeating it gives `before` equal to `after` and no new event; `--remove-doc` removes it and the key leaves the file; `--remove-doc` of an absent path changes nothing; a path with a newline (via the patch) is `INVALID_INPUT`.
- [ ] Run fail, implement, run pass.
- [ ] Commit `feat(issues): add a docs field with --add-doc and --remove-doc (PMK-228)`.

### Task 3: `docs` on Linear and in the migration

**Files:**
- Modify: `scripts/lib/linear/issue-ops.mjs` (`updateIssue`: `patch.docs !== undefined` → `NOT_SUPPORTED` before any request)
- Modify: `scripts/lib/linear/manifest.mjs` (`documents.detail.unsupported: ['createDocument', 'updateDocument', 'issueDocs']`)
- Modify: `scripts/lib/linear/migrate-fields.mjs` (`EXPORT_LOSSES` gets `doc links`; an issue with `docs` adds it)
- Test: `scripts/lib/linear/manifest.test.mjs`, the issue-ops test, `scripts/lib/linear/migrate-fields.test.mjs`

- [ ] Tests: the manifest detail deep-equals the new list; `updateIssue('ENG-1', { docs: ['x'] })` rejects with `NOT_SUPPORTED` and the fake API saw no mutation; a Local issue with `docs` gives a `doc links` loss naming its id.
- [ ] Run fail, implement, run pass. (`updateDocument` is listed here and implemented in Task 4.)
- [ ] Commit `feat(linear): refuse the docs field and list it as a migration loss (PMK-228)`.

### Task 4: `docs adr-status` and `updateDocument`

**Files:**
- Modify: `scripts/lib/adr.mjs` (`setAdrStatus(text, line) -> string`, `adrStatusLine(status, byPath)`)
- Modify: `scripts/lib/local/documents.mjs` (`updateDocumentFile(docsDir, docPath, body, { dryRun, onWrite })`)
- Modify: `scripts/lib/local/tracker.mjs`, `scripts/lib/linear/project-ops.mjs`, `scripts/lib/linear/tracker.mjs`, `scripts/lib/contract.mjs` (`updateDocument`)
- Modify: `scripts/pmkit.mjs` (command `docs adr-status`, `byTracker: true`; shared ADR folder helper used by `docs next-adr` too)
- Modify: `scripts/lib/capabilities.mjs` (`SERVED_BY.documents` gets `docs adr-status`)
- Test: `scripts/adr.test.mjs`, `scripts/documents.test.mjs`, `scripts/lib/linear/tracker.test.mjs`, a CLI test

**Interfaces:**
- Consumes: `adrFolders`, `adrFiles` (Task 1).
- Produces: `updateDocument(docPath, body, actor, { dryRun }) -> { before: { path, body }, after: { path, body } }`, `NOT_FOUND` for a missing file, Linear `NOT_SUPPORTED` with next step `Edit the document in Linear`.
- Produces: CLI data `{ number, path, place, status: { before: string|null, after: string }, before: string, after: string }`.

- [ ] Tests for `setAdrStatus`: no heading → line at the top; `# T\n\nText` → `# T\n\nStatus: deprecated\n\nText`; an existing `Status: accepted` before the first `## ` is replaced; a `Status:` under a `## ` section is not touched (line inserted after the H1); CRLF input gives LF output.
- [ ] Tests for `updateDocumentFile`: writes, `dryRun` writes nothing, missing → `NOT_FOUND`.
- [ ] CLI tests on a temp Local tracker: `docs adr-status 1 deprecated --dry-run` on a repo ADR writes nothing and returns the status before/after; the real run writes the file and the note says it has no commit; a tracker ADR goes through `updateDocument`; `superseded` without `--by` and `deprecated --by 2` are usage errors; `--by` naming a missing ADR is `NOT_FOUND`; `--by` equal to the number is `INVALID_INPUT`; two files with the number is `CONFLICT`; status `foo` and number `12345` are `INVALID_INPUT`; the same status twice gives `before` equal to `after`.
- [ ] Linear tracker test: `updateDocument` is `NOT_SUPPORTED` and sends no request.
- [ ] Run fail, implement, run pass; `cli-hosted.test.mjs` and the capabilities tests stay green.
- [ ] Commit `feat(docs): add docs adr-status to change an ADR's status (PMK-228)`.

### Task 5: `origin/HEAD` for an unset default branch

**Files:**
- Modify: `scripts/lib/config.mjs` (`resolveDefaultBranch(pmkit, { originHead } = {})`)
- Modify: `scripts/pmkit.mjs` (`originHead(ctx)` memoized per ctx; `defaultBranch`, `defaultBranchNotes`, `default-branch`, `docs next-adr` pass it)
- Modify: `commands/issues/work.md`, `pause.md`, `progress.md`, `review.md`, `investigate-bug.md`, `README.md` (the "unset" wording)
- Test: `scripts/config.test.mjs`, a CLI test with a temp git repo whose `refs/remotes/origin/HEAD` points at `origin/trunk`

- [ ] Tests: unset + `originHead: () => 'trunk'` → `{ branch: 'trunk', configured: null, valid: true, note: 'git_host.default_branch is not set, so origin/HEAD (trunk) is used' }`; unset + `() => null` → `main`, note null; unset + `() => 'a..b'` → `main`, note null; set value → `originHead` never called; CLI `default-branch --json` in the temp repo answers `trunk` with the note.
- [ ] Run fail, implement, run pass.
- [ ] Commit `feat(config): use origin/HEAD when default_branch is not set (PMK-228)`.

### Task 6: Command files, scenario, docs

**Files:**
- Create: `commands/spec/adr-status.md`, `scripts/__scenarios__/spec-adr-status.mjs` (+ snapshot), inputs in `scripts/__scenarios__/_inputs/`
- Modify: `commands/spec/record-decision.md` (step 6 `--add-doc` when `issueDocs` is supported; Output mentions `/pmkit:spec:adr-status`), `scripts/__scenarios__/spec-record-decision.mjs` (+ snapshots)
- Modify: counts in `scripts/scenarios.test.mjs`, `scripts/scenarios-live.mjs`; `COMMANDS` in `scripts/plugin.test.mjs`
- Modify: `README.md` (command table, `issues update` flags, `docs adr-status`), `skills/pmkit/SKILL.md`, `CHANGELOG.md` (one line under `## Unreleased`, top)

- [ ] Write `adr-status.md`: parameters, steps (dry run, show the status line before and after and the path, ask once whatever `write_policy.confirm` says, write; `NOT_FOUND`/`CONFLICT`/`INVALID_INPUT` handling), confirmation point, output (says a repo file has no commit).
- [ ] Scenario: team fixture with `docs/adr/0001-a.md` and `0002-b.md` set up; `0001 superseded --by 2`; expect the file holds `Status: superseded by docs/adr/0002-b.md`.
- [ ] Update record-decision step 6 and its scenario entries with the `--add-doc` dry runs and writes; regenerate snapshots with `UPDATE_GOLDENS=1 node --test scripts/scenarios.test.mjs` and read the diff.
- [ ] Run `npm test` in the foreground; exit code 0.
- [ ] Commit `docs(spec): add /pmkit:spec:adr-status and link ADRs through docs (PMK-228)`.
