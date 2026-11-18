# Epic description Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every epic that `/pmkit:spec:from-prd` and `/pmkit:spec:import` create gets a description with its purpose, scope, what stays out and the documents it comes from.

**Architecture:** The CLI gains `epic create --description-file`, passed to the existing `description` input of `createDeliverable` on the three trackers. The two Markdown procedures draft the description in a fixed template, show it in their approval, and pass it by file. `import` stores the spec before the epic, so the description can cite its path.

**Tech Stack:** Node.js ESM, no dependencies, `node:test` (`npm test` runs `node scripts/run-tests.mjs`).

**Spec:** `docs/specs/2026-11-17-pmk-347-epic-description-design.md`

## Global Constraints

- No dependencies (ADR 0003). Tests use `node:test` and `node:assert/strict` only.
- Text from data never goes on the shell command line. The description goes through `--description-file`, written with the file tool (`skills/pmkit/references/conventions.md`).
- Commands are the source for every agent (ADR 0002): the change lives in `commands/**` and the CLI.
- Every command file call ends with `--json` (scenarios rule 4), every flag it names must exist in the CLI (rule 3), and every call is used by a scenario entry or listed in `skip` (rule 6).
- The description template, headings in English with `###`, text in the language of the PRD or spec. A section with nothing to say is left out, except Purpose:

  ```markdown
  ### Purpose
  ### Scope (in)
  ### Out of scope
  ### Documents
  ```

- Every path in Documents is relative to the repository root: `.issues/docs/<path>` for a local tracker document, the repository path for a repository file (`docs/specs/<slug>-prd.md`, `docs/adr/NNNN-<slug>.md`).
- Every commit message carries `(PMK-347)` and ends with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Stage files by explicit path, never `git add -A`: the working tree has user changes (`CLAUDE.md`, `.issues/issues/PMK-332`, `PMK-346`, `PMK-349` to `PMK-351`).
- Known failures on WSL (PMK-333), not caused by this work: `pr diff local fallback ... --base wins`, `pr open counts only what the branch lacks...`, `two view files whose names differ only in case...`.

## Review Focus

1. A description with a backtick, `$(` or a `## ` line stays text and comes back unchanged from `epic get` (Task 1, `epic create --description-file keeps shell characters and headings as text`).
2. An empty description file creates the epic with no description and no error (Task 1, `an empty description file creates the epic with no description`).
3. A description file with a BOM and CRLF line ends comes back with `\n` and no BOM (Task 1, `the description file is read like issues create reads it`).
4. A missing description file answers `INVALID_INPUT` and writes no epic (Task 1, `a missing description file writes no epic`).
5. In `import`, a spec path that answers `CONFLICT` in step 3 never reaches an approval with the old path (Task 2, static check `step 3 runs the docs create dry run before the tree is shown`).

---

### Task 1: `epic create --description-file`

**Files:**
- Modify: `scripts/pmkit.mjs:1428-1436` (the `epic create` entry)
- Modify: `skills/pmkit/references/conventions.md:39` (`epic create` joins the commands that take `--description-file`)
- Test: `scripts/cli.test.mjs` (local), `scripts/cli-linear.test.mjs` (Linear fake), `scripts/cli-cycles-epics-github.test.mjs` (GitHub fake)

**Interfaces:**
- Produces: `pmkit epic create (--title t | --title-file f) [--start d] [--target d] [--goal id] [--description-file f]`. Tasks 2 to 4 call it with `--description-file`.

- [ ] **Step 1: Write the failing tests**

In `scripts/cli.test.mjs`, on `makeRepo('basic')`:
- `epic create --description-file writes the description, and epic get shows it`: write `### Purpose\n\nFinance builds the monthly report by hand.\n` to a temp file; `json(root, ['epic', 'create', '--title', 'E', '--description-file', file])`; assert `after.description === '### Purpose\n\nFinance builds the monthly report by hand.'`; assert `run(root, ['epic', 'get', id]).stdout` contains `Finance builds the monthly report by hand.`; assert the file `.issues/epics/<id>/epic.md` ends with that text plus `\n`.
- `the epic create dry run shows the description and writes nothing`: same file with `--dry-run`; assert `after.description` equals the text and `hashTree(root)` is unchanged.
- `epic create --description-file keeps shell characters and headings as text`: description ``Run `make` and $(whoami)\n## Notes\nkept``; assert `epic get --json` returns it unchanged.
- `an empty description file creates the epic with no description`: empty file; assert exit 0 and `description === ''`.
- `the description file is read like issues create reads it`: file bytes `﻿Line one\r\nLine two`; assert `description === 'Line one\nLine two'`.
- `a missing description file writes no epic`: path that does not exist; assert error code `INVALID_INPUT` and `epic list --json` length unchanged.

In `scripts/cli-linear.test.mjs`: `epic create --description-file sends the content to Linear`: as the existing `epic create, progress, update-status...` test, with `--description-file`; assert the fake's `projectCreate` input has `content === 'Plan'`.

In `scripts/cli-cycles-epics-github.test.mjs`: `epic create --description-file sets the readme of the Project`: as `epic create, list and get work on linked Projects`, with `--description-file`; assert the fake's mutations include the readme mutation with `input.readme === 'Plan'`, and `epic get acme/13 --json` returns `description === 'Plan'`.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test scripts/cli.test.mjs scripts/cli-linear.test.mjs scripts/cli-cycles-epics-github.test.mjs`
Expected: the new tests FAIL with an unknown-flag usage error for `--description-file`.

- [ ] **Step 3: Implement the flag in `scripts/pmkit.mjs`**

Add `'description-file'` to `flags`, the usage line above, and `if (ctx.opt('description-file') !== undefined) input.description = readInput(ctx.opt('description-file'))`. The trackers already accept `description` and treat `''` as blank. Update the `epic create` line of `conventions.md:39`.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test scripts/cli.test.mjs scripts/cli-linear.test.mjs scripts/cli-cycles-epics-github.test.mjs scripts/cli-text-files.test.mjs`
Expected: PASS. If a help or usage snapshot test fails on the new usage line, update its expected text.

- [ ] **Step 5: Commit**

```bash
git add scripts/pmkit.mjs scripts/cli.test.mjs scripts/cli-linear.test.mjs scripts/cli-cycles-epics-github.test.mjs skills/pmkit/references/conventions.md
git commit -m "feat: take the epic description in epic create --description-file (PMK-347)"
```

### Task 2: `/pmkit:spec:import` stores the spec first and gives the epic a description

**Files:**
- Modify: `commands/spec/import.md` (steps 3 to 7, the removed step 10, Confirmation points, Output, If something is missing)
- Modify: `scripts/__scenarios__/spec-import.mjs` and its snapshot `spec-import.after.txt`
- Create: `scripts/__scenarios__/_inputs/description-webhook-delivery-platform.md`
- Create: `scripts/import-command.test.mjs` (static checks, on the model of `scripts/from-prd-command.test.mjs` and its `stage`/`section` helpers)

**Interfaces:**
- Consumes: `epic create --description-file` (Task 1).
- Produces: the new step numbers of `import.md` that Task 4 cites. Step 7 becomes: `7.1` store the spec, `7.2` the epic, `7.3` the milestones. Steps 8 and 9 keep their numbers. The old step 10 goes away and step 11 (temporary files) becomes step 10.

- [ ] **Step 1: Write the failing static tests in `scripts/import-command.test.mjs`**

Each test reads `commands/spec/import.md` and asserts on the step text:
- `step 3 drafts the epic description in the template`: step 3 contains `### Purpose`, `### Scope (in)`, `### Out of scope`, `### Documents`.
- `step 3 runs the docs create dry run before the tree is shown`: step 3 contains `docs create specs/<name>.md --body-file <file> --dry-run --json`, `CONFLICT` and `NOT_SUPPORTED`, and names the repository file `docs/specs/<name>.md`.
- `step 5 offers to store the spec, create without storing it, or stop`: step 5 names all three choices, and the two-choice case for a spec already under `docs/`.
- `step 7 stores the spec before the epic`: in step 7, the index of `docs create` is lower than the index of `epic create`, and `epic create` carries `--description-file`.
- `the epic dry run of step 6 carries the description`: step 6's `epic create` call has `--description-file <epic description file>`.
- `no step stores the spec after the issues`: no step after 7 contains `docs create`.
- `Documents paths are relative to the repository root`: the file contains `.issues/docs/`.
- `a repository spec file is said to have no commit`: Output mentions that the repository file has no commit yet.
- `an existing epic gets no description`: the file says that with an `epic-id` no description is drafted.

- [ ] **Step 2: Run them to verify they fail**

Run: `node --test scripts/import-command.test.mjs`
Expected: FAIL on every test but none crash.

- [ ] **Step 3: Rewrite `commands/spec/import.md` as the spec's "`/pmkit:spec:import`, new order" section says**

Keep the six section headings. Step 6 runs `epic create --title-file <epic title file> --description-file <epic description file> [--start <date>] [--target <date>] --dry-run --json`. Step 7.1 stores the spec with `docs create ... --json` (tracker) or the file tool (repository file), then 7.2 creates the epic with `--description-file`, then 7.3 the milestones. A failed 7.1 stops with nothing else created.

- [ ] **Step 4: Update the scenario**

In `scripts/__scenarios__/spec-import.mjs`, the spec is already under `docs/`, so step 3 runs no `docs create` dry run and 7.1 stores nothing: list them in `skip` (`'3 docs create'`, `'7.1 docs create'`), replace the old `'10 docs create'` skip and the `'Step 10'` notHit, rename `'7.2 milestone create'` to `'7.3 milestone create'`, and move the epic write to step `'7.2'`. Add `'--description-file', path.join(import.meta.dirname, '_inputs', 'description-webhook-delivery-platform.md')` to the `epic` call. The input file holds Purpose, Scope (in) and Documents with `- Spec: .issues/docs/specs/overview.md`. In `expect`, assert `repo.epic(epicId).description` contains `.issues/docs/specs/overview.md`. Regenerate the snapshot the way the other scenarios do (see the header of `scripts/scenarios.test.mjs`).

- [ ] **Step 5: Run the tests to verify they pass**

Run: `node --test scripts/import-command.test.mjs scripts/scenarios.test.mjs`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add commands/spec/import.md scripts/import-command.test.mjs scripts/__scenarios__/spec-import.mjs scripts/__scenarios__/spec-import.after.txt scripts/__scenarios__/_inputs/description-webhook-delivery-platform.md
git commit -m "feat: store the spec before the epic in spec:import and give the epic a description (PMK-347)"
```

### Task 3: runbook and E2E test of `/pmkit:spec:import`

**Files:**
- Create: `docs/runbooks/spec-import.md`
- Create: `scripts/runbook-spec-import.test.mjs`

**Interfaces:**
- Consumes: the step numbers and calls of Task 2.

- [ ] **Step 1: Write the runbook and the failing E2E test**

The runbook follows `docs/runbooks/spec-from-prd.md`: a Local tracker, a spec pasted (outside `docs/`), the calls the command makes after the step 5 approval, in order: step 3 `docs create specs/<name>.md --body-file tmp/spec.md --dry-run --json`, step 6 dry runs, step 7.1 `docs create` without `--dry-run`, step 7.2 `epic create --title-file tmp/epic-title.txt --description-file tmp/epic-description.md --json`, step 8 issues, step 9 links. The test, on the model of `scripts/runbook-spec-from-prd.test.mjs`, has these tests:
- `the runbook names every call the test runs`: each CLI call of the test appears in the runbook text.
- `import stores the spec, then creates the epic with a description that cites it`: after the run, `docs read specs/<name>.md --json` returns the spec, and `epic get <id> --json` returns a description that contains `### Purpose` and `.issues/docs/specs/<name>.md`.
- `the step 3 dry run writes nothing`: `hashTree` is equal before and after the dry run.
- `a second import with the same spec name answers CONFLICT at step 3`: the dry run answers `CONFLICT` and nothing changes.

- [ ] **Step 2: Run it to verify it fails, then fix the runbook or the test until it passes**

Run: `node --test scripts/runbook-spec-import.test.mjs`
Expected first: FAIL only where the runbook text and the calls disagree. Then PASS.

- [ ] **Step 3: Commit**

```bash
git add docs/runbooks/spec-import.md scripts/runbook-spec-import.test.mjs
git commit -m "test: add the spec:import runbook and its E2E test (PMK-347)"
```

### Task 4: `/pmkit:spec:from-prd` Stage 4 drafts the epic description

**Files:**
- Modify: `commands/spec/from-prd.md` (Stage 4, Stage 5's reference to `import` step 7.2, Confirmation points, Output)
- Modify: `scripts/from-prd-command.test.mjs`
- Modify: `docs/runbooks/spec-from-prd.md` and `scripts/runbook-spec-from-prd.test.mjs`

**Interfaces:**
- Consumes: `epic create --description-file` (Task 1); `import` steps 7.2 (epic) and 7.3 (milestones), and step 7.1 (spec), which Stage 4 skips (Task 2).

- [ ] **Step 1: Write the failing tests**

In `scripts/from-prd-command.test.mjs`, with the `stage` and `section` helpers:
- `Stage 4 drafts the epic description in the template`: `stage('Stage 4')` contains the four `###` headings.
- `the epic description cites the stored refined PRD and the ADRs`: Stage 4 names the stored path of Stage 3b and the ADRs of Stage 3 and of the Resume step, and says a declined ADR is not listed.
- `the epic approval shows the full description`: Stage 4 says the approval shows the description whatever `write_policy.confirm` says.
- `Stage 4 skips the spec sub-step of import step 7`: Stage 4 names `7.2` and `7.3` and says it skips `7.1`.
- `Stage 5 cites the new milestone sub-step`: `stage('Stage 5')` contains `step 7.3` and not `step 7.2`.
- `a failed readme stops with the epic ID and the drafted description`: Stage 4 names `UPSTREAM`, the new epic ID, and showing the drafted description for the PM to paste.
- `an existing epic gets no description`: Stage 4 says no description is drafted with an `epic-id` or a matched epic.

In `scripts/runbook-spec-from-prd.test.mjs`, the Stage 4 write gains `--description-file tmp/epic-description.md`, and a new assertion: `epic get <epic-id> --json` returns a description that contains `### Purpose` and `.issues/docs/specs/bulk-export-prd.md`.

- [ ] **Step 2: Run them to verify they fail**

Run: `node --test scripts/from-prd-command.test.mjs scripts/runbook-spec-from-prd.test.mjs`
Expected: the new tests FAIL.

- [ ] **Step 3: Rewrite Stage 4 and the other sections of `commands/spec/from-prd.md`, and step 5 of `docs/runbooks/spec-from-prd.md`, as the spec's "`/pmkit:spec:from-prd`, Stage 4" section and its GitHub readme subsection say**

The runbook lists `tmp/epic-description.md` with its content among the input files and adds `--description-file tmp/epic-description.md` to the `epic create` line.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test scripts/from-prd-command.test.mjs scripts/runbook-spec-from-prd.test.mjs scripts/scenarios.test.mjs`
Expected: PASS. The `from-prd` snapshots do not change.

- [ ] **Step 5: Commit**

```bash
git add commands/spec/from-prd.md scripts/from-prd-command.test.mjs docs/runbooks/spec-from-prd.md scripts/runbook-spec-from-prd.test.mjs
git commit -m "feat: draft the epic description in spec:from-prd Stage 4 (PMK-347)"
```

### Task 5: changelog and full suite

**Files:**
- Modify: `CHANGELOG.md` (one entry at the top of Unreleased)

- [ ] **Step 1: Add the entry**

One entry: `epic create` takes `--description-file`; `/pmkit:spec:from-prd` and `/pmkit:spec:import` give each new epic a description with its purpose, scope and documents; `/pmkit:spec:import` now stores the spec before it creates the epic, and on Linear and GitHub stores it in `docs/specs/` of the repository.

- [ ] **Step 2: Run the full suite**

Run: `npm test`
Expected: every test passes except the three PMK-333 tests named in Global Constraints.

- [ ] **Step 3: Commit**

```bash
git add CHANGELOG.md
git commit -m "docs: record the epic description in the changelog (PMK-347)"
```
