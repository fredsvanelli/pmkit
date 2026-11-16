# PMK-270 Supersedes ref Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `/pmkit:spec:record-decision` writes the `Supersedes:` line with the same base `docs adr-status --by` uses.

**Architecture:** One helper `adrRef` in `scripts/lib/adr.mjs` holds the rule; `adr-status` and a new `--from` flag of `docs adr-get` call it; step 4 of `commands/spec/record-decision.md` reads `supersedesRef` from the JSON.

**Tech Stack:** Node ESM, `node:test`.

**Spec:** `docs/superpowers/specs/2026-11-12-pmk-270-supersedes-ref-design.md`

## Global Constraints

- Commit trailer, exactly: `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`; every message carries `(PMK-270)`.
- The change in `scripts/lib/adr.mjs` stays small and local (PMK-273 edits the file next).
- Every message the command file repeats exists in the `--json`.
- No rule of `commands/spec/record-decision.md` disappears.

## Review Focus

- `--from` names a path in no ADR folder, or a name that is not `NNNN-x.md`: `INVALID_INPUT`, nothing guessed (Task 1).
- New ADR in the repository, old ADR in the outside tracker: `supersedesRef` is `ref` (Task 1).
- Tracker inside the repository, and Linear (no tracker folder): `supersedesRef` equals `ref` (Task 1).
- `--from` with a CRLF or absent old ADR: `NOT_FOUND` from the number, as before (Task 1).

---

### Task 1: `adrRef` and `docs adr-get --from`

**Files:**
- Modify: `scripts/lib/adr.mjs` (add `adrRef` after `adrFiles`)
- Modify: `scripts/pmkit.mjs` (`runAdrStatus` line ~383, `runAdrGet`, the `docs adr-get` entry ~1707)
- Test: `scripts/adr.test.mjs`

**Interfaces:**
- Produces: `adrRef(holder, target, trackerFolder) -> string`, where `holder` and `target` are `{ place, file, ref }`; `docs adr-get <n> [--from <path>]` returns `supersedesRef: string | null`.

- [ ] **Step 1: Write the failing tests** in `scripts/adr.test.mjs`, using `withOutsideTracker`, `writeAdr`, `repo`:
  - `docs adr-get --from with both ADRs in a tracker outside the repository gives a ref relative to the new ADR, the base adr-status --by writes (PMK-270)`: old ADR `0001-a.md` exists outside; run `docs adr-get 1 --from tracker:docs/adr/0003-x.md --json`; assert `supersedesRef === '0001-a.md'`, `ref === ../<outside>/docs/adr/0001-a.md` unchanged; then write `0003-x.md`, run `adrStatus(root, '1', 'superseded', '--by', '3')` and assert the old ADR's `superseded by` target relative to the old ADR's folder resolves to the same file as `supersedesRef` relative to the new ADR's folder (same base).
  - `... new ADR in the repository keeps ref`: `--from docs/adr/0003-x.md` against the outside old ADR gives `supersedesRef === ref`.
  - `... repository ADRs and a tracker inside the repository keep ref (PMK-270)`: repo old ADR with `--from docs/adr/0003-x.md`; tracker at `.issues/docs/adr` with `--from .issues/docs/adr/0003-x.md`; `supersedesRef === ref` in both.
  - `... without --from, supersedesRef is null`; `--from nowhere/0003-x.md` and `--from docs/adr/notes.md` exit 2 with `INVALID_INPUT`.
  - Unit: `adrRef` returns the same-folder name for two outside-tracker ADRs and `target.ref` otherwise.

- [ ] **Step 2: Run to verify failure:** `node --test scripts/adr.test.mjs` fails on the new tests.

- [ ] **Step 3: Implement.** `adrRef` per the spec (uses `path.relative(path.dirname(holder.file), target.file)` with `/`). `runAdrStatus` replaces its inline expression with `adrRef(adr, newer, trackerFolder)`. `runAdrGet` becomes: when `--from` is given, find the folder whose `label` is the dirname of the value (`adrFolders`), require `NNNN-*.md` as the file name (`adrFiles`' pattern, exported as `isAdrName` if not already), build `{ place: folder.place, file: path.join(folder.dir, name) }` and return `supersedesRef`; register the flag `from` in the command entry and its usage.

- [ ] **Step 4: Run** `node --test scripts/adr.test.mjs scripts/cli.test.mjs` and expect all pass.

- [ ] **Step 5: Commit** `feat(adr): add docs adr-get --from, a Supersedes ref relative to the new ADR (PMK-270)`.

### Task 2: Command file, scenarios, docs

**Files:**
- Modify: `commands/spec/record-decision.md` (steps 2, 4, 5), `scripts/plugin.test.mjs` (~line 200), `scripts/__scenarios__/spec-record-decision.mjs` and its `.after.txt` goldens, `README.md:137`, `CHANGELOG.md`, and `skills/pmkit/SKILL.md` if it lists `adr-get`.
- Test: `scripts/plugin.test.mjs`, `scripts/scenarios.test.mjs`

**Interfaces:**
- Consumes: `docs adr-get <n> --from <path> --json` -> `supersedesRef`.

- [ ] **Step 1: Write the failing assertions** in `plugin.test.mjs`: `step(4)` matches `docs adr-get <old number> --from <path> --json` and `supersedesRef`; `step(2)` keeps its existing assertions; `step(5)` says to run the lookup again when the path changes.
- [ ] **Step 2: Run** `node --test scripts/plugin.test.mjs`; expect FAIL.
- [ ] **Step 3: Edit the command file.** Step 2 keeps its `ref` rules and adds that `supersedesRef` is read in step 4. Step 4 gets, before the draft: for each replaced ADR run `docs adr-get <old number> --from <path of step 3> --json` and use its `supersedesRef` in the line `Supersedes: ADR <old number>, <supersedesRef>` instead of `ref`; it says why (same base as the `superseded by` mark of step 7; a path from the repository root is kept in every other case, which the CLI decides). Step 5 repeats that lookup when the number or the path changes.
- [ ] **Step 4: Scenarios.** In the two replace scenarios add `{ step: '4', read: ['docs', 'adr-get', '<n>', '--from', '.issues/docs/adr/0003-keep-estimates-in-points.md'] }` after the step 3 read (one per replaced ADR); regenerate the `.after.txt` goldens the way `scripts/scenarios.test.mjs` documents, and read the diff.
- [ ] **Step 5: Docs.** README row of `docs adr-get` gains `--from <path>` and `supersedesRef`; `CHANGELOG.md` line on top of `## Unreleased`, same style; `skills/pmkit/SKILL.md` if it names the command.
- [ ] **Step 6: Verify** `npm test` in the foreground, exit code 0; commit `fix(spec): write the Supersedes line relative to the new ADR in a tracker outside the repository (PMK-270)`.

## Self-review

Spec coverage: helper, adr-status refactor, `--from`, command steps, non-goals (unchanged `ref`), the three acceptance points map to Task 1 tests. Names: `adrRef`, `supersedesRef`, `--from` are the same in both tasks.
