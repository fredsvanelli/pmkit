# PMK-271 Hide absolute paths in the auto_commit failure message Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans (inline execution, chosen by the orchestrator). Steps use checkbox syntax.

**Goal:** A failed auto_commit never shows part of an absolute path (with spaces, UNC) and names the tracker folder when more than 5 files are outside the repository.

**Architecture:** One pure function `hideAbsolutePaths(text)` in `scripts/lib/paths.mjs` replaces the regex in `commitIn`. `commitTracker` names the folder from `tracker.path`.

**Tech Stack:** Node ESM, `node:test`.

**Spec:** `docs/superpowers/specs/2026-11-12-pmk-271-hide-absolute-paths-design.md`

## Global Constraints

- Commit trailer: `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`; every message has `(PMK-271)`.
- No message shows an absolute path (PMK-268).

## Review Focus

- A quote that never closes: the rest of the line is hidden.
- Two quoted paths on one line: each hidden alone, the text between stays.
- Absolute `tracker.path`: never shown in the next step.
- `//host/share` and `C:/x` forms are hidden.
- Text without a path (`can't open`) is left as it is.

---

### Task 1: `hideAbsolutePaths`

**Files:** Modify `scripts/lib/paths.mjs`, `scripts/paths.test.mjs`.

**Interfaces:** Produces `hideAbsolutePaths(text: string): string`.

- [ ] **Step 1:** Tests in `scripts/paths.test.mjs`: `fatal: bad config line 1 in file /Users/John Doe/.gitconfig` becomes `fatal: bad config line 1 in file <path>`; `'/Users/John Doe/x' and '/b c/d'` becomes `'<path>' and '<path>'`; `error: \\host\share\a b\c.md` becomes `error: <path>`; `C:\Users\A B\x` and `C:/Users/A B/x` hidden; `can't open file` unchanged; unclosed `"/a b/c` becomes `"<path>`.
- [ ] **Step 2:** Run `node --test scripts/paths.test.mjs`: FAIL (not exported).
- [ ] **Step 3:** Implement with two regex passes: quoted (`(['"])(abs[^\r\n]*?)\1` to `$1<path>$1`), then unquoted (`(^|[\s'"(])(abs[^\r\n]*)` to `$1<path>`, multiline), where abs is `[A-Za-z]:[\\/]|\\\\|/`.
- [ ] **Step 4:** Run again: PASS.
- [ ] **Step 5:** Commit `fix(auto_commit): hide absolute paths with spaces and UNC paths (PMK-271)`.

### Task 2: use it in `commitIn`, name the tracker folder

**Files:** Modify `scripts/pmkit.mjs` (`commitIn`, `commitTracker`), `scripts/cli-autocommit.test.mjs`, `CHANGELOG.md`.

- [ ] **Step 1:** Test: with a tracker outside the repository and a stale `index.lock`, a git stub or `core.hooksPath`-free failure whose stderr has a path with a space shows none of it in `error.message`. Test: 6 outside files (bulk write) and a stale lock: `error.nextStep` contains the relative `tracker.path` (`../outside-...`) and no absolute path.
- [ ] **Step 2:** Run: FAIL.
- [ ] **Step 3:** `commitIn` calls `hideAbsolutePaths(relativeTo(...))`. In `commitTracker`, the outside name for more than 5 files is `the tracker files in ${folder}`, or `the tracker files` when `climbsOut`-absolute (`path.isAbsolute(folder) || path.win32.isAbsolute(folder)`).
- [ ] **Step 4:** Run `node --test scripts/cli-autocommit.test.mjs scripts/paths.test.mjs`: PASS.
- [ ] **Step 5:** CHANGELOG line, commit.

### Task 3: finish

- [ ] Check the 3 criteria (`issues update PMK-271 --check n`), commit `.issues/`, `npm test` in the foreground (exit 0), PR.
