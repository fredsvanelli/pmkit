# PMK-124 separate the paragraph after a sub-list Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** In `pause.md` and `import.md`, the indented paragraph at the end of step 7 renders as part of the step, not inside the last sub-list item.

**Architecture:** Add one empty line before the paragraph in each of two command files. No code changes. The spec's static check (`awk` and `grep -F`) fails first, the edit makes it pass, then `npm test` runs in full.

**Tech Stack:** Markdown, `awk`, `grep`, `git`, `npm test` (`node:test`).

**Spec:** `docs/superpowers/specs/2026-10-26-pmk-124-sub-list-paragraph-design.md`

## Global Constraints

- Only two files may change in the implementation commit: `commands/issues/pause.md` and `commands/spec/import.md`. Each gains exactly one empty line and loses none. Do not touch `commands/cycle/close.md`, `scripts/`, any scenario, any snapshot, or `CHANGELOG`.
- Indent stays 3 spaces. The empty line is truly empty (no spaces). The paragraph text does not change. This matches `commands/cycle/close.md` lines 28 to 33.
- `commands/issues/pause.md`, step 7. Before (lines 27 and 28, long text cut with `...`):

```
   - When `existing` is `true`, the branch already has an open PR, in `pr`. ... Ask once whether to push.
   When the user approves, run the same command without `--dry-run`. When the user declines, skip the push and say the branch is not pushed.
```

  After (lines 27 to 29): line 27 unchanged, line 28 empty, line 29 is the old line 28 unchanged. Line 29 starts with `   When the user approves`.

- `commands/spec/import.md`, step 7. Before (lines 28 and 29, long text cut with `...`):

```
   2. For each new milestone, run `node ... milestone create <id> --name "<name>" [--due <date>] --json` and note its id. ... before step 8.
   When one fails, stop, list what was created and what was not, and do not retry it.
```

  After (lines 28 to 30): line 28 unchanged, line 29 empty, line 30 is the old line 29 unchanged. Line 30 starts with `   When one fails`.

- Suggested edit: `sed -i '28i\\' commands/issues/pause.md` and `sed -i '29i\\' commands/spec/import.md`. Any method works if the result matches the lines above. Check that the inserted line has no trailing spaces.
- Diff base is `"$(git merge-base main HEAD)"` (`e20817c` today), never `main`.
- Snapshots: the spec expects none to change, because `parseCommandFile` ignores blank lines and the `.after.txt` files hold CLI calls and step numbers, not command text. If `git status --short scripts/` is not empty after `npm test`, stop. Read the diff line by line to find out why. Regenerate only with `UPDATE_GOLDENS=1 npm test`, then read the new diff line by line again. Never edit a snapshot by hand. This plan edits no snapshot.
- Commit message format: a subject ending with `(PMK-124)`, then the trailer `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`.
- Straight quotes, no em dashes in prose.
- Decision on the open choices: one task, not two. The two edits have the same shape and share one check and one commit. A reviewer would not approve one file and reject the other. No new test file and no scenario assertion (spec decisions 3 and 4).

## Review Focus

1. The inserted line holds spaces, and the diff shows `+   ` and not a lone `+`. Task 1 pins it with the `-U0` pipeline that must print two lone `+` lines.
2. The indent of the paragraph is removed, which ends the list and detaches the paragraph from step 7. Task 1 pins it with the `sed -n | cut` checks and the numstat of `1 0` per file.
3. The `awk` check runs on a wrong path and prints nothing, which looks like a pass. Task 1 requires the before-run to print the two spots.
4. A snapshot changes after `npm test`. Task 1 pins it with `git status --short scripts/` printing nothing.

---

### Task 1: Add the empty line before the step 7 paragraph in both files

**Files:**
- Modify: `commands/issues/pause.md` (insert an empty line at line 28)
- Modify: `commands/spec/import.md` (insert an empty line at line 29)

**Interfaces:**
- Consumes: the precedent layout in `commands/cycle/close.md` lines 28 to 33 (read only).
- Produces: nothing other tasks use.

- [ ] **Step 1: Run the failing check.** From the repo root, run:

```
for f in $(git ls-files 'commands/*.md' 'commands/**/*.md' 'skills/**/*.md'); do
  awk -v F=$f 'prev ~ /^ +([-*]|[0-9]+\.) / && $0 ~ /^ +[^ ]/ && $0 !~ /^ +([-*]|[0-9]+\.) / {print F":"NR": "substr($0,1,50)} {prev=$0}' $f
done
```

Expected now, exactly two lines: `commands/issues/pause.md:28:    When the user approves, run the same command wi` and `commands/spec/import.md:29:    When one fails, stop, list what was created and`. If the output differs, stop and report. A wrong path prints nothing, so the two lines also prove the check reads the files.

Also run `git diff --numstat "$(git merge-base main HEAD)" -- commands/`. Expected now: no output.

- [ ] **Step 2: Insert the empty lines.** Apply the before and after text from Global Constraints: one empty line at line 28 of `commands/issues/pause.md`, and one at line 29 of `commands/spec/import.md`. Change nothing else.

- [ ] **Step 3: Run the check again and confirm it passes.**
  - The Step 1 loop prints nothing.
  - `sed -n 27,29p commands/issues/pause.md | cut -c1-30` prints `   - When `existing` is`, an empty line, then `   When the user approves`.
  - `sed -n 28,30p commands/spec/import.md | cut -c1-30` prints `   2. For each new milestone`, an empty line, then `   When one fails`.
  - `git diff --numstat "$(git merge-base main HEAD)" -- commands/` prints `1	0	commands/issues/pause.md` and `1	0	commands/spec/import.md`.
  - `git diff -U0 "$(git merge-base main HEAD)" -- commands/ | grep '^[+-]' | grep -v '^+++\|^---'` prints two lines, each a lone `+`.

- [ ] **Step 4: Run the whole suite.**

Run: `npm test`
Expected: 1011 tests, 1011 pass, 0 fail, with the `issues-pause` and `spec-import` scenarios among the passes. Then run `git status --short scripts/`. Expected: no output. If a snapshot changed, follow the snapshot rule in Global Constraints and do not commit until the diff is read and explained.

- [ ] **Step 5: Commit**

```bash
git add commands/issues/pause.md commands/spec/import.md
git commit -m "fix: separate the step 7 paragraph from the sub-list in pause and spec import (PMK-124)

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

Complexidade: baixa
