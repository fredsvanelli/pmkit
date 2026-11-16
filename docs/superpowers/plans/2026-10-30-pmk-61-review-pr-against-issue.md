# Review a pull request against its issue Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** `/pmkit:issues:review <id>` checks the diff of an issue branch against the acceptance criteria and offers to comment the result.

**Architecture:** Two methods on `createGithubHost` (`prDiff`, `localDiff`) back one CLI read, `pr diff`. A command file drives the comparison and the comment.

**Tech Stack:** Node test runner, the fake `gh` of `scripts/fake-gh.mjs`, a temp git repo for the local diff.

**Spec:** `docs/superpowers/specs/2026-10-30-pmk-61-review-pr-against-issue-design.md`

## Global Constraints

- Tests never call the real GitHub.
- Edits in `scripts/lib/capabilities.mjs`, goldens, README, CHANGELOG and `skills/pmkit/SKILL.md` stay small, because PMK-44, PMK-57 and PMK-59 touch them in parallel.
- No change to the Local tracker store.

## Review Focus

- The pull request diff and the local diff both come back with `source`, `truncated` and `lines`.
- A branch or base that starts with a dash fails with `INVALID_INPUT` before git or gh runs.
- `--max-lines 0` fails with `INVALID_INPUT`.
- A timed out `gh` or `git` call is `UPSTREAM`, not `UNEXPECTED`.

### Task 1: Host methods and timeout

**Files:** Modify `scripts/lib/github/host.mjs`; test `scripts/github-host.test.mjs`.

- [ ] Write failing tests: `prDiff(7)` calls `gh pr diff 7 --color never`; `localDiff({ branch, base })` calls `git diff --no-color base...branch`, falls back to `origin/base` when `git rev-parse --verify --quiet base` fails; dash refs are refused; `defaultExec` passes a timeout and an ETIMEDOUT error becomes `UPSTREAM`.
- [ ] Run `node --test scripts/github-host.test.mjs`, expect FAIL.
- [ ] Implement, reusing `check` and `refArg`.
- [ ] Run again, expect PASS. Commit.

### Task 2: `pr diff` command and capability entry

**Files:** Modify `scripts/pmkit.mjs`, `scripts/lib/capabilities.mjs`, the four `capabilities.txt` goldens, `scripts/golden-cases.mjs`, `scripts/cli.test.mjs`, `scripts/cli-degraded-coverage.test.mjs`; test `scripts/cli-pr.test.mjs`.

- [ ] Write failing tests: PR diff with `fakeGh`; local diff in a repo with a branch; truncation with `--max-lines`; `--max-lines 0` is `INVALID_INPUT`; `NOT_SUPPORTED` with no git host.
- [ ] Run `node --test scripts/cli-pr.test.mjs`, expect FAIL.
- [ ] Add the command after `ci logs`, add `pr diff` to `SERVED_BY.linked_code`, register it in the shared test tables, refresh the goldens.
- [ ] Run `npm test`, expect PASS. Commit.

### Task 3: Command file and docs

**Files:** Create `commands/issues/review.md`; modify `README.md`, `CHANGELOG.md`, `skills/pmkit/SKILL.md`.

- [ ] Write the command file with the steps, the confirmation point, the output and the missing-input cases.
- [ ] Add the README command list line and the `pr diff` table row, a CHANGELOG line at the top of `## Unreleased`, and the SKILL.md routing row.
- [ ] Run `npm test` (the plugin tests check the paths and the list), expect PASS. Commit.

### Task 4: Close out

- [ ] Tick the three criteria with `issues update PMK-61 --check n`, commit `.issues/`.
- [ ] Run `npm test`, open the PR, comment, move to `in_review`.
