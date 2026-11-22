# PMK-155 Design Spec CLI Table Check Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A test compares every row of the design spec's `## CLI` table with the CLI usage strings, and the rows that drift today are fixed.

**Architecture:** One new test file reads the spec, parses each row's backticked commands, and compares flags, flag value sets and positional value sets with `COMMANDS` from `scripts/pmkit.mjs`.

**Tech Stack:** Node 18+, `node:test`, no dependencies.

**Spec:** `docs/superpowers/specs/2026-11-22-pmk-155-design-spec-cli-table-design.md`

## Global Constraints

- No dependencies (ADR 0003). The table stays a summary: a usage flag missing from a row is not a problem.

## Review Focus

- `epic update` against `epic update-status`: the longest name followed by a space or the end matches.
- `\|` in a Markdown cell is unescaped before parsing.
- `--json` and `--dry-run` in a row are global and accepted.

---

### Task 1: The check and the spec fixes

**Files:**
- Create: `scripts/design-spec-cli.test.mjs`
- Modify: `docs/superpowers/specs/2026-10-23-pmkit-design.md` (`## CLI` rows `issues assign`, `release-notes`, `cycle add`, `cycle capacity`)
- Modify: `CHANGELOG.md` (`## Unreleased`)

**Interfaces:**
- Produces: `tableProblems(section: string, commands: {name, usage}[]) -> string[]`, local to the test file.

- [ ] Write `scripts/design-spec-cli.test.mjs` with two tests: `every row of the design spec CLI table matches the CLI usage` asserts `tableProblems(<## CLI section>, COMMANDS)` deep-equals `[]`; `the check catches a value set that drifts from the usage` asserts that a one-row table `` | `cycle add <id...> --to <sprint\|none>` | x | `` gives one problem naming `cycle add` and `--to`, and that a row naming `issues nope` gives one problem.
- [ ] Run `node --test scripts/design-spec-cli.test.mjs`: the first test fails with the four drifts (`issues assign`, `cycle add`, `cycle capacity`, `release-notes`), the second passes.
- [ ] Fix the four rows: `<member\|me\|none>`, `--to <sprint\|current\|none>`, `cycle capacity <id\|current>`, `release-notes [--release id \| --sprint id\|current \| --since d [--until d]]`.
- [ ] Run it again: both pass.
- [ ] Add a CHANGELOG line; run `npm test` and `npm run lint`; commit.
