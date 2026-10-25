# PMK-3 design: milestones in the Local tracker

Issue PMK-3, epic EPC-1. Status: approved by the author's own choice (autonomous brainstorm). Builds on PMK-2, which this branch stacks on.

## Problem

An issue's `milestone` field takes any string. `issuePatch` in `scripts/pmkit.mjs` passes `--milestone` through, and `NORMALIZE.milestone` in `scripts/lib/local/tracker.mjs` only refuses a line break. `validateRepo` checks the reference only when `.issues/milestones/` exists, and no command creates that folder. `/pmkit:spec:import` proposes milestones in its tree but has no command to create them, so the names it writes are free text.

Sources: Local adapter, Entity mapping ("`milestones/<name>.md` and the issue's `milestone` field"). Technical spec, Core types (`Milestone { id, name, dueDate? }`).

This repository shows the current state. Its issues use nine milestone names (`local-gaps`, `generic-commands`, `linear`, `jira`, `gitlab`, `github-issues`, `azure-devops`, `faces`, `phase-2-commands`) and it has no `milestones/` folder.

## Goals

- A milestone is a file, `milestones/<id>.md`, that holds a name and an optional due date.
- The CLI lists milestones, prints one, and creates one.
- `/pmkit:spec:import` creates the milestones of the tree it imports before it creates the issues that name them.
- Once a tracker has milestone files, writes and `validate` refuse or report a milestone that has no file.

## Non-goals

- Updating, renaming, closing or deleting a milestone. The issue asks for list, get and create.
- A `--milestone` filter on `issues list`, milestone progress, or a command that lists the issues of a milestone.
- A `--milestone` flag on `epic create`. The tracker operation already takes `milestone`, and the reference check below covers it.
- Releases. PMK-22 adds `releases/<version>.md` and the `releases` capability.
- Creating milestone files for this repository on this branch. `.issues/` changes only through the CLI, after the release (see "Trackers that already use milestone names").

## Anti-goals

- A tracker that uses milestone names without files must keep working after the upgrade. No write path that works in 0.2.0 may start failing, and `validate` must not start reporting every existing name, until the tracker has at least one milestone file.
- No tracker format bump for an additive change. A bump makes every teammate upgrade before they can read the tracker again.

## Approaches

1. **Milestone files, checked once the first one exists.** `milestones/<id>.md` holds the milestone. Writes and `validate` check a `milestone` value only when `milestones/` holds at least one `.md` file, which is close to the rule `validate` already follows. `milestone create` makes the folder, warns about names in use that still have no file, and `/pmkit:local:doctor` offers to create a file for each. The format stays 2.
2. **Milestone files, always checked.** `--milestone` must name a file in every tracker. In 0.2.0 any string works, so `issues create --milestone M1` would fail in every tracker without files, and `validate` would report every existing name the day the release lands. That breaks the first anti-goal.
3. **Format 3 with a migration that writes the files.** The migration writes a file for every milestone name found in issues and epics, and every check is always on. It bumps the format for a change that alters no existing file, so a teammate on 0.2.0 can no longer read the tracker. It also has to invent a file for every free-text value, including names that are not valid file names, such as `Q4 2026`.

Recommended: approach 1. It keeps every 0.2.0 tracker working, needs no migration, and gives each tracker a path to checked references through `milestone create` or `/pmkit:local:doctor`.

## Design

### Milestone file

`milestones/<id>.md` under the tracker folder:

```markdown
---
name: Local tracker gaps
due: 2026-11-30
---

Close the gaps of 0.1.0.
```

- The file stem is the milestone id. An issue's or epic's `milestone` field holds this id. The frontmatter has no `id` key, as a sprint file has none, so the id and the file name cannot disagree.
- `name` is a one-line, non-empty string. `milestone create` always writes it and defaults it to the id. A file written by hand without `name` reads with the id as its name.
- `due` is optional, `YYYY-MM-DD`, with the same key as the issue's `due`.
- The body after the frontmatter is the description. `milestone create` writes no body. A description written by hand reads back in `milestone get`.
- The reader ignores other frontmatter keys. No command rewrites a milestone file, so nothing drops them.

The model is `Milestone { id, name, due?, description }`, added as a typedef in `scripts/lib/model.mjs`. It maps the technical spec's `Milestone { id, name, dueDate? }`. The Local tracker spells the date `due`, as it does for issues.

**Id rule.** An id starts and ends with a letter or a digit, and holds only letters, digits, `.`, `_` and `-`. `local-gaps`, `phase-2-commands`, `v1.0` and `M1` pass. `Q4 2026` and `v1.` fail. Matching is exact and case-sensitive. `milestone create` also refuses an id that equals an existing one when case is ignored, because macOS and Windows store `M1.md` and `m1.md` as one file.

A new module, `scripts/lib/local/milestones.mjs`, holds the id check, parsing, serializing and sorting, as `sprints.mjs` does for sprints. Parsing follows `parseFile` in `epics.mjs`: conflict markers throw `CONFLICT`, and a missing or unreadable frontmatter, a bad `due` or a `name` with a line break throws `INVALID_INPUT`, both with the next step `/pmkit:local:doctor`. Whether `parseFile` moves to a shared module or is exported from `epics.mjs` is the builder's call.

**No event log.** A milestone is one file, as a sprint is, and sprints have no `events.jsonl`. `milestone create` is the only write, and git history records it.

### Tracker operations

The contract gets a Milestones family. `scripts/lib/contract.mjs` adds the three names to `TRACKER_OPERATIONS`, and the design spec's Contract table gets a row.

- `listMilestones()` returns every milestone file that parses, by `due`, then by id. A milestone without `due` comes last. A file that does not parse is left out, as `listDeliverables` leaves out a bad epic, and `validate` reports it. A missing folder returns `[]`.
- `getMilestone(id)` returns the milestone whose file stem equals `id`. Otherwise it throws `NOT_FOUND` with the next step `pmkit milestone list`.
- `createMilestone({ id, name, due }, actor, { dryRun })` runs `requireWriter(actor)` first, then refuses unknown keys as `createDeliverable` does. An id that breaks the rule is `INVALID_INPUT`. An id that matches an existing file, ignoring case, is `CONFLICT` with the next step `pmkit milestone list`. `name` is trimmed, checked with `oneLine`, and defaults to the id. `due` must pass `validDate`. The operation serializes, reads the text back with `readBack`, and, unless `dryRun`, creates the folder and writes the file with `writeFileAtomic`. It returns `{ before: null, after }`.

Reads use `config.readDir ?? config.issuesDir`, as every other read does, so a tracker on an older format reads its migrated copy.

### References

**Rule:** a tracker uses milestone files once `milestones/` holds at least one `.md` file. Until then, `milestone` is free text, as in 0.2.0. An empty folder, or one with only folders or `.yaml` files, does not turn the checks on. Git does not keep empty folders, so the trigger is the same on every clone.

**Which folder.** The checks read `config.readDir ?? config.issuesDir`, as every read does. Writes on an older format fail in `requireWriter` before any check, so when a write runs, `readDir` is unset and the check, the case-insensitive clash check and the write all use `issuesDir`.

- **Writes.** `NORMALIZE.milestone` keeps the one-line check. When the rule above applies, it also requires a file whose stem equals the value, or it throws `INVALID_INPUT` with the message `milestone <value> does not exist` and the next step `pmkit milestone create <value>`. The check covers `createIssue`, `updateIssue` and `createDeliverable`, since all three normalize `milestone`. Clearing the field with `--milestone none` is never checked. A write that does not set `milestone` does not check it, so an issue whose milestone has no file stays editable.
- **Exact match.** The check compares the value with the list of file stems from `readdirSync`. It does not call `fs.existsSync`, which ignores case on macOS and Windows.
- **`validate`.** The reference check follows the same rule and reads only `*.md` stems from `milestones/`. Today it counts every entry, folders and `.yaml` files included, and starts checking as soon as the folder exists. It also checks the `milestone` of each epic, which it skips today. It parses each milestone file and reports a failure with the new problem code `milestone`, and an id that breaks the rule with the same code. `checked` gains a `milestones` count, and the text head reads `checked: N issues, N epics, N sprints, N milestones, N comments`. The `reference` message stays `milestone <value> does not exist`, so `/pmkit:local:doctor` can group by name.

The existing test `a milestone is checked only when a milestones folder exists` in `scripts/validate.test.mjs` makes a folder named `v2`. It changes to write `milestones/v2.md`, and a new case shows that an empty `milestones/` folder turns no check on.

### Trackers that already use milestone names

The steps below cover a tracker like this repository, with milestone names in its issues and no files.

1. Before the first milestone file exists, nothing changes. Writes accept any milestone and `validate` reports none.
2. `milestone create`, with or without `--dry-run`, adds one warning when issues or epics name milestones that would still have no file after the create. The new milestone counts as having a file. The warning goes through the CLI's `warnings` list, so it prints on stderr and the JSON on stdout stays `{ before, after }`. Text: `warning: 8 milestones named by issues or epics have no file: generic-commands (12), jira (5), ...; run /pmkit:local:doctor`. The number in parentheses counts the issues and epics that name it. How the CLI collects the names, through a tracker helper outside the contract or from `searchIssues` and `listDeliverables`, is the builder's call.
3. `/pmkit:local:doctor`, step 4, groups the `reference` problems for missing milestones by name and proposes one `milestone create <name> --dry-run --json` per name as the default fix. When the name breaks the id rule, it asks the user for an id that follows the rule, proposes `milestone create <new id> --name "<old name>"` first, then `issues update <id> --milestone <new id>` for each issue. When the user names an existing milestone instead, only the updates run, and `--milestone none` stays an option. Step 5 shows every fix in its one preview, as today. Step 5's list of problems the CLI cannot fix gains `milestone`, next to `frontmatter`, `events` and `sprint`.

There is no migration. After the release, running `/pmkit:local:doctor` once `milestone create local-gaps` has written the first file turns this repository's nine names into files.

### Format version

The format stays 2. ADR-0004 says the format goes up only when the files change shape. This change adds a folder and a new kind of file, and no existing file changes shape. pmkit 0.2.0 ignores `milestones/` in every read, and its `validate` already treats the stems of `milestones/<id>.md` as milestone names, so both versions agree on which references exist. `FORMAT_VERSION` and `MIGRATIONS` do not change.

### CLI

Three entries in `COMMANDS`, in a `milestone` group like `epic`:

| Command | Text output | JSON |
|---|---|---|
| `milestone list` | a table with ID, Name and Due, or `no milestones` | the array from `listMilestones` |
| `milestone get <id>` | `milestoneRecord`: id, name, due, then the description | the milestone |
| `milestone create <id> [--name n] [--due YYYY-MM-DD]` | `writeText` with `record: milestoneRecord` | `{ before: null, after }` |

`milestone create` is `write: true`, so it takes `--dry-run` and `--as`. It returns `commit: <id>`, so with `auto_commit` on the commit message is `pmkit: milestone create <id>`. `milestoneRecord` goes in `scripts/lib/format.mjs` next to `epicRecord`. The CLI passes `--due` to the tracker unchanged, and `validDate` checks it there.

### Capability manifest

No `SERVED_BY` entry changes. None of the 20 capabilities is milestones. `releases` is the closest, and PMK-22 serves it with `releases/<version>.md`. PMK-69 names a milestone as what `release-readiness` falls back to when `releases` is absent, which treats the two as different things. `deliverables` is epics. The manifest stays at 10 native, 2 derived and 8 absent, ADR-0001 does not change, and the guard test in `scripts/capabilities.test.mjs` needs no change.

### `/pmkit:spec:import`

`commands/spec/import.md` changes in these steps:

- Step 2 also runs `milestone list --json`, so the tree reuses existing milestones. A milestone counts as existing only when `milestone list` returns it. A name that issues use as free text, with no file, is new, and step 7 creates its file.
- Step 3: each milestone in the tree is existing or new. A new one has an id that follows the id rule, a name, and a due date when the spec gives one. Issues get a milestone only when the tree has milestones.
- Step 4: the table marks new milestones and shows their id, name and due date above the issue rows.
- Step 6 dry-runs `milestone create <id> --name "<name>" [--due <date>] --dry-run --json` for each new milestone. The issue dry runs pass `--milestone` only for milestones that already exist. For a new one they leave it out, as they leave out `--parent`, because once `milestones/` holds a file, a name without a file fails.
- Step 7 creates the epic, when it is new, and then each new milestone with `milestone create ... --json`. When one fails, the command stops and lists what it created and what it did not.
- Step 8 is unchanged. It passes `--milestone <id>` when the issue has one.
- The approval in step 5 covers the milestones, and the Confirmation points say so.
- The Output lists the created milestone ids before the tree.

### Docs

- `docs/superpowers/specs/2026-10-23-pmkit-design.md`: a Milestone row in the Common model table, the `# phase 2` note removed from `milestones/` in the Layout, a "Milestones" subsection under "Local tracker" that points here, a Milestones row in the Contract table, and the three commands in the CLI table.
- `CONTEXT.md`: a **Milestone** term. A named target with an optional due date that issues and epics point to by id. _Avoid_: release (PMK-22), phase, version.
- `README.md`: the three commands in the CLI table.
- `commands/local/doctor.md` and `commands/spec/import.md`: as above.
- `CHANGELOG.md`: no change on this branch, as with PMK-2. The release that ships PMK-3 adds a line such as "Adds milestones: `milestones/<id>.md` and the `milestone list`, `get` and `create` commands", with no `Tracker format:` line and no `Setup:` line.

### Tests

- `scripts/milestones.test.mjs`: the id rule, parsing with and without `name`, a bad `due`, conflict markers, serializing, and the sort order.
- Tracker tests: create, list and get; a dry run writes nothing and makes no folder; `CONFLICT` for an id that differs only in case; unknown keys refused; the reference check off without the folder and on with it, for `createIssue`, `updateIssue` and `createDeliverable`; `--milestone none` unchecked; an update to another field of an issue with an unfiled milestone succeeds.
- CLI tests: the three commands in text and JSON, and the warning from step 2 of "Trackers that already use milestone names". The existing test that checks every `pmkit ...` next step against `COMMANDS` covers the new next steps.
- `scripts/validate.test.mjs`: `.md` stems only, epic references, `milestone` problems, and the `checked.milestones` count.
- `scripts/contract-suite.mjs`: create, list and get, `NOT_FOUND`, and a dry run that writes nothing.

## Decisions

| Decision | Reason |
|---|---|
| Check milestone references only once `milestones/` holds a `.md` file | `validate` already checks once the folder exists. Counting files instead of the folder keeps an empty or stray folder from turning the checks on, and git drops empty folders anyway. Every 0.2.0 tracker keeps working with free-text milestones until it opts in. |
| Keep tracker format 2, with no migration | No existing file changes shape. A bump would lock teammates on 0.2.0 out of reads for an additive change. |
| The file stem is the id, with no `id` key in the frontmatter | Sprint files work the same way, and the id and the file name cannot disagree. |
| `name` defaults to the id, `due` uses the issue's key | The issue asks for a name and an optional due date. `due` matches the issue field. |
| Id rule allows letters, digits, `.`, `_`, `-`, case-sensitive, with a case-insensitive clash check on create | It accepts every name in use here plus `v1.0` and `M1`, keeps file names valid on every OS, and stops two files that macOS and Windows would merge. |
| No event log for milestones | A milestone is one file with one write, as a sprint is. |
| No `milestone update`, close or delete | Not in the acceptance criteria. A later issue can add them. |
| Add `listMilestones`, `getMilestone`, `createMilestone` to the contract | Milestone is a core type, and hosted trackers such as GitHub and GitLab have milestones too. |
| No `SERVED_BY` change | No capability is milestones. `releases` is PMK-22, and PMK-69 treats a milestone as the fallback for an absent `releases`. |
| `milestone create` warns about names in use that have no file | The first create turns the checks on, so the user learns in the same step which names `validate` will report. |
| `/pmkit:local:doctor` proposes `milestone create` for a missing milestone | Creating the file keeps the issues grouped. Clearing the field loses the grouping. |
| `spec:import` creates new milestones after the epic and before the issues, and leaves `--milestone` out of issue dry runs for new ones | Once the tracker has a milestone file, an issue with a new milestone fails until its own file exists. |
| `validate` also checks epic milestones | `createDeliverable` now checks them on write, and the reader should agree with the writer. |
| No CHANGELOG edit on this branch | PMK-2 set the pattern. The release adds the line, with no `Tracker format:` line. |
| Leave this repository's `.issues/` alone on this branch | The pmkit CLI owns it. The nine names become files through `/pmkit:local:doctor` after the release. |

## Acceptance criteria map

| Criterion | Part of the design |
|---|---|
| `milestones/<name>.md` holds a name and an optional due date | Milestone file: `name`, optional `due`, the stem as the id; `scripts/lib/local/milestones.mjs`; `validate` checks the files |
| The CLI lists, gets and creates milestones | CLI: `milestone list`, `milestone get <id>`, `milestone create <id> [--name] [--due]`, on the tracker operations `listMilestones`, `getMilestone`, `createMilestone` |
| `/pmkit:spec:import` creates the milestones of its tree | `/pmkit:spec:import`: `milestone list` in step 2, dry runs in step 6, `milestone create` in step 7 before the issues of step 8 |

## Self-review

- Placeholders: none. The two builder's calls, where `parseFile` lives and how the CLI collects unfiled names, do not change behavior.
- Consistency: the rule "checked once `milestones/` holds a `.md` file" is the same for writes, `validate`, `/pmkit:local:doctor` and `/pmkit:spec:import`. The `reference` message stays `milestone <value> does not exist` everywhere. The format stays 2 in every section. The manifest counts stay 10, 2 and 8, as in the PMK-2 spec.
- Scope: one new module, three tracker operations, three CLI commands, one normalizer change, a `validate` change, two command files and the docs. No update or delete, no filters, no capability change.
- Ambiguity: a milestone "exists" when a `.md` file in `milestones/` has a stem equal to the value exactly. The checks turn on with the first such file, not with the folder.
- Builder check: a fresh reviewer asked about four points. Which trigger turns the checks on (the first `.md` file), which folder the checks read (`issuesDir` for writes), what the doctor proposes for a name that breaks the id rule (a new valid id, created first), and how `spec:import` treats a free-text name with no file (new). The answers are in the sections above. "Name" in the issue's `milestones/<name>.md` is the id here, and the display name is the `name` key.
