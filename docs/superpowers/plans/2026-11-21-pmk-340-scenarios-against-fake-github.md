# Scenarios against the fake GitHub Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A scenario can run on a GitHub Issues tracker backed by the stateful fake `gh`, the discussions command gets a GitHub scenario, and the setup runbook test uses the shared fake `gh` helper.

**Architecture:** A `githubTracker: { seed(github) }` option in `prepareCopy` (`scripts/scenario-helpers.mjs`): an empty repo, `git init`, `init --tracker github ...` with `statefulGhOnPath` first on `PATH`, then the usual initial commit; the snapshot lists the GraphQL operation names the fake `gh` got.

**Tech Stack:** Node 18+ ES modules, `node:test`, the stateful fake GitHub.

**Spec:** `docs/superpowers/specs/2026-11-21-pmk-340-scenarios-against-fake-github-design.md`

## Global Constraints

- No network: the only `gh` the child sees is the fake one first on `PATH`.
- No token or scratch path in a snapshot (rule 12).
- The init arguments live once: `GITHUB_TRACKER_INIT` in `scripts/fake-gh-path.mjs`, used by the scenario helper and `scripts/runbook-discussions-github.test.mjs`.

## Review Focus

- A `githubTracker` scenario with a `fixture`: the init would refuse an existing config. The helper throws a clear `runner:` error instead (Task 1 test).

---

### Task 1: the `githubTracker` option

**Files:** Modify `scripts/scenario-helpers.mjs` (`prepareCopy`, `runScenario`'s snapshot), `scripts/fake-gh-path.mjs` (`GITHUB_TRACKER_INIT`), `scripts/runbook-discussions-github.test.mjs` (use it). Test: `scripts/scenario-helpers.test.mjs`.

- [ ] **Step 1: Write the failing tests** in `scenario-helpers.test.mjs`: `prepareCopy with githubTracker runs on the fake GitHub`: `prepareCopy({ githubTracker: { seed: (github) => github.seedDiscussion({ title: 'RFC', category: 'Ideas' }) } }, { scratch, fixturesDir })`, then `run(['capabilities', '--json'], root, { env })` reports `tracker: 'github'`, and `run(['github', 'discussions', 'list', '--json'], ...)` lists `RFC`; and `prepareCopy with githubTracker and a fixture throws`.
- [ ] **Step 2: Run** `node --test scripts/scenario-helpers.test.mjs`: FAIL.
- [ ] **Step 3: Implement** the branch, returning `tracker` (the `statefulGhOnPath` result) next to `gh`; the snapshot's call block is `--- gh calls` with `graphql <operation>` per call.
- [ ] **Step 4: Run** the file and `scripts/runbook-discussions-github.test.mjs`: PASS. **Commit** `test: scenarios can run on the stateful fake GitHub (PMK-340)`.

### Task 2: the GitHub discussions scenario

**Files:** Modify `scripts/__scenarios__/github-discussions.mjs` (a second entry), new inputs in `scripts/__scenarios__/_inputs/`, snapshots `github-discussions.0.after.txt` and `.1.after.txt` (the old one is renamed by the generator).

- [ ] **Step 1:** Add the entry: seed `RFC: offline mode` (Ideas, two comments); steps 1 `capabilities`, 2 `github discussions list`, confirm `Step 2`, 3 `github discussions get 1`, confirm `Step 4`, 5 `discover`? (only if the command file's step 5 names it as a call; follow the parser), 5 `issues create` dry run with the input files, confirm `Step 5`, 6 `issues create`, 7 `github discussions comment 1 --body-file` dry run, confirm `Step 7`, 8 the comment. No `skip`, no `notHit`. `expect`: the fake's state holds the comment `Tracked in #1` on discussion 1.
- [ ] **Step 2: Run** `node --test scripts/scenarios.test.mjs`: FAIL on the missing snapshot; then `UPDATE_GOLDENS=1 node --test scripts/scenarios.test.mjs`, read the new snapshot (no token, no scratch path), and run again: PASS.
- [ ] **Step 3: Commit** `test: a GitHub scenario covers the discussions command (PMK-340)`.

### Task 3: the setup runbook test uses the shared fake `gh`

**Files:** Modify `scripts/runbook-setup-github.test.mjs`.

- [ ] **Step 1:** Replace `fakeGhOnPath` and `calls` with `statefulGhOnPath` and `statefulGhCalls`; delete the copies.
- [ ] **Step 2: Run** `node --test scripts/runbook-setup-github.test.mjs`: PASS, same assertions. `npm test`, `npm run lint`: pass.
- [ ] **Step 3: Commit** `refactor: the setup runbook test uses the shared fake gh (PMK-340)`.
