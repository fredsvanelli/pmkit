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
| link this repository to a git host, or on Linear to a team | `/pmkit:link-repo` | `${CLAUDE_PLUGIN_ROOT}/commands/link-repo.md` |
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
| create an issue from an idea, refined into context, scope, tasks and acceptance criteria, with the fields checked against the project config | `/pmkit:issues:create` | `${CLAUDE_PLUGIN_ROOT}/commands/issues/create.md` |
| delegate an issue to an agent, hand it to agent:<name>, or have an agent work on it | `/pmkit:issues:delegate` | `${CLAUDE_PLUGIN_ROOT}/commands/issues/delegate.md` |
| delete an issue for good after a full preview, refusing while other issues reference it | `/pmkit:issues:delete` | `${CLAUDE_PLUGIN_ROOT}/commands/issues/delete.md` |
| show what blocks an issue or an epic, with the blocker chain, the hierarchy and the critical path | `/pmkit:issues:dependencies` | `${CLAUDE_PLUGIN_ROOT}/commands/issues/dependencies.md` |
| propose an estimate for an issue from the code it affects and from similar completed issues, and save it after confirmation | `/pmkit:issues:estimate` | `${CLAUDE_PLUGIN_ROOT}/commands/issues/estimate.md` |
| find issues with a plain-language question, such as "high-priority bugs in the current sprint" | `/pmkit:issues:find` | `${CLAUDE_PLUGIN_ROOT}/commands/issues/find.md` |
| link two issues (blocks, related, duplicate), remove a link, or set a parent | `/pmkit:issues:link` | `${CLAUDE_PLUGIN_ROOT}/commands/issues/link.md` |
| log time worked on an issue after confirmation and show its total, or suggest a comment when the tracker has no time tracking | `/pmkit:issues:log-time` | `${CLAUDE_PLUGIN_ROOT}/commands/issues/log-time.md` |
| list the issues assigned to the user, with the state of their pull requests and the next one to pick up | `/pmkit:issues:mine` | `${CLAUDE_PLUGIN_ROOT}/commands/issues/mine.md` |
| move an issue to a status category: in progress, in review, done | `/pmkit:issues:move` | `${CLAUDE_PLUGIN_ROOT}/commands/issues/move.md` |
| pause work on an issue, leave a handoff note and push a draft PR when there is code | `/pmkit:issues:pause` | `${CLAUDE_PLUGIN_ROOT}/commands/issues/pause.md` |
| post what was done on an issue as a comment, tick acceptance criteria and log the time spent | `/pmkit:issues:progress` | `${CLAUDE_PLUGIN_ROOT}/commands/issues/progress.md` |
| review the pull request of an issue against its acceptance criteria, flag the gaps and post the result after approval | `/pmkit:issues:review` | `${CLAUDE_PLUGIN_ROOT}/commands/issues/review.md` |
| turn the TODO and FIXME comments of the repository into issues after a full preview, skipping the ones an issue already covers | `/pmkit:issues:todos` | `${CLAUDE_PLUGIN_ROOT}/commands/issues/todos.md` |
| list what blocks a pull request from merging: checks, reviews, conflicts, open threads and policies | `/pmkit:issues:unblock` | `${CLAUDE_PLUGIN_ROOT}/commands/issues/unblock.md` |
| summarize an issue or an epic from its record, comments and history | `/pmkit:issues:summary` | `${CLAUDE_PLUGIN_ROOT}/commands/issues/summary.md` |
| change the title, priority, estimate, labels or acceptance criteria of an issue | `/pmkit:issues:update` | `${CLAUDE_PLUGIN_ROOT}/commands/issues/update.md` |
| pick up an issue: claim it, branch, plan, implement, open the PR and move it to review | `/pmkit:issues:work` | `${CLAUDE_PLUGIN_ROOT}/commands/issues/work.md` |
| list or edit Linear customers, see who asks for a feature, or link a customer request to an issue or a project | `/pmkit:linear:customers` | `${CLAUDE_PLUGIN_ROOT}/commands/linear/customers.md` |
| see who is on triage duty in Linear, change the triage rotation, or read Triage Intelligence suggestions | `/pmkit:linear:triage-rotation` | `${CLAUDE_PLUGIN_ROOT}/commands/linear/triage-rotation.md` |
| check the tracker files, fix what can be fixed and resolve git conflict markers | `/pmkit:local:doctor` | `${CLAUDE_PLUGIN_ROOT}/commands/local/doctor.md` |
| render a board, roadmap or sprint view as Markdown or HTML to share with people outside the agent | `/pmkit:local:render` | `${CLAUDE_PLUGIN_ROOT}/commands/local/render.md` |
| move the tracker to Linear, import a Linear team into .issues/, undo or finish a migration | `/pmkit:local:migrate` | `${CLAUDE_PLUGIN_ROOT}/commands/local/migrate.md` |
| write release notes, say what shipped, a changelog for customers | `/pmkit:report:release-notes` | `${CLAUDE_PLUGIN_ROOT}/commands/report/release-notes.md` |
| draft a status update for an epic and publish it after approval | `/pmkit:report:status` | `${CLAUDE_PLUGIN_ROOT}/commands/report/status.md` |
| turn a spec or PRD into an epic with milestones, issues, sub-issues, estimates and blockers | `/pmkit:spec:import` | `${CLAUDE_PLUGIN_ROOT}/commands/spec/import.md` |
| see and change capacity and days off per member for a sprint, with the effect on the load | `/pmkit:team:capacity` | `${CLAUDE_PLUGIN_ROOT}/commands/team/capacity.md` |
| show cycle time, lead time, throughput, aging and bug rate for a period, with the trend against the previous period | `/pmkit:team:flow-metrics` | `${CLAUDE_PLUGIN_ROOT}/commands/team/flow-metrics.md` |
| see issues, estimates and work in progress per member, who is overloaded or has no work in the sprint, and move issues between members | `/pmkit:team:load` | `${CLAUDE_PLUGIN_ROOT}/commands/team/load.md` |
| see what could make the team miss: blockers, stalled issues and PRs, late epics, epics without a recent status update, broken CI | `/pmkit:team:risk-radar` | `${CLAUDE_PLUGIN_ROOT}/commands/team/risk-radar.md` |
| digest of what changed since the last business day, per person, with what needs attention | `/pmkit:team:standup` | `${CLAUDE_PLUGIN_ROOT}/commands/team/standup.md` |
