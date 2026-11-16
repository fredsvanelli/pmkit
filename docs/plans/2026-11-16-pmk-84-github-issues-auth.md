# PMK-84 GitHub Issues authentication ADR implementation plan

> **For agentic workers:** use superpowers:executing-plans to run this plan task by task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Record how the GitHub Issues adapter authenticates, when it needs the `project` scope, the minimum GHES version and where field roles read from. The record is ADR 0007 plus one glossary term. PMK-85, PMK-86, PMK-87, PMK-89 and setup start from it.

**Architecture:** No product code changes. One new test file, `scripts/adr-github-auth.test.mjs`, checks the ADR and the glossary term, so the decision cannot lose its key facts without a failing test. The ADR follows ADR 0001 to ADR 0006: a title that states the decision, a prose context and choice, then `## Considered options` and `## Consequences`.

**Tech stack:** Markdown, Node 18+ ES modules, no dependencies (ADR 0003), `node:test`. `npm test` runs the suite.

**Spec:** `docs/specs/2026-11-16-pmk-84-github-issues-auth-design.md`. Where this plan and the spec differ, the spec wins, and the implementer reports the difference.

## Global constraints

- The ADR file is `docs/adr/0007-github-issues-reuses-the-gh-login-and-needs-ghes-3-19.md`.
- The four decisions and their rejected options come from the spec's "Decisions from the user".
- The ADR holds no token and no string shaped like one (`gh[pousr]_` plus 36 characters, `github_pat_`).
- `CHANGELOG.md` does not change on this branch, as with PMK-28.
- `npm test` starts no `gh` process and opens no network connection. `package.json` gains no dependency. `package-lock.json` stays untracked.
- Every commit message carries `(PMK-84)` and ends with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- All prose follows `~/.claude/skills/unslop/SKILL.md`.

## Criteria map

| Criterion | Tasks |
|---|---|
| 1. An ADR in `docs/adr/` records the choices | Task 1 (check), Task 2 (ADR), Task 4 (verification) |

The glossary term (Task 3) supports criterion 1 and adds no criterion.

## File structure

- Create `scripts/adr-github-auth.test.mjs`.
- Create `docs/adr/0007-github-issues-reuses-the-gh-login-and-needs-ghes-3-19.md`.
- Modify `CONTEXT.md`: one new term after **Mapping**.
- Commit the tracker files the pmkit CLI changed for PMK-84 (`.issues/issues/PMK-84/`), the spec and this plan.

## Task 1: write the failing check

**Files:** create `scripts/adr-github-auth.test.mjs`.

- [ ] **Step 1: write the test.** Use `node:test`, `node:assert/strict`, `node:fs` and a root resolved from `import.meta.url`, as `scripts/adr-linear-auth.test.mjs` does. Tests:
  1. The ADR file exists.
  2. Its first line is a `# ` heading, and it has `## Considered options` and `## Consequences`.
  3. The credential: it names `gh api graphql`, `GH_TOKEN` and `GH_ENTERPRISE_TOKEN`, and says pmkit holds no token (match `holds no token`).
  4. The scope: it names `gh auth refresh -s project` and `INSUFFICIENT_SCOPES`, and `AUTH`.
  5. The version: it names `3.19`, `gh api meta`, `installed_version`, `NOT_SUPPORTED` and `2026-12-09`.
  6. The fields: it names issue fields, Project fields, the Status field and `3.21`.
  7. Considered options name each rejected option: fine-grained PAT, GitHub App, `3.18`, `3.20`, Project fields only, issue fields only.
  8. Consequences names `PMK-85`, `PMK-86`, `PMK-87`, `PMK-89` and `/pmkit:setup`.
  9. No file in `docs/adr/` and no line of `CONTEXT.md` matches `/\bgh[pousr]_[A-Za-z0-9]{36}\b|github_pat_[A-Za-z0-9_]+/`.
  10. `CONTEXT.md` has an `**Issue field**:` term whose text names a Project field.
- [ ] **Step 2: run it and see it fail.** `node --test scripts/adr-github-auth.test.mjs`. Expect failures for tests 1 to 8 and 10, and a pass for test 9.
- [ ] **Step 3: commit.** `test: check the GitHub Issues auth ADR and glossary term (PMK-84)`.

## Task 2: write ADR 0007

**Files:** create `docs/adr/0007-github-issues-reuses-the-gh-login-and-needs-ghes-3-19.md`.

- [ ] **Step 1: write the title and the opening paragraphs.** Title: `# GitHub Issues reuses the gh login and needs GHES 3.19`. Context: the four open questions of the planning doc's GitHub tab, the Unified model's Q1 decision D and Q5 decision A. Choice: one paragraph per decision, with the checked facts from the spec (default `gh` scopes, the fine-grained PAT limitation, the GHES schemas and dates, issue fields from GHES 3.21). Correct the issue's "3.17+".
- [ ] **Step 2: write `## Considered options`.** One bullet per option of each question, chosen or rejected, with the reason from the spec.
- [ ] **Step 3: write `## Consequences`.** The spec's table as bullets: PMK-85, PMK-86, PMK-87, PMK-89, `/pmkit:setup`, the security rule, authorship, the cost of one `gh` process per call, and the two items left open.
- [ ] **Step 4: run the check.** `node --test scripts/adr-github-auth.test.mjs`. Expect every test but 10 to pass.
- [ ] **Step 5: commit.** `docs: add ADR 0007 for GitHub Issues authentication (PMK-84)`.

## Task 3: add the glossary term

**Files:** modify `CONTEXT.md`.

- [ ] **Step 1: add the term after `**Mapping**`.** `**Issue field**:` with the text from the spec's Glossary section and `_Avoid_: custom field`.
- [ ] **Step 2: run the check.** Expect all 10 tests to pass.
- [ ] **Step 3: commit.** `docs: add the Issue field term (PMK-84)`.

## Task 4: verify

- [ ] **Step 1: run `npm test`** and read the summary. Every test passes.
- [ ] **Step 2: check the prose** of the ADR, the term, the spec and this plan against the Unslop rules: no em dashes, sentence-case headings, active voice.
- [ ] **Step 3: commit the spec, this plan and the PMK-84 tracker files** if they are not committed yet: `docs: add PMK-84 design spec and plan (PMK-84)`.
