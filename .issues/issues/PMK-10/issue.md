---
id: PMK-10
title: Add command scenario tests
type: task
status: in_review
priority: medium
estimate: 8
assignee: fred
parent: EPC-1
blocked_by: [PMK-9]
milestone: local-gaps
branch: pmk-10-add-command-scenario-tests
created: 2026-10-25T19:13:19Z
updated: 2026-10-26T15:00:45Z
---

## Description

Source: Technical spec, Testing item 4 ("a scripted prompt per skill run against a fixture repo, with checks on the resulting files and the confirmation points the skill must hit").

Open: how a scenario drives an agent headless.

## Acceptance criteria

- [ ] One scripted scenario per command in `commands/**`
- [ ] Each scenario checks the files after the run and the confirmation points the command must hit
