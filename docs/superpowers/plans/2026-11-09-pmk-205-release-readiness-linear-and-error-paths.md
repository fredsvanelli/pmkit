# PMK-205 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans (inline) to implement this plan task-by-task.

**Goal:** Fix the Linear and error paths of `release-readiness`.

**Architecture:** Pure rules stay in `scripts/lib/release-readiness.mjs`; `runReleaseReadiness` reads lazily and tolerates transient errors, recording them as `problems` and `unread` rungs.

**Tech Stack:** Node ESM, `node:test`, fake `gh`.

**Spec:** `docs/superpowers/specs/2026-11-09-pmk-205-release-readiness-linear-and-error-paths-design.md`

## Global Constraints

- Every commit message carries `(PMK-205)` and ends with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- An unread or incomplete read never yields `ready: true` (lessons, rounds 3 and 7).
- `spawnSync` timeouts only on reads, never on writes.

## Review Focus

- Linear releases on, `--release`: `getRelease` stub NOT_SUPPORTED shows as an error, not a crash.
- `RATE_LIMITED` on every read with no selector: the error is rethrown, not "nothing to check".
- Release with a tag and a failing by-ref deploy call: `deploys` is `{error}`, not partial.

Each task is test first, then code, then `node --test` on the touched file.

1. **Pure fixes** (`scripts/lib/release-readiness.mjs`, `scripts/lib/release-readiness.test.mjs`): tests for `refs/tags/<tag>` match, `empty: true` and `ready: null` with zero issues, and `chooseReadinessBasis({ unread })` giving `releases_not_read`, `milestones_not_read`, `cycles_not_read`. Then the code. (AC 3, 4 partial)
2. **Text** (`scripts/lib/format.mjs`): the three new skip texts and the empty verdict line.
3. **Host** (`scripts/lib/github/host.mjs`): `listDeploys({ ref })` adds `&ref=<encoded>`. Test the URL.
4. **CLI** (`scripts/pmkit.mjs`, `scripts/cli-release-readiness.test.mjs`): tests first with a Linear-shaped fake tracker where practical, otherwise Local with the failing call stubbed:
   - a selector never calls `listReleases`, `currentCycle` or `listMilestones` (except `--sprint current` reads `currentCycle`);
   - transient error on each read, auto pick: result incomplete, `ready: null`, warning, `skipped` reason;
   - everything unread and no basis: the first error is rethrown;
   - `--sprint current` without cycles: `NOT_SUPPORTED`;
   - release with a tag: the ref calls are made, an old deploy is matched, `refs/tags/` ref matches.
   Then the code. (AC 1, 2, 4)
5. **Docs and bookkeeping**: `commands/report/release-readiness.md` (skip reasons, `empty`, incomplete reads), scenario `report-release-readiness` still green, CHANGELOG line, tick the four criteria with `issues update PMK-205 --check n`, commit `.issues/`.
6. **Verify**: `npm test` in the foreground, exit code 0, then the PR.
