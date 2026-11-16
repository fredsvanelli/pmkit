# PMK-186 fixture cache Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** A cache in `scripts/__fixtures__/` neither shows in git nor breaks the suite; the `scenarios-live.mjs` header holds no stale counts.

**Spec:** `docs/superpowers/specs/2026-11-08-pmk-186-fixture-cache-design.md`

## Tasks
1. (TDD) Test in `scripts/fixtures.test.mjs`: `copyFixture` of a temp folder holding `.issues/.cache/index.json` and `.issues/x` copies `x` and not `.cache`. Fail, then add `copyFixture` to `scripts/test-helpers.mjs`, use it in `makeRepo` and in `prepareCopy` (`scripts/scenario-helpers.mjs`).
2. (TDD) Test: the header of `scripts/scenarios-live.mjs` matches no `\d+ runs`, `of \d+ entries` or `\$\d+` count. Fail, then rewrite the comment lines 5, 11-12 and 36.
3. Add the `.gitignore` line. Prove it with `git check-ignore`.
4. CHANGELOG line under `## Unreleased`. No command is new, so README and SKILL stay.
5. Verify: reproduce by running the CLI in `scripts/__fixtures__/team`, then `npm test` in the foreground, exit code 0. Remove the stray cache.
6. Tick criteria, commit `.issues/`, open the PR, comment, move to `in_review`.
