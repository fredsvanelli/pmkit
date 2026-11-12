# PMK-289 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:executing-plans (inline).

**Goal:** hide absolute paths in the remaining git and gh error texts.
**Architecture:** call the existing `hideAbsolutePaths` at the listed places; drop the root from two messages.
**Tech Stack:** Node ESM, node:test.
**Spec:** docs/superpowers/specs/2026-11-12-pmk-289-hide-paths-design.md

## Global Constraints
- Do not touch `scripts/lib/paths.mjs`. Do not reformat the `issues branch` area of `host.mjs` or `pmkit.mjs` near line 1937.
- Commits carry `(PMK-289)` and the Opus 5.5 trailer.

## Review Focus
- gh stderr whose first line has a path before `(HTTP 404)`: status still 404.
- gh stderr `HTTP 502: ... /path`: status still 502.
- A path with a space in the gh text shows no part.

### Task 1: gh stderr (host.mjs)
Files: `scripts/lib/github/host.mjs` `failure()`; test `scripts/github-host.test.mjs`.
- [ ] Failing tests: stderr `gh: open /Users/a b/x: no such file (HTTP 404)` -> message has no `/Users`, `httpStatus` 404; stderr `HTTP 502: Bad Gateway (/home/u/x)` -> status 502, no `/home`; plain path-only stderr hidden.
- [ ] Implement: compute `http` on the raw `detail`, build the message with `hideAbsolutePaths(detail)` for every cmd.
- [ ] Run `node --test scripts/github-host.test.mjs`.
- [ ] Commit.

### Task 2: spawn messages (pmkit.mjs)
- [ ] Failing tests in `scripts/cli-git-paths.test.mjs`: `tagWarning` and `grepFailure` with a spawn `error.message` holding a path (cwd that does not exist gives `spawnSync git ENOENT`; use a fake via env/cwd as feasible, otherwise export-free unit through `tagWarning` with a missing cwd).
- [ ] Wrap `result.error.message` in `hideAbsolutePaths` in `grepFailure` and `tagWarning`.
- [ ] Commit.

### Task 3: drop the root (link-repo, todos)
- [ ] Update `scripts/cli-git-paths.test.mjs` todos test and `scripts/cli-link-repo.test.mjs:438` to assert no root; add a link-repo test with a subfolder root.
- [ ] Change messages in `scripts/pmkit.mjs:3797` and `scripts/lib/todos.mjs:452`; hide `listed.error?.message` in todos.
- [ ] Regenerate the four `todos-scan.txt` goldens; check CHANGELOG line under `## Unreleased`.
- [ ] Commit.

### Task 4: verify
- [ ] `npm test` in foreground, exit 0. Check criteria with `issues update PMK-289 --check 1 --check 2`, commit `.issues/`.
