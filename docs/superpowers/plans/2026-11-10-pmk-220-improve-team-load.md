# PMK-220 Improve Team Load Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans (inline) to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** `team load` gets a config key for the overload factor, a Delivered column, blocked-issue handling in move proposals, and reads capacity, days off and flow history once.

**Architecture:** Pure logic stays in `scripts/lib/team-load.mjs` (`teamLoad`, `proposeMoves`); the tracker reads stay in `teamLoadReport` in `scripts/pmkit.mjs`, split into `readLoadInputs` (reads) and `buildLoadReport` (pure over the inputs) so `team capacity` reads once.

**Tech Stack:** Node ESM, `node:test`.

**Spec:** `docs/superpowers/specs/2026-11-10-pmk-220-improve-team-load-design.md`

## Global Constraints

- Every commit message carries `(PMK-220)` and ends with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- A read that can be incomplete (`hasMore`, bad issue file, unreadable blocker) is "not verified" in JSON and text, never zero or "nothing blocks".
- `npm test` must exit 0, run in the foreground.
- Do not run the CLI inside `scripts/__fixtures__/`; use `makeRepo`.

## Review Focus

- `overload_factor: 1.5` explicit equals the default; `1`, `0.5`, `'x'` are refused by `validate`.
- Delivered with a cut read is `null`, not 0; with no sprint it is `null` and the column is absent.
- A blocker outside the scope that cannot be read counts as blocking, with a warning.
- A member with `no_availability` still gives away blocked `todo` work.
- `team capacity --set` makes one `searchIssues` for open work (not two).

---

### Task 1: `defaults.overload_factor`

**Files:** Modify `scripts/lib/config.mjs` (DEFAULTS, validation ~l.217), `schemas/issues.config.schema.json`, `templates/issues.config.yaml`, `scripts/lib/team-load.mjs`, `scripts/pmkit.mjs` (`teamLoadReport`). Test: `scripts/team-load.test.mjs`, `scripts/cli-team-load.test.mjs`, `scripts/config.test.mjs` (existing config tests file; find with `ls scripts/*config*.test.mjs`).

**Interfaces:**
- Produces: `teamLoad(issues, { ..., overloadFactor = OVER_AVERAGE })`; report field `overloadFactor: number`; `proposeMoves` reads `report.overloadFactor ?? OVER_AVERAGE`.

- [ ] **Step 1: Failing tests.** In `team-load.test.mjs`: `teamLoad` with loads 10/4/4 flags nobody at factor 1.5 less... choose members so a load is above 1.2 x mean but under 1.5 x: asserts `over_average` appears with `overloadFactor: 1.2` and not with the default; `report.overloadFactor` equals the input. Config test: `defaults.overload_factor: 1.2` validates; `1`, `0.5`, `'x'` give a problem `defaults.overload_factor must be a number above 1`. CLI test: set `overload_factor` in the `team` fixture copy and assert the `ana` flags/`limit` change.
- [ ] **Step 2: Run** `node --test scripts/team-load.test.mjs scripts/cli-team-load.test.mjs` and the config test: FAIL.
- [ ] **Step 3: Implement.** Config: default `overload_factor: 1.5` in DEFAULTS.defaults, validation branch for the key (finite number > 1), schema property (type number, exclusiveMinimum 1, default 1.5; the `additionalProperties` stays integer), template line. `teamLoad` and `proposeMoves` use the factor in the `row.load * known.length > factor * sum` comparisons and `limit`. `teamLoadReport` passes `ctx.settings().defaults.overload_factor`. Text header says `overload factor N` only when it is not 1.5.
- [ ] **Step 4: Run** the same tests: PASS.
- [ ] **Step 5: Commit** `feat(team): add defaults.overload_factor to team load (PMK-220)`.

### Task 2: Delivered column

**Files:** Modify `scripts/lib/team-load.mjs`, `scripts/pmkit.mjs` (`teamLoadReport`, `teamLoadText`). Test: same two test files.

**Interfaces:**
- Consumes: Task 1's `teamLoad` options.
- Produces: `teamLoad(..., { delivered })` where `delivered` is `null` (not verified or no sprint) or `{ [member]: n, unassigned?: n }`; each row has `delivered: number | null`; `unassigned.delivered: number | null`.

- [ ] **Step 1: Failing tests.** Pure: `delivered: { ana: 2 }` gives ana 2, a member not in the map 0, a non-member key gets a row `isMember: false`, `delivered: null` gives `null` everywhere. CLI (`team` fixture, which has done issues in the sprint: check with `issues list --category done --sprint`): rows carry the counts and the text has a `Delivered` column; no sprint gives `null` and no column; a cut read (`hasMore`, simulate with an adapter wrapper whose `searchIssues` for `done` returns `hasMore: true`) gives `null` and the warning `the delivered count is not verified`.
- [ ] **Step 2: Run:** FAIL.
- [ ] **Step 3: Implement.** `teamLoadReport` reads `searchIssues({ categories: ['done'], sprint: sprint.id })` only with a sprint; a bad file in `problems` or `hasMore` makes `delivered = null` plus the warning; else count by `assignee`. `teamLoad` applies it as above (rows from `delivered` keys get `emptyRow(..., { isMember: false })`).
- [ ] **Step 4: Run:** PASS.
- [ ] **Step 5: Commit** `feat(team): show issues delivered per member in team load (PMK-220)`.

### Task 3: Blocked issues in move proposals

**Files:** Modify `scripts/lib/team-load.mjs`, `scripts/pmkit.mjs`, `commands/team/load.md`. Test: same.

**Interfaces:**
- Produces: `teamLoad(..., { blocked })` where `blocked` is a `Set` of issue ids with an open blocker; row field `blocked: number` and `blockedIds: string[]`; `proposeMoves(report, issues)` takes blocked ids from `report.blockedIds` (union over rows); new reason `blocked`, message in `NO_MOVE_MESSAGES.blocked`.

- [ ] **Step 1: Failing tests.** Pure: an overloaded member with two `todo` issues, the larger blocked: the proposal moves the smaller one, and never the blocked; with only blocked `todo` issues the reason is `blocked`; with `no_availability` blocked work still moves. CLI: an issue `blockedBy` an open `backlog` issue outside the scope is counted (`blocked: 1`) and not proposed; a blocker that is `done` does not block; a blocker id that `getIssue` fails on counts as blocking and the warning contains `blocker state is not verified`.
- [ ] **Step 2: Run:** FAIL.
- [ ] **Step 3: Implement.** `teamLoadReport` collects `blockedBy` ids of the open issues; those outside the scope are read once each with `getIssue` (dedupe; a throw leaves it unread); an issue is blocked when any blocker is not terminal (`isBlocked` from `scripts/lib/model.mjs` with a `byId` map of scope plus read blockers; unread ids stay missing so they block). `proposeMoves` filters blocked ids out of `candidates` unless `idle`, and tracks `anyBlocked` for the new reason (checked before `no_target`/`would_not_improve`, after `unestimated`/`zero_estimate`). `commands/team/load.md` step 2 gets the `Blocked` column, step 3 the `blocked` reason.
- [ ] **Step 4: Run:** PASS.
- [ ] **Step 5: Commit** `feat(team): team load does not propose moving blocked issues (PMK-220)`.

### Task 4: Read once

**Files:** Modify `scripts/pmkit.mjs` (`teamLoadReport` split, `flowInputs`, `runTeamCapacity`). Test: `scripts/cli-team-load.test.mjs`.

**Interfaces:**
- Produces: `readLoadInputs(ctx, { wanted, requireSprint, withAging }) -> inputs`; `buildLoadReport(ctx, inputs, { capacity?, daysOff? }) -> { data, warnings, notes, sprint, incomplete }`; `teamLoadReport` becomes `buildLoadReport(ctx, await readLoadInputs(...), overrides)`. `flowInputs(tracker, statuses)` takes the already read `discover().statuses`.

- [ ] **Step 1: Failing test.** A counting adapter (wrap the local adapter's `create` result in a `Proxy` that counts method calls) shows for `team load` on the `team` fixture: `searchIssues` for open work 1, `getCapacity` 1, `getDaysOff` 1, `metricEvents` 1, `discover` 1, `capabilities` 1. For `team capacity --set ana=12 --dry-run`: open-work `searchIssues` 1, `getCapacity` 1, `metricEvents` 0.
- [ ] **Step 2: Run:** FAIL (discover and capabilities are called several times).
- [ ] **Step 3: Implement** the split, reading `discover()` and `capabilities()` once and passing them to `flowInputs`, the notes (a `pathNote` of the entry already read, replacing `capabilityNotes`/`metricNotes` calls in this path) and the member list. `runTeamCapacity` reads once, builds the current report, then builds the after report with `capacity`/`daysOff` overrides from the same inputs, and merges against `inputs.capacity`.
- [ ] **Step 4: Run** `npm test -- ` the whole team suite and the goldens: PASS.
- [ ] **Step 5: Commit** `refactor(team): read capacity, days off and flow history once (PMK-220)`.

### Task 5: Docs, scenario, goldens, changelog

**Files:** `commands/team/load.md`, `scripts/__scenarios__/team-load.*`, `scripts/__goldens__/*/team-load.txt` (regenerate with the repo's golden update script, see `scripts/golden-cases.mjs`), `CHANGELOG.md`, `docs/superpowers/epc-6-follow-ups.md` (not edited; only the issue is closed by the orchestrator).

- [ ] **Step 1:** Update `load.md` steps 2 and 3 (Delivered, Blocked, `overload_factor`, not-verified rules); make the scenario expectations and goldens agree with the file.
- [ ] **Step 2:** One line on top of `## Unreleased` in `CHANGELOG.md`, same style, `(PMK-220)`.
- [ ] **Step 3:** `npm test` in the foreground, exit code 0.
- [ ] **Step 4: Commit** `docs(team): document the team load changes (PMK-220)`.
