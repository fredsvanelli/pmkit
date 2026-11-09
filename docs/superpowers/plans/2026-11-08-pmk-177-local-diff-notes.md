# PMK-177 local diff notes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** `pr diff` and `/pmkit:issues:review` report the working tree, the PR base, merged PRs refused with 406 and reused branch names correctly.

**Architecture:** Two new git reads in `scripts/lib/github/host.mjs` (`workingTree`, `branchTip`), two new PR fields (`baseRefName`, `headRefOid`), and notes plus JSON flags in the `pr diff` command.

**Tech Stack:** Node ESM, `node:test`, fake `gh`/`git` exec in tests.

**Spec:** `docs/superpowers/specs/2026-11-08-pmk-177-local-diff-notes-design.md`

## Global Constraints

- Trailer on every commit: `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`; issue ID `PMK-177` in the message.
- `git` calls use the `DIFF_TIMEOUT_MS` read timeout; no timeout on writes.
- An unknown state is never "clean": a failing `git status` throws.
- Do not run the CLI inside `scripts/__fixtures__/`.

## Review Focus

- Clean checked-out branch: `uncommitted` false, no note.
- Only an untracked file: `uncommitted` false, `untracked` 1, a note.
- PR source with a dirty tree: note, `uncommittedIncluded` false.
- Merged PR, 406, branch merged into base (empty local diff): `incomplete` true, never `gap`.
- Stacked PR (`baseRefName` not the default): fallback diffs against it; `--base` wins.
- Merged PR with `headRefOid` different from the branch tip: PR not used, note.

---

### Task 1: host reads (`scripts/lib/github/host.mjs`, `scripts/github-host.test.mjs`)

**Interfaces:**
- Produces: `workingTree(branch) -> null | { uncommitted: boolean, untracked: number }`; `branchTip(branch) -> string | null`; `localDiff` returns `{ diff, base, ref, uncommitted, untracked }`; `VIEW_FIELDS` ends with `,baseRefName,headRefOid`.

- [ ] **Step 1: tests** in `github-host.test.mjs`: update `VIEW_FIELDS`; `workingTree` returns null for another branch, `{uncommitted:false, untracked:0}` for empty status, `{uncommitted:false, untracked:1}` for `?? f`, `{uncommitted:true, untracked:0}` for ` M f`, throws UPSTREAM-ish error on a failing status; `branchTip` prefers the local ref, then origin, then null; `localDiff` of a checked-out clean branch uses the three-dot diff and `uncommitted:false`.
- [ ] **Step 2:** run `node --test scripts/github-host.test.mjs`; expect FAIL.
- [ ] **Step 3:** implement the two methods and rewire `localDiff` (`git status --porcelain`; line starting `??` is untracked, any other line is a tracked change).
- [ ] **Step 4:** rerun; expect PASS. Commit `feat(host): read the working tree state and the branch tip (PMK-177)`.

### Task 2: `pr diff` behavior (`scripts/pmkit.mjs`, `scripts/cli-pr.test.mjs`)

**Interfaces:**
- Consumes: Task 1 methods and PR fields.
- Produces: JSON `{ ..., uncommitted, uncommittedIncluded, untracked, incomplete }`.

- [ ] **Step 1: tests** (add `baseRefName`, `headRefOid` to `prJson`/`VIEW`): one test per Review Focus line, asserting the exact `note:` text and JSON fields.
- [ ] **Step 2:** run `node --test scripts/cli-pr.test.mjs`; expect FAIL.
- [ ] **Step 3:** implement in the `pr diff` command as in the spec (merged + head/tip mismatch drops the PR; local base `requested ?? pr?.baseRefName ?? default`; `incomplete` when merged, 406 and empty local diff).
- [ ] **Step 4:** rerun; expect PASS. Commit `fix(pr-diff): note uncommitted changes, use the PR base, flag unusable merged diffs (PMK-177)`.

### Task 3: docs and delivery files

- [ ] **Step 1:** `commands/issues/review.md` step 3.1/3.3: repeat the new notes; `incomplete` true means every criterion `not checked`. Update scenario/golden in `scripts/__scenarios__/` if they quote the step. README `pr diff` row. CHANGELOG line at the top of `## Unreleased`.
- [ ] **Step 2:** `npm test` in the foreground, exit code 0. Commit `docs(pr-diff): describe the diff notes (PMK-177)`.
