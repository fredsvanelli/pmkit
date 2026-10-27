# PMK-19 flow-metrics command Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add `/pmkit:team:flow-metrics`, a read-only command that shows cycle time, lead time, throughput, aging and bug rate for a period next to the previous period, and says the numbers come from the event history.

**Architecture:** One command file that runs the four PMK-18 `metrics` commands twice (period and previous period) and compares the numbers. The command computes the previous period's dates itself. No CLI, tracker or config change (ADR-0002 keeps computation in the CLI). A scenario on the `team` fixture proves the calls, and a static test pins the procedure that the scenario matcher cannot see.

**Tech Stack:** Node 18+ ES modules, no dependencies (ADR 0003), `node:test`. Run tests with `npm test`.

**Spec:** `docs/superpowers/specs/2026-10-27-pmk-19-flow-metrics-command-design.md` (the user's answers are recorded under "Decisions on the open questions"). The spec is the authority.

## Global Constraints

- Everything written to the repo is in English and follows the unslop rules (no em dashes, no colon connectors, active voice, plain words).
- Do not edit anything under `.issues/` by hand. Do not edit `scripts/pmkit.mjs`, `scripts/lib/`, `scripts/scenario-helpers.mjs`, `scripts/__fixtures__/`, `scripts/__goldens__/`, `CHANGELOG.md` or `skills/pmkit/references/conventions.md`.
- Never run the CLI inside `scripts/__fixtures__/`. It writes an index cache there and breaks tests. Use a copy outside the repo and delete it.
- Group `team`, file `commands/team/flow-metrics.md`, shown as `/pmkit:team:flow-metrics`. `argument-hint: "[since <date>] [until <date>]"`, `disable-model-invocation: true`, description `Show cycle time, lead time, throughput, aging and bug rate for a period, with the trend against the previous period`.
- Defaults (decision 1): `until` is today. `since` is the start of a window of `defaults.sprint_length_days` days (14 when missing in `.issues/config.yaml`) that ends on `until`.
- Previous period (decision 2): the command does the arithmetic. With `N` = days from `since` to `until` plus 1, the previous period is `since - N days` to `since - 1 day`. A `since` after `until` makes the command ask for corrected dates without calling the CLI.
- Trend (decision 3): the change is the plain difference with a sign (`+1.5 days`, `-2 issues`, `+10 points`) and the word `up`, `down` or `same`. No verdict ("better", "worse"). The change is `n/a` when either period has a count of 0. No division beyond bug rate.
- Bug rate is `byType.bug` (0 when the key is missing) over `count` of `metrics throughput`, shown as `50% (1 of 2)`. `n/a` when `count` is 0.
- A small-sample line appears when either period has fewer than 5 issues behind a metric.
- Every CLI call ends with `--json`. The command has no write call, no `--dry-run` call and no confirmation point.
- Task 1 is the only task that adds `commands/team/flow-metrics.md`. Before it exists, name it without the `${CLAUDE_PLUGIN_ROOT}/` prefix in any doc. A test checks that every plugin-root path in the docs, this plan included, exists, so this plan writes the new file without the prefix. The prefixed paths it does write (`scripts/pmkit.mjs`, the conventions file) exist today.
- Fixture facts (`team` fixture, clock `PMKIT_NOW=2026-10-23T12:00:00Z`, from a run of the PMK-18 commands on a copy):

| Period | since | until | cycle-time | throughput | aging at `until` |
| --- | --- | --- | --- | --- | --- |
| Period | 2026-10-06 | 2026-10-08 | count 2, median 7.8, p85 8.15 | count 2, byType bug 1, feature 1 | count 0, median null |
| Previous | 2026-10-03 | 2026-10-05 | count 1, median 4.3 | count 1, byType bug 1 | count 2, median 6.1, p85 6.45 |

  Lead time medians are 11.3 days (period) and 8.3 days (previous), from the spec. Check them in the scenario run and use what the CLI prints if the spec differs.

## Review Focus

- A `since` after `until`. The command must ask for corrected dates and make no CLI call. Pinned by a static test on the file text in Task 2.
- A period that crosses a month end. The arithmetic is in prose, so Task 1 gives the worked example `2026-11-02` to `2026-11-04` (N = 3, previous `2026-10-30` to `2026-11-01`) in the file, and a static test in Task 2 checks the example is present.
- A period with no issue done, as the `team` fixture shows for aging at `2026-10-08` (`count` 0, `median` null). The table shows `none` and the change `n/a`. Pinned by the scenario `expect` in Task 1 and the "If something is missing" text test in Task 2.
- A one-issue sample. The count appears next to every median and the small-sample line fires. Pinned by a text test in Task 2.
- A tracker whose `native_metrics` is `absent`. The command stops and gives `enableHint`. Pinned by a text test in Task 2.

---

### Task 1: the command, its scenario and its registrations

Acceptance criteria 1, 2 and 3 land here. The command file, the scenario, the snapshot and every registration go in one commit, because the suite requires them together (a scenario per command file, the README and skill-table entries, the file count).

**Files:**
- Create: `commands/team/flow-metrics.md`
- Create: `scripts/__scenarios__/team-flow-metrics.mjs`
- Create (by regeneration): `scripts/__scenarios__/team-flow-metrics.after.txt`
- Modify: `scripts/plugin.test.mjs:93` (`COMMANDS.team`)
- Modify: `scripts/scenarios.test.mjs:64-65` (file count)
- Modify: `README.md` (command list, after the `/pmkit:team:standup` line, alphabetical order puts `flow-metrics` before `standup`)
- Modify: `skills/pmkit/SKILL.md` (routing table, same position)
- Modify: `scripts/scenarios-live.mjs` (`LIVE_EXPECT_STOPS` and the "lists 15 of 26 entries" comment)

**Interfaces:**
- Consumes: CLI commands `capabilities`, `metrics cycle-time`, `metrics lead-time`, `metrics throughput` (flags `since`, `until`) and `metrics aging` (flag `until`). Scenario module shape as in `scripts/__scenarios__/team-standup.mjs`.
- Produces: scenario command id `team/flow-metrics`. Step ids in the command file are `1` to `6`. Task 2 reads steps `3` and `4`.

- [ ] **Step 1: Write the failing tests**
  - In `scripts/plugin.test.mjs` set `team: ['flow-metrics', 'standup']`.
  - In `scripts/scenarios.test.mjs` change the test title to `there are 25 command files` and the assertion to `assert.equal(FILES.length, 25, ...)`.
  - Create `scripts/__scenarios__/team-flow-metrics.mjs` with `command: 'team/flow-metrics'`, `fixture: 'team'`, no `github`, `prompt: '/pmkit:team:flow-metrics since 2026-10-06 until 2026-10-08'`, `answers: []`, `skip: {}`, `notHit: {}`. Header comment says the period is 2026-10-06 to 2026-10-08, the previous period 2026-10-03 to 2026-10-05, and the command only reads.
  - Its `steps`, with `save` names in parentheses:
    - `{ step: '1', read: ['capabilities'], save: 'caps' }`
    - step `3`: reads of `['metrics', 'cycle-time', '--since', '2026-10-06', '--until', '2026-10-08']` (`cycle`), `lead-time` with the same flags (`lead`), `throughput` with the same flags (`through`), and `['metrics', 'aging', '--until', '2026-10-08']` (`aging`).
    - step `4`: the same four reads with `--since 2026-10-03 --until 2026-10-05`, saved as `prevCycle`, `prevLead`, `prevThrough`, `prevAging`.
  - Its `expect(repo, saved)` asserts, with `node:assert/strict`:
    - `saved.caps.capabilities.find((c) => c.id === 'native_metrics')` has `path: 'derived'` and `detail.source: 'events'`.
    - `saved.through.count === 2`, `saved.through.byType.bug === 1`, `saved.prevThrough.count === 1`, `saved.prevThrough.byType.bug === 1`.
    - `saved.cycle.median === 7.8`, `saved.prevCycle.median === 4.3`, and the two lead-time medians as the CLI prints them (11.3 and 8.3).
    - `saved.aging.count === 0` and `saved.aging.median === null`, `saved.prevAging.count === 2` and `saved.prevAging.median === 6.1`.
    - `repo.newEvents(id)` is `[]` for every issue id in `saved.cycle.issues`, `saved.prevCycle.issues` and `saved.prevAging.issues` (read-only, criterion 3).
- [ ] **Step 2: Run the tests to verify they fail**

  Run: `node --test scripts/plugin.test.mjs scripts/scenarios.test.mjs`
  Expected: FAIL on the `team` command list (`flow-metrics` missing on disk), on the file count (24 against 25) and on rule 1 (scenario names no command file).
- [ ] **Step 3: Write `commands/team/flow-metrics.md`**

  Copy the layout of `commands/team/standup.md`: frontmatter, `# Flow metrics`, `Arguments: \`$ARGUMENTS\``, then `## Parameters`, `## Steps`, `## Confirmation points`, `## Output`, `## If something is missing`. The first line of Steps is the conventions line. Content to fix:
  - Parameters: `since <date>` and `until <date>` as `YYYY-MM-DD`, with the defaults of the Global Constraints.
  - Step 1: run `node "${CLAUDE_PLUGIN_ROOT}/scripts/pmkit.mjs" capabilities --json`. For `native_metrics` with path `derived` and `detail.source` `events`, go on. For path `absent`, stop and say the tracker has no metrics, with `enableHint`.
  - Step 2: resolve `S`, `U`, `N` and the previous period, with the table of the spec and the worked example `2026-11-02` to `2026-11-04` giving `2026-10-30` to `2026-11-01`. Read `defaults.sprint_length_days` from `.issues/config.yaml` for the default `since`. A `since` after `U`, or a date that does not exist, makes the command ask for corrected dates, with no CLI call.
  - Step 3: four separate sentences, each with one call: `metrics cycle-time --since <S> --until <U> --json`, `metrics lead-time ...`, `metrics throughput ...`, `metrics aging --until <U> --json`, each written as `node "${CLAUDE_PLUGIN_ROOT}/scripts/pmkit.mjs" ...`.
  - Step 4: the same four calls with `<previous S>` and `<previous U>`, and a sentence saying `metrics aging` gives the work in progress at the end of the previous period.
  - Step 5: bug rate as in the Global Constraints.
  - Step 6: the trend and the small-sample rule as in the Global Constraints.
  - Confirmation points: one bullet saying the command only reads, so it has none.
  - Output: the table shape of the spec (columns Metric, Period, Previous, Change; rows Cycle time, Lead time, Throughput, Aging, Bug rate), then the source line "Computed from the event history of each issue (`events.jsonl`), not read from a tracker report.", the line saying cycle time and lead time count the issues done in the period while aging counts the issues in work at its end, the line "DORA metrics are not included: the tracker holds no deployment data.", and the small-sample line. Lead with the table, write dates in full, show no issue IDs, give no verdict.
  - If something is missing: the six cases of the spec ("No events in the period", "No work in progress at one end date", "A new tracker with no history before the previous period", "`since` after `until`", "`native_metrics` absent", a CLI error under the rules for reading errors in the conventions).
- [ ] **Step 4: Register the command**
  - `README.md`: add `- \`/pmkit:team:flow-metrics\`: Show cycle time, lead time, throughput, aging and bug rate for a period, with the trend against the previous period.` before the standup line.
  - `skills/pmkit/SKILL.md`: add the row `| show cycle time, lead time, throughput, aging and bug rate for a period, with the trend against the previous period | \`/pmkit:team:flow-metrics\` | <plugin-root prefix>/commands/team/flow-metrics.md |` before the standup row, with the prefix written as in the neighbouring rows. The file exists after Step 3, so the path test passes.
  - `scripts/scenarios-live.mjs`: add `'team-flow-metrics': 'the metrics results the agent shows'` to `LIVE_EXPECT_STOPS` and change the count in the comment from "15 of 26" to "16 of 27". The `expect` reads `saved`, so the live suite needs the entry.
- [ ] **Step 5: Generate the snapshot and read it**

  Run: `UPDATE_GOLDENS=1 node --test scripts/scenarios.test.mjs`
  Then read `git diff scripts/__scenarios__/` and `scripts/__scenarios__/team-flow-metrics.after.txt`. Expected: nine `read` rows (one `capabilities`, eight `metrics`), every `exit 0`, `(no file changed)`, and no other snapshot changed. If a number in `expect` is wrong, fix the `expect` from the CLI output, not the snapshot.
- [ ] **Step 6: Run the whole suite**

  Run: `npm test`
  Expected: PASS, with no rule 1 to 12 problem for `team/flow-metrics`.
- [ ] **Step 7: Commit**

```bash
git add commands/team/flow-metrics.md scripts/__scenarios__/team-flow-metrics.mjs scripts/__scenarios__/team-flow-metrics.after.txt scripts/plugin.test.mjs scripts/scenarios.test.mjs scripts/scenarios-live.mjs README.md skills/pmkit/SKILL.md
git commit -m "feat(team): add the flow-metrics command (PMK-19)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: static tests for the procedure

The scenario matcher compares flag names only, so it cannot tell the period call from the previous call or see the wording of the output. These tests read the command file, like the PMK-122 tests of `plan.md`.

**Files:**
- Modify: `scripts/scenarios.test.mjs` (new tests inside `describe('scenarios')`, after the `cycle/plan` tests)

**Interfaces:**
- Consumes: `FILES` (parsed command files, `.parsed.calls` with `step`, `command`, `flags`, `text`, `dryRun`), `COMMANDS_DIR`, `fs`, `path`, `assert`, and `isWrite` from the top of the file.
- Produces: nothing for later tasks.

- [ ] **Step 1: Write the tests**
  - `team/flow-metrics reads the four metrics for the period in step 3 and for the previous period in step 4`: for steps `3` and `4`, the non-dry-run calls are exactly `metrics cycle-time`, `metrics lead-time`, `metrics throughput` and `metrics aging`. In both steps `metrics aging` has `until` and not `since`, and the other three have both. The texts of step 3 and step 4 for `metrics cycle-time` differ.
  - `team/flow-metrics has no write call and no confirmation point`: `parsed.calls.some(isWrite)` is false, and `parsed.points` is empty.
  - `team/flow-metrics step 2 rejects a since after until and shows the month-end example`: the file text of step 2 matches `/after `until`/` or equivalent wording from Task 1, and contains `2026-10-30` and `2026-11-01`. Calls of step 2 are none.
  - `team/flow-metrics says the numbers come from the event history, names the DORA gap and the small sample`: the text matches `/event history/`, `/events\.jsonl/`, `/DORA metrics are not included/` and `/fewer than 5/`.
  - `team/flow-metrics stops when the tracker has no metrics`: step 1 text matches `/absent/` and `/enableHint/`.
  - `team/flow-metrics gives no verdict`: the Output section does not match `/\b(better|worse)\b/` outside a sentence that says the command gives no such verdict. Write the file so the Output section has no occurrence of either word, and assert `doesNotMatch`.
- [ ] **Step 2: Run the tests**

  Run: `node --test scripts/scenarios.test.mjs`
  Expected: PASS. If one fails, the command file from Task 1 lacks that wording, so fix the command file and not the test.
- [ ] **Step 3: Prove the tests bite**

  For the first test, delete the step 4 `metrics lead-time` sentence from `commands/team/flow-metrics.md`, run `node --test scripts/scenarios.test.mjs`, and confirm the new test and rule 6 fail. Restore the file with `git checkout commands/team/flow-metrics.md`.
- [ ] **Step 4: Run the whole suite**

  Run: `npm test`
  Expected: PASS.
- [ ] **Step 5: Commit**

```bash
git add scripts/scenarios.test.mjs
git commit -m "test(team): pin the flow-metrics procedure (PMK-19)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: final check (no commit)

- [ ] **Step 1:** Run `npm test` and confirm PASS.
- [ ] **Step 2:** Run `git status --short` and confirm a clean tree. Run `git diff main --stat` and confirm the changed files are only those named in Tasks 1 and 2, plus this plan and the spec.
- [ ] **Step 3:** Confirm no file under `scripts/__fixtures__/` has an index cache (`git status --short scripts/__fixtures__` prints nothing).
- [ ] **Step 4:** Walk the table below and confirm each row against the command file text and the scenario snapshot.

## Acceptance criteria map

| Criterion | Covered by |
| --- | --- |
| Shows cycle time, lead time, throughput, aging and bug rate for a period, with the trend | Task 1 steps 3 to 6 and the Output table of the command file. The scenario reads all eight metric calls and asserts the numbers. Task 2 pins the eight calls by step. |
| Says the numbers were computed from history | The source line in Output, taken from the manifest in step 1. The scenario asserts `native_metrics` is `derived` from `events`. Task 2 pins the wording. |
| Writes nothing | No write call and no confirmation point (Task 2 test). The scenario asserts `repo.newEvents` is empty, and rule 8 checks that no read changes a file. |

## Self-review

- Spec coverage. Parameters and defaults (Task 1 step 3, decisions 1 and 2), the two periods (step 2 of the file), steps, trend, output, scenario, edge cases and the three open-question decisions all map to Task 1 or Task 2. The spec's "Tests to write in the plan" list is covered by Task 1 (`COMMANDS.team`, scenario, snapshot) and Task 2 (the procedure test).
- Registration. README, skill table, file count, `COMMANDS.team` and the live-suite map are all in Task 1 so the suite stays green at each commit. `commands/help.md` reads the files and needs no change. No `CHANGELOG.md` entry, as the spec says.
- Merge note. `main` gained command files after this branch was cut (PMK-20, PMK-21, soon PMK-24 and PMK-25). The file count in `scripts/scenarios.test.mjs`, the `COMMANDS` lists in `scripts/plugin.test.mjs` and the live-suite comment count will conflict at merge time. The orchestrator rebases and adds up the counts.
