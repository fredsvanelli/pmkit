# PMK-45 strategic goals implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Goals in `.issues/goals/<ID>.md`, linked from epics, listed and rolled up by the CLI, with `strategic_goals` native on Local.

**Architecture:** A pure file module `scripts/lib/local/goals.mjs` (parse, serialize, sort, id rule), five tracker operations in `scripts/lib/local/tracker.mjs` that reuse one progress function with `deliverableProgress`, and CLI commands in `scripts/pmkit.mjs`. Linear gets the generic stubs and an absent manifest entry.

**Tech Stack:** Node.js ESM, `node:test`, no dependencies (ADR-0003).

**Spec:** `docs/superpowers/specs/2026-10-30-pmk-45-strategic-goals-design.md`

## Global constraints

- Goal IDs: prefix `GOAL`, code by `id_style` (`GOAL-7K3Q` random, `GOAL-1` numbered). `isId(value, 'GOAL')` and `normalizeId` apply.
- File: `goals/<ID>.md`, frontmatter `title` (required, one line) and `target` (optional `YYYY-MM-DD`), body is the description. No `id` key written.
- Epic key `goal`, written after `milestone` in `EPIC_KEYS`.
- Tracker format stays 2. No migration.
- Every commit message carries `(PMK-45)` and ends with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Keep the edits to `capabilities.mjs`, the `capabilities.txt` goldens, `README.md`, `CHANGELOG.md` and ADR-0001 to the lines this issue needs (parallel issues touch them).

## Review focus

- A goal file with conflict markers or bad YAML: `goal list` skips it with a warning, `validate` reports it once (`conflict` or `goal`). Test in Task 1 and Task 4.
- `epic goal` with a goal ID in lowercase or with `O`/`I` letters: normalized before the lookup. Test in Task 2.
- `epic goal <epic> none` on an epic with no goal: no write and no event. Test in Task 2.
- `goal progress` with an archived or canceled issue under a linked epic: counted exactly as `epic progress` counts it. Test in Task 2 compares with `deliverableProgress`.
- `GOAL-1.md` and a numbered next ID: `nextNumberedId` must read file stems, not names with `.md`. Test in Task 2.

---

### Task 1: The goal file module

**Files:**
- Create: `scripts/lib/local/goals.mjs`
- Modify: `scripts/lib/local/epics.mjs` (`EPIC_KEYS`, `parseEpicFile`, `epicFrontmatter` gain `goal`)
- Test: `scripts/goals.test.mjs`

**Interfaces:**
- Produces: `GOAL_PREFIX = 'GOAL'`; `goalStems(dir) -> Set<string>`; `parseGoal(text, id) -> { id, title, target?, description }` (throws `INVALID_INPUT` with next step `/pmkit:local:doctor`, `CONFLICT` on markers, through `parseFile`); `serializeGoal({ title, target, description }) -> string`; `sortGoals(list)` by target, then `compareIds`, no target last.

- [ ] **Step 1: Write the failing tests**: a goal round trips through `serializeGoal`/`parseGoal`; `parseGoal` refuses an empty title, a title with a line break and `target: soon`; an `id` key in the file is ignored; `sortGoals` puts `GOAL-2` (target 2026-11-01) before `GOAL-10` (target 2026-12-01) before `GOAL-3` (no target); `parseEpicFile` reads `goal: GOAL-1` and `serializeEpic` writes it after `milestone`.
- [ ] **Step 2: Run `node --test scripts/goals.test.mjs`**: fails, module missing.
- [ ] **Step 3: Implement the module** following `milestones.mjs` and `releases.mjs`.
- [ ] **Step 4: Run the test**: passes.
- [ ] **Step 5: Commit** `feat(goals): add the goal file format and the epic goal key (PMK-45)`.

### Task 2: Tracker operations

**Files:**
- Modify: `scripts/lib/local/tracker.mjs`, `scripts/lib/contract.mjs`
- Test: `scripts/goals.test.mjs`

**Interfaces:**
- Consumes: Task 1.
- Produces: `listGoals() -> { goals, problems: [{ id, code, message }] }`; `getGoal(id) -> goal`; `createGoal({ title, target?, description? }, actor, { dryRun }) -> { before: null, after }`; `goalProgress(id) -> { goal, epics: [{ id, title, status, progress }], total, done, canceled, points, pointsDone, byCategory }`; `setEpicGoal(epicId, goal | null, actor, { dryRun }) -> { before, after }`; `createDeliverable` accepts `goal`. A goal record has `epics: [epic ids]` in `listDeliverables` order. Contract list gains `'listGoals', 'getGoal', 'createGoal', 'goalProgress', 'setEpicGoal'` after the views line.

- [ ] **Step 1: Write the failing tests** on the `team` fixture (epic `EPC-2M9D`):
  - `createGoal({ title: 'Trust', target: '2026-12-31' }, 'fred')` writes `goals/<id>.md` with `---\ntitle: Trust\ntarget: 2026-12-31\n---\n`, the id matches `isId(id, 'GOAL')`, and a dry run writes nothing (`hashTree` unchanged).
  - With `id_style: numbered` and an existing `goals/GOAL-1.md`, the next goal is `GOAL-2`.
  - `setEpicGoal('epc-2m9d', id.toLowerCase(), 'fred')` sets `after.goal === id`, appends `{ op: 'update', field: 'goal', from: null, to: id }` to the epic events; `getGoal(id).epics` is `['EPC-2M9D']`; `setEpicGoal('EPC-2M9D', null, 'fred')` removes it; a second removal changes no file.
  - `setEpicGoal` and `createDeliverable({ title, goal: 'GOAL-ZZZZ' })` refuse a missing goal with `INVALID_INPUT`.
  - `goalProgress(id)` after linking: `epics[0].progress` deep-equals `deliverableProgress('EPC-2M9D')`, the sums equal it, and a goal with no epics gives zeros and `epics: []`.
  - `listGoals()` skips a goal file with bad YAML and a stem `notes.md` and reports both in `problems`; `getGoal('GOAL-9')` is `NOT_FOUND`.
- [ ] **Step 2: Run the tests**: they fail.
- [ ] **Step 3: Implement.** Extract `progressOf(epicId, issues)` from `deliverableProgress` and use it in both. Goal IDs come from stems: `nextNumberedId(GOAL_PREFIX, [...goalStems(dir)])` or `newId(GOAL_PREFIX, { random, exists: (c) => goalStems(dir).has(c) })`. `requireGoal(value)` normalizes, checks the file exists and parses.
- [ ] **Step 4: Run `node --test scripts/goals.test.mjs scripts/contract.test.mjs scripts/epics.test.mjs`**: passes.
- [ ] **Step 5: Commit** `feat(goals): add goal operations to the Local tracker (PMK-45)`.

### Task 3: CLI, capability and Linear

**Files:**
- Modify: `scripts/pmkit.mjs`, `scripts/lib/args.mjs` (`GROUPS` gains `goal`), `scripts/lib/format.mjs` (`goalRecord`, `goal` line in `epicRecord`), `scripts/lib/capabilities.mjs`, `scripts/lib/linear/manifest.mjs`, `scripts/lib/linear/tracker.mjs` (`STUB_CAPABILITY`), `scripts/lib/linear/project-ops.mjs` (`goal` input is `NOT_SUPPORTED`)
- Test: `scripts/goals.test.mjs`, `scripts/capabilities.test.mjs`, `scripts/lib/linear/manifest.test.mjs`, `scripts/cli-degraded-coverage.test.mjs`, `scripts/cli-autocommit.test.mjs`, `scripts/golden-cases.mjs` and goldens

**Interfaces:**
- Consumes: Task 2.
- Produces: commands `goal list`, `goal get <id>`, `goal create --title t [--target d]`, `goal progress <id>`, `epic goal <epic> <goal|none>`, `epic create --goal`, a `goal:` line in `epic get`, a Goal column in `epic list` only when an epic has a goal. `SERVED_BY.strategic_goals` lists the five command names.

- [ ] **Step 1: Write the failing tests**: CLI `goal create`, `goal list --json` (array), `goal get`, `epic goal`, `goal progress --json` (shape of the spec) on a temp `team` repo; `capabilities --json` reports `strategic_goals` native; Linear Business manifest gives `{ path: 'absent', detail: { workspace: 'native', unsupported: [five ops] }, enableHint: 'The Linear adapter does not serve initiatives yet; Linear offers them on this workspace' }`; Free plan keeps the plan hint; REFUSALS gain `goal list`, `goal get GOAL-1`, `goal create --title G`, `goal progress GOAL-1`, `epic goal P-ACM-1 GOAL-1`; WRITES gain `goal create` and `epic goal`.
- [ ] **Step 2: Run the tests**: they fail.
- [ ] **Step 3: Implement**, then add golden cases (`goal list`, `goal get`, `goal progress`, `goal create`, `epic goal`), a `goal` anchor `GOAL-8K2W` in every fixture, and `goals/GOAL-8K2W.md` in `scripts/__fixtures__/no-sprints` with `EPC-4H7V` linked to it.
- [ ] **Step 4: Run `UPDATE_GOLDENS=1 node --test scripts/goldens.test.mjs`, review the golden diff, then `npm test`**: passes.
- [ ] **Step 5: Commit** `feat(goals): add the goal commands and serve strategic_goals (PMK-45)`.

### Task 4: Validate, doctor, migration and docs

**Files:**
- Modify: `scripts/lib/validate.mjs`, `commands/local/doctor.md`, `scripts/lib/local/migrate-reader.mjs`, `scripts/lib/linear/migrate-fields.mjs`, `README.md`, `CHANGELOG.md`, `CONTEXT.md`, `docs/adr/0001-local-tracker-is-the-reference-implementation.md`, `docs/superpowers/specs/2026-10-23-pmkit-design.md`
- Test: `scripts/validate-goals.test.mjs`, `scripts/lib/local/migrate-reader.test.mjs`, `scripts/lib/linear/migrate-fields.test.mjs`

- [ ] **Step 1: Write the failing tests**: validate reports `goal` for `goals/bad.md` (stem), `goals/GOAL-2.md` with no title, `goals/GOAL-3.md` with `target: soon`; `conflict` only for a goal file with markers; `reference` for an epic with `goal: GOAL-9`; `outOfScope.goals` counts goal files; `mapExport` lists `goals` with why `2 goals stay in .issues/goals/; pmkit does not create Linear initiatives, so epics lose their goal links`.
- [ ] **Step 2: Run them**: they fail.
- [ ] **Step 3: Implement**, add `goal` to the doctor's hand-fix list, and update the docs: README CLI rows, a CHANGELOG line under `## Unreleased`, the Goal glossary entry, ADR-0001 counts (17 served, 13 native, absent `demand_signals`, `request_queue`, `user_inbox`), and the Goal entity and Goals contract row in the design spec.
- [ ] **Step 4: Run `npm test`**: passes.
- [ ] **Step 5: Commit** `feat(goals): validate goals, count them in the export and document them (PMK-45)`.
