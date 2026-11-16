# PMK-279 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:executing-plans (inline).

**Goal:** a `rev-parse` failure other than "not a git repository" in an outside tracker folder is reported as `UPSTREAM`.
**Architecture:** in `commitTracker` (scripts/pmkit.mjs), classify the spawn result; throw a `PmkitError` like `commitIn`'s `fail`.
**Spec:** docs/superpowers/specs/2026-11-13-pmk-279-rev-parse-failure-design.md

## Global Constraints
- No absolute path in any message. Commits carry the issue ID and the Opus 5.5 trailer.

## Review Focus
- Spawn error (git missing): UPSTREAM, no path.
- Folder outside any repository: current note stays (test exists in adr.test.mjs; add one in cli-autocommit).

### Task 1: classify the rev-parse failure
**Files:** Modify `scripts/pmkit.mjs` (`commitTracker`); Test `scripts/cli-autocommit.test.mjs`, `CHANGELOG.md`.
- [ ] Failing test 1: outside tracker (not a repo) with `GIT_CONFIG_GLOBAL` set to a malformed file: status 2, `error.code` UPSTREAM, message matches `/auto_commit failed: .*bad config line 1/`, says the write succeeded, no absolute path, `written` present; the tracker file changed on disk.
- [ ] Failing test 2: outside tracker in a folder with no repository: status 0, stderr note `not in a git repository, so nothing was committed`.
- [ ] Run, see test 1 fail.
- [ ] Implement: `result.error` or status != 0 and stderr not `/not a git repository/i` throws UPSTREAM (hideAbsolutePaths of message/stderr first line), nextStep `Commit the tracker files yourself`.
- [ ] `npm test` (foreground, exit 0), CHANGELOG line, check criteria, commit.
