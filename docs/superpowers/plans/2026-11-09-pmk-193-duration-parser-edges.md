# PMK-193 Duration Parser Edges Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix four edge defects of the log-time duration parser and its note.

**Architecture:** All logic lives in `scripts/lib/duration.mjs`; `scripts/pmkit.mjs` passes `written` to the note on a real write. Goldens of `issues parse-time` change for the day format.

**Tech Stack:** Node ESM, `node:test`.

**Spec:** `docs/superpowers/specs/2026-11-09-pmk-193-duration-parser-edges-design.md`

## Global Constraints

- Every commit message carries `PMK-193` and ends with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Error code for a bad duration is `INVALID_INPUT` with the `FORMATS` next step.
- The note threshold stays `LONG_ENTRY_MINUTES` (24 h).

## Review Focus

- `9007199254740991` minutes is valid, `9007199254740992` and `99999999999999999999999` are `INVALID_INPUT` (Task 1).
- A digit string so long it becomes `Infinity` answers "too large", not "not a whole number" (Task 1).
- `99999999999999999999h` (hours that overflow after the x60) is `INVALID_INPUT` (Task 1).
- Exactly one day (1440) has no note; 1500 reads `1d1h`; 2880 reads `2d`; 1470 reads `1d0h30` (Task 2).
- A real write and a dry run print different notes, and the JSON `note` matches stderr (Task 3).

---

### Task 1: Reject durations that are not safe integers

**Files:**
- Modify: `scripts/lib/duration.mjs` (`parseMinutes`)
- Test: `scripts/duration.test.mjs`

**Produces:** `parseMinutes(input)` throws `INVALID_INPUT` ("... it is too large to be a whole number of minutes") above `Number.MAX_SAFE_INTEGER`.

- [ ] **Step 1: Write failing test** `parseMinutes keeps safe integers and rejects larger ones`: `parseMinutes('9007199254740991') === 9007199254740991`; each of `'9007199254740992'`, `'99999999999999999999999'`, `'99999999999999999999h'`, `'1' + '0'.repeat(400)` throws `INVALID_INPUT` with message matching `/too large/`.
- [ ] **Step 2: Run** `node --test scripts/duration.test.mjs`. Expected: FAIL.
- [ ] **Step 3: Implement.** After the format match, throw `invalid(input, 'it is too large to be a whole number of minutes')` when `!(minutes <= Number.MAX_SAFE_INTEGER)`; round to 6 decimals only when `!Number.isInteger(minutes)`; keep the later checks.
- [ ] **Step 4: Run** the same command. Expected: PASS.
- [ ] **Step 5: Commit** `fix(duration): refuse a time that is not a safe integer of minutes (PMK-193)`.

### Task 2: Days in the readable form

**Files:**
- Modify: `scripts/lib/duration.mjs` (`hoursText`, `longEntryNote`)
- Test: `scripts/duration.test.mjs`

**Produces:** `hoursText` is `<d>d` plus, when hours or minutes are non-zero, `<h>h` plus zero-padded minutes when non-zero; with no whole day it keeps the `1h30` style. Not exported.

- [ ] **Step 1: Write failing test** by changing the `longEntryNote` test: `longEntryNote(1500)` matches `/1500 minutes \(1d1h\)/`; `100000` matches `/\(69d10h40\)/`; `2880` matches `/\(2d\)/`; `1470` matches `/\(1d0h30\)/`; `1440` is `null`.
- [ ] **Step 2: Run** `node --test scripts/duration.test.mjs`. Expected: FAIL.
- [ ] **Step 3: Implement** `hoursText(minutes: number): string` as described.
- [ ] **Step 4: Run** the same command. Expected: PASS.
- [ ] **Step 5: Commit** `fix(duration): write long durations with days (PMK-193)`.

### Task 3: Note on a real write says the time is already logged

**Files:**
- Modify: `scripts/lib/duration.mjs` (`longEntryNote(minutes, { written } = {})`), `scripts/pmkit.mjs` (`issues log-time` run: pass `{ written: !ctx.dryRun }`), `commands/issues/log-time.md` (step 5), `scripts/cli.test.mjs` (log-time test near line 2334)
- Regenerate: `scripts/__goldens__/*/issues-parse-time.txt`

**Produces:** with `written: true` the note is `<m> minutes (<text>) is more than a day; the time is already logged, check it`; otherwise unchanged.

- [ ] **Step 1: Write failing tests.** In `duration.test.mjs`: `longEntryNote(1500, { written: true })` matches `/already logged/` and not `/before you confirm/`. In `cli.test.mjs`, the real run in the loop is `--json` and its `note` matches `/already logged/`; stderr has `note: .*already logged`.
- [ ] **Step 2: Run** `node --test scripts/duration.test.mjs scripts/cli.test.mjs`. Expected: FAIL.
- [ ] **Step 3: Implement** the option, the `pmkit.mjs` call, and one sentence in step 5 of the command file: when the real write returns a `note`, the time is already logged, so repeat the note and offer no confirmation.
- [ ] **Step 4: Regenerate goldens** `UPDATE_GOLDENS=1 node --test scripts/goldens.test.mjs`; check the diff is only `25h` to `1d1h`.
- [ ] **Step 5: Run** `npm test` in the foreground, exit code 0.
- [ ] **Step 6: Commit** `fix(log-time): the long-entry note on a write says the time is logged (PMK-193)`.

### Task 4: Changelog, PMK-60 correction, criteria

- [ ] **Step 1:** Add a line at the top of `## Unreleased` in `CHANGELOG.md`, in the style of the lines there.
- [ ] **Step 2:** Post a correcting comment on PMK-60 through `issues comment` (dry run, then real) saying the limit is not 24 hours: there is no ceiling, and a note appears above 24 hours.
- [ ] **Step 3:** `issues update PMK-193 --check 1`, `--check 2`, `--check 3` (dry run, then real); commit `.issues/`.
- [ ] **Step 4:** Verify with `npm test` (foreground, exit 0), then open the PR.
