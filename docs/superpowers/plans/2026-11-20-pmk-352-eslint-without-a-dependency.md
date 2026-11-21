# PMK-352 ESLint without a dependency Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `npm run lint` runs ESLint without a dependency and exits 0, with `npm test` still passing.

**Architecture:** A flat `eslint.config.js` that imports nothing, run by `npx --yes eslint@10.15.0 .` from an npm `lint` script. The dead names it reports are removed from `scripts/`. `AGENTS.md` names the lint command and says there is no type check and no CI.

**Tech Stack:** Node 18+ ES modules, `node:test`, ESLint 10.15.0 through `npx`.

**Spec:** `docs/superpowers/specs/2026-11-20-pmk-352-eslint-without-a-dependency-design.md`

## Global Constraints

- `package.json` has no `dependencies` or `devDependencies` (ADR 0003, `scripts/plugin.test.mjs`).
- ESLint is pinned at `10.15.0`.
- Lint stays outside `npm test`.
- Ignore only `.agents/` and `.codex/`.
- Every commit message carries `(PMK-352)`.

## Review Focus

- A removed name that a test body still used (as `ids` in `cli-bulk.test.mjs:313`): lint's `no-undef` and `npm test` both catch it.
- A Node global the code uses but the list lacks: lint fails with `no-undef`; add it to the list.
- A cold npm cache with no network: `npm run lint` fails to download ESLint; `npm test` is unaffected.

The work was already written in the working tree before this plan (see the design's note for the PR). The tasks commit it in an order where each check fails first.

---

### Task 1: Lint command and config

**Files:**
- Create: `eslint.config.js`
- Modify: `package.json` (`scripts.lint`)

- [ ] **Step 1:** Set `scripts.lint` to `npx --yes eslint@10.15.0 .` and the ignore list to `['.agents/', '.codex/']`.
- [ ] **Step 2:** With the script edits of Task 2 stashed, run `npm run lint`. Expected: FAIL, 19 `no-unused-vars` errors, none from `.agents/` or `.codex/`.
- [ ] **Step 3:** Run `node --test scripts/plugin.test.mjs`. Expected: PASS (no dependencies).
- [ ] **Step 4:** Commit `eslint.config.js` and `package.json`.

### Task 2: Remove the dead names

**Files:** the 14 files under `scripts/` listed in the design.

- [ ] **Step 1:** Restore the stashed script edits.
- [ ] **Step 2:** Run `npm run lint`. Expected: exit 0.
- [ ] **Step 3:** Run `npm test`. Expected: `# fail 0`.
- [ ] **Step 4:** Commit the 14 files.

### Task 3: Agent instructions

**Files:** `AGENTS.md`

- [ ] **Step 1:** Check that Execute and Ship name `npm run lint`, and that Ship and Tech stack say there is no type check and no CI.
- [ ] **Step 2:** Commit `AGENTS.md`.
