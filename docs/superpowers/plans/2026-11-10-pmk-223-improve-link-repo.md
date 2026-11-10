# PMK-223 improve link-repo Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans (inline) to implement this plan task-by-task.

**Goal:** `link-repo` handles GitHub Enterprise remotes, can skip its confirmation for a host-only change, and can re-check the team held in the file.

**Architecture:** all three changes live in `runLinkRepo` (`scripts/pmkit.mjs`) plus the command file; no new config key.

**Tech Stack:** Node ESM, `node:test`.

## Global Constraints

- Commit trailer exactly `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`, issue ID in every message.
- A read that cannot be verified is reported as not verified (`verified: false`), never as fine.

## Review Focus

- Enterprise remote whose path is not `owner/name` (three segments): falls back to the "needs a repo" refusal, no wrong repo written.
- `--yes` with a team change or a broken mapping: still asks.
- `--recheck-team` on Local, with no team, or with an unknown team: `INVALID_INPUT`.

Spec: `docs/superpowers/specs/2026-11-10-pmk-223-improve-link-repo-design.md`. Files: `scripts/pmkit.mjs` (`runLinkRepo`, command table), `commands/link-repo.md`, `scripts/cli-link-repo.test.mjs`, `scripts/__scenarios__/link-repo.*` only if the steps change, `README.md`, `skills/pmkit/SKILL.md` if it lists flags, `CHANGELOG.md`.

Each task is test first (red), then code (green).

1. **GitHub Enterprise (criterion 1).** Tests: `--git-host github` with `git@github.example.com:acme/app.git` writes `repo: acme/app` with `source: remote` and a note naming the host and `gh auth login --hostname`; `--repo` beats the remote; an Enterprise remote without the flag still changes nothing; a path that is not owner/name falls back to the "needs a repo" refusal. Code: in `runLinkRepo`, when `flagHost === 'github'`, `flagRepo` is unset and the inferred system is `null`, take `owner/name` from `parseRemoteUrl(chosen.remote.url)` (a path with more than two segments counts as none), and add the note.
2. **Host-only skip (criterion 2).** Tests: `hostOnly` true for a host/repo/branch change, false for a team change, for no change, and for a broken mapping. Command-file test: `--yes` in the hint and the Parameters, and step 6 says when it applies. Code: compute `hostOnly` next to `changed`; edit `commands/link-repo.md` (Parameters, step 6, confirmation points).
3. **Re-check team (criterion 3).** Tests: Linear `--recheck-team` verifies the held team (`verified: true`, one Linear call), an unknown held team is `INVALID_INPUT`, no team is `INVALID_INPUT`, Local is `INVALID_INPUT`, broken mappings of an unchanged team are listed but the write goes through, and `--team X --recheck-team` checks `X` once. Code: new flag in the command table and `usage`; call `linkTeam` for `wantedTeam ?? heldTeam`; command-file Parameters and step 2 text.
4. **Docs.** `CHANGELOG.md` line under `## Unreleased` at the top, `README.md` command table row, scenario and goldens only if their output changes.
5. **Acceptance.** `issues update PMK-223 --check 1..3` (dry run, then real), commit `.issues/`, `npm test` in the foreground with exit code 0, PR.
