# Improve goals Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the six PMK-213 criteria: `goal_prefix`, `goal update|close|delete`, goal status, Linear initiative reads, `goal progress` warnings, `validate` goal count.

**Architecture:** Local goal files gain a `status` key and a configurable prefix; two contract operations (`updateGoal`, `deleteGoal`) back three CLI commands. The Linear adapter gets a small `goal-ops.mjs` that reads initiatives as goals and reuses `deliverableProgress`.

**Tech Stack:** Node ESM, `node:test`, no dependencies (ADR-0003).

**Spec:** `docs/superpowers/specs/2026-11-10-pmk-213-improve-goals-design.md`

## Global Constraints

- Every commit message carries `(PMK-213)` and ends with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Goal statuses, exactly: `proposed`, `planned`, `active`, `completed`, `canceled`; missing reads as `active`.
- `goal_prefix`: `^[A-Z]{2,5}$`, default `GOAL`, differs from `id_prefix` and `epic_prefix`.
- An incomplete read is `complete: false` plus a warning in the JSON and the text; never a conclusion.
- Never run the CLI inside `scripts/__fixtures__/`; tests copy fixtures with `makeRepo`.
- `npm test` exits 0 in the foreground before the PR.

## Review Focus

- A goal file with a hand-written `status: Active` (capitalized) — refused as not in the list (`INVALID_INPUT` naming the values), not silently mapped. Test in Task 1.
- `goal update GOAL-X --target none` on a goal without target writes nothing. Test in Task 2.
- `goal delete` while an epic file does not parse refuses and writes nothing (hashTree unchanged). Test in Task 2.
- `goals overview` must not grow a `warnings` key inside each item after `goalProgress` returns `warnings`. Test in Task 3.
- Linear `getGoal` with the identifier in lower case finds the goal. Test in Task 4.

---

### Task 1: goal_prefix and goal status in the Local model

**Files:**
- Modify: `scripts/lib/config.mjs` (DEFAULTS, `localConfigShapeProblems`, `validateLocalConfig`)
- Modify: `schemas/issues.config.schema.json` (add `goal_prefix`)
- Modify: `scripts/lib/local/goals.mjs` (drop `GOAL_PREFIX`, add `GOAL_STATUSES`, status in parse/serialize)
- Modify: `scripts/lib/local/tracker.mjs` (`local.goal_prefix` everywhere `GOAL_PREFIX` was; `createGoal` takes `status`)
- Modify: `scripts/lib/validate.mjs` (`local.goal_prefix`)
- Modify: `scripts/lib/format.mjs` (`goalRecord` adds `status` after title), `scripts/pmkit.mjs` (`goal list` Status column, `goal create --status --title-file`)
- Test: `scripts/goals.test.mjs`, `scripts/config.test.mjs`, `scripts/schemas.test.mjs` if it lists keys

**Interfaces:**
- Produces: `GOAL_STATUSES = ['proposed','planned','active','completed','canceled']` from `goals.mjs`; `parseGoal(text, id)` → `{ id, title, status, target?, description }`; `serializeGoal({ title, status, target, description })` with order `title, status, target`; `config.local.goal_prefix`.

- [ ] Step 1: Tests. `parseGoal('---\ntitle: T\n---\n','GOAL-1').status === 'active'`; `status: Active` and `status: done` throw `INVALID_INPUT` with nextStep `/pmkit:local:doctor`; `serializeGoal({title:'T',status:'active',description:''}) === '---\ntitle: T\nstatus: active\n---\n'`; `createGoal({title:'Trust'})` writes `status: active` and `createGoal({title:'T',status:'planned'})` writes planned, `status:'nope'` is `INVALID_INPUT`; with `goal_prefix: OKR` in config, `createGoal` ids match `isId(id,'OKR')` and a `GOAL-1.md` file is a `kind: 'file'` problem in `listGoals`; config: `goal_prefix: ok` → problem `goal_prefix must be 2 to 5 capital letters`, `id_prefix: GOAL` without goal_prefix → `id_prefix, epic_prefix and goal_prefix must differ`. Replace the `GOAL_PREFIX` test.
- [ ] Step 2: Run `node --test scripts/goals.test.mjs scripts/config.test.mjs` — FAIL.
- [ ] Step 3: Implement. Prefix-distinct check uses `obj.goal_prefix ?? 'GOAL'`; keep the existing `id_prefix and epic_prefix must differ` message and add one for the goal prefix only when it collides.
- [ ] Step 4: Run the two tests plus `node --test scripts/validate-goals.test.mjs scripts/cli-goals-overview.test.mjs` — PASS (fix goldens/expectations that print goal records).
- [ ] Step 5: Commit `feat(goals): goal_prefix config key and goal status (PMK-213)`.

### Task 2: updateGoal, deleteGoal and the CLI commands

**Files:**
- Modify: `scripts/lib/contract.mjs` (add `'updateGoal', 'deleteGoal'` after `setEpicGoal`)
- Modify: `scripts/lib/local/tracker.mjs` (two functions, export them)
- Modify: `scripts/lib/linear/tracker.mjs` (`STUB_CAPABILITY` lists the two)
- Modify: `scripts/lib/capabilities.mjs` (`SERVED_BY.strategic_goals` adds `goal update`, `goal close`, `goal delete`)
- Modify: `scripts/pmkit.mjs` (three commands)
- Test: `scripts/goals.test.mjs`, `scripts/cli.test.mjs` or a new `scripts/cli-goals.test.mjs`

**Interfaces:**
- Consumes: Task 1 model.
- Produces: `updateGoal(id, { title?, target?: string|null, status? }, actor, { dryRun })` → `{ before, after }` (both with `epics`); `deleteGoal(id, actor, { dryRun })` → `{ before, after: null, removes: { file } }`; CLI `goal update <id> [--title|--title-file] [--target d|none] [--status s]`, `goal close <id>`, `goal delete <id>`.

- [ ] Step 1: Tests. Update edits only changed lines: a goal file with a `# keep` comment and a body keeps both after `--title New`; unchanged input writes nothing (hashTree same); `target: null` removes the key; empty input is `INVALID_INPUT`; unknown key is `INVALID_INPUT`; dry run writes nothing. Close of an active goal → status completed; close of a completed goal writes nothing. Delete: removes the file; refuses `CONFLICT` with `details.epics` naming the linked epic and nextStep containing `pmkit epic goal`; refuses `INVALID_INPUT` when an `epic.md` does not parse, and writes nothing; dry run writes nothing and returns `removes.file === '.issues/goals/<id>.md'`. CLI: `goal update` with no flag exits 2 `INVALID_INPUT`; `goal delete --dry-run --json` prints `after: null`.
- [ ] Step 2: Run them — FAIL.
- [ ] Step 3: Implement. Update uses `splitFrontmatter` + `setScalar`/`removeKey` as `setEpicGoal` does, then `readBack` with `parseGoal`. Delete uses `readDeliverables()` for links and problems; `fs.rmSync` the file.
- [ ] Step 4: Run tests plus `node --test scripts/capabilities.test.mjs scripts/plugin.test.mjs scripts/lib/linear/tracker.test.mjs scripts/lib/linear/manifest.test.mjs` — PASS.
- [ ] Step 5: Commit `feat(goals): goal update, close and delete (PMK-213)`.

### Task 3: goal progress warnings and validate goal count

**Files:**
- Modify: `scripts/lib/local/tracker.mjs` (`goalProgress` returns `warnings`)
- Modify: `scripts/pmkit.mjs` (`goal progress` prints warnings, `complete`; `runGoalsOverview` drops `warnings` from the item spread; `validate` text adds `goals`)
- Modify: `scripts/lib/validate.mjs` (`noneChecked` adds `goals: 0` after `releases`; `checked.goals++` per goal file)
- Test: `scripts/goals.test.mjs`, `scripts/validate-goals.test.mjs`, `scripts/cli-goals-overview.test.mjs`, `scripts/cli-hosted.test.mjs` (checked shape)

**Interfaces:**
- Produces: `goalProgress(id)` → `{ goal, epics, total, done, canceled, points, pointsDone, byCategory, warnings: string[] }`. CLI data adds `complete: warnings.length === 0`.

- [ ] Step 1: Tests. With a broken `epic.md`, `goal progress --json` has `complete: false` and a warning naming the epic and "may link to this goal"; text ends with the `incomplete:` line. With a broken issue file, a warning too. Clean: `complete: true`, `warnings: []`. `goals overview` items have no `warnings` key. `validate --json` `checked.goals` equals the number of goal files (2 with one broken), text has `2 goals`.
- [ ] Step 2: Run — FAIL.
- [ ] Step 3: Implement. Epic problem line: `epic file <id> does not parse, and it may link to this goal: <message>`; issue problem line reuses `issueReadWarnings` text with `; goal progress may be low`.
- [ ] Step 4: Run — PASS.
- [ ] Step 5: Commit `feat(goals): warn in goal progress and count goals in validate (PMK-213)`.

### Task 4: Linear initiatives as goals (reads)

**Files:**
- Create: `scripts/lib/linear/goal-ops.mjs`
- Modify: `scripts/lib/linear/tracker.mjs` (wire `listGoals`, `getGoal`, `goalProgress` through a wrapper that refuses with the manifest hint when `strategic_goals` is absent)
- Modify: `scripts/lib/linear/manifest.mjs` (Business entry `native` with `detail: { entity: 'initiative', unsupported: ['createGoal','setEpicGoal','updateGoal','deleteGoal'] }`)
- Modify: `scripts/lib/linear/API-VERIFICATION.md` (Initiative fields, schema source, not live)
- Test: `scripts/lib/linear/goal-ops.test.mjs`, `scripts/lib/linear/manifest.test.mjs`

**Interfaces:**
- Consumes: `projects.deliverableProgress(epicId)`, `epicId(node)`, `STATUS_CATEGORY`, `sortGoals`, `client.paginate`.
- Produces: `goalOperations({ client, config, projects })` → `{ listGoals, getGoal, goalProgress }`; query operation name `PmkitInitiatives`; goal `{ id, title, status, target?, description?, url, epics }`.

- [ ] Step 1: Tests with `fakeLinearFetch` routes: two initiatives (one with `identifier: 'INI-1'`, one without) map to the shapes in the spec, sorted by target; `getGoal('ini-1')` and the slug both find it; unknown key `NOT_FOUND`; nested `projects.pageInfo.hasNextPage` gives a `problems` entry `kind: 'goal', code: 'INCOMPLETE'`; `goalProgress` sums two epics' `deliverableProgress`, marks a canceled project `counted: false`, and a `hasMore` epic adds a warning; the query sends the team filter in `projectFilter`. Manifest test: Business → native with the four unsupported; Free unchanged. Tracker test: on Free `listGoals` is `NOT_SUPPORTED` with the plan hint and sends no `PmkitInitiatives`.
- [ ] Step 2: Run — FAIL.
- [ ] Step 3: Implement. Page size 50, max 20 pages.
- [ ] Step 4: Run `node --test scripts/lib/linear/*.test.mjs scripts/cli-goals-overview.test.mjs scripts/cli-degraded-coverage.test.mjs` — PASS.
- [ ] Step 5: Commit `feat(linear): read initiatives as goals (PMK-213)`.

### Task 5: Docs and full suite

**Files:**
- Modify: `README.md` (CLI table rows for `goal update|close|delete`, status in `goal create`, `goal_prefix` where config keys are described), `CHANGELOG.md` (one line on top of `## Unreleased`), `docs/superpowers/specs/2026-10-30-pmk-45-strategic-goals-design.md` (pointer to this spec)
- Modify: `commands/report/initiatives-and-goals.md` only if its text about Linear (`does not support them, as a Linear workspace today`) becomes false — it does: say Linear reads initiatives on Business plans.

- [ ] Step 1: Edit docs.
- [ ] Step 2: `npm test` in the foreground; exit code 0.
- [ ] Step 3: Commit `docs(goals): document goal update, close, delete and Linear initiatives (PMK-213)`.
