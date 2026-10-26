# PMK-3 milestones implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task by task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** The Local tracker stores milestones as `milestones/<id>.md`, the CLI lists, gets and creates them, and `/pmkit:spec:import` creates the milestones of its tree.

**Architecture:** A new module `scripts/lib/local/milestones.mjs` parses and serializes the file, like `sprints.mjs`. The tracker gets three contract operations. Milestone references are checked on write and in `validate` only once `milestones/` holds a `.md` file, so every 0.2.0 tracker keeps working. The format stays 2.

**Tech Stack:** Node ESM, `node:test`, no dependencies (ADR-0003).

**Spec:** `docs/superpowers/specs/2026-10-25-pmk-3-milestones-design.md`

## Global Constraints

- Issue ID `PMK-3` in every commit message, for example `feat: add milestone files and tracker operations (PMK-3)`. Every commit ends with `Co-Authored-By: Claude <model of the implementer> <noreply@anthropic.com>`, naming the model that made the commit (for example `Claude Sonnet 5.5`).
- Code, specs, plans and commits in English. No new dependency. Do not edit `.issues/`, do not push, do not switch branch. No CHANGELOG edit. `FORMAT_VERSION` and `MIGRATIONS` do not change (format stays 2). `SERVED_BY` and the capability counts (10 native, 2 derived, 8 absent) do not change.
- File: `<tracker>/milestones/<id>.md`. Frontmatter `name` (one line, non-empty, defaults to the id) and optional `due` (`YYYY-MM-DD`, checked by `validDate`). Body is the description. No `id` key. Other keys are ignored on read. `milestone create` writes no body and no event log.
- Model: `Milestone { id, name, due?, description }`, typedef in `scripts/lib/model.mjs`.
- Id rule: starts and ends with a letter or digit, holds only letters, digits, `.`, `_`, `-`. Case-sensitive. `local-gaps`, `phase-2-commands`, `v1.0`, `M1` pass. `Q4 2026` and `v1.` fail.
- Tracker operations, added to `TRACKER_OPERATIONS` in `scripts/lib/contract.mjs`: `listMilestones()`, `getMilestone(id)`, `createMilestone({ id, name, due }, actor, { dryRun })`. List order is `due` ascending, then id, with no-`due` last. A file that does not parse is left out of the list. A missing folder gives `[]`. `getMilestone` miss is `NOT_FOUND` with next step `pmkit milestone list`. `createMilestone` returns `{ before: null, after }`.
- `createMilestone` errors: `requireWriter` first; unknown keys refused as `createDeliverable` does; bad id `INVALID_INPUT`; id equal to an existing one ignoring case `CONFLICT` with next step `pmkit milestone list`; bad `due` `INVALID_INPUT`. Dry run writes nothing and makes no folder.
- Reference rule: checks are on once `milestones/` holds at least one `*.md` file (folders and `.yaml` files do not count). Exact, case-sensitive match against `readdirSync` stems, never `fs.existsSync`. Reads use `config.readDir ?? config.issuesDir`; writes use `issuesDir`.
- Write check: `NORMALIZE.milestone` keeps its one-line check, then throws `INVALID_INPUT` `milestone <value> does not exist` with next step `pmkit milestone create <value>`. Covers `createIssue`, `updateIssue`, `createDeliverable`. `--milestone none` is never checked. A write that does not set `milestone` does not check it.
- `validate`: problem code `milestone` for an unparsable milestone file or an id that breaks the rule. Code `reference` message stays `milestone <value> does not exist`, and now covers epics too. `checked` gains `milestones`. Text head: `checked: N issues, N epics, N sprints, N milestones, N comments`.
- CLI: `milestone list` (table `ID`, `Name`, `Due`, or `no milestones`), `milestone get <id>` (`milestoneRecord`: id, name, due, then description), `milestone create <id> [--name n] [--due YYYY-MM-DD]` (`write: true`, `commit: <id>`, so the auto-commit message is `pmkit: milestone create <id>`). JSON for create is `{ before: null, after }`.
- Warning from `milestone create`, also on `--dry-run`, through the CLI `warnings` list (stderr): `warning: 8 milestones named by issues or epics have no file: generic-commands (12), jira (5), ...; run /pmkit:local:doctor`. Counts issues and epics per name. The new milestone counts as filed. No warning when none are unfiled.
- Test commands: `node --test scripts/<file>.test.mjs` while working, `npm test` before each commit.
- Prose follows the Unslop rules: no em dashes, plain words.

## Review Focus

- `milestones/` holds only a folder or a `.yaml` file: checks stay off (Task 2).
- An issue whose milestone has no file gets an update to another field: succeeds (Task 2).
- `milestone create M1` when `m1.md` exists: `CONFLICT` (Task 1).
- A milestone file with conflict markers or a bad `due`: `validate` reports `milestone`, list skips it (Tasks 1 and 2).
- `milestone create` with an id such as `Q4 2026`: `INVALID_INPUT`, nothing written (Task 1).

## File structure

- Create `scripts/lib/local/milestones.mjs` (id rule, parse, serialize, sort) and `scripts/milestones.test.mjs`.
- Modify `scripts/lib/model.mjs`, `scripts/lib/contract.mjs`, `scripts/lib/local/tracker.mjs`, `scripts/lib/validate.mjs`, `scripts/lib/format.mjs`, `scripts/pmkit.mjs`, `scripts/contract-suite.mjs`.
- Tests: `scripts/tracker-milestones.test.mjs` (new), `scripts/validate.test.mjs`, `scripts/cli.test.mjs`, `scripts/contract.test.mjs` (unchanged, it already runs the suite for the sync and promise setups).
- Docs: `commands/spec/import.md`, `commands/local/doctor.md`, `docs/superpowers/specs/2026-10-23-pmkit-design.md`, `CONTEXT.md`, `README.md`.

---

### Task 1: Milestone file module and tracker operations

Complexity: hard
Covers: `milestones/<name>.md` holds a name and an optional due date

**Files:**
- Create: `scripts/lib/local/milestones.mjs`, `scripts/milestones.test.mjs`, `scripts/tracker-milestones.test.mjs`
- Modify: `scripts/lib/model.mjs`, `scripts/lib/contract.mjs`, `scripts/lib/local/tracker.mjs`, `scripts/contract-suite.mjs`

**Interfaces:**
- Produces in `milestones.mjs`: `validMilestoneId(id: string): boolean`, `parseMilestone(text: string, id: string): Milestone`, `serializeMilestone(m: { name: string, due?: string }): string`, `sortMilestones(list: Milestone[]): Milestone[]`. Parse errors follow `parseFile` in `epics.mjs`: conflict markers throw `CONFLICT`, missing or unreadable frontmatter, bad `due` or a `name` with a line break throw `INVALID_INPUT`, both with next step `/pmkit:local:doctor`. Share `parseFile` by exporting it from `epics.mjs` or moving it; either is fine.
- Produces on the tracker: `listMilestones`, `getMilestone`, `createMilestone` as in Global Constraints. `NORMALIZE.milestone` is unchanged in this task.

- [ ] **Step 1: Write failing unit tests** in `scripts/milestones.test.mjs`: `validMilestoneId` accepts `local-gaps`, `phase-2-commands`, `v1.0`, `M1` and rejects `Q4 2026`, `v1.`, `-a`, `` (empty); `parseMilestone` reads `name`, `due` and a body as `description`; without `name` it returns the id as the name; a bad `due` (`2026-13-40`) throws `INVALID_INPUT`; text with `<<<<<<<` throws `CONFLICT`; extra frontmatter keys are ignored; `serializeMilestone({ name: 'Local tracker gaps', due: '2026-11-30' })` equals `---\nname: Local tracker gaps\ndue: 2026-11-30\n---\n` and omits `due` when unset; `sortMilestones` orders by `due`, then id, no-`due` last.
- [ ] **Step 2: Write failing tracker tests** in `scripts/tracker-milestones.test.mjs` (use `makeRepo` and the tracker setup that `tracker-issues.test.mjs` uses): create then list and get; dry run leaves `hashTree` unchanged and makes no `milestones/` folder; `createMilestone({ id: 'M1' })` after `m1` exists is `CONFLICT`; bad id `Q4 2026` is `INVALID_INPUT` and writes nothing; unknown key `{ id: 'a', color: 'red' }` is refused; `name` defaults to the id and is trimmed; a hand-written bad file is missing from `listMilestones`; a missing folder lists `[]`; `getMilestone('nope')` is `NOT_FOUND` with next step `pmkit milestone list`; a non-writer actor is refused first.
- [ ] **Step 3: Add contract-suite cases** in `scripts/contract-suite.mjs` using the `it(...)` helper: `listMilestones` is empty at start; `createMilestone` then `listMilestones` and `getMilestone` agree; `getMilestone` of an unknown id rejects `NOT_FOUND`; a dry run returns `after` and leaves `listMilestones` empty. Use `await` on every call. `scripts/contract.test.mjs` runs them for the sync and the promise setups, so no change there.
- [ ] **Step 4: Run** `node --test scripts/milestones.test.mjs scripts/tracker-milestones.test.mjs scripts/contract.test.mjs`. Expected: FAIL (module and operations missing).
- [ ] **Step 5: Implement** `scripts/lib/local/milestones.mjs`, the typedef in `model.mjs`, the three names in `TRACKER_OPERATIONS`, and the three operations in `tracker.mjs` (reads through `config.readDir ?? config.issuesDir`; create uses `readBack` and `writeFileAtomic` like `createDeliverable`).
- [ ] **Step 6: Run** `npm test`. Expected: PASS.
- [ ] **Step 7: Commit** `feat: add milestone files and tracker operations (PMK-3)` with the trailer from Global Constraints.

### Task 2: Milestone reference checks in writes and `validate`

Complexity: hard
Covers: `milestones/<name>.md` holds a name and an optional due date; the CLI lists, gets and creates milestones (the checks keep created milestones consistent)

**Files:**
- Modify: `scripts/lib/local/tracker.mjs` (`NORMALIZE.milestone`), `scripts/lib/validate.mjs` (lines near 213-224, `noneChecked`, the sprint loop at ~150 for the new count), `scripts/pmkit.mjs` (text head at ~604)
- Test: `scripts/tracker-milestones.test.mjs`, `scripts/validate.test.mjs`, `scripts/cli.test.mjs`

**Interfaces:**
- Consumes: `parseMilestone`, `validMilestoneId` from Task 1.
- Produces: `hasMilestoneFiles(dir: string): boolean` and `milestoneStems(dir: string): Set<string>` in `milestones.mjs`, used by the normalizer and by `validate`. Only `*.md` entries count.

- [ ] **Step 1: Write failing tracker tests**: with no `milestones/` folder, `createIssue({ milestone: 'free text' })` succeeds; with an empty folder, a folder `v2/` or `v2.yaml`, it still succeeds; after `createMilestone({ id: 'v2' })`, `createIssue`, `updateIssue` and `createDeliverable` with `milestone: 'v3'` throw `INVALID_INPUT` `milestone v3 does not exist` with next step `pmkit milestone create v3`; `milestone: 'v2'` succeeds; `V2` fails (case-sensitive); `milestone: 'none'` through `updateIssue` clears without a check; updating `priority` on an issue whose milestone has no file succeeds.
- [ ] **Step 2: Write failing validate tests** in `scripts/validate.test.mjs`: change the existing `a milestone is checked only when a milestones folder exists` to write `milestones/v2.md`; add an empty `milestones/` folder case with no check; a `.yaml` stem is not a milestone; an epic whose `milestone` has no file gets a `reference` problem; a milestone file with a bad `due` and one named `Q4 2026.md` each give code `milestone`; `checked.milestones` counts the `.md` files.
- [ ] **Step 3: Write failing CLI test** in `scripts/cli.test.mjs`: `validate` text head reads `checked: N issues, N epics, N sprints, N milestones, N comments`.
- [ ] **Step 4: Run** `node --test scripts/tracker-milestones.test.mjs scripts/validate.test.mjs scripts/cli.test.mjs`. Expected: FAIL.
- [ ] **Step 5: Implement** the helpers, the normalizer check (reads `issuesDir`; value `none` never reaches it, confirm how `updateIssue` clears the field) and the `validate` changes, including `noneChecked` gaining `milestones: 0`.
- [ ] **Step 6: Run** `npm test`. Expected: PASS. Fix any existing test that builds a `milestones/` folder without a `.md` file.
- [ ] **Step 7: Commit** `feat: check milestone references once milestone files exist (PMK-3)` with the trailer.

### Task 3: `milestone` CLI commands and the unfiled-names warning

Complexity: standard
Covers: The CLI lists, gets and creates milestones

**Files:**
- Modify: `scripts/pmkit.mjs` (`COMMANDS`, next to `epic`), `scripts/lib/format.mjs`, `scripts/lib/local/tracker.mjs` (helper for unfiled names)
- Test: `scripts/cli.test.mjs`

**Interfaces:**
- Consumes: `listMilestones`, `getMilestone`, `createMilestone` (Task 1).
- Produces: `milestoneRecord(m: Milestone): string` in `format.mjs`, built with `fields` like `epicRecord`. A tracker helper `unfiledMilestones(): Array<{ name: string, count: number }>` outside the contract, or the same data from `searchIssues` and `listDeliverables`; the builder chooses.

- [ ] **Step 1: Write failing CLI tests**: `milestone list` prints `no milestones` on an empty tracker and the table after a create; `--json` returns the array; `milestone get <id>` prints id, name, due and description, and a miss exits with the `NOT_FOUND` text; `milestone create local-gaps --name "Local tracker gaps" --due 2026-11-30 --json` returns `{ before: null, after }`; `--dry-run` writes nothing; a bad id shows `INVALID_INPUT`; with auto commit on, the commit message is `pmkit: milestone create local-gaps`; on a tracker with issues naming `jira` (2 issues) and `generic-commands` (1 epic and 1 issue), `milestone create x` writes to stderr `warning: 2 milestones named by issues or epics have no file: generic-commands (2), jira (2); run /pmkit:local:doctor` with stdout JSON still `{ before, after }`; no warning when every name has a file; the existing test that checks every `pmkit ...` next step against `COMMANDS` still passes.
- [ ] **Step 2: Run** `node --test scripts/cli.test.mjs`. Expected: FAIL (unknown command).
- [ ] **Step 3: Implement** the three `COMMANDS` entries, `milestoneRecord`, and the warning (sorted by name, counts of issues plus epics; the created id excluded from the unfiled set).
- [ ] **Step 4: Run** `npm test`. Expected: PASS.
- [ ] **Step 5: Commit** `feat: add milestone list, get and create commands (PMK-3)` with the trailer.

### Task 4: Docs and command files

Complexity: mechanical
Covers: `/pmkit:spec:import` creates the milestones of its tree; the CLI lists, gets and creates milestones (docs)

**Files:**
- Modify: `commands/spec/import.md`, `commands/local/doctor.md`, `docs/superpowers/specs/2026-10-23-pmkit-design.md`, `CONTEXT.md`, `README.md`

- [ ] **Step 1: `commands/spec/import.md`**, per the spec section "/pmkit:spec:import": step 2 runs `milestone list --json`; step 3 marks each milestone existing or new (new has a valid id, a name, an optional due); step 4 table lists new milestones above the issues; step 6 dry-runs `milestone create <id> --name "<name>" [--due <date>] --dry-run --json` and leaves `--milestone` out of issue dry runs for new milestones; step 7 creates the epic, then each new milestone with `milestone create ... --json`, and stops listing created and not created on failure; step 5 approval and the Confirmation points cover milestones; Output lists created milestone ids before the tree.
- [ ] **Step 2: `commands/local/doctor.md`**, per "Trackers that already use milestone names" item 3: step 4 groups missing-milestone `reference` problems by name and proposes `milestone create <name> --dry-run --json` per name; for a name that breaks the id rule it asks for a valid id, proposes `milestone create <new id> --name "<old name>"` first, then `issues update <id> --milestone <new id>` per issue, with `--milestone none` as an option; step 5 adds `milestone` to the problems the CLI cannot fix.
- [ ] **Step 3: Design spec**: Milestone row in the Common model table, remove `# phase 2` from `milestones/` in the Layout, a "Milestones" subsection under "Local tracker" pointing to the PMK-3 spec, a Milestones row in the Contract table, the three commands in the CLI table. `CONTEXT.md`: term **Milestone**, "A named target with an optional due date that issues and epics point to by id." with `_Avoid_: release (PMK-22), phase, version`. `README.md`: the three commands in the CLI table.
- [ ] **Step 4: Run** `npm test` (the plugin test may lint command files). Expected: PASS.
- [ ] **Step 5: Commit** `docs: document milestones and update import and doctor (PMK-3)` with the trailer.
