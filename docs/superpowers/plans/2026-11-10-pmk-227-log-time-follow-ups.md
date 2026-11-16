# PMK-227 Improve log-time Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Cover the Linear comment path of `/pmkit:issues:log-time` with a scenario, and record why `progress` step 8 stays as it is.

**Architecture:** The scenario module `scripts/__scenarios__/issues-log-time.mjs` exports two entries: the existing Local entry and a new Linear entry that runs against the fake Linear API (`scripts/fake-linear-api.mjs`). The command text `commands/issues/log-time.md` is not changed, because its step 6 already describes the path.

**Tech Stack:** Node.js test runner (`node --test`), the scenario helper `scripts/scenario-helpers.mjs`, the fake Linear API.

**Spec:** `docs/superpowers/specs/2026-11-10-pmk-227-log-time-follow-ups-design.md`

## Global Constraints

- Commit trailer is exactly `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Every commit message carries `(PMK-227)`.
- No real Linear API call: the Linear entry uses the fake routes only.
- Snapshots are regenerated with `UPDATE_GOLDENS=1`, never edited by hand.

## Review Focus

- Linear entry reads a time with no unit (`1.5`): the CLI must refuse it, not log it. Covered by the existing `parse-time` rules in `scripts/cli-linear.test.mjs`; no new test here, the scenario does not exercise it.
- Local entry with a time over 24 hours: the `note` must appear. Already covered by the `issues log-time` CLI tests.

## Task 1: Linear comment-path scenario

**Files:**
- Modify: `scripts/__scenarios__/issues-log-time.mjs` (export becomes an array `[local, linear]`)
- Create: `scripts/__scenarios__/_inputs/log-time-comment.md`
- Create: `scripts/__scenarios__/issues-log-time.0.after.txt`, `issues-log-time.1.after.txt`
- Delete: `scripts/__scenarios__/issues-log-time.after.txt`

**Interfaces:**
- Consumes: `fakeLinearIssues` from `scripts/fake-linear-api.mjs`.
- Produces: scenario entries named `issues-log-time.0` (Local) and `issues-log-time.1` (Linear).

- [ ] **Step 1: Confirm the Linear entry is in place**

Run: `grep -n "command: 'issues/log-time'" scripts/__scenarios__/issues-log-time.mjs`
Expected: two matches, one for the Local entry and one for the Linear entry.

- [ ] **Step 2: Run the scenario tests**

Run: `node --test scripts/scenarios.test.mjs 2>&1 | grep -E "^# (pass|fail)"`
Expected: `# fail 0`

- [ ] **Step 3: Check the Linear snapshot**

Run: `cat scripts/__scenarios__/issues-log-time.1.after.txt`
Expected: the `capabilities`, `issues get ACME-2`, `issues parse-time 1h30`, dry-run and write `issues comment ACME-2` lines, with `exit 0` after each, and no `log-time` call.

- [ ] **Step 4: Commit**

```bash
git add scripts/__scenarios__/issues-log-time.mjs scripts/__scenarios__/_inputs/log-time-comment.md scripts/__scenarios__/issues-log-time.0.after.txt scripts/__scenarios__/issues-log-time.1.after.txt docs/superpowers/specs/2026-11-10-pmk-227-log-time-follow-ups-design.md docs/superpowers/plans/2026-11-10-pmk-227-log-time-follow-ups.md
git rm -q --cached scripts/__scenarios__/issues-log-time.after.txt 2>/dev/null; git commit -m "test(issues): cover the log-time comment path on Linear (PMK-227)" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

## Task 2: Changelog line

**Files:**
- Modify: `CHANGELOG.md` (under `## Unreleased`, at the top)

- [ ] **Step 1: Read the style of the existing lines**

Run: `sed -n 1,25p CHANGELOG.md`
Expected: the `## Unreleased` heading and its bullet lines.

- [ ] **Step 2: Add one bullet under `## Unreleased`, in the same style**

Text: `- Test: \`/pmkit:issues:log-time\` has a scenario for the comment path on Linear, where the tracker has no time tracking (PMK-227).`

- [ ] **Step 3: Commit**

```bash
git add CHANGELOG.md
git commit -m "docs(changelog): note the log-time Linear scenario (PMK-227)" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

## Task 3: Verification and PR

- [ ] **Step 1: Run the full suite in the foreground**

Run: `npm test; echo "exit=$?"`
Expected: `exit=0`. A non-zero exit with zero failing tests is a failure (leaked files, see `scripts/run-tests.mjs`).

- [ ] **Step 2: Mark the criterion met and commit `.issues/`**

Criterion 1 is met by Task 1. Criterion 2 is not met: its condition (rule 5 relaxed) does not hold, so it stays unchecked and the report says why.

Run: `node scripts/pmkit.mjs issues update PMK-227 --check 1 --dry-run --json`, then the same without `--dry-run`, then commit `.issues/` with `(PMK-227)` and the trailer.
