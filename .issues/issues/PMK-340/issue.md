---
id: PMK-340
title: Run the scenario tests against the fake GitHub
type: chore
status: in_progress
priority: low
estimate: 3
assignee: fred
parent: EPC-8
milestone: github-issues
branch: pmk-340-run-the-scenario-tests-against-the-fake
created: 2026-11-17T22:21:23.192Z
updated: 2026-11-21T20:15:59Z
---

## Description

Found while working PMK-90 (PR #313). `scripts/scenario-helpers.mjs` has no fake `gh`, so the discussions command's scenario covers only the Local stop. `scripts/runbook-setup-github.test.mjs` also builds its own fake path instead of using `scripts/fake-gh-path.mjs`.

## Acceptance criteria

- [ ] The scenario helper can run a scenario against the stateful fake `gh`
- [ ] A GitHub scenario covers the discussions command
- [ ] `runbook-setup-github.test.mjs` uses `scripts/fake-gh-path.mjs`
