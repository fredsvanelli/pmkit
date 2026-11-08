# PMK-55 inbox-digest Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add `/pmkit:issues:inbox-digest`, a read-only command file that summarizes mentions, new assignments and reviews waiting for the user.

**Architecture:** A markdown command calling `capabilities`, `inbox list`, `issues list` and `pr blockers`. No CLI change.

**Spec:** `docs/superpowers/specs/2026-11-08-pmk-55-inbox-digest-design.md`

## Global Constraints

- Five sections that `scripts/plugin.test.mjs` checks; every CLI call and flag must exist (scenario parser checks it).
- Keep edits to `README.md`, `CHANGELOG.md`, `skills/pmkit/SKILL.md` and the counts small: PMK-70 edits them in parallel.

## Review Focus

- `complete: false`, `problems`, a cut read and a failed `pr blockers` show as incomplete or "not verified", never "nothing new".
- The command never runs `inbox mark-read` or any write.
- Linear (`user_inbox` absent): derived list, mentions "not verified".
- Scenario, golden and command steps agree.

### Task 1: Command, scenario and docs

**Files:**
- Create: `commands/issues/inbox-digest.md`, `scripts/__scenarios__/issues-inbox-digest.mjs` and its golden
- Modify: `scripts/plugin.test.mjs` (`COMMANDS.issues`), `scripts/scenarios.test.mjs` (file count), `scripts/scenarios-live.mjs`, `README.md`, `skills/pmkit/SKILL.md`, `CHANGELOG.md`

- [ ] Add `inbox-digest` to `COMMANDS.issues`, bump the count, see the tests fail.
- [ ] Write the command file and the scenario; `UPDATE_GOLDENS=1 node --test scripts/scenarios.test.mjs`.
- [ ] Add the README, SKILL and CHANGELOG lines.
- [ ] Run `npm test` in the foreground; pass by the machine baseline rule.
- [ ] Commit with `(PMK-55)`.
