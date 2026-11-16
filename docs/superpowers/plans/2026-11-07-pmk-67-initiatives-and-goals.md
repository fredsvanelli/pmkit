# initiatives-and-goals Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add `pmkit goals overview` and `/pmkit:report:initiatives-and-goals`.

**Architecture:** one pure rollup in `scripts/lib/initiatives.mjs`, one read command in `scripts/pmkit.mjs` that picks goals or top-level issues, one command file.

**Tech Stack:** Node, `node:test`.

**Spec:** `docs/superpowers/specs/2026-11-07-pmk-67-initiatives-and-goals-design.md`

## Constraints

- Commit trailer `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>` and `(PMK-67)` in each message.
- Small edits in README.md, CHANGELOG.md, skills/pmkit/SKILL.md, scenario counts and COMMANDS.

## Review Focus

- A goal with no epics, or epics with no issues: progress is unknown, not 0%.
- A cut issue read (`hasMore`) or an issue file with conflict markers: `complete: false`, warning.
- Linear: `listGoals` answers `NOT_SUPPORTED`, so the fallback runs and says why.
- A parent cycle among issues does not loop.
- Issues without an estimate do not add 0 points silently: points are counted only for estimated issues.

## Tasks

- [ ] 1. `scripts/lib/initiatives.mjs`: `topLevelRollup(issues)` (tests first in `scripts/initiatives.test.mjs`: epic-parented issues, nested descendants, canceled, no estimate, cycle, archived).
- [ ] 2. `goals overview` in `scripts/pmkit.mjs` (tests first in `scripts/cli-goals-overview.test.mjs`: goals with epics, no goals, goal file that does not parse, cut read, Linear NOT_SUPPORTED fallback). Add READS and golden entries.
- [ ] 3. `commands/report/initiatives-and-goals.md`, plugin test and command table entries.
- [ ] 4. Scenario `scripts/__scenarios__/report-initiatives-and-goals.mjs`, counts.
- [ ] 5. README, SKILL.md, CHANGELOG.
- [ ] 6. `npm test` in the foreground, tick the criteria, PR.
