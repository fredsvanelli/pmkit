# pmkit MVP skills

This is a copy of the "MVP skills" tab of the planning doc "pmkit - Project Management Kit for Agents", copied on 2026-10-24.

## MVP scope

The MVP ships 18 of the 54 skills, running on the Local tracker with the GitHub git host. The cut closes the full loop for each persona: a dev picks up and delivers an issue, a PM turns a spec into a backlog and reports on it, an EM plans and closes a sprint.

| Skill | Command | Persona | Why it's in the MVP |
| --- | --- | --- | --- |
| `setup` | `/pmkit:setup` | All | Nothing works without the config and the capability manifest |
| `query` | `/pmkit:issues-find` | All | Base of every read; proves `translate_query` |
| `manage-issue` | `/pmkit:issues-create`, `issues-update`, `issues-move`, `issues-assign`, `issues-comment`, `issues-link` | All | Everyday CRUD; proves the write path and confirmations |
| `summarize` | `/pmkit:issues-summary` | All | Cheap, high value, reused by other skills |
| `work-on-issue` | `/pmkit:issues-work` | Dev | The flagship skill; exercises tracker and git host together |
| `my-tasks` | `/pmkit:issues-mine` | Dev | Daily entry point for devs |
| `create-issue-from-context` | `/pmkit:issues-capture` | Dev | Turns what the agent sees (errors, diffs) into issues |
| `break-down-issue` | `/pmkit:issues-breakdown` | Dev | Proves hierarchy and estimates |
| `update-progress` | `/pmkit:issues-progress` | Dev | Keeps the tracker honest at the end of a session |
| `pause-and-handoff` | `/pmkit:issues-pause` | Dev | Completes the dev loop when work stops midway |
| `spec-to-issues` | `/pmkit:spec-import` | PM | Fastest way to seed a backlog from a document |
| `backlog-grooming` | `/pmkit:backlog-groom` | PM | Keeps the data clean enough for the EM skills |
| `status-report` | `/pmkit:report-status` | PM | Proves deliverables and status updates |
| `plan-cycle` | `/pmkit:cycle-plan` | EM | Proves sprints, estimates and capacity |
| `close-cycle-and-retro` | `/pmkit:cycle-close` | EM | Proves history-based metrics |
| `standup-digest` | `/pmkit:team-standup` | EM | Daily value; proves tracker + git host reads together |
| `local-doctor` | `/pmkit:local-doctor` | All | Required to keep hand-edited files and merges healthy |
| `help` | `/pmkit:help <capability> \| <text>` | All | Discoverability: explains what pmkit can do in this repo and which command to use |

Every skill also triggers from natural language ("what should I pick up now?"); the command is a shortcut, not a requirement.

Commands are shown in their Claude Code form (`/pmkit:<id>`). Per MQ1, the same skill is `$pmkit-<id>` in Codex and `/pmkit-<id>` in OpenCode; `manage-issue` ships as six skills (`issues-create`, `issues-update`, `issues-move`, `issues-assign`, `issues-comment`, `issues-link`) per MQ3.

**Left for phase 2:** the remaining 36 skills, starting with the ones that only need data the MVP already produces (`dependency-map`, `flow-metrics`, `risk-radar`, `release-notes`, `triage`, `local-render`), then the Linear adapter.

## Conventions shared by every skill

Every skill follows the same shape so the agent behaves predictably across all 18.

**SKILL.md shape**

```markdown
---
name: work-on-issue
description: Take an issue from the tracker to an open PR. Use when the user asks to work on, pick up, start or implement an issue by ID.
---

## When to use
## Inputs
## Steps
## Confirmation points
## Output
## If something is missing
```

The description is short and trigger-focused (Q3), because it is the only part always in context.

**Rules every skill applies**

1. **Read config first.** Load `.pmkit/config.yaml` and the capability manifest; if either is missing, stop and offer `setup`.
2. **Talk in categories, call in operations.** Skills use the common model and contract operations only; never adapter details.
3. **Confirm by risk (write policy).** Reads run freely. Single writes show what will change and ask once. Bulk changes, deletes, scope moves and publishing updates show a full preview first.
4. **Say which path was used.** When a capability is derived or degraded, the output says so in one line (e.g., "velocity computed from the last 3 sprints").
5. **Lean output.** Lead with the answer; tables for lists of issues (ID, title, status, assignee, estimate); IDs always clickable or copyable.
6. **Fail with a next step.** Errors name what went wrong and what to do ("no sprint is active; create one with `/pmkit:cycle-plan`").

## Foundation skills

### `setup` · `/pmkit:setup`

- **Triggers:** "set up pmkit", "connect my tracker", or any skill finding no config.
- **Inputs:** tracker system (MVP: `local`), git host (MVP: `github`, detected from the git remote).
- **Flow:**
    1. Detect the git remote and the GitHub auth (reuse the `gh` login if present).
    2. Scaffold `.issues/` with a default `config.yaml`, `.gitattributes` and `.gitignore` for `.cache/`.
    3. Ask only what can't be inferred (Q6): ID prefix, estimate unit, members (prefilled from `git log` authors).
    4. Write `.pmkit/config.yaml` and build the capability manifest.
    5. Show a one-screen summary for approval.
- **Operations:** `discover`, `capabilities`, `list_members`, `list_statuses`, `list_fields`.
- **Confirms:** the final summary before writing files.
- **Output:** what was created, the active capabilities, and three suggested next commands.
- **Edge cases:** existing `.issues/` → validate it instead of overwriting; no git remote → run without git host and say which skills lose features.

### `query` · `/pmkit:issues-find`

- **Triggers:** any question about issues ("high-priority bugs in the current sprint", "what's assigned to me and blocked?").
- **Inputs:** natural-language question, optional scope.
- **Flow:**
    1. Translate the question into the contract's filter (status category, type, assignee, sprint, labels, dates, blocked).
    2. Show the filter in one line so the user can correct it.
    3. Run it and return a table, sorted by what the question implies.
- **Operations:** `translate_query`, `search_issues`, `run_native_query`.
- **Confirms:** none (read-only).
- **Output:** issues table plus the count; offers to save as a view when the same query repeats.
- **Edge cases:** ambiguous person or label → show the closest matches and ask.

### `manage-issue` · `/pmkit:issues-create` · `issues-update` · `issues-move` · `issues-assign` · `issues-comment` · `issues-link`

- **Triggers:** "create an issue for…", "move ISS-7K3Q to review", "assign to Ana", "ISS-4P8A blocks ISS-7K3Q".
- **Inputs:** issue ID (except create), the change, optional fields.
- **Flow:**
    1. Resolve the target issue and the change in common terms (category, field role, relation type).
    2. Validate against config (allowed types, statuses, estimate scale).
    3. Show the change as before → after and ask once.
    4. Apply it; the adapter writes the event log.
- **Operations:** `create_issue`, `update_issue`, `move_to_category`, `assign`, `comment`, `link`, `unlink`, `set_parent`, `archive`.
- **Confirms:** every write, as a single before → after line; `archive` and scope moves with a preview.
- **Output:** the updated issue line with its ID.
- **Edge cases:** moving to done with open sub-issues or unresolved blockers → warn before confirming.

### `summarize` · `/pmkit:issues-summary`

- **Triggers:** "summarize ISS-7K3Q", "where are we on epic EPC-2M9D?".
- **Inputs:** issue or epic ID.
- **Flow:** read the record, comments and events; condense into decisions, open points, blockers and next steps.
- **Operations:** `get_issue`, `list_comments`, `get_history`, `list_relations`.
- **Confirms:** none.
- **Output:** four short sections; offers to post it as a comment.
- **Edge cases:** very long threads → summarize the latest 30 days and say so.

### `help` · `/pmkit:help <capability> | <text>`

- **Triggers:** "what can pmkit do?", "how do I plan a sprint?", "does this repo support cycles?", or `/pmkit:help` with no argument.
- **Inputs:** nothing, a capability ID (e.g., `cycles`, `time_tracking`), or free text (a question, a skill name, a command).
- **Flow:**
    1. **No argument:** show the active tracker and git host, the capabilities available in this instance, and the installed skills grouped by persona with their commands.
    2. **Capability:** when the argument matches a capability ID, explain what it is, its path in this instance (native, derived, conditional or absent), which skills use it, and how to enable it when it's missing (plan, tier, configuration).
    3. **Text:** otherwise, match the text against skill names, commands, descriptions and capabilities; answer with the best one to three matches, each with what it does and two example invocations.
    4. **No match:** say so, show the closest commands and suggest `/pmkit:help` for the full list.
- **Operations:** `capabilities`, `discover` (from cache); reads the installed skills' metadata.
- **Confirms:** none (read-only).
- **Output:** a short answer that ends with a ready-to-run command.
- **Edge cases:** no config yet → explain what pmkit is and point to `/pmkit:setup`; a capability that is absent for this tracker → say which trackers support it.

## Dev skills

### `work-on-issue` · `/pmkit:issues-work <ID>`

- **Triggers:** "work on ISS-7K3Q", "pick up the next issue", "implement ISS-7K3Q".
- **Inputs:** issue ID (or none: falls back to the top of `my-tasks`).
- **Flow:**
    1. **Context:** issue, acceptance criteria, comments, parent epic, sub-issues, blockers, linked docs.
    2. **Readiness:** warn and ask if it's blocked, assigned to someone else, already done or missing acceptance criteria.
    3. **Claim:** assign to the user and move to in progress.
    4. **Branch:** create `iss-7k3q-short-title` from the default branch and record it in the issue's `branch` field.
    5. **Plan:** propose an implementation plan from the code and the issue; optionally post it as a comment.
    6. **Execute:** the agent implements with its normal flow; commit messages include the issue ID.
    7. **Deliver:** push, open the PR with the ID and a link to the issue in the body, comment a summary on the issue, move to in review.
    8. **Follow-ups:** offer issues for discovered scope or tech debt, linked as related.
- **Operations:** `get_issue`, `list_relations`, `list_comments`, `assign`, `move_to_category`, `update_issue`, `comment`, `create_issue`, `link`; git host: `create_branch`, `open_pr`.
- **Confirms:** claiming (step 3), the plan (step 5), opening the PR (step 7).
- **Output:** PR link, issue status, follow-ups created.
- **Edge cases:** uncommitted changes in the tree → ask before switching branches; PR merged later → the issue moves to done the next time any skill reads it (merge detected through the git host).

### `my-tasks` · `/pmkit:issues-mine`

- **Triggers:** "what should I pick up?", "my issues", "what's on my plate?".
- **Flow:** list the user's open issues in the active sprint, ordered by in progress first, then priority, due date and unblocked before blocked; add their open PRs awaiting review.
- **Operations:** `current_cycle`, `search_issues`, `list_relations`; git host: `get_pr`, `pr_reviews`.
- **Confirms:** none.
- **Output:** a short table plus one recommended next issue with the reason.
- **Edge cases:** no active sprint → assigned open issues by priority and date, and says so.

### `create-issue-from-context` · `/pmkit:issues-capture`

- **Triggers:** "open an issue for this bug", "track this TODO", after a failing test or stack trace in the session.
- **Flow:** collect the evidence in context (error, diff, files, repro steps); draft title, type, description, acceptance criteria and suggested priority; check for likely duplicates; create on confirmation.
- **Operations:** `search_issues` (duplicates), `create_issue`, `link`.
- **Confirms:** the draft before creating.
- **Output:** the new issue ID, or the existing duplicate.
- **Edge cases:** secrets in logs → redact before writing.

### `break-down-issue` · `/pmkit:issues-breakdown <ID>`

- **Triggers:** "break ISS-7K3Q into sub-issues", "split this epic".
- **Flow:** read the issue and the affected code; propose sub-issues with titles, estimates, order and blockers between them; create them with `parent` set.
- **Operations:** `get_issue`, `create_issue`, `set_parent`, `link`.
- **Confirms:** the full list before creating (bulk preview).
- **Output:** the tree of created sub-issues with total estimate vs. the parent's.

### `update-progress` · `/pmkit:issues-progress [ID]`

- **Triggers:** "update the issue with what I did", end of a working session.
- **Flow:** find the issue (argument, current branch or last worked-on); summarize the session's commits and changes; post as a comment; optionally log time spent.
- **Operations:** `get_issue`, `comment`, `log_time`; git: local log of the branch.
- **Confirms:** the comment text.
- **Output:** the posted comment.

### `pause-and-handoff` · `/pmkit:issues-pause [ID]`

- **Triggers:** "I'm pausing this", "hand this off to Ana".
- **Flow:** record current state, what's done, what's next and open questions as a comment; push the branch and open a draft PR if there is code; move back to to do (or keep in progress) and reassign if asked.
- **Operations:** `comment`, `move_to_category`, `assign`; git host: `open_pr` (draft).
- **Confirms:** the handoff note and the status/assignee change.
- **Output:** the note, the draft PR link and the new owner.

## PM skills

### `spec-to-issues` · `/pmkit:spec-import <file>`

- **Triggers:** "turn this PRD into issues", "break this spec into a backlog".
- **Inputs:** a document (file in `.issues/docs/`, any local file, or pasted text), optional target epic and milestone.
- **Flow:**
    1. Read the spec and extract goals, scope, requirements and acceptance criteria.
    2. Propose an epic (or reuse one), milestones if the spec has phases, and issues with sub-issues, estimates and blockers.
    3. Show the full tree for review; the user edits, removes or merges items in conversation.
    4. Create everything and link the spec document to the epic.
- **Operations:** `read_document`, `create_document`, `create_issue`, `set_parent`, `link`, `list_deliverables`.
- **Confirms:** the full tree before creating (bulk preview).
- **Output:** the created tree with totals per milestone; open questions found in the spec listed separately.
- **Edge cases:** requirements without acceptance criteria → created with a "needs criteria" label rather than invented criteria.

### `backlog-grooming` · `/pmkit:backlog-groom`

- **Triggers:** "clean up the backlog", "what's wrong with our backlog?".
- **Flow:**
    1. Scan backlog and to-do issues for problems: no estimate, no acceptance criteria, no parent epic, untouched for 60+ days, likely duplicates (similar titles and descriptions), broken references.
    2. Group findings by problem with a proposed fix for each (estimate, criteria draft, epic, close as stale, merge duplicates).
    3. Apply the fixes the user accepts, in bulk or one by one.
- **Operations:** `search_issues`, `get_history`, `update_issue`, `move_to_category`, `link`, `archive`.
- **Confirms:** a preview of all accepted fixes before applying.
- **Output:** before and after counts per problem.
- **Edge cases:** the 60-day threshold is configurable in `config.yaml`.

### `status-report` · `/pmkit:report-status <epic>`

- **Triggers:** "status of EPC-2M9D", "write this week's update for the epic".
- **Flow:**
    1. Read the epic, its issues and the events since the last status update.
    2. Compute progress (done vs. total, by count and estimate), what changed, what's blocked, and forecast vs. target date.
    3. Draft the update with a proposed health (on track, at risk, off track) and the reason.
    4. Publish to `epics/<ID>/updates/` on confirmation.
- **Operations:** `get_deliverable`, `deliverable_progress`, `search_issues`, `get_history`, `publish_status_update`; git host: merged PRs in the period.
- **Confirms:** the draft and the health before publishing.
- **Output:** the published update, ready to paste into Slack or email.
- **Edge cases:** no previous update → covers the last 14 days and says so.

## EM skills

### `plan-cycle` · `/pmkit:cycle-plan`

- **Triggers:** "plan the next sprint", "what fits in the next cycle?".
- **Inputs:** sprint dates (default: same length as the last sprint, starting after it), optional goal.
- **Flow:**
    1. Compute velocity from the last three closed sprints (estimates completed); fall back to issue count with no estimates.
    2. Compute capacity from member availability in config and days off entered for this sprint.
    3. Propose scope from the prioritized backlog up to capacity, keeping blockers before what they block, and flag unestimated issues.
    4. Propose a sprint goal from the selected issues.
    5. Create `sprints/<date>.yaml` and set the `sprint` field on the selected issues.
- **Operations:** `list_cycles`, `cycle_issues`, `get_history`, `get_capacity`, `set_capacity`, `search_issues`, `open_cycle`, `move_to_cycle`.
- **Confirms:** capacity inputs, then the proposed scope (bulk preview).
- **Output:** the sprint plan: goal, issues, committed estimate vs. capacity, and risks (unestimated, blocked, single-owner overload).
- **Edge cases:** no closed sprints yet → asks for a target number of points or issues instead of velocity.

### `close-cycle-and-retro` · `/pmkit:cycle-close`

- **Triggers:** "close the sprint", "sprint retro".
- **Flow:**
    1. Compare planned vs. delivered (count and estimate), scope added and removed mid-sprint, carry-over, and issues that spent several sprints in progress.
    2. Compute cycle time and throughput for the sprint from the event logs.
    3. Propose what to do with unfinished issues: move to the next sprint, back to backlog, or split.
    4. Close the sprint and apply the moves; optionally write a retro document to `docs/`.
- **Operations:** `current_cycle`, `cycle_issues`, `get_history`, `metric_events`, `close_cycle`, `move_to_cycle`, `create_document`.
- **Confirms:** the moves of unfinished issues (bulk preview) and closing the sprint.
- **Output:** the sprint report with numbers and the retro prompts (what slipped and why, based on the data).

### `standup-digest` · `/pmkit:team-standup`

- **Triggers:** "what changed since yesterday?", "standup".
- **Inputs:** period (default: since the last business day), optional person.
- **Flow:** per person, list issues moved, created and completed (from event logs), new comments, blockers, and PRs opened, merged or waiting for review; highlight anything stuck for more than N days.
- **Operations:** `get_history`, `search_issues`, `list_relations`; git host: `get_pr`, `pr_reviews`, `pr_checks`.
- **Confirms:** none.
- **Output:** a compact digest per person plus a "needs attention" list, ready to paste into a channel.
- **Edge cases:** solo repos → a personal "yesterday / today / blockers" format instead of per person.

## Local-specific skill

### `local-doctor` · `/pmkit:local-doctor`

- **Triggers:** "check the issues folder", after a merge with conflicts in `.issues/`, or automatically when any skill finds an invalid file.
- **Flow:**
    1. **Validate:** every file against the schema (required fields, allowed values from `config.yaml`, ID format).
    2. **References:** find broken `parent`, `blocked_by`, `sprint`, `milestone` and assignee references, and dependency cycles.
    3. **Conflicts:** detect git conflict markers in frontmatter and resolve them with the user field by field, using the event log to show which value is newer.
    4. **Drift:** append synthetic events where hand edits changed frontmatter without an event.
    5. **Duplicate IDs:** reassign the newer one and update references (rare with base32 IDs, possible with copy-paste).
    6. **Cache:** rebuild `.issues/.cache/`.
- **Operations:** local-only operations exposed by the Local adapter (`validate`, `resolve_conflict`, `reindex`), plus `update_issue` and `get_history`.
- **Confirms:** each conflict resolution and each ID reassignment; schema fixes in one preview.
- **Output:** a health report (files checked, problems found and fixed, problems left).

## Contract, build order and open questions

### Contract operations the MVP needs

The 18 skills use 13 of the 20 operation families. The rest can wait for phase 2.

| Family | Needed in the MVP | Not yet |
| --- | --- | --- |
| Discovery | All | — |
| Issues | All | — |
| Native search | `translate_query`, `run_native_query` | `run_saved_view` |
| Relations | All | — |
| History | `get_history` | — |
| Comments | `list_comments`, `comment` | `resolve_thread` |
| Cycles | All | — |
| Deliverables | All | — |
| Capacity | `get_capacity`, `set_capacity` | — |
| Metrics | `metric_events` | `native_metrics` |
| Documents | `read_document`, `create_document` | `list_documents` |
| Time | `log_time` | `list_time_entries` |
| Git host | `create_branch`, `open_pr`, `get_pr`, `pr_checks`, `pr_reviews` | `list_deploys`, `ci_logs` |
| Strategy, Releases, Demand, Agents, Inbox, Security | — | All |

### Build order

1. **Core:** config loader, capability manifest, contract types and the Local adapter (CRUD, event log, query engine, cache).
2. **Faces:** CLI and MCP server over the same core, with the capability-filtered tool list (Q3).
3. **Foundation skills:** `setup`, help, `query`, `manage-issue`, `summarize`, `local-doctor`.
4. **GitHub git host adapter:** branches, PRs, reviews and checks, reusing the `gh` login.
5. **Dev skills:** `work-on-issue` first, then `my-tasks`, `create-issue-from-context`, `break-down-issue`, `update-progress`, `pause-and-handoff`.
6. **PM skills:** `spec-to-issues`, `backlog-grooming`, `status-report`.
7. **EM skills:** `plan-cycle`, `close-cycle-and-retro`, `standup-digest`.
8. **Packaging:** Claude Code plugin, Codex plugin and plain skill folders in `fredsvanelli/skills/pmkit`.

Testing runs against fixture repositories with a prepared `.issues/` folder and golden outputs per skill, which the Local adapter makes possible without any network.

### Open questions

- [x] **Command depth:** confirm that `/pmkit:group:action` works in Claude Code, Codex and OpenCode; otherwise use `/pmkit:group-action`.
- [x] **Merged PR detection:** move issues to done on the next read (lazy, no infrastructure) or also offer a GitHub Action that updates `.issues/` on merge.
- [x] **One skill per command or grouped:** `manage-issue` covers six commands; decide whether each command is its own `SKILL.md` (sharper triggers) or one skill with sub-actions (fewer files).
- [x] **Default estimate unit:** points or hours for new Local trackers.
- [x] **Stale threshold and other defaults:** values for `backlog-grooming` (60 days), standup "stuck" (N days) and sprint length.

### Decisions on the open questions

All five recommendations below were accepted.

#### MQ1. Command depth

The research changes the premise: `/pmkit:group:action` is not portable. Only Claude Code has slash commands with a plugin prefix, and skill IDs everywhere must be kebab-case, with no colons.

| Agent | How skills are invoked explicitly | Implication |
| --- | --- | --- |
| Claude Code | Plugin skills and commands appear as `/plugin-name:command` ([source](https://openskillindex.com/skills/majiayu000-claude-skill-registry-creating-plugins)); commands in subfolders get a namespace from the folder name ([source](https://smithery.ai/skills/lttr/plugin-creator)) | `/pmkit:issues-create` works for skills; a third `:` level only exists for subfolder commands and needs testing |
| Codex | Skills are not slash commands: they are mentioned with `$` or picked from `/skills`, or triggered from the description ([source](https://developers.openai.com/codex/skills)); custom slash prompts were removed in v0.117.0 ([source](https://codex.danielvaughan.com/2026/04/10/migrating-custom-prompts-to-skills/)) | `$issues-create` or natural language; no `/pmkit:` at all |
| OpenCode | Skills appear as `/id` commands; IDs should match `^[a-z0-9]+(-[a-z0-9]+)*$` ([source](https://v2.opencode.ai/skills.md)) | `/issues-create` or `/pmkit-issues-create`; no colon prefix |

| Option | Result | Pros | Cons |
| --- | --- | --- | --- |
| A. Skill IDs without prefix (`issues-create`) | Claude Code `/pmkit:issues-create` · Codex `$issues-create` · OpenCode `/issues-create` | Shortest; clean in Claude Code | Name collisions with other skills in Codex and OpenCode |
| B. Skill IDs with prefix (`pmkit-issues-create`) | Claude Code `/pmkit:pmkit-issues-create` · Codex `$pmkit-issues-create` · OpenCode `/pmkit-issues-create` | Unique everywhere | Redundant and long in Claude Code |
| C. Per-target naming at build time | Claude Code plugin uses `issues-create` under the `pmkit` namespace; Codex and OpenCode packages get `pmkit-issues-create` | Clean in Claude Code and collision-free elsewhere | The packaging step renames skills, so docs must show the form per agent |

**Recommendation: C.** The packaging step from Q2 already builds one artifact per agent, so it can also apply the right name. Skills are written once with a base ID (`issues-create`); the build adds the `pmkit-` prefix where there is no plugin namespace. Natural language keeps working everywhere, and `help` shows the right invocation for the agent in use.

#### MQ2. Merged PR detection

| Option | How it works | Pros | Cons |
| --- | --- | --- | --- |
| A. Lazy | Any skill that reads an issue in review checks its PR through the git host; if merged, it moves the issue to done and logs the event | No infrastructure; works offline until the next read | The tracker lags until someone runs a skill; the move lands in whoever's working tree runs it |
| B. GitHub Action | A workflow on `pull_request: closed` updates `.issues/` on the default branch | Always current; one commit per merge | Bot commits in the repo; needs write permission for Actions; GitHub-only |
| C. Merge-time convention | The PR itself includes the issue's move to done, made by `work-on-issue` when opening the PR | Tracker and code change land atomically in the same merge | The issue shows done on the PR branch before review ends; abandoned PRs need cleanup |

**Recommendation: A in the MVP, B as an optional add-on in phase 2.** A needs nothing extra and is enough for solo and small teams. B is the clean answer for teams that want the main branch always current, and fits naturally with Q7 (scheduled and CI runs).

#### MQ3. One skill per command or grouped

| Option | How it works | Pros | Cons |
| --- | --- | --- | --- |
| A. One `SKILL.md` per command | `issues-create`, `issues-update`, `issues-move`, `issues-assign`, `issues-comment`, `issues-link` | Sharp descriptions and reliable triggering; each one shows as its own command | Six descriptions in context instead of one; some duplicated instructions |
| B. One grouped skill | `manage-issue` with sub-actions | One description, one file | Vague triggering; no direct command per action in agents that list skills as commands |
| C. Hybrid | One `SKILL.md` per command for discoverability, all pointing to a shared reference file with the common rules | Benefits of A without duplicated instructions | Slightly more structure |

**Recommendation: C.** Skills support reference files next to `SKILL.md`, so each command stays short and the shared rules (validation, confirmations, event logging) live once in `references/`. The MVP count stays at 18 skills conceptually, shipped as 23 skill folders.

#### MQ4. Default estimate unit

| Option | Pros | Cons |
| --- | --- | --- |
| A. Points (Fibonacci: 1, 2, 3, 5, 8, 13) | Industry default for sprints; matches Linear, Jira and Azure DevOps habits | Abstract for solo devs |
| B. Hours | Concrete; works with time tracking | Encourages false precision; harder to compare across people |
| C. T-shirt sizes (XS to XL) | Fast and low-pressure | Velocity needs a conversion table |

**Recommendation: A, configurable.** Points keep velocity math simple and migrate cleanly to hosted trackers through `local-migrate`. `setup` asks once and offers hours or sizes for those who prefer them.

#### MQ5. Defaults

| Setting | Recommended default | Reason |
| --- | --- | --- |
| Stale issue threshold (`backlog-grooming`) | 60 days without activity | Long enough to skip normal backlog, short enough to catch abandoned items |
| "Stuck" threshold (`standup-digest`) | 3 business days in the same status | Flags problems within a week without noise from normal work |
| Sprint length (`plan-cycle`) | 2 weeks, starting on Monday | Most common cadence; editable per sprint |
| Velocity window | Last 3 closed sprints | Smooths noise without hiding recent changes |
| Status update window (`status-report`) | Since the last update, or 14 days | Matches a sprint |

All of these live in `.issues/config.yaml` and can be changed per repo.
