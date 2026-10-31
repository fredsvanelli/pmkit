# security-alerts Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add `pmkit alerts scan` and `/pmkit:issues:security-alerts`, which turn security alerts into issues after a full preview.

**Spec:** `docs/superpowers/specs/2026-10-31-pmk-73-security-alerts-design.md`

## Constraints

- Commit trailer `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>` and `(PMK-73)` in each message.
- Small edits in README.md, CHANGELOG.md, skills/pmkit/SKILL.md, scenario counts and COMMANDS.

## Tasks

- [ ] 1. `scripts/lib/alerts.mjs`: `alertKey`, `priorityFor`, `alertCandidate`, `matchAlerts` (tests first in `scripts/alerts.test.mjs`).
- [ ] 2. `alerts scan` in `scripts/pmkit.mjs` with `--severity` (tests first in `scripts/cli-alerts.test.mjs`: candidates, second run, incomplete scanner, absent, unread issue, custom priorities).
- [ ] 3. `commands/issues/security-alerts.md`, plugin test and command table entries.
- [ ] 4. Scenario `scripts/__scenarios__/issues-security-alerts.mjs`, counts, goldens.
- [ ] 5. README, SKILL.md, CHANGELOG.
- [ ] 6. `npm test` in the foreground, tick the criteria, PR.
