# PMK-182 todos scan fixes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** `todos scan` refuses a missing `--path`, reads SQL/Lua/Haskell block comments, and the docs describe `incomplete`, `cut` and `unread`.

**Architecture:** Small edits in `scripts/lib/todos.mjs` and the `todos scan` command in `scripts/pmkit.mjs`, plus docs.

**Tech Stack:** Node ESM, `node:test`.

**Spec:** `docs/superpowers/specs/2026-11-08-pmk-182-todos-scan-fixes-design.md`

## Global Constraints

Commit trailer `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`; issue ID in every commit; CHANGELOG line at the top of `## Unreleased`.

## Review Focus

- `--path` naming an existing folder with no TODO stays a success.
- Lua `--[ TODO` (not a block) stays a line comment.
- An unreadable issue sets `incomplete` but not `cut`.

## Task 1: missing `--path` (criterion 2)
- Test first in `scripts/cli-todos.test.mjs` next to the `--path outside` test: `--path nope/` and `--path src/missing.mjs` answer `INVALID_INPUT`; an existing folder without TODOs still succeeds.
- `scanRepo` in `scripts/lib/todos.mjs`: after `pathPrefix`, throw `INVALID_INPUT` when `prefix !== null` and `<root>/<prefix>` does not exist.

## Task 2: SQL, Lua and Haskell block comments (criterion 3)
- Test first in `scripts/todos.test.mjs`: `/* TODO: a */` in `.sql`, `--[[ TODO: b ]]` in `.lua`, `{- TODO: c -}` in `.hs`, multi-line variants with the line numbers, `--[ TODO` in Lua staying a line comment.
- Add the styles and move the extensions.

## Task 3: `cut` in the data and the comment (criterion 1)
- Test first: `todos scan` data has `cut: false` and, with an unreadable issue, `incomplete: true`, `cut: false`.
- Add `cut: existing.cut` to the data of `todos scan` in `scripts/pmkit.mjs`; fix the comment in `readExistingIssues`.

## Task 4: docs (criteria 1 and 2)
- README row of `todos scan` (line 167): `incomplete`, `cut`, `unread`, `--path` relative to the root, missing path is `INVALID_INPUT`, SQL/Lua blocks.
- `commands/issues/todos.md`: step 1 and the "If something is missing" list.
- PMK-64 spec: the data shape, the "complete or flagged" bullet, `--path` bullet; short "Changes after PMK-182" section.
- CHANGELOG line under `## Unreleased`, at the top.

## Finish
- `--check 1,2,3` on the issue (dry run, then real), commit `.issues/`, `npm test` in the foreground (exit 0), PR.
