# PMK-264 Linear Doc Links On A GitHub Enterprise Host Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A Linear doc link uses the web host of the repository's `origin` remote.

**Architecture:** `webHost(url, repo)` in `git-remote.mjs`; the CLI passes `docsHost`; `docUrl` takes the host.

**Tech Stack:** Node 18 ES modules, `node:test`.

**Spec:** `docs/superpowers/specs/2026-11-22-pmk-264-linear-doc-links-on-github-enterprise-design.md`

## Global Constraints

- No dependencies (ADR 0003). github.com links stay as they are.

## Review Focus

- `origin` pointing at another repository keeps github.com.
- No `origin` at all keeps github.com.

---

### Task 1: webHost

**Files:** `scripts/lib/git-remote.mjs`; test `scripts/git-remote.test.mjs`

**Produces:** `webHost(url: string, repo: string | undefined) -> string | null`.

- [ ] Test `webHost is the remote's web host for the configured repo`: the values of the spec. Red, implement, green, commit.

### Task 2: The link

**Files:** `scripts/pmkit.mjs`, `scripts/lib/linear/issue-ops.mjs`; test `scripts/cli-degraded.test.mjs`

- [ ] Test `issues update --add-doc on Linear links to the GitHub Enterprise host of origin`: origin `git@ghe.example.com:acme/app.git`, `git_host.repo: acme/app`; the attachment URL starts `https://ghe.example.com/acme/app/blob/`. Red, implement, green. CHANGELOG. `npm test`, `npm run lint`. Commit.
