# Priority and estimate from labels on GitHub without a Project Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** On a GitHub repository without a Project, `mappings.priority.<level>` and `mappings.estimate.<value>` name labels that give each issue its priority and estimate, writes swap them, setup asks the priority labels and takes estimate labels from a flag.

**Architecture:** Two more label maps beside `statusLabels` and `typeLabels` (ADR 0009's pattern), held in the GitHub context; reads go through `readLabels`, writes through `planLabels`, setup through `proposeGithubSetup` and `init`.

**Tech Stack:** Node 18+ ES modules, `node:test`, the stateful fake GitHub.

**Spec:** `docs/superpowers/specs/2026-11-21-pmk-339-github-priority-estimate-labels-design.md`; ADR 0012.

## Global Constraints

- Levels: `urgent`, `high`, `medium`, `low` (PRIORITIES). Estimate keys: strings; the scale is the keys in mapping order; unit `points` when every key is a number (an issue's estimate is then the number), else `sizes`.
- A label value holds only when `tracker.scope.project` is none and `mappings.fields.<role>` is none; otherwise it is a broken mapping, `NOT_CONFIGURED`, next step `/pmkit:setup`.
- One label stands for one value across status, type, priority and estimate.
- Flags: `init --priority-label <level>=<label|none>`, `init --estimate-label <value>=<label|none>`.
- Dates: unchanged (unsupported without a Project or issue fields).

## Review Focus

- Several priority labels on one issue: the highest wins, with a warning naming them (Task 2).
- A labels patch that names a priority or estimate label: `INVALID_INPUT`, pointing at `--priority` or `--estimate` (Task 3).
- A held priority label with a Project, or with `mappings.fields.priority` set: broken, so setup asks again (Task 1).
- `--estimate` with a value no label stands for: `INVALID_INPUT` naming the mapped values (Task 3).

---

### Task 1: the mapping check and the config schema

**Files:** `scripts/lib/github/mappings.mjs` (`problemOf`, `brokenGithubMappings`), `schemas/pmkit.config.schema.json`. Test: `scripts/lib/github/mappings.test.mjs`, `scripts/config.test.mjs` if it validates the schema.

- [ ] Failing tests: `brokenGithubMappings` flags `mappings.priority.high: label:P1` with a Project (`... but priority and estimate come from fields when there is a Project`), with `mappings.fields.priority` set, with a missing label, and with a value that is not `label:`; accepts it without a Project and with the field none. Same for `mappings.estimate.3`. A config with `mappings.priority` and `mappings.estimate` validates against the schema.
- [ ] Implement; run; commit `feat: the GitHub mapping check knows priority and estimate labels (PMK-339)`.

### Task 2: reads

**Files:** `scripts/lib/github/issues.mjs` (`makeContext`: `priorityLabels`, `estimateLabels`, `mappedLabelIds`, `readLabels`; `priorityOf`, `estimateOf`), `scripts/lib/github/discovery.mjs` (`estimateOf` scale), `scripts/lib/github/manifest.mjs`. Test: `issues.test.mjs`, `discovery.test.mjs`, `manifest.test.mjs`.

- [ ] Failing tests: an issue labeled `P1` reads `priority: 'high'`; `size: 3` reads `estimate: 3` (points); labels `S`/`M` give `estimate: 'M'` (sizes); two priority labels read the highest with the warning `<id> has several priority labels (P0, P2); pmkit reads urgent`; with a Project the maps are empty; discover's `estimate` is `{ unit: 'points', scale: ['1','2','3'] }`; the manifest reports estimation native with that scale.
- [ ] Implement; run; commit `feat: read priority and estimate from labels without a Project (PMK-339)`.

### Task 3: writes

**Files:** `scripts/lib/github/writes.mjs` (`planLabels`, `planFields`, `refuseMapped`). Test: `writes.test.mjs`, `issue-ops.test.mjs`.

- [ ] Failing tests: `updateIssue(id, { priority: 'urgent' })` swaps `P1` for `P0` in one `labelIds` update and no field write; `{ estimate: null }` removes the estimate label; `{ estimate: 4 }` with no label for 4 is `INVALID_INPUT` naming `1, 2, 3`; `{ labels: ['P0'] }` is `INVALID_INPUT` `label P0 holds a priority; use --priority`; create with priority and estimate sets both labels.
- [ ] Implement; run; commit `feat: write priority and estimate as labels without a Project (PMK-339)`.

### Task 4: setup

**Files:** `scripts/lib/github/mappings.mjs` (`proposeGithubSetup`), `scripts/pmkit.mjs` (flags, `parseMappingFlags`, `mappedLabelNames`, `hostedDraft`, `putMappings`, usage). Test: `mappings.test.mjs`, `cli-github-init.test.mjs`.

- [ ] Failing tests: without a Project and with `mappings.fields.priority` none, setup asks `mappings.priority.<level>` for each level, candidates the labels no status or type took, recommended by name (`P0`/`urgent`, `P1`/`high`, `P2`/`medium`, `P3`/`low`, without case and a `priority:` prefix); `--priority-label high=P1` answers it; `--estimate-label 3=size: 3` writes `mappings.estimate`; with a Project the flags are `INVALID_INPUT`; a label used twice is `INVALID_INPUT`.
- [ ] Implement; run; commit `feat: setup asks priority labels and takes estimate labels without a Project (PMK-339)`.

### Task 5: E2E and docs

**Files:** `scripts/runbook-setup-github.test.mjs` + `docs/runbooks/setup-github.md`; `scripts/runbook-issues-github.test.mjs` + `docs/runbooks/issues-github.md` (no-Project part); `commands/setup.md`; `README.md`; `CHANGELOG.md`; an ADR test `scripts/adr-github-labels.test.mjs` (ADR 0012 and the two glossary terms).

- [ ] Failing E2E steps first: setup without a Project with `--priority-label` answers and `--estimate-label`, the config holds them; issues create with `--priority high --estimate 3`, read back, update to urgent and clear the estimate, the fake's labels follow.
- [ ] Docs; run `npm test`, `npm run lint`; commit `docs: priority and estimate labels in setup, the runbooks and the README (PMK-339)`.
