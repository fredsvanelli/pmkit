---
id: PMK-344
title: Read sprint issues faster on GitHub
type: feature
status: in_review
priority: low
estimate: 5
assignee: fred
parent: EPC-8
milestone: github-issues
branch: pmk-344-read-sprint-issues-faster-on-github
created: 2026-11-18T00:15:22.814Z
updated: 2026-11-21T21:01:31Z
---

## Description

Found while working PMK-88 (PR #318). `cycle issues` scans the repository on the client (`sprintStep` in `scripts/lib/github/filter.mjs`), and `moveToCycle` in `scripts/lib/github/cycle-ops.mjs` (used by `cycle add`) reads each issue twice.

## Acceptance criteria

- [x] On github.com and GHE.com, `cycle issues` reads through `items(query: "iteration:...")`, keeping the client scan for GHES
- [x] `cycle add` reads each issue once
