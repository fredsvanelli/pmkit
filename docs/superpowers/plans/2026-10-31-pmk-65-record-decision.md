# record-decision Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add `/pmkit:spec:record-decision`, which writes an ADR after one confirmation and links it to the related issues.

**Architecture:** A command file that uses the existing CLI (`capabilities`, `issues get`, `docs list`, `docs create`, `issues comment`) and the agent's file tools for the repository file. A scenario runs the Local path through the CLI.

**Tech Stack:** Markdown command file, Node 18 ES modules, `node:test`, no dependencies.

**Spec:** `docs/superpowers/specs/2026-10-31-pmk-65-record-decision-design.md`

## Global Constraints

- The commit trailer is exactly `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`, and each message has `(PMK-65)`.
- Every `pmkit.mjs` call in the command ends with `--json` and uses only flags the CLI has.
- The command file has the sections Parameters, Steps, Confirmation points, Output and If something is missing, and its first step reads the conventions.
- No change to the tracker store or to `scripts/lib/`.

## Review Focus

- A repository `docs/adr/` folder with a gap in the numbers (0001, 0003): the next number is the highest plus one, 0004. The command file states the rule.
- A related issue ID that does not exist: the command stops before any write. Covered by the `If something is missing` text and the step 3 `issues get`.
- Two related issues: the comments are a bulk change, so a full preview comes first. Covered by the scenario, which has two issues.
- A comment that fails halfway: the command lists what was posted and what is missing. Covered by a plugin test on the command text.
- Linear, where `docs create` is `NOT_SUPPORTED`: the file goes to `docs/adr/`. Covered by a plugin test on the command text.

---

### Task 1: The command file, its scenario and the counts

**Files:**
- Create: `commands/spec/record-decision.md`
- Create: `scripts/__scenarios__/spec-record-decision.mjs`, `scripts/__scenarios__/_inputs/adr.md`, `scripts/__scenarios__/_inputs/adr-comment.md`
- Modify: `scripts/scenarios.test.mjs` (42 to 43), `scripts/scenarios-live.mjs` (the two 42s), `scripts/plugin.test.mjs` (`spec` list)
- Test: `scripts/plugin.test.mjs`, `scripts/scenarios.test.mjs`

**Interfaces:**
- Consumes: `docs create <path> --body-file f`, `docs list`, `issues get <id>`, `issues comment <id> --body-file f`, `capabilities`.
- Produces: the command `/pmkit:spec:record-decision`.

- [ ] **Step 1: Write the failing tests.** Change the counts and the `spec` list, add the scenario with two related issues on the `team` fixture (a `docs create adr/0001-<slug>.md` dry run and write, then two comment dry runs and writes). Add one test in `plugin.test.mjs`, `record-decision.md covers the three places, the numbering and a failed comment`, that asserts the text mentions `docs/adr/`, `createDocument`, `highest`, `origin/` and `stop`.
- [ ] **Step 2: Run `node --test scripts/plugin.test.mjs scripts/scenarios.test.mjs`.** Expected: FAIL, the command file is missing.
- [ ] **Step 3: Write `commands/spec/record-decision.md`** with the decisions of the spec.
- [ ] **Step 4: Run the same tests.** Expected: PASS, after `UPDATE_GOLDENS=1 node --test scripts/scenarios.test.mjs` creates the snapshot.
- [ ] **Step 5: Commit.**

### Task 2: README, skill table, CHANGELOG

**Files:**
- Modify: `README.md`, `skills/pmkit/SKILL.md`, `CHANGELOG.md` (one line each)

- [ ] **Step 1: The plugin test `every command is listed in the skill table and in the README` already fails after Task 1. Run it.** Expected: FAIL.
- [ ] **Step 2: Add one line to each file, in the style of the lines around it.**
- [ ] **Step 3: Run `npm test`.** Expected: all pass.
- [ ] **Step 4: Commit.**
