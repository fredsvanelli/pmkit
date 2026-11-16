# PMK-222 Improve issues delete Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the five follow-ups of PMK-52: scan the repository for a deleted ID, restore from Linear's trash, unlink several targets in one call, prepare the live sandbox run, and test three edge cases.

**Architecture:** The repository scan lives in the CLI layer of `issues delete` (one place for both trackers), with the line filter in `scripts/lib/mentions.mjs`. `restore` is a new tracker contract method (Linear: `issueUnarchive`; Local: `NOT_SUPPORTED`). Multi-target `issues link --remove` loops in the CLI, reusing the stop-and-report shape of `issues bulk` (`written`, `partialCommit`).

**Tech Stack:** Node ESM, `node:test`, the fake Linear API in `scripts/fake-linear-api.mjs`.

**Spec:** `docs/superpowers/specs/2026-11-10-pmk-222-improve-issues-delete-design.md`

## Global Constraints

- Every commit message carries `(PMK-222)` and ends with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- `spawnSync` for git reads goes through `readGit(ctx, args)` in `scripts/pmkit.mjs` (timeout + large `maxBuffer`).
- A read that fails is reported as not checked, never as "no mentions".
- `npm test` exits 0, run in the foreground.

## Review Focus

- The git scan fails (no repo): `files` is `[]` and `unchecked` keeps `code comments, documents and docs/` with the reason. Test in Task 1.
- `PMK-5` must not match `PMK-52` in a file line: the filter uses `mentionedIn`. Test in Task 1.
- A multi-target unlink that fails on the second target: the first stays written, the error lists applied/failed/remaining. Test in Task 3.
- `issues restore` on an issue that is not trashed: `INVALID_INPUT`, no mutation. Test in Task 2.
- `issues link A B C --kind blocks` without `--remove`: `INVALID_INPUT`, nothing written. Test in Task 3.

---

### Task 1: Scan the repository for the deleted ID (criterion 1)

**Files:**
- Modify: `scripts/lib/mentions.mjs` (add `fileMentions`)
- Modify: `scripts/lib/delete-refusal.mjs` (export `REPO_UNCHECKED = 'code comments, documents and docs/'`)
- Modify: `scripts/lib/local/tracker.mjs`, `scripts/lib/linear/issue-ops.mjs` (use `REPO_UNCHECKED`; Linear adds `Linear documents`)
- Modify: `scripts/pmkit.mjs` (`issues delete` run, `deleteText`)
- Test: `scripts/mentions.test.mjs`, `scripts/cli-delete.test.mjs`, `scripts/lib/linear/tracker.test.mjs`

**Interfaces:**
- Produces: `fileMentions(id: string, grepOutput: string) -> Array<{ path: string, lines: number[] }>` parsing `git grep -n` lines `path:line:text`, keeping lines where `mentionedIn(id)(text)` is true, grouped and sorted by path.
- Produces: delete result field `files` (always present after the CLI step).

- [ ] Step 1: tests. `mentions.test.mjs`: `fileMentions('PMK-5', 'a.md:3:see PMK-5\na.md:9:PMK-52 only\nb/c.mjs:1:// PMK-5.\n')` deep-equals `[{ path: 'a.md', lines: [3] }, { path: 'b/c.mjs', lines: [1] }]`. `cli-delete.test.mjs`: a committed `docs/note.md` citing the new issue ID and a `src/x.mjs` citing it, plus a file citing `<id>9`: dry run JSON `files` lists the two files with line numbers, `unchecked` lacks `code comments, documents and docs/`, text contains `docs/note.md:1`. A repo without `.git` (remove it): `files` is `[]` and `unchecked` has an entry starting `code comments, documents and docs/ (`. Linear test: `unchecked` includes `Linear documents`.
- [ ] Step 2: run them, see them fail.
- [ ] Step 3: implement. In `issues delete`: after the tracker call, `readGit(ctx, ['grep', '-n', '-I', '-F', '--untracked', '-e', id, '--', '.', ':(exclude).issues'])` with `id = result.before.id`; status 0 → `fileMentions`, 1 → `[]`, else keep the entry with `(git grep failed: <first stderr line or error>)`. `deleteText` prints `cited in files of the repository:` with up to 10 `path:line,line` lines and `N more files in --json`.
- [ ] Step 4: run the tests, see them pass; update goldens/scenarios that print `unchecked` if they fail.
- [ ] Step 5: commit `feat(issues): delete scans the repository for the ID (PMK-222)`.

### Task 2: `issues restore` from Linear's trash (criterion 2)

**Files:**
- Modify: `scripts/lib/contract.mjs` (add `'restore'` after `'delete'`)
- Modify: `scripts/lib/linear/documents.mjs` (`ISSUE_UNARCHIVE = 'mutation PmkitIssueUnarchive($id: String!) { issueUnarchive(id: $id) { success } }'`)
- Modify: `scripts/lib/linear/issue-ops.mjs` (`restore`, `readNode` gains `{ trashed: true }` option)
- Modify: `scripts/lib/local/tracker.mjs` (`restore` → `NOT_SUPPORTED`)
- Modify: `scripts/fake-linear-api.mjs` (`PmkitIssueUnarchive` clears `trashed` and `archivedAt`)
- Modify: `scripts/lib/linear/sandbox.mjs` (`issueUnarchive` rule: owns issue; 15 mutations)
- Modify: `scripts/pmkit.mjs` (command `issues restore <id>`, write; Linear delete text names it)
- Modify: `scripts/contract-suite.mjs` (delete test restores or expects `NOT_SUPPORTED`)
- Docs: `README.md` row, `commands/issues/delete.md` Output, `scripts/lib/linear/API-VERIFICATION.md` (allowlist count, open fact "`issueUnarchive` brings back a trashed issue")
- Test: `scripts/lib/linear/tracker.test.mjs`, `scripts/tracker-delete.test.mjs`, `scripts/lib/linear/sandbox.test.mjs` if it counts the allowlist

**Interfaces:**
- Produces: `tracker.restore(id, actor, { dryRun }) -> { before: null, after: Issue }`.
- Local error: `NOT_SUPPORTED`, message `the Local tracker has no trash: a deleted issue comes back from git history`, nextStep `git log --diff-filter=D -1 --format=%h -- .issues/issues/<id> finds the commit; git checkout <commit>^ -- .issues/issues/<id> brings the folder back`. Malformed ID → `INVALID_INPUT`.
- Linear errors: not trashed → `INVALID_INPUT` `<id> is not in Linear's trash`, nextStep `pmkit issues get <id>`; `success !== true` → `UPSTREAM` `Linear did not restore <id>`.

- [ ] Step 1: tests. Linear: delete ACME-3, `restore` dry run sends no mutation and `after.id === 'ACME-3'`; real run sends `PmkitIssueUnarchive` once and `getIssue('ACME-3')` works; restore of a live issue is `INVALID_INPUT` with no mutation; a fake answering `success: false` is `UPSTREAM`. Local: `restore` of a deleted ID is `NOT_SUPPORTED` with the nextStep naming the folder; `restore('../x')` is `INVALID_INPUT`. Contract test extended.
- [ ] Step 2: run, see them fail.
- [ ] Step 3: implement as in Interfaces.
- [ ] Step 4: run, pass; fix counts the plugin/capability tests check (`COMMANDS` lists, help goldens).
- [ ] Step 5: commit `feat(issues): restore an issue from Linear's trash (PMK-222)`.

### Task 3: `issues link --remove` takes several targets (criterion 3)

**Files:**
- Modify: `scripts/pmkit.mjs` (`issues link`: `rest: 'id'`, usage `<from> <to...> --kind ... [--remove]`)
- Modify: `scripts/lib/delete-refusal.mjs` (group `blockedBy` and `related` next steps)
- Docs: `commands/issues/link.md`, `commands/issues/delete.md` step 3, `README.md` row
- Test: `scripts/cli.test.mjs` or a new `scripts/cli-link-many.test.mjs`, `scripts/tracker-delete.test.mjs`

**Interfaces:**
- Several targets → data `{ results: [{ to, before, after, other? }] }`; failure → `PmkitError` with `written = { data: { applied, failed: { to, code, message }, remaining }, text }` and `partialCommit = 'unlink <from> (<n> of <m>)'` when `n > 0`.
- `referencedError` nextStep order: grouped blocks command, grouped related command, then duplicateOf and parent commands, capped at `MAX_STEPS`.

- [ ] Step 1: tests. A blocks B and C: `issues link A B C --kind blocks --remove` empties both `blockedBy`; dry run writes nothing and returns two results; `issues link A B C --kind blocks` is exit 2 `INVALID_INPUT`; `A B B` is `INVALID_INPUT`; `A B` keeps the single-target JSON (`before`, `after` at the top); unlink `A B MISSING-ID` where the unlink of `MISSING-ID` fails: B is written, error JSON lists `applied: [B]`, `failed.to`, `remaining: []`. Delete refusal with two blockers and two related: nextStep starts with `pmkit issues link X B C --kind blocks --remove; pmkit issues link X D E --kind related --remove`.
- [ ] Step 2: run, see them fail.
- [ ] Step 3: implement.
- [ ] Step 4: run, pass.
- [ ] Step 5: commit `feat(issues): link --remove takes several targets (PMK-222)`.

### Task 4: Edge-case tests (criterion 5)

**Files:**
- Test: `scripts/tracker-delete.test.mjs`, `scripts/cli-delete.test.mjs`, `scripts/lib/linear/tracker.test.mjs`

- [ ] Step 1: tests. Local: `delete('../' + id)`, `delete(id + '/..')`, `delete('../../etc')` throw and `hashTree(root)` is unchanged; with an epic created, `delete(epicId)` is `NOT_FOUND` and the epic folder exists. CLI: same `../` case exits 2. Linear: `delete('../ACME-1')` sends no request; `delete('EPC-...')`/a project key is `NOT_FOUND` with no mutation; fake `issueDelete` answering `{ success: false }` → `UPSTREAM`, `getIssue` still works.
- [ ] Step 2: run; these pin current behavior, so they pass; if one fails, fix the code it exposes.
- [ ] Step 3: commit `test(issues): delete edge cases (PMK-222)`.

### Task 5: Live sandbox readiness, changelog, verification (criterion 4)

- [ ] Step 1: `CHANGELOG.md` line under `## Unreleased`.
- [ ] Step 2: if `LINEAR_API_KEY` and `PMKIT_LIVE_WORKSPACE` are set, run `PMKIT_LIVE=1 node scripts/lib/linear/contract-live.mjs` and record the result in `API-VERIFICATION.md`; otherwise leave criterion 4 unchecked and say so in the PR.
- [ ] Step 3: `npm test` in the foreground, exit 0.
- [ ] Step 4: commit `docs: changelog for PMK-222 (PMK-222)`.
