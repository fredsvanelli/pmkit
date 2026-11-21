---
id: PMK-352
title: Add ESLint without a dependency and fix the unused names it reports
type: chore
status: in_review
priority: medium
estimate: 2
assignee: fred
branch: pmk-352-add-eslint-without-a-dependency-and-fix
created: 2026-11-20T23:36:26.814Z
updated: 2026-11-20T23:53:25Z
---

## Description

### Context

The SPEC-SS workflow in AGENTS.md now asks every change to pass lint before it ships, but the project had no linter. Without one, unused names pile up in the scripts and can hide a check that was meant to run. pmkit has no dependencies (ADR 0003), so the linter has to run without a devDependency.

### Scope (in)

- A lint command for the repository that runs without adding a dependency
- Lint rules for mistakes in plain JavaScript modules, tuned to the idioms the code already uses on purpose
- The existing scripts and tests cleaned of every unused name the linter reports
- The workflow and tech stack sections of AGENTS.md naming the lint command, and saying there is no type check and no CI

### Out of scope

- Formatting and style rules
- A CI pipeline that runs lint and tests
- A type check

### Tasks

- [ ] Add the lint command and its configuration
- [ ] Clean the scripts and tests of every unused name
- [ ] Describe lint, the absent type check and the absent CI in the agent instructions

## Acceptance criteria

- [ ] `npm run lint` exits 0 on the repository
- [ ] `npm test` passes
- [ ] `package.json` still has no `dependencies` or `devDependencies`
- [ ] AGENTS.md names `npm run lint` in the Execute and Ship steps, and says the project has no type check and no CI
