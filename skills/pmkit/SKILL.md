---
name: pmkit
description: Project management for development agents. Use when the user works with issues, sprints, epics, the backlog, a standup or a status report in a repository that has .pmkit/config.yaml, or asks to pick up, create, find, move, plan or close work.
---

# pmkit

pmkit keeps issues, sprints and epics in one command set. The Local tracker stores them as files under `.issues/` in the repository.

## Commands

Each command file holds the full procedure. When the user asks for one of these in their own words, read the file and follow it as if they had typed the command.

| Request | Command | File |
|---|---|---|
| set up pmkit in the project, or bring a setup in line with the installed version | `/pmkit:setup` | `${CLAUDE_PLUGIN_ROOT}/commands/setup.md` |
| update the installed pmkit plugin and move `.issues/` to the current tracker format | `/pmkit:upgrade` | `${CLAUDE_PLUGIN_ROOT}/commands/upgrade.md` |
| see what pmkit can do here, explain a capability, or find the command for a task | `/pmkit:help` | `${CLAUDE_PLUGIN_ROOT}/commands/help.md` |
| find what is wrong with the backlog and fix what the user accepts | `/pmkit:backlog:groom` | `${CLAUDE_PLUGIN_ROOT}/commands/backlog/groom.md` |
| triage the issues nobody has looked at and apply the decisions the user accepts | `/pmkit:backlog:triage` | `${CLAUDE_PLUGIN_ROOT}/commands/backlog/triage.md` |
| close the active sprint, report planned against delivered, and move the unfinished issues | `/pmkit:cycle:close` | `${CLAUDE_PLUGIN_ROOT}/commands/cycle/close.md` |
| plan the next sprint from velocity, capacity and the prioritized backlog | `/pmkit:cycle:plan` | `${CLAUDE_PLUGIN_ROOT}/commands/cycle/plan.md` |
| assign an issue to a member, to the user or to nobody | `/pmkit:issues:assign` | `${CLAUDE_PLUGIN_ROOT}/commands/issues/assign.md` |
| break an issue into sub-issues with estimates, order and blockers | `/pmkit:issues:breakdown` | `${CLAUDE_PLUGIN_ROOT}/commands/issues/breakdown.md` |
| open an issue from what the session found (an error, a failing test, a TODO), after a duplicate check | `/pmkit:issues:capture` | `${CLAUDE_PLUGIN_ROOT}/commands/issues/capture.md` |
| add a comment to an issue | `/pmkit:issues:comment` | `${CLAUDE_PLUGIN_ROOT}/commands/issues/comment.md` |
| create an issue, with the fields checked against the project config | `/pmkit:issues:create` | `${CLAUDE_PLUGIN_ROOT}/commands/issues/create.md` |
| show what blocks an issue or an epic, with the blocker chain, the hierarchy and the critical path | `/pmkit:issues:dependencies` | `${CLAUDE_PLUGIN_ROOT}/commands/issues/dependencies.md` |
| find issues with a plain-language question, such as "high-priority bugs in the current sprint" | `/pmkit:issues:find` | `${CLAUDE_PLUGIN_ROOT}/commands/issues/find.md` |
| link two issues (blocks, related, duplicate), remove a link, or set a parent | `/pmkit:issues:link` | `${CLAUDE_PLUGIN_ROOT}/commands/issues/link.md` |
| list the issues assigned to the user, with the state of their pull requests and the next one to pick up | `/pmkit:issues:mine` | `${CLAUDE_PLUGIN_ROOT}/commands/issues/mine.md` |
| move an issue to a status category: in progress, in review, done | `/pmkit:issues:move` | `${CLAUDE_PLUGIN_ROOT}/commands/issues/move.md` |
| pause work on an issue, leave a handoff note and push a draft PR when there is code | `/pmkit:issues:pause` | `${CLAUDE_PLUGIN_ROOT}/commands/issues/pause.md` |
| post what was done on an issue as a comment, tick acceptance criteria and log the time spent | `/pmkit:issues:progress` | `${CLAUDE_PLUGIN_ROOT}/commands/issues/progress.md` |
| summarize an issue or an epic from its record, comments and history | `/pmkit:issues:summary` | `${CLAUDE_PLUGIN_ROOT}/commands/issues/summary.md` |
| change the title, priority, estimate, labels or acceptance criteria of an issue | `/pmkit:issues:update` | `${CLAUDE_PLUGIN_ROOT}/commands/issues/update.md` |
| pick up an issue: claim it, branch, plan, implement, open the PR and move it to review | `/pmkit:issues:work` | `${CLAUDE_PLUGIN_ROOT}/commands/issues/work.md` |
| check the tracker files, fix what can be fixed and resolve git conflict markers | `/pmkit:local:doctor` | `${CLAUDE_PLUGIN_ROOT}/commands/local/doctor.md` |
| render a board, roadmap or sprint view as Markdown or HTML to share with people outside the agent | `/pmkit:local:render` | `${CLAUDE_PLUGIN_ROOT}/commands/local/render.md` |
| draft a status update for an epic and publish it after approval | `/pmkit:report:status` | `${CLAUDE_PLUGIN_ROOT}/commands/report/status.md` |
| turn a spec or PRD into an epic with milestones, issues, sub-issues, estimates and blockers | `/pmkit:spec:import` | `${CLAUDE_PLUGIN_ROOT}/commands/spec/import.md` |
| show cycle time, lead time, throughput, aging and bug rate for a period, with the trend against the previous period | `/pmkit:team:flow-metrics` | `${CLAUDE_PLUGIN_ROOT}/commands/team/flow-metrics.md` |
| see what could make the team miss: blockers, stalled issues and PRs, late epics, epics without a recent status update, broken CI | `/pmkit:team:risk-radar` | `${CLAUDE_PLUGIN_ROOT}/commands/team/risk-radar.md` |
| digest of what changed since the last business day, per person, with what needs attention | `/pmkit:team:standup` | `${CLAUDE_PLUGIN_ROOT}/commands/team/standup.md` |
