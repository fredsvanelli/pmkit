# Deploys and CI logs Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** The GitHub git host lists deploys and returns the log of a failed run, through two read-only CLI commands.

**Architecture:** Two methods on `createGithubHost` in `scripts/lib/github/host.mjs` call `gh api` and `gh run view`. Two commands in `scripts/pmkit.mjs` wrap them. `SERVED_BY.linked_code` lists them.

**Tech Stack:** Node test runner, the fake `gh` of `scripts/fake-gh.mjs`.

**Spec:** `docs/superpowers/specs/2026-10-30-pmk-49-deploys-and-ci-logs-design.md`

## Global Constraints

- Tests never call the real GitHub. Host tests use an injected `exec`, CLI tests use `fakeGh`.
- Edits in `scripts/lib/capabilities.mjs` stay to one line.

## Review Focus

- A deployment with no statuses reports state `pending`.
- `--run abc` and `--limit 0` fail with `INVALID_INPUT` before `gh` runs.
- No failed run on the branch returns an empty result, not an error.
- An environment name with spaces or `&` is URL-encoded.
- A huge log is cut to the last `--tail` lines.

### Task 1: Host methods

**Files:** Modify `scripts/lib/github/host.mjs`; test `scripts/github-host.test.mjs`.

**Interfaces:**
- Produces: `listDeploys({ environment?: string, limit?: number }): Deploy[]`, `ciLogs({ branch?: string, runId?: number }): { runId, workflowName, url, log } | null`.

- [ ] Write failing tests: `listDeploys` issues the deployments call and one statuses call per deployment, maps state (`pending` with no status), encodes the environment, rejects a limit outside 1 to 100; `ciLogs` with `runId` calls `gh run view 99 --log-failed`; without it picks the newest `failure` run from `gh run list`, returns null when none failed, refuses a branch that starts with a dash.
- [ ] Run `node --test scripts/github-host.test.mjs`, expect FAIL.
- [ ] Implement both methods, reusing `check`, `parse` and `listRuns`.
- [ ] Run the same command, expect PASS. Commit.

### Task 2: CLI commands and capability entry

**Files:** Modify `scripts/pmkit.mjs`, `scripts/lib/capabilities.mjs`, `README.md`; test `scripts/cli-pr.test.mjs`.

**Interfaces:**
- Consumes: Task 1 methods.
- Produces: `deploys list [--environment e] [--limit n]`, `ci logs [--branch b] [--run id] [--tail n]`.

- [ ] Write failing tests with `fakeGh`: both commands print and return JSON; `--run abc`, `--limit 0` and `--tail 0` give `INVALID_INPUT`; the log is cut to `--tail` lines with `truncated: true`; with no git host both give `NOT_SUPPORTED`.
- [ ] Run `node --test scripts/cli-pr.test.mjs`, expect FAIL.
- [ ] Add the commands after `pr status`, add them to `SERVED_BY.linked_code`, document them in the README command table.
- [ ] Run `npm test`, expect PASS. Commit.
