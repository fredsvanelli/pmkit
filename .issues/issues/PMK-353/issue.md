---
id: PMK-353
title: "Add epic move to change an epic's status"
type: feature
status: in_review
priority: medium
estimate: 8
assignee: fred
parent: EPC-6
related: [PMK-354, PMK-355, PMK-356]
branch: pmk-353-add-epic-move-to-change-an-epic-s-status
created: 2026-11-21T02:24:06.919Z
updated: 2026-11-21T07:03:24Z
---

## Description

### Context

No CLI command can change an epic's status, so every epic stays in backlog even when its work is finished. EPC-3 has all 8 of its issues done and still reads backlog. `/pmkit:issues:move EPC-3 done` answers NOT_FOUND because it only reads issues. The tracker contract only creates epics, and editing `.issues/` by hand is not allowed, so there is no way to fix this today. Status reports, roadmap reviews and anyone reading `epic list` get a wrong picture of what is open.

### Scope (in)

- An `epic move <id> <category>` command with an optional `--status <name>` and a dry run that shows the status before and after
- Status changes on the local, Linear and GitHub trackers, each mapped to that tracker's own epic status
- A warning that lists the IDs of open issues when an epic moves to done, without blocking the move
- The local epic's history records the move
- `/pmkit:issues:move` accepts an epic ID and runs `epic move` for it
- A runbook and an E2E test of the flow

### Out of scope

- Editing an epic's title or description (PMK-348)
- Moving an epic's status automatically when its issues finish
- Moving many epics in one command

### Tasks

- [ ] Add epic status changes to the tracker contract
- [ ] Support epic status changes on the local, Linear and GitHub trackers
- [ ] Add `epic move` to the CLI and its help
- [ ] Warn about open issues when an epic moves to done
- [ ] Let the move command accept an epic ID
- [ ] Write the runbook and the E2E test
- [ ] Record the change in the CHANGELOG

## Acceptance criteria

- [ ] `pmkit epic move EPC-3 done` changes the status, and `pmkit epic get EPC-3` and `pmkit epic list` show it as done
- [ ] The dry run shows the status before and after and writes nothing
- [ ] Moving an epic to done while it has open issues lists their IDs in a warning and still moves it
- [ ] On the local tracker, the epic's history records the move with its author and date
- [ ] On Linear and GitHub, the remote epic shows the new status
- [ ] `/pmkit:issues:move EPC-3 done` moves the epic instead of answering NOT_FOUND
- [ ] An epic ID that does not exist answers NOT_FOUND
- [ ] A category that does not exist, or the status the epic already has, answers INVALID_INPUT
