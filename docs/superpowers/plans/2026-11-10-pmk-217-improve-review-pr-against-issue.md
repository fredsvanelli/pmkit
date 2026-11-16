# PMK-217 improve review-pr-against-issue Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `/pmkit:issues:review` posts its findings on the pull request with inline comments, reads a cut diff file by file, and counts a failing check as a gap.

**Architecture:** Two CLI changes in `scripts/pmkit.mjs` (a `files` list and `--file` on `pr diff`; a new write `pr review`) backed by one new host method in `scripts/lib/github/host.mjs` and one small diff parser in `scripts/lib/diff-files.mjs`. The rest is the command file `commands/issues/review.md` and its scenario.

**Tech Stack:** Node ESM, `node:test`, `gh` CLI.

**Spec:** `docs/superpowers/specs/2026-11-10-pmk-217-improve-review-pr-against-issue-design.md`

## Global Constraints

- Every commit message carries `(PMK-217)` and ends with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Text from data (paths, finding text) never goes on a shell line unquoted: paths in single quotes, texts by file.
- A read that cannot be checked shows as `not checked`, never as passing.
- `npm test` exits 0 in the foreground before the PR.

## Review Focus

- A diff path with spaces, a rename, a deleted file or a binary file must still map to the right `path` (Task 1 tests).
- `--file` with a path not in the diff must fail, not return an empty diff that reads as "no change" (Task 1 test).
- An inline comment on a line outside the hunks must be refused before any write, in the dry run too (Task 2 test).
- GitHub refusing the diff as too large must refuse inline comments, not post them unchecked (Task 2 test).
- `pr review` on a branch with a closed or no pull request must refuse, never post to an old one (Task 2 test).

---

### Task 1: `pr diff` lists files and reads one file

**Files:**
- Create: `scripts/lib/diff-files.mjs`
- Modify: `scripts/pmkit.mjs` (`pr diff` command)
- Test: `scripts/cli-pr.test.mjs`, `scripts/lib/diff-files.test.mjs`

**Interfaces:**
- Produces: `splitDiff(text: string) => Array<{ path: string, text: string }>` (sections in order; `text` ends with `\n`); `rightLines(sectionText: string) => Set<number>` (new-file line numbers of added and context lines).

- [ ] Step 1: `diff-files.test.mjs`: `splitDiff` maps a modify (`+++ b/a b.txt` gives `a b.txt`), a delete (`+++ /dev/null`, path from `--- a/`), a pure rename (`rename to new.txt`), and a binary file (`Binary files a/img.png and b/img.png differ`, path `img.png` from the header). `rightLines` of `@@ -1,2 +1,3 @@\n a\n-b\n+c\n+d\n` is `{1,2,3}`.
- [ ] Step 2: run `node --test scripts/lib/diff-files.test.mjs`: FAIL (module missing).
- [ ] Step 3: implement both. Header fallback: `diff --git a/<p> b/<p>` gives `p` from the symmetric split (length `(n - 5) / 2` after `diff --git `).
- [ ] Step 4: `cli-pr.test.mjs`: `pr diff` JSON has `files: [{ path, lines, cut }]`; with `--max-lines` cutting inside the second file, the first has `cut: false`, the second and later `cut: true`; `--file b.txt` returns only that section with `lines`/`truncated` for it; `--file missing.txt` exits 2 with `INVALID_INPUT` whose message names the path.
- [ ] Step 5: implement in `pr diff`: compute `files` from `splitDiff(full)`; with `--file`, replace `full` by the joined sections of that path before the cut. Text head names the file.
- [ ] Step 6: run `node --test scripts/cli-pr.test.mjs scripts/lib/diff-files.test.mjs`: PASS. Update the README `pr diff` row and the `--help` usage `[--file path]`.
- [ ] Step 7: commit `feat(pr): pr diff lists its files and reads one with --file (PMK-217)`.

### Task 2: `pr review` posts a review with inline comments

**Files:**
- Modify: `scripts/lib/github/host.mjs`, `scripts/pmkit.mjs`, `scripts/lib/capabilities.mjs` (`linked_code` gets `pr review`), `README.md`
- Test: `scripts/github-host.test.mjs`, `scripts/cli-pr.test.mjs`, and whatever command lists the suite checks (golden cases, degraded coverage, write lists)

**Interfaces:**
- Consumes: `splitDiff`, `rightLines` (Task 1).
- Produces: host `postReview(number: number, { body: string, comments: Array<{ path, line, body }> }) => { id: number, url: string }`, calling `gh api repos/{owner}/{repo}/pulls/<n>/reviews --method POST --input -` with `{ event: 'COMMENT', body, comments: comments.map(c => ({ ...c, side: 'RIGHT' })) }`. CLI `pr review --issue <id> --body-file f [--comments-file f]`, write; data `{ pr: { number, url }, event: 'COMMENT', body, comments }` plus `review` on the real run.

- [ ] Step 1: host test: `postReview(7, ...)` sends the args above and the JSON as `input`; returns `{ id, url: html_url }`.
- [ ] Step 2: CLI tests: dry run makes no `api` call and returns the data; real run calls the endpoint once; a comment on a line outside the hunks, an unknown path, a bad JSON file or an entry without `path`/`line`/`body` is `INVALID_INPUT` naming the entries, with no `api` call; an empty body file is refused; a too-large diff (HTTP 406) refuses inline comments and allows a body-only review; no branch, no pull request and a closed pull request are refused.
- [ ] Step 3: run them: FAIL.
- [ ] Step 4: implement. Validation runs before `if (ctx.dryRun)`.
- [ ] Step 5: run `npm test`; fix the command lists the suite asks for (goldens via the golden update script if one exists).
- [ ] Step 6: commit `feat(pr): add pr review to post a review with inline comments (PMK-217)`.

### Task 3: the command file, scenario and docs

**Files:**
- Modify: `commands/issues/review.md`, `scripts/__scenarios__/issues-review.mjs` (+ `.after.txt` snapshots), `scripts/__scenarios__/_inputs/` (review body, comments JSON), `CHANGELOG.md`, `skills/pmkit/SKILL.md` only if it describes the review steps.

- [ ] Step 1: scenario entry .0 (happy path): reads issue, `pr diff`, `pr status`; posts the issue comment and the pull request review (`pr review --dry-run` then real) after confirmations. Entry .1: cut diff (`--max-lines` small via a long canned diff) read with `--file`, and a failing check whose `ci logs --run` is read, with the comment holding `gap` for the check.
- [ ] Step 2: run the scenario test: FAIL.
- [ ] Step 3: edit `review.md` as the spec's command-file section says (step 3.2, new checks step, result, posting step, confirmation points, output).
- [ ] Step 4: regenerate the snapshots; run `npm test`: exit 0.
- [ ] Step 5: CHANGELOG line under `## Unreleased`; commit `feat(issues): review reads checks, cut diffs by file and posts on the pull request (PMK-217)`.
