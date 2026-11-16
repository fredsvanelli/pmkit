# link-repo Command Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `pmkit link-repo` writes the git host and the Linear team to `.pmkit/config.yaml`, inferring the git host from the git remote.

**Architecture:** A pure module parses remotes and chooses one. A CLI command in `scripts/pmkit.mjs` builds the new config text with `yaml-edit.mjs`, validates it, and writes only on a real run. A command file wraps it with one confirmation.

**Tech Stack:** Node ESM, `node:test`, git through `spawnSync`.

**Spec:** `docs/superpowers/specs/2026-10-31-pmk-53-link-repo-design.md`

## Global Constraints

- Every commit message carries `(PMK-53)` and ends with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- The file keeps its comments and key order. Only `setScalar` and `removeKey` edit it.
- Git reads use a timeout and a large `maxBuffer`. An unreadable remote list is "unknown", never "no remote".
- Hosts: `github` or `none`. No change to the Local tracker store, `SERVED_BY` or the ADR-0001 counts.
- Keep edits to `README.md`, `CHANGELOG.md`, `skills/pmkit/SKILL.md`, `scripts/lib/args.mjs` and scenario counts small.

## Review Focus

- A remote with a port, a user, a trailing slash or no `.git`: the repo still reads `owner/name`.
- `origin` missing with several remotes: nothing is inferred and the user is told how to choose.
- Git unreadable (not a repository): the file does not change.
- Invalid `.pmkit/config.yaml`: dry run and write both refuse and leave the file as it was.
- Linear team that breaks the mappings: refused, sent to `/pmkit:setup`.

---

### Task 1: Remote parsing and inference

**Files:** Create `scripts/lib/git-remote.mjs`, `scripts/git-remote.test.mjs`.

**Interfaces:**
- Produces `parseRemoteUrl(url: string): { host: string, owner: string, name: string } | null`.
- Produces `chooseRemote(remotes: {name, url}[], wanted?: string): { remote: {name, url}|null, state: 'chosen'|'none'|'ambiguous'|'unknown-name', notes: string[] }`.
- Produces `inferHost(url): { system: 'github'|'none'|null, repo: string|null, host: string|null }`.

- [ ] Write tests: https with and without `.git` and trailing slash, `git@github.com:o/r.git`, `ssh://git@github.com:22/o/r.git`, `git://`, uppercase host, garbage URL gives null, `www.github.com`, gitlab gives `none`, GHE host gives `none`; `chooseRemote` for origin among several, one non-origin remote, several without origin (ambiguous), none, `wanted` unknown.
- [ ] Run `node --test scripts/git-remote.test.mjs`, expect FAIL (module missing).
- [ ] Implement the three functions.
- [ ] Run again, expect PASS. Commit.

### Task 2: yaml-edit removeKey

**Files:** Modify `scripts/lib/yaml-edit.mjs`, `scripts/yaml-edit.test.mjs`.

**Interfaces:** Produces `removeKey(text: string, keyPath: string[]): string`. A missing key returns the text unchanged. A key that holds a block removes the block. Comments on other lines stay.

- [ ] Write tests: removes a scalar line, keeps neighbors and comments, missing key is a no-op, CRLF input.
- [ ] Run, expect FAIL. Implement with `walk` and `block`. Run, expect PASS. Commit.

### Task 3: The CLI command

**Files:** Modify `scripts/pmkit.mjs` (new entry in `COMMANDS`, `runLinkRepo`), create `scripts/cli-link-repo.test.mjs`.

**Interfaces:** `link-repo` with flags `git-host`, `repo`, `remote`, `team`, `dryRun: true`, `exempt: true`, no args. Output shape as in the spec "Output".

- [ ] Tests (Local, in a temp git repo made from a fixture copy): origin https and ssh forms infer `github` and `owner/name`; gitlab remote infers `none` and removes `git_host.repo`; no remote leaves the file and notes it; not a git repository leaves the file and notes it; two remotes without origin is ambiguous and `--remote` resolves it; `--git-host` and `--repo` override the remote; `--repo` with `--git-host none` fails; `--team` on Local fails; dry run writes nothing and `notes` is in the JSON; real run keeps comments and key order; unchanged config says "already linked"; invalid config refuses on dry run and on write; missing config is `NOT_CONFIGURED`; CRLF file.
- [ ] Tests (Linear, with `fakeLinearFetch`): `--team ACME` valid is written; unknown team is `INVALID_INPUT` with the list; no team in file and one viewer team is applied; broken mappings are listed in `broken` and the real run refuses without writing; discovery `AUTH` error writes nothing.
- [ ] Run, expect FAIL. Implement `runLinkRepo`: load with `loadPmkitConfig`, refuse on `pmkitProblems` with `pmkitWriteRefusal`, read remotes, resolve values, edit text, `pmkitConfigRefusal`, adapter `configProblems`, write on real run. Run, expect PASS. Commit.

### Task 4: Command file, scenario, docs and counts

**Files:** Create `commands/link-repo.md`, `scripts/__scenarios__/link-repo.mjs` and its snapshot. Modify `scripts/scenarios.test.mjs`, `scripts/scenarios-live.mjs`, `scripts/plugin.test.mjs` (`COMMANDS`), `README.md`, `skills/pmkit/SKILL.md`, `CHANGELOG.md` (top of `## Unreleased`).

- [ ] Write the command file with the difference from `/pmkit:setup`, one confirmation always asked, and the error rules.
- [ ] Add the scenario, update the counts, the README table, the skill table and the CHANGELOG line.
- [ ] Run `npm test`, expect PASS. Commit.

### Task 5: Delivery

- [ ] Mark both acceptance criteria with `issues update PMK-53 --check <n>` (dry run, then real), commit `.issues/`, run `npm test`, open the PR, comment, move to `in_review`.
