# PMK-45 strategic goals for the Local tracker

Source: Local adapter, Entity mapping ("`goals/<ID>.md`, linked to epics") and Capabilities ("progress rolled up from epics"); Technical spec, `EpicFrontmatter.goal`; Unified model, `list_goals`, `goal_progress`.

## Goal

A team records a strategic goal, links epics to it, and reads the goal's progress from the issues of those epics. The `strategic_goals` capability becomes native on the Local tracker. PMK-67 (`initiatives-and-goals`) builds its command on these CLI calls, so their `--json` output is complete and stays stable.

## Non-goals

- Updating, closing, renaming or deleting a goal. None is in the acceptance criteria. They are follow-ups.
- A goal status or owner. Progress comes from the epics, and the criteria ask for nothing else.
- Goals on Linear. Linear calls them initiatives, but the adapter does not read them. The commands answer `NOT_SUPPORTED` there.
- Linking a goal to issues directly, or a goal to a parent goal.

## Design

### File

`.issues/goals/<ID>.md` holds one goal. The file stem is the ID, as for milestones and releases, so the frontmatter holds no `id` key and an `id` key there is ignored.

```markdown
---
title: Customers trust our webhooks
target: 2026-12-31
---

Why the goal matters, in free text.
```

`title` is required and fits on one line. `target` is optional, a date as `YYYY-MM-DD`. The body is the description.

### ID

A goal ID is `GOAL-` and a code. The code follows `id_style` in `.issues/config.yaml`, as issue and epic IDs do: `GOAL-7K3Q` with `random` and `GOAL-1` with `numbered`. Both shapes stay valid when the style changes. Input is normalized like other IDs, so `goal-1` names `GOAL-1`.

The prefix is fixed at `GOAL` (builder's call). A `goal_prefix` key would add a config key, a schema entry, a setup question and a rule that three prefixes differ, and no criterion asks for it. A goal ID only appears where a goal is expected (`goal` commands and the epic `goal` field), so an issue prefix of `GOAL` does not make a reference ambiguous. A `goal_prefix` key is a follow-up.

### The epic link

An epic links to one goal through an optional `goal` key in `epics/<ID>/epic.md`, after `milestone`. The link lives on the epic only. A goal's epic list is computed on each read, the way an issue's `children` is.

- `epic create --goal <id>` creates an epic linked to a goal.
- `epic goal <epic> <goal|none>` sets or removes the link of an existing epic. It writes `epic.md` and appends an `update` event with `field: goal` to the epic's `events.jsonl`. When the value does not change, it writes nothing.

Both refuse a goal that has no file, and a goal file that does not parse.

### Tracker format

The tracker format stays 2 (builder's call, following the ADR-0004 rule that the format goes up only when files change shape). The change only adds a folder and an optional epic key. A plugin from before this change reads an epic with `goal` and ignores the key, and it has no command that rewrites an epic, so the key is never lost. Milestones, releases and views were added the same way. No migration is needed.

### Contract operations

Five new operations in `TRACKER_OPERATIONS`:

- `listGoals()` returns `{ goals, problems }`. Goals are sorted by target date, then ID, and a goal without a target goes last. A file that does not parse, or whose stem is not a goal ID, is skipped and reported in `problems`. `pmkit validate` reports it too.
- `getGoal(id)` returns the goal. A missing goal is `NOT_FOUND`. A file that does not parse is `INVALID_INPUT` with `/pmkit:local:doctor` as the next step.
- `createGoal(input, actor, { dryRun })` takes `title` and an optional `target` and `description`, and returns `{ before: null, after }`.
- `goalProgress(id)` returns the goal, one entry per linked epic with that epic's progress, and the sums.
- `setEpicGoal(epic, goal, actor, { dryRun })` returns `{ before, after }` with the epic records. A `null` goal removes the link.

`createDeliverable` accepts `goal`.

A goal record is `{ id, title, target?, description, epics }`, where `epics` lists the IDs of the linked epics in `epic list` order.

`goalProgress` returns:

```json
{
  "goal": { "id": "GOAL-1", "title": "...", "target": "2026-12-31", "description": "", "epics": ["EPC-1"] },
  "epics": [{ "id": "EPC-1", "title": "...", "status": { "name": "in_progress", "category": "in_progress" }, "progress": { "total": 4, "done": 1, "canceled": 0, "points": 8, "pointsDone": 2, "byCategory": { "...": 0 } } }],
  "total": 4, "done": 1, "canceled": 0, "points": 8, "pointsDone": 2, "byCategory": { "...": 0 }
}
```

Each epic's `progress` is exactly what `deliverableProgress` returns for it. The tracker computes both from one shared function, so the counting rule (non-archived issues whose parent chain reaches the epic, canceled issues outside `total`) lives in one place. The sums add the epics. An issue reaches at most one epic, because an epic has no parent, so no issue counts twice.

### CLI

A new `goal` group:

- `goal list` prints a table with ID, title, target and epics, or `no goals`. With `--json` it prints the goal records as an array. Files that do not parse print as warnings that point to `pmkit validate`.
- `goal get <id>` prints the goal record with its epics.
- `goal create --title t [--target YYYY-MM-DD]` (a write).
- `goal progress <id>` prints the sums, the counts by category and a table of the epics with their done and total counts.

In the `epic` group:

- `epic goal <epic> <goal|none>` (a write).
- `epic create` takes `--goal <id>`.
- `epic get` prints a `goal:` line when the epic has one, and `epic list` adds a Goal column when an epic has a goal, so output without goals is unchanged.

### Capability

`SERVED_BY.strategic_goals = ['goal list', 'goal get', 'goal create', 'goal progress', 'epic goal']`, so the Local manifest reports `strategic_goals` as native. ADR-0001 then counts 17 served capabilities, 13 of them native.

`SERVED_BY` applies to Linear too. Linear answers `native` for initiatives on a Business plan, so without a change the Linear manifest would report `strategic_goals` native while every goal call fails. On a Business plan Linear's entry becomes `absent` with `detail: { workspace: 'native', unsupported: [the five operations] }` and the hint "The Linear adapter does not serve initiatives yet; Linear offers them on this workspace". On other plans it stays `absent` with the plan hint. The Linear stubs map the five operations to `strategic_goals`, so the refusal carries the manifest's hint. `epic create --goal` on Linear answers `NOT_SUPPORTED`.

### Validate and doctor

`pmkit validate` checks `goals/*.md`. A stem that is not a goal ID, a file that does not parse, a missing or multi-line title or a bad target is a `goal` problem. An epic whose `goal` names no goal file is a `reference` problem. `/pmkit:local:doctor` lists `goal` with the codes the user fixes by hand.

### Migration to Linear

`local-migrate export` lists `goals` among the losses: the goal files stay in `.issues/goals/`, pmkit creates no Linear initiative, and the epics lose their goal links.

### Docs

The README CLI table, a CHANGELOG line, a Goal entry in `CONTEXT.md` (a sprint's `goal` is a sentence, not a Goal), the Goal entity and the Goals contract family in the design spec, and ADR-0001's counts. No `commands/` file changes, because PMK-67 adds the command that uses these calls.

## Decisions taken without the user

- The fixed `GOAL` prefix, with the code following `id_style`.
- No tracker format change and no migration.
- `epic goal <epic> <goal|none>` as the way to link an existing epic, shaped like `issues parent`.
- The goal fields: `title`, `target`, the description. No status or owner.
- Linear reports `strategic_goals` absent with Linear's own answer in `detail.workspace`.
