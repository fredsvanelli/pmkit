# PMK-66 Roadmap Review Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans (inline execution, chosen by the coordinator) with superpowers:test-driven-development. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A read-only `pmkit roadmap review` and `/pmkit:report:roadmap-review` showing epics and milestones with dates, health and delays, and the epics with no recent status update.

**Architecture:** `scripts/lib/roadmap-review.mjs` holds a pure builder and the text renderer; `runRoadmapReview` in `scripts/pmkit.mjs` does the awaited tracker reads and the failure rules; the command file only shows the CLI result.

**Tech Stack:** Node.js ES modules, `node:test`, pmkit tracker contract, scenario harness. No dependencies.

**Spec:** `docs/superpowers/specs/2026-11-07-pmk-66-roadmap-review-design.md`

## Global Constraints

- Writes nothing: no tracked file in `.issues/`, no user-store file, no git-host call.
- Health is the newest update's health, else `epic.health`, else `null`; never derived from completion.
- A status-update read that failed or is unsupported never yields `no_recent_update`; the epic goes in `updatesNotChecked`.
- Every message the command file repeats is in the JSON (`notes`, `warnings`, `problems`, `incomplete`).
- Every commit carries `PMK-66` and ends with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Tests never run the CLI inside `scripts/__fixtures__/`; copy with `makeRepo`.

## Review Focus

- Linear milestones belong to a project (`milestone.epic`), Local epics name a milestone (`epic.milestone`): both must link. Test in Task 1.
- `searchIssues` with `hasMore: true` (Linear page cap): milestone counts `null`, past-due delay unknown, `incomplete: true`. Test in Task 1.
- Due date equal to today is not late; yesterday is 1 day late (UTC). Test in Task 1.
- Archived issues and canceled issues never make a milestone late. Test in Task 1.
- One epic's progress read throwing `PmkitError` keeps every other row. Test in Task 2.

---

### Task 1: Pure builder and text

**Files:** Create `scripts/lib/roadmap-review.mjs`, `scripts/roadmap-review.test.mjs`.

**Interfaces:**
- Produces `buildRoadmapReview({ today, windowDays, issues, issuesComplete, epics, milestones, progressByEpic, updatesByEpic }) -> report`.
  - `epics`/`milestones`: arrays, or `null` when unreadable.
  - `progressByEpic[id]`: `{ total, done, canceled }`-bearing object or `null` (unreadable).
  - `updatesByEpic[id]`: array newest first, or `null` (unreadable).
  - `report`: `{ today, statusUpdateWindowDays, epics, milestones, noRecentUpdates, updatesNotChecked, lateIssues, incomplete, problems: [] }` as in the spec; the CLI fills `problems` and ORs its own `incomplete`.
- Produces `roadmapReviewText(report) -> string`.

- [ ] **Step 1: Write failing tests** in `scripts/roadmap-review.test.mjs` (today `2026-11-07`, window 14):
  - `late open epic`: target `2026-11-06` → `delayDays 1`, reasons include `late`; target `2026-11-07` → `delayDays 0`, no `late`; no target → `delayDays null`.
  - `terminal epic`: done epic with past target → `delayDays 0`, `reasons []`, not in `noRecentUpdates`.
  - `update freshness`: in_progress epic with update at `2026-10-24` (14 days) → not stale; `2026-10-23` (15) → in `noRecentUpdates`; no updates (`[]`) → in `noRecentUpdates`; `null` updates → in `updatesNotChecked`, not in `noRecentUpdates`.
  - `health`: newest update `at_risk` → `health 'at_risk'`; no update but `epic.health 'on_track'` → `'on_track'`; neither → `null`.
  - `milestone lateness`: milestone due `2026-11-01` with only done, canceled and archived open issues → `delayDays 0`, `issues {open:0, done:1, canceled:1}`; same milestone with an open epic (`epic.milestone`) → `delayDays 6`; Linear-style milestone with `epic: 'P-1'` lists `P-1` in `epics` and sets the epic row's `milestone`.
  - `unfiled milestone`: an issue with `milestone: 'm9'` and no record → row `{ id:'m9', filed:false, due:null, delayDays:0 }` after filed milestones.
  - `incomplete issues`: `issuesComplete false`, past-due milestone, no open epic → `issues null`, `delayDays null`, `incomplete true`.
  - `degraded`: `epics null` → `lateIssues` holds the open issue due `2026-11-01` (`delayDays 6`), not a done one; `epics` array → `lateIssues null`.
  - `text`: contains `roadmap review on 2026-11-07: status updates due every 14 days`, `epics (`, `milestones (`, `epics with no recent status update (`, `not checked:` for `updatesNotChecked`, `unknown` for null health.
  - `empty portfolio`: no epics, no milestones → empty arrays, `incomplete false`, text says `none` per section.
- [ ] **Step 2:** `node --test scripts/roadmap-review.test.mjs` → FAIL (module missing).
- [ ] **Step 3: Implement** using `epicRisks` (pass `updatesByEpic` with `null` replaced by a sentinel so no update reason comes from it: call `epicRisks` per epic with `[]` and drop `no_recent_update` when updates were `null`), `dayNumber`, `table`.
- [ ] **Step 4:** focused test passes.
- [ ] **Step 5: Commit** `feat(report): compute roadmap review (PMK-66)`.

### Task 2: CLI command

**Files:** Modify `scripts/pmkit.mjs` (COMMANDS entry next to `risks`, `runRoadmapReview`); create `scripts/cli-roadmap-review.test.mjs`; modify `README.md` CLI table.

**Interfaces:**
- Consumes Task 1.
- Produces COMMANDS entry `{ name: 'roadmap review', summary: 'epics and milestones with dates, health and delays, and the epics with no recent status update; reads only', flags: [] }` returning `{ data: report, text, warnings, notes }`.

- [ ] **Step 1: Write failing tests** (team fixture via `makeRepo('team')`, `PMKIT_NOW`-style fixed clock as `cli-risks.test.mjs` does):
  - `roadmap review --json` returns `EPC-2M9D` with `reasons` and `noRecentUpdates` as the fixture gives; `git status --porcelain` of `.issues/` (excluding `.cache`) and the user store are unchanged.
  - text mode prints the head line.
  - `roadmap review extra` → usage error.
  - fake Linear (`useLinear` + `fakeLinearFetch` as `cli-risks`/`cli-degraded` do): command succeeds with awaited reads.
  - a tracker whose `deliverableProgress` throws `PmkitError('UPSTREAM')` for one epic: other rows kept, `progress null`, warning `<id>: UPSTREAM ...`, `incomplete true`.
  - `listStatusUpdates` throwing `NOT_SUPPORTED`: every open epic in `updatesNotChecked`, `noRecentUpdates []`.
- [ ] **Step 2:** `node --test scripts/cli-roadmap-review.test.mjs` → FAIL (unknown command).
- [ ] **Step 3: Implement `runRoadmapReview(ctx)`**: reads per spec "Reads and failure rules"; `NOT_SUPPORTED` on `listDeliverables`/`listMilestones` → `null` + `capabilityNotes(tracker, 'deliverables')`; on `listStatusUpdates` → `null` + `capabilityNotes(tracker, 'status_update')`; other `PmkitError` per epic → `null`, problem, warning; issue `problems` → `problemLine` warnings; `incomplete` ORs all of these and `hasMore`.
- [ ] **Step 4:** focused CLI test passes; add the README CLI table row after `risks`.
- [ ] **Step 5: Commit** `feat(report): add pmkit roadmap review (PMK-66)`.

### Task 3: Command file, routing, scenario, docs

**Files:** Create `commands/report/roadmap-review.md`, `scripts/__scenarios__/report-roadmap-review.mjs` (+ snapshot the harness writes). Modify `scripts/plugin.test.mjs` (`report: [..., 'roadmap-review']`), `scripts/scenarios.test.mjs` (49 → 50), `scripts/scenarios-live.mjs` (map entry, run count 61 → 62), `skills/pmkit/SKILL.md` routing row, `README.md` command list, `CHANGELOG.md` top of `## Unreleased`.

- [ ] **Step 1:** Write the scenario (fixture `team`, prompt `/pmkit:report:roadmap-review`, no answers, one step reading `roadmap review`, `expect`: no new events, `EPC-2M9D` row present, `noRecentUpdates` matches). Run `node --test scripts/scenarios.test.mjs` → FAIL (no command file / count).
- [ ] **Step 2:** Write the command file in the style of `commands/team/risk-radar.md`: parameters none; step 1 runs `roadmap review --json`; show head, `incomplete`, tables, not-checked line, `notes` and `warnings` verbatim; offer `/pmkit:report:status <epic>` for epics needing an update; no confirmation points; "If something is missing" covers no epics, `null` sections and CLI errors.
- [ ] **Step 3:** Update counts, lists, SKILL row, README, CHANGELOG. Regenerate the scenario snapshot with the repository's update flag if the harness needs one.
- [ ] **Step 4:** `node --test scripts/scenarios.test.mjs scripts/plugin.test.mjs scripts/roadmap-review.test.mjs scripts/cli-roadmap-review.test.mjs` → pass.
- [ ] **Step 5: Commit** `feat(report): add /pmkit:report:roadmap-review (PMK-66)`.

### Task 4: Verification and delivery

- [ ] `TMPDIR="$(node -p "require('fs').realpathSync(require('os').tmpdir())")" npm test` in the foreground; pass = exit 0, or exit 1 with only the two known `not ok` lines.
- [ ] `git diff --check origin/develop`.
- [ ] Tick criteria 1-3 (`issues update PMK-66 --check n`, dry run then real), commit `.issues/`.
- [ ] `pr open --issue PMK-66` (dry run, then real), summary comment, move to `in_review` (dry run, then real), commit `.issues/` and push.
