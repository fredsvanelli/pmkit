---
id: PMK-5A53
title: Add golden output tests on fixture repositories
type: task
status: backlog
priority: medium
estimate: 3
parent: EPC-TJVF
milestone: local-gaps
created: 2026-10-25T19:13:19Z
updated: 2026-10-25T19:13:19Z
---

## Description

The fixtures today are `basic`, `team` and `broken`.

Source: Technical spec, Testing item 3 ("sample repos in `fixtures/` (empty, small team, messy merge, no sprints) with golden outputs for CLI commands").

## Acceptance criteria

- [ ] Fixtures exist for an empty repository, a small team, a messy merge and a repository with no sprints
- [ ] Each CLI command has a golden output per fixture, and the test fails on a difference
