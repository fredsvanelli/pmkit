# `/pmkit:spec:from-prd` Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the command `/pmkit:spec:from-prd`, which turns a one-page PRD into a refined PRD, ADRs, an epic with estimated issues, and blocker links.

**Architecture:** One Markdown command, `commands/spec/from-prd.md`, with a new product interview and stages that follow the procedures of `commands/spec/record-decision.md` and `commands/spec/import.md` by reference. Subagents read, draft and check, and never write. Static tests pin the rules in the command text. A runbook with an E2E test runs the CLI sequence of the flow on the Local tracker.

**Tech Stack:** Markdown commands, the `pmkit.mjs` CLI, Node's `node:test` (no dependencies).

**Spec:** `docs/specs/2026-11-17-pmk-338-spec-from-prd-design.md`

## Global Constraints

- Issue PMK-338. Every commit message carries `(PMK-338)`.
- No CLI change. The command calls only CLI commands that exist (`scripts/plugin.test.mjs` checks every `pmkit.mjs` call).
- No dependencies (ADR 0003). Tests use `node:test` and `node:assert/strict`.
- Every write goes through `node "${CLAUDE_PLUGIN_ROOT}/scripts/pmkit.mjs"` (ADR 0002). Titles, names and descriptions go through `--title-file`, `--name-file`, `--body-file`, `--description-file`, never inline.
- The command file has the frontmatter keys `description`, `argument-hint` and `disable-model-invocation: true`, the line ``Arguments: `$ARGUMENTS` ``, and the sections `## Parameters`, `## Steps`, `## Confirmation points`, `## Output`, `## If something is missing`, in that order (`HEADINGS` in `scripts/plugin.test.mjs`). The first line of `## Steps` reads the conventions.
- `argument-hint: "<prd file or pasted text> [epic-id]"`.
- The interview asks one question per message and never asks about technology, architecture or storage.
- No subagent writes to the tracker. Every write runs in the main agent after an approval.
- Approvals, in order: the refined PRD (content and path), each ADR, the epic with its milestones, the issue tree, and the extra links of the final check when there are any.
- A declined ADR turns its decision into `PRD only` and the flow goes on. A declined stage of any other kind stops the flow, lists what was written, and names `/pmkit:spec:from-prd specs/<slug>-prd.md` or the original PRD as the way to continue.
- The refined PRD is written with `docs create specs/<slug>-prd.md` after the ADRs (stage 3b). On `NOT_SUPPORTED` it goes to the repository file `docs/specs/<slug>-prd.md`.
- Draft estimates use `issues list --category done --text <word>` hits with an estimate, never `issues similar` (it needs an existing issue ID).
- Prose in the command and the runbook follows the style of the existing commands: short sentences, active voice, no em dashes.

## Review Focus

1. A PRD that already has criteria for every requirement: the interview asks nothing about criteria and goes to the playback. Pinned in Task 2 by a test that the text says to skip a question the PRD already answers.
2. The PM stops the interview early: the requirements without criteria go under "Open questions", and the import marks them "needs criteria". Pinned in Task 2.
3. The approved path for the refined PRD is taken between stage 2 and stage 3b (`CONFLICT`): the command asks for a new name and names both paths, because the ADRs cite the old one. Pinned in Task 3.
4. A resume where an ADR already exists for a decision: the decision is skipped, and ADRs in the repository's `docs/adr/` count too. Pinned in Task 4.
5. A tracker without blocker links or without an estimate scale: stage 5 follows `spec:import` and `issues:estimate`, and the output says the path taken. Pinned in Task 4 by a test that the text points to those rules.

---

### Task 1: Register the command

**Files:**
- Create: `commands/spec/from-prd.md` (frontmatter, title, the six sections with one placeholder line each)
- Modify: `scripts/plugin.test.mjs:93` (add `'from-prd'` to `spec`)
- Modify: `skills/pmkit/SKILL.md:64` (new row above `spec:import`)
- Modify: `README.md:62` (new line above `spec:import`)

**Interfaces:**
- Produces: the file `commands/spec/from-prd.md` with the six headings, which Tasks 2 to 4 fill.

- [ ] **Step 1: Write the failing test.** In `scripts/plugin.test.mjs`, change the `spec` entry of `COMMANDS` to `['import', 'record-decision', 'adr-status', 'from-prd']`.
- [ ] **Step 2: Run it.** `node --test scripts/plugin.test.mjs`. Expected: FAIL on "the 4 commands in commands/spec exist" and on "every command is listed in the skill table and in the README".
- [ ] **Step 3: Add the files.** Create the command with `description: Turn a one-page PRD into a refined PRD, ADRs for the decisions that are hard to reverse, an epic with estimated issues, and blocker links` and the `argument-hint` from Global Constraints. SKILL.md row: `| turn a vague or one-page PRD into a refined PRD, ADRs and an estimated, linked backlog | `/pmkit:spec:from-prd` | `${CLAUDE_PLUGIN_ROOT}/commands/spec/from-prd.md` |`. README line: ``- `/pmkit:spec:from-prd`: Interview the PM on a one-page PRD, then store the refined PRD, write an ADR per decision that is hard to reverse, and create the epic, the estimated issues and their blocker links, with an approval at each stage.``
- [ ] **Step 4: Run it.** `node --test scripts/plugin.test.mjs`. Expected: PASS.
- [ ] **Step 5: Commit.** `git add commands/spec/from-prd.md scripts/plugin.test.mjs skills/pmkit/SKILL.md README.md && git commit -m "feat: register the /pmkit:spec:from-prd command (PMK-338)"`

### Task 2: Recon, interview and refined PRD (stages 0 to 2)

**Files:**
- Create: `scripts/from-prd-command.test.mjs` (static checks, in the style of `scripts/estimate-command.test.mjs`)
- Modify: `commands/spec/from-prd.md` (`## Parameters`, steps of stages 0 to 2)

**Interfaces:**
- Consumes: the command file of Task 1.
- Produces: in `from-prd.md`, numbered steps whose first line names the stage (`Stage 0: recon`, `Stage 1: interview`, `Stage 2: refined PRD`), and the refined PRD sections Problem, Users, Scope (in), Out of scope, Use cases, Requirements, Decisions, Phases, Open questions. Tasks 3 and 4 add later stages after them. The test file exports nothing; Tasks 3 and 4 add tests to it and reuse its `text` constant and a `stage(name)` helper that returns the text of one stage step.

- [ ] **Step 1: Write the failing tests** in `scripts/from-prd-command.test.mjs`:
  - `'stage 0 reads with a subagent that writes nothing, and runs in sequence without one'`: `stage('Stage 0')` matches `/subagent/`, `/writes nothing/`, `/without subagents/i`, `/issues list --text/`, `/epic list --json/`, `/docs list --json/`.
  - `'likely duplicates are shown before the first question'`: `stage('Stage 0')` matches `/duplicate/` and `/AskUserQuestion/`.
  - `'the interview asks one question per message and nothing technical'`: `stage('Stage 1')` matches `/one question per message/` and `/never asks? about technology, architecture or storage/`.
  - `'the interview skips what the PRD, the recon or the code answer'`: matches `/Skip any question the PRD/` and `/go(es)? to the code, not to the PM/`.
  - `'the interview covers scope, use cases and criteria, with error and edge cases'`: matches `/scope/`, `/use cases?/`, `/acceptance criteri/`, `/edge cases?/`.
  - `'each decision is marked ADR or PRD only, and ADR means hard to reverse'`: matches `` /`ADR`/ ``, `` /`PRD only`/ ``, `/hard to reverse/`.
  - `'the interview stops on coverage, with a soft limit of 15 questions'`: matches `/at least one acceptance criterion/` and `/15 questions/`.
  - `'an early stop sends the gaps to Open questions and the import marks them needs criteria'`: matches `/Open questions/` and `/needs criteria/`.
  - `'stage 2 approves the content and the path, and does not write the file'`: `stage('Stage 2')` matches `/docs create specs\/<slug>-prd\.md --body-file <file> --dry-run --json/`, `/AskUserQuestion/` and `/Stage 3b/`.
- [ ] **Step 2: Run them.** `node --test scripts/from-prd-command.test.mjs`. Expected: FAIL on every test.
- [ ] **Step 3: Write the steps** for stages 0 to 2 in `from-prd.md`, from the design's sections "Stage 0", "Stage 1" and "Stage 2". The `## Parameters` section names `prd` (required: a path under the tracker's `docs/`, a local file, or pasted text) and `epic-id` (optional).
- [ ] **Step 4: Run them.** `node --test scripts/from-prd-command.test.mjs scripts/plugin.test.mjs`. Expected: PASS.
- [ ] **Step 5: Commit.** `git commit -m "feat: add the recon, the product interview and the refined PRD to spec:from-prd (PMK-338)"`

### Task 3: ADRs and storing the refined PRD (stages 3 and 3b)

**Files:**
- Modify: `commands/spec/from-prd.md`
- Modify: `scripts/from-prd-command.test.mjs`

**Interfaces:**
- Consumes: `text` and `stage(name)` from Task 2; the decision marks of stage 1.

- [ ] **Step 1: Write the failing tests:**
  - `'each ADR follows record-decision and is asked one by one'`: `stage('Stage 3')` matches `/commands\/spec\/record-decision\.md/` and `/once per ADR|one approval per ADR/`.
  - `'an ADR cites the refined PRD path and has no related issues yet'`: matches `/names the refined PRD path/` and `/stage 6 links them/i`.
  - `'a declined ADR becomes PRD only and the flow goes on'`: matches `` /declines one ADR[^.]*`PRD only`/ `` and `/never stops the flow/`.
  - `'stage 3b writes the refined PRD after the ADRs, with no new approval'`: `stage('Stage 3b')` matches `/docs create/`, `/after the ADRs/`, `/no new approval|covers it/`.
  - `'a taken path asks for a new name and names both paths'`: matches `` /`CONFLICT`/ `` and `/both paths/`.
  - `'a tracker that cannot create documents gets a repository file'`: matches `` /`NOT_SUPPORTED`/ `` and `/docs\/specs\/<slug>-prd\.md/`.
- [ ] **Step 2: Run them.** Expected: FAIL on the new tests.
- [ ] **Step 3: Write the steps** of stages 3 and 3b from the design.
- [ ] **Step 4: Run them.** `node --test scripts/from-prd-command.test.mjs scripts/plugin.test.mjs`. Expected: PASS.
- [ ] **Step 5: Commit.** `git commit -m "feat: write the ADRs and store the refined PRD in spec:from-prd (PMK-338)"`

### Task 4: Epic, issue tree, final check, resume and output (stages 4 to 6)

**Files:**
- Modify: `commands/spec/from-prd.md` (stages 4 to 6, the resume step, `## Confirmation points`, `## Output`, `## If something is missing`)
- Modify: `scripts/from-prd-command.test.mjs`

**Interfaces:**
- Consumes: `text` and `stage(name)` from Task 2.

- [ ] **Step 1: Write the failing tests:**
  - `'the epic and milestones are approved before any issue'`: `stage('Stage 4')` matches `/commands\/spec\/import\.md/` and `/AskUserQuestion/`.
  - `'drafting subagents copy the criteria from the refined PRD and never invent them'`: `stage('Stage 5')` matches `/subagent/`, `/never new ones|never invent/` and `/without subagents/i`.
  - `'draft estimates use done issues, not issues similar'`: matches `/issues list --category done --text/` and `/code alone/`, and `stage('Stage 5')` does not match `/issues similar <id>/`.
  - `'the tree is shown in full and the links follow spec:import'`: matches `/full tree/` and `/issues link/`.
  - `'the final check reads and reports, and fixes only with approval'`: `stage('Stage 6')` matches `/issues dependencies <epic-id> --json/`, `/requirements? .*with no issue/`, `/one bulk preview/`, `/never as an issue created without approval/`.
  - `'no subagent writes'`: `text` matches `/No subagent writes to the tracker/`.
  - `'a resume skips existing ADRs in the tracker and in the repository'`: `stage('Resume')` matches `/docs list/`, `/docs\/adr\//`, `/skips? the decisions that already have one/`.
  - `'a declined stage lists what was written and names the next command'`: `text` matches `/\/pmkit:spec:from-prd specs\/<slug>-prd\.md/` and `/lists what it already wrote/`.
  - `'the confirmation points list every approval'`: the `## Confirmation points` section matches `/refined PRD/`, `/each ADR/`, `/epic/`, `/issue tree|tree/`, `/extra links/`.
  - `'the output ends with the critical path and cycle:plan'`: the `## Output` section matches `/critical path/` and `/\/pmkit:cycle:plan/`.
- [ ] **Step 2: Run them.** Expected: FAIL on the new tests.
- [ ] **Step 3: Write** stages 4 to 6, the resume step, and the last three sections from the design (sections "Stage 4" to "Stage 6", "Output", "When the PM declines a stage", "Resuming", "Subagents").
- [ ] **Step 4: Run them.** `node --test scripts/from-prd-command.test.mjs scripts/plugin.test.mjs`. Expected: PASS.
- [ ] **Step 5: Commit.** `git commit -m "feat: create the epic, the issue tree and the final check in spec:from-prd (PMK-338)"`

### Task 5: Runbook and its E2E test

**Files:**
- Create: `docs/runbooks/spec-from-prd.md` (format of `docs/runbooks/issues-github.md`: a summary line, `## Before you start`, one section per stage, the commands each stage runs)
- Create: `scripts/runbook-spec-from-prd.test.mjs`

**Interfaces:**
- Consumes: `makeRepo('basic')`, `tempDir`, `userStoreEnv` from `scripts/test-helpers.mjs`; `childEnv` from `scripts/golden-helpers.mjs`. The CLI runs as a subprocess, as in `scripts/runbook-setup-github.test.mjs`.

The interview and the approvals cannot run in a test. The E2E runs the CLI calls the command makes after each approval, in the order of the stages, on the Local tracker.

- [ ] **Step 1: Write the failing tests:**
  - `'the runbook names the commands this test runs'`: the runbook text includes `docs create specs/`, `docs next-adr --title-file`, `epic create --title-file`, `milestone create`, `issues create --title-file`, `--criteria-file`, `issues link`, `--kind blocks`, `issues dependencies`.
  - `'runbook: a refined PRD becomes an ADR, an epic, estimated issues with criteria, and a critical path'`: in a `basic` repo, run `docs create specs/bulk-export-prd.md --body-file <prd> --dry-run --json` (exit 0, nothing written), then the same without `--dry-run`; write the ADR through `docs next-adr` and `docs create` at its `docPath` with a body that names `specs/bulk-export-prd.md`; create the epic, one milestone and three issues with `--estimate`, `--description-file` and `--criteria-file`; link issue 1 blocks 2 and 2 blocks 3. Assert: `docs read specs/bulk-export-prd.md --json` returns the body; every issue from `issues list --parent <epic> --json` has an `estimate` and a non-empty `acceptanceCriteria`; `issues dependencies <epic> --json` has `basis` `blockers` and `criticalPath.ids` equal to the three IDs in order.
  - `'runbook: a taken PRD path answers CONFLICT and writes nothing'`: a second `docs create specs/bulk-export-prd.md` exits 2 with `error.code` `CONFLICT`, and `hashTree` of `.issues/docs` is unchanged.
  - `'runbook: a resume finds the ADR that cites the refined PRD'`: after the first scenario, `docs list --json` holds the ADR path, and `docs read <it>` contains `specs/bulk-export-prd.md`.
- [ ] **Step 2: Run them.** `node --test scripts/runbook-spec-from-prd.test.mjs`. Expected: FAIL (no runbook file).
- [ ] **Step 3: Write the runbook** with the commands above, one section per stage, and a "What the test checks" section, as in the other runbooks.
- [ ] **Step 4: Run them.** Expected: PASS. If an assertion on a CLI result fails, check the real shape with the CLI before changing the test, using `superpowers:systematic-debugging`.
- [ ] **Step 5: Commit.** `git commit -m "test: add the spec:from-prd runbook and its E2E test (PMK-338)"`

### Task 6: Changelog, glossary and the full suite

**Files:**
- Modify: `CHANGELOG.md` (a line under `## Unreleased`)
- Modify: `CONTEXT.md` (the term **Refined PRD**)

- [ ] **Step 1: Add the CHANGELOG line**: `` - `/pmkit:spec:from-prd` turns a one-page PRD into a refined PRD, ADRs for the product decisions that are hard to reverse, an epic with estimated issues and blocker links, with an approval at each stage and subagents that read, draft and check (PMK-338). ``
- [ ] **Step 2: Add the CONTEXT.md term**, with `mattpocock-skills:domain-modeling`: **Refined PRD**: the PRD after the `/pmkit:spec:from-prd` interview, with scope, use cases, requirements with acceptance criteria, and each decision marked `ADR` or `PRD only`, stored at `docs/specs/<slug>-prd.md` in the tracker or the repository. _Avoid_: spec (a spec is the technical design of one issue).
- [ ] **Step 3: Run the full suite.** `npm test`. Expected: every test passes. The four WSL failures of PMK-333 may appear on this machine; report them as known, not as new.
- [ ] **Step 4: Commit.** `git commit -m "docs: add the spec:from-prd changelog entry and the Refined PRD term (PMK-338)"`
