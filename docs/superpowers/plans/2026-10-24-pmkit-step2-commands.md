# pmkit build step 2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make pmkit an installable Claude Code plugin: the GitHub git host, the CLI additions the commands need, the tracker format version with migrations, the changelog, a setup that runs again safely, the 23 commands plus `/pmkit:upgrade`, the routing skill and the marketplace entry.

**Architecture:** Library code stays in `scripts/lib/` and the CLI stays the only entry point the commands use. The GitHub git host is `scripts/lib/github/host.mjs`, a thin wrapper over `git` and `gh` with an injectable runner. Tracker format checks and migrations live in `scripts/lib/local/migrations.mjs`; a migration runs on a temporary copy of the tracker folder, so the dry run, the real run and the read path of an older format all go through the same code. Commands are Markdown procedures under `commands/`, and one routing skill maps natural-language requests to them.

**Tech Stack:** Node 18+ ES modules with no dependencies, `node:test`, `node:child_process` for `git` and `gh`.

**Spec:** `docs/superpowers/specs/2026-10-23-pmkit-design.md` (main spec) and `docs/superpowers/specs/2026-10-24-pmkit-upgrade-design.md` (upgrade design). The command flows come from `docs/superpowers/specs/2026-10-23-pmkit-mvp-skills.md`, a copy of the planning doc's "MVP skills" tab. Where that file and the main spec disagree, the main spec wins.

## Global Constraints

- Everything in the Global Constraints of `docs/superpowers/plans/2026-10-23-pmkit-core-local.md` still applies: Node 18+, no dependencies, no Node 20 APIs, `node:` imports, CRLF and BOM tolerated on read, `\n` on write, `path.join`, injected time and randomness, timestamps without milliseconds, the error codes, the YAML subset, exit codes 0 and 2.
- Work on a new branch `feat/pmkit-step2` created from `feat/pmkit-core`.
- Run tests from `pmkit/`: `npm test`. Every task ends with the whole suite green.
- Commits follow the repository style (`feat(pmkit): ...`, `test(pmkit): ...`, `docs(pmkit): ...`, `chore(pmkit): ...`) and end with the `Co-Authored-By:` line of the model that wrote them. Files under any `docs/` folder need `git add -f`, because the root `.gitignore` ignores `docs/`.
- Command names use the main spec's colon form: `/pmkit:issues:find`, never the MVP file's `/pmkit:issues-find`. Merged PRs are found by the explicit `pmkit pr sync` of the main spec, not by the MVP file's lazy check (MQ2).
- Commands never edit `.issues/` files by hand. The one exception is `/pmkit:local:doctor` resolving git conflict markers, file by file, after the user approves each edit (Task 13).
- Every CLI call in a command file is written as `node "${CLAUDE_PLUGIN_ROOT}/scripts/pmkit.mjs" <command> ... --json`.
- The plugin version for the first marketplace entry is `0.1.0`, and the tracker format stays `1`.
- Section headings, frontmatter keys and keywords that scripts parse stay in English.

## Review Focus

1. A repository whose `.issues/config.yaml` says `version: 2`, read by this CLI (format 1): `issues list` and `issues create` both exit 2 with `NOT_SUPPORTED` and the next step `/pmkit:upgrade`, and no file changes. Pinned in Task 5.
2. `migrate` with an uncommitted change under a tracker path that is not `.issues` (`tracker.path: tracker`): it refuses with `CONFLICT` and every file stays byte-identical. Pinned in Task 6.
3. `init --update` on a `.pmkit/config.yaml` with comments and hand-set values: every line it was not asked to change survives byte-for-byte, and a `.issues/.gitattributes` the user edited is never replaced unless `--replace` names it. Pinned in Task 8.
4. `gh` missing, or installed but not logged in: every `pr` command exits 2 with `NOT_CONFIGURED` or `AUTH` and a next step, never an `UNEXPECTED` error. `pr sync` where one PR lookup fails still moves the other merged issues and reports the failed one. Pinned in Task 2 and Task 3.
5. A `CHANGELOG.md` with CRLF line endings: `changelog --since 0.9.0` returns `0.10.0` (numeric comparison, not text) and leaves out `0.9.0` itself, oldest section first. Pinned in Task 7.

---

### Task 1: YAML line editor

**Files:**
- Create: `pmkit/scripts/lib/yaml-edit.mjs`
- Test: `pmkit/scripts/yaml-edit.test.mjs`

**Interfaces:**
- Produces: `setScalar(text: string, keyPath: string[], value: string | number | boolean | Array<string | number>): string` (an array is written as a flow list) and `addMapEntry(text: string, keyPath: string[], key: string, value: object): string`. Task 5 (version bump) and Task 8 (setup update) use them to change config files without losing comments.

- [ ] **Step 1: Write the failing tests**

```js
test('setScalar changes one value and keeps the comment on that line', () => {
  const text = 'version: 1\ngit_host:\n  system: none          # github | none\n  default_branch: main\n'
  assert.equal(setScalar(text, ['git_host', 'system'], 'github'),
    'version: 1\ngit_host:\n  system: github          # github | none\n  default_branch: main\n')
})
test('setScalar adds a missing key at the end of its parent block', () => {
  const text = 'git_host:\n  system: github\nwrite_policy:\n  confirm: none\n'
  assert.equal(setScalar(text, ['git_host', 'repo'], 'fred/app'),
    'git_host:\n  system: github\n  repo: fred/app\nwrite_policy:\n  confirm: none\n')
})
test('setScalar quotes a value the YAML subset would misread', () => {
  assert.equal(setScalar('a: 1\n', ['a'], '# x'), "a: '# x'\n")
})
test('setScalar writes an array as a flow list', () => {
  assert.equal(setScalar('estimate:\n  scale: [1, 2]\n', ['estimate', 'scale'], ['XS', 'S']), 'estimate:\n  scale: [XS, S]\n')
})
test('addMapEntry turns an empty flow map into a block map', () => {
  assert.equal(addMapEntry('members: {}\nauto_commit: false\n', ['members'], 'ana', { name: 'Ana', email: 'ana@x.io' }),
    'members:\n  ana: { name: Ana, email: ana@x.io }\nauto_commit: false\n')
})
test('addMapEntry appends after the last entry and refuses an existing key', () => {
  const text = 'members:\n  fred: { name: Fred }\n'
  assert.equal(addMapEntry(text, ['members'], 'ana', { name: 'Ana' }), 'members:\n  fred: { name: Fred }\n  ana: { name: Ana }\n')
  assert.throws(() => addMapEntry(text, ['members'], 'fred', { name: 'F' }), /already/)
})
test('every result parses with parseYaml', () => { /* round-trip each output above through parseYaml */ })
```

- [ ] **Step 2: Run them and see them fail**

Run: `node --test scripts/yaml-edit.test.mjs` from `pmkit/`.
Expected: FAIL, module not found.

- [ ] **Step 3: Implement both functions in `scripts/lib/yaml-edit.mjs`**

Work line by line on block maps indented by two spaces, the shape every pmkit config uses. Scalars and flow maps are written with `stringifyYaml` from `yaml.mjs` so quoting matches the writer. A missing parent block, or a key path that crosses a flow map, throws an `Error` naming the path.

- [ ] **Step 4: Run the suite**

Run: `npm test`
Expected: PASS.

- [ ] **Step 5: Commit**

`feat(pmkit): line editor for config files that keeps comments`

---

### Task 2: GitHub git host

**Files:**
- Create: `pmkit/scripts/lib/github/host.mjs`
- Test: `pmkit/scripts/github-host.test.mjs`

**Interfaces:**
- Produces: `createGithubHost({ root, env, exec? })` returning `{ currentBranch(), createBranch(name, { from }), push(branch), openPullRequest({ title, body, head, base, draft }), getPullRequest({ number } | { head }), prChecks(number), prReviews(number) }`. `exec(cmd: string, args: string[], { input?: string }) → { status: number, stdout: string, stderr: string }` defaults to `spawnSync` with `cwd: root`, `env`, `encoding: 'utf8'`. Task 3 uses it.
- The commands and flags per operation are the main spec's "GitHub git host" table, verbatim. `getPullRequest` returns `{ number, url, title, state, isDraft, headRefName, author, mergedAt }` or `null` when `gh` says no pull request exists. `openPullRequest` passes the body on stdin (`--body-file -`) and returns `getPullRequest({ head })`.

- [ ] **Step 1: Write the failing tests** with a fake `exec` that records calls and returns scripted results:
  - `getPullRequest({ head: 'iss-7k3q-retry' })` calls `gh pr view iss-7k3q-retry --json number,url,title,state,isDraft,headRefName,author,mergedAt` and returns the parsed object.
  - `getPullRequest` returns `null` when `gh` exits 1 with `no pull requests found for branch "x"` on stderr.
  - `openPullRequest({ title: 'T', body: 'B', head: 'h', base: 'main', draft: true })` calls `gh pr create --title T --body-file - --head h --base main --draft` with `input: 'B'`, then `gh pr view h --json ...`.
  - `exec` throwing `ENOENT` for `gh` becomes `PmkitError` `NOT_CONFIGURED` with the next step `Install the GitHub CLI (https://cli.github.com) and run gh auth login`.
  - stderr containing `gh auth login` becomes `AUTH` with the next step `gh auth login`; stderr containing `rate limit` becomes `RATE_LIMITED`; any other failure becomes `UPSTREAM` with the first stderr line in the message.
  - `createBranch('iss-7k3q-retry', { from: 'main' })` calls `git switch -c iss-7k3q-retry main`; `push('b')` calls `git push -u origin b`; `currentBranch()` trims `git branch --show-current`.

- [ ] **Step 2: Run them and see them fail**

Run: `node --test scripts/github-host.test.mjs`
Expected: FAIL, module not found.

- [ ] **Step 3: Implement `createGithubHost` in `scripts/lib/github/host.mjs`**

- [ ] **Step 4: Run the suite**

Run: `npm test`
Expected: PASS.

- [ ] **Step 5: Commit**

`feat(pmkit): GitHub git host over git and gh`

---

### Task 3: CLI for branches and pull requests

**Files:**
- Modify: `pmkit/scripts/pmkit.mjs` (command table, `ctx`)
- Test: `pmkit/scripts/cli-pr.test.mjs`
- Create: `pmkit/scripts/__fixtures__/fake-gh/gh` (executable Node script) for the CLI tests

**Interfaces:**
- Consumes: `createGithubHost` (Task 2), `branchName(id, title)` from `scripts/lib/ids.mjs`, the tracker's `getIssue`, `updateIssue`, `searchIssues`, `moveToCategory`.
- Produces: `ctx.host()` in `pmkit.mjs`, built from `createGithubHost({ root, env: ctx.env })`. With `git_host.system: none` it throws `NOT_SUPPORTED` with the next step `Set git_host.system to github in .pmkit/config.yaml, or run /pmkit:setup`. New commands:

| Command | Does | JSON |
|---|---|---|
| `issues branch <id> [--from b]` (write) | creates `branchName(id, title)` from `--from`, default `git_host.default_branch` or `main`, and records it on the issue with `updateIssue(id, { branch })` | `{ branch, before, after }` |
| `pr open --issue <id> [--draft] [--body-file f]` (write) | pushes the issue's `branch` and opens a PR to `git_host.default_branch` (default `main`); title `<issue title> (<ID>)`; body from `--body-file`, else `Tracker issue: <ID>` and the acceptance criteria as a task list | the PR from `getPullRequest` |
| `pr status [--branch b]` | the PR of `--branch` (default the current branch) with `checks` and `reviews` | `{ branch, pr: {...} \| null, checks, reviews }` |
| `pr sync` (write) | for every `in_review` issue with a `branch`, moves it to `done` when its PR has `mergedAt` | `{ checked, moved: [{ id, pr }], problems: [{ id, code, message }] }` |

- An issue without `branch` in `pr open` fails with `INVALID_INPUT` and the next step `pmkit issues branch <id>`.
- `--dry-run` on `issues branch` and `pr open` runs no `git` or `gh` command that changes anything, and returns what it would do (`{ branch, from }`; `{ title, body, head, base, draft }`). On `pr sync` it asks GitHub and returns the moves without writing.
- The commit message for `pr sync` lists the moved ids; with nothing moved there is no commit.
- A failed lookup inside `pr sync` goes to `problems` and the loop continues.

- [ ] **Step 1: Write the failing tests.** The fake `gh` reads canned responses from the JSON file named by `PMKIT_FAKE_GH` (args joined by a space → `{ status, stdout, stderr }`). Tests put its folder first on `PATH` in the `env` they pass to `run`, on a repo from `makeRepo('team')` with `git init`. Cases:
  - `pr sync` moves an `in_review` issue whose PR has `mergedAt`, leaves one whose PR is open, reports one whose lookup fails with `UPSTREAM` in `problems`, and the moved issue's last event has `field: 'status'` and `by` the current actor.
  - `pr sync --dry-run` leaves `hashTree` of the repo unchanged.
  - Any `pr` command with `git_host.system: none` exits 2 with `NOT_SUPPORTED`.
  - Any `pr` command with `PATH` that has no `gh` exits 2 with `NOT_CONFIGURED`, and with the fake answering `gh auth login` on stderr exits 2 with `AUTH`.
  - `issues branch ISS-XXXX --dry-run` prints the branch name `branchName` gives and creates no git branch.
  - `pr open --issue <id without branch>` exits 2 with `INVALID_INPUT`.

- [ ] **Step 2: Run them and see them fail**

Run: `node --test scripts/cli-pr.test.mjs`
Expected: FAIL, unknown command `pr sync`.

- [ ] **Step 3: Add the four commands to `COMMANDS` and `ctx.host()` in `pmkit.mjs`**

- [ ] **Step 4: Run the suite**

Run: `npm test`
Expected: PASS.

- [ ] **Step 5: Commit**

`feat(pmkit): issues branch, pr open, pr status and pr sync`

---

### Task 4: CLI gaps the commands need

**Files:**
- Modify: `pmkit/scripts/pmkit.mjs`
- Test: `pmkit/scripts/cli.test.mjs` (add cases)

**Interfaces:**
- Consumes: the tracker's `createIssue` (already accepts `milestone`), `listStatusUpdates(epicId)`, `readDocument(path)`, `createDocument(path, body, actor, { dryRun })`.
- Produces:

| Command | Needed by |
|---|---|
| `issues create ... --milestone m` | `/pmkit:spec:import` (MVP file line 203) |
| `epic updates <id>` → status updates newest first | `/pmkit:report:status` reads events since the last update (line 227) |
| `docs read <path>` → `{ path, body }` | `/pmkit:spec:import` (lines 207-208) |
| `docs create <path> --body-file f` (write) | `/pmkit:cycle:close` writes the retro (line 262) |

- [ ] **Step 1: Write the failing tests:** `issues create --title T --milestone M1 --json` returns `after.milestone === 'M1'`; `epic updates <id> --json` on the team fixture returns updates newest first; `docs create retros/2026-11-15.md --body-file -` with stdin, then `docs read retros/2026-11-15.md --json` returns the same body; `docs create` with `--dry-run` writes nothing; `docs read ../x.md` exits 2 with `INVALID_INPUT`.

- [ ] **Step 2: Run them and see them fail**

Run: `node --test scripts/cli.test.mjs`
Expected: FAIL on the new cases.

- [ ] **Step 3: Add the flag and the three commands**

- [ ] **Step 4: Run the suite**

Run: `npm test`
Expected: PASS.

- [ ] **Step 5: Commit**

`feat(pmkit): milestone on create, epic updates, docs read and create`

---

### Task 5: Tracker format version

**Files:**
- Create: `pmkit/scripts/lib/local/migrations.mjs`
- Modify: `pmkit/scripts/lib/config.mjs`, `pmkit/scripts/lib/validate.mjs`, `pmkit/scripts/lib/local/tracker.mjs`, `pmkit/scripts/pmkit.mjs`
- Test: `pmkit/scripts/migrations.test.mjs`

**Interfaces:**
- Produces, in `migrations.mjs`:
  - `FORMAT_VERSION = 1` and `MIGRATIONS = []`. A migration is `{ from: number, to: number, describe: string, run(dir: string): void }`, where `run` edits the tracker files under `dir` in place.
  - `formatState(version: unknown, current = FORMAT_VERSION) → 'current' | 'behind' | 'ahead'`. A missing or non-integer version throws `INVALID_INPUT`.
  - `planMigration({ root, trackerPath, from, to, migrations = MIGRATIONS }) → { from, to, steps: [{ from, to, describe, changes: [{ path, action }] }], dir }`. It copies the tracker folder to a fresh `fs.mkdtempSync` folder, runs each step there, and after each step sets `version` in the copy's `config.yaml` with `setScalar` (Task 1). `changes` compares the copy before and after the step: `action` is `create`, `change` or `delete`, `path` is relative to `root` with `/`. A gap in the chain throws `NOT_SUPPORTED`.
  - `migratedCopy(opts)` → the `dir` of `planMigration`, for reads.
- `loadConfig(root, { formatVersion = FORMAT_VERSION, migrations = MIGRATIONS } = {})` checks `formatState` before `withLocalDefaults` and returns `format: { state, version, current }` next to `pmkit`, `local`, `root`, `issuesDir`:
  - `ahead` throws `NOT_SUPPORTED`, message `this repository uses tracker format N, this pmkit reads up to format M`, next step `/pmkit:upgrade`.
  - `behind` loads `local` from `migratedCopy` and sets `readDir` to the copy's path. `createLocalTracker` reads from `readDir` when present, and its `requireWriter` throws `NOT_SUPPORTED`, message `this repository uses tracker format N, this pmkit writes format M`, next step `/pmkit:upgrade`, before any other write check.
- `validateLocalConfig` no longer checks `version`. `validateRepo` reports a format other than `FORMAT_VERSION` as one problem, code `FORMAT`, with the message of the matching error above.

- [ ] **Step 1: Write the failing tests** (lib level, with injected `formatVersion` and `migrations`):
  - `formatState(1)`, `formatState(1, 2)`, `formatState(3, 2)` give `current`, `behind`, `ahead`; `formatState('1')` throws.
  - A test migration 1→2 that renames `issues/*/events.jsonl` lines' `op: "log_time"` to `op: "time"`: `planMigration` lists one `change` per touched `events.jsonl` plus `.issues/config.yaml`, the copy's config says `version: 2`, a comment in the original config is still in the copy, and the original tree's `hashTree` is unchanged.
  - A chain 1→2 with `to: 3` throws `NOT_SUPPORTED`.
  - `loadConfig` with `formatVersion: 2` and that migration: a tracker from the result reads issues in the new shape, and `createIssue` throws `NOT_SUPPORTED` naming `/pmkit:upgrade`.
  - CLI, real constants: a `makeRepo('basic')` whose config says `version: 2`: `issues list --json` and `issues create --title X --json` both exit 2 with `NOT_SUPPORTED` and `nextStep: '/pmkit:upgrade'`, and `hashTree` is unchanged (Review Focus 1). `validate --json` reports one `FORMAT` problem.

- [ ] **Step 2: Run them and see them fail**

Run: `node --test scripts/migrations.test.mjs`
Expected: FAIL, module not found.

- [ ] **Step 3: Implement `migrations.mjs` and wire `loadConfig`, `validateRepo`, `createLocalTracker`**

Remove the temporary copy when the process exits (`process.once('exit', ...)` with `fs.rmSync(dir, { recursive: true, force: true })`).

- [ ] **Step 4: Run the suite**

Run: `npm test`
Expected: PASS, including every existing test.

- [ ] **Step 5: Commit**

`feat(pmkit): tracker format version, read older formats, refuse newer ones`

---

### Task 6: `migrate`

**Files:**
- Modify: `pmkit/scripts/pmkit.mjs`, `pmkit/scripts/lib/local/migrations.mjs`
- Test: `pmkit/scripts/migrations.test.mjs` (add cases)

**Interfaces:**
- Consumes: `planMigration` (Task 5).
- Produces: `loadConfig(root, { checkFormat: false })`, which skips the format check so `migrate` can read `tracker.path` and the declared version of any format. `applyMigration(plan, { root }) → void`, which copies every `create` and `change` from `plan.dir` into the real tracker folder with `writeFileAtomic` and removes every `delete`. New CLI command `migrate [--dry-run]` (write, no `--as` needed), skipping the format check in `loadConfig` and reading the files as the format they declare. Its JSON is the design's shape: `{ from, to, steps: [{ from, to, changes: [{ path, action }] }] }`, plus `commit` with the message when `auto_commit` committed. Nothing to do gives `from === to` and `steps: []`.
- Checks, in this order: `git rev-parse --is-inside-work-tree` fails or `git` is missing → `NOT_CONFIGURED`, next step `migrate needs a git repository: git history is the only way back from a migration`; `git status --porcelain -- <tracker.path>` not empty → `CONFLICT`, next step `Commit or discard the changes under <tracker.path> first`. With `auto_commit: true` the commit message is `pmkit: migrate tracker format <from> to <to>` (not the generic `pmkit: <command> <id>`).
- Tests reach `migrate` through an exported `runMigrate(root, { dryRun, formatVersion, migrations })` that the command calls with the real constants.

- [ ] **Step 1: Write the failing tests:** with the test migration of Task 5, `runMigrate(..., { dryRun: true })` returns the plan and leaves `hashTree` unchanged; the real run makes the tree equal to the dry run's copy; a repo with `tracker.path: tracker` and an uncommitted change under `tracker/` throws `CONFLICT` with the tree unchanged (Review Focus 2); a folder with no `.git` throws `NOT_CONFIGURED`; `auto_commit: true` creates one commit with the message above; CLI `migrate --json` on `basic` returns `{ from: 1, to: 1, steps: [] }`.

- [ ] **Step 2: Run them and see them fail**

Run: `node --test scripts/migrations.test.mjs`
Expected: FAIL on the new cases.

- [ ] **Step 3: Implement `applyMigration`, `runMigrate` and the command**

- [ ] **Step 4: Run the suite**

Run: `npm test`
Expected: PASS.

- [ ] **Step 5: Commit**

`feat(pmkit): migrate with a dry run, a clean-tree check and its own commit`

---

### Task 7: Changelog

**Files:**
- Create: `pmkit/CHANGELOG.md`, `pmkit/scripts/lib/changelog.mjs`
- Modify: `pmkit/scripts/pmkit.mjs`, `pmkit/scripts/plugin.test.mjs`
- Test: `pmkit/scripts/changelog.test.mjs`

**Interfaces:**
- Produces: `parseChangelog(text) → [{ version, date, body, trackerFormat: number | null, setup: string[] }]` in file order; `compareVersions(a, b) → -1 | 0 | 1` on `MAJOR.MINOR.PATCH`; `sectionsSince(sections, version)` → the sections newer than `version`, oldest first. CLI `changelog --file <path> --since <version>` prints them; `--json` gives the array. The file format is the upgrade design's "Changelog" section, verbatim: `## <version> - <YYYY-MM-DD>`, a Markdown list, then optional `Tracker format: N` and `Setup: <reason>` lines. `body` is the section's text without those two kinds of lines.
- `CHANGELOG.md` starts with `# Changelog` and one section `## 0.1.0 - <the date this task runs>` listing what the first release ships in plain words: the Local tracker, the GitHub git host, the commands, `/pmkit:upgrade`. No `Tracker format:` line.

- [ ] **Step 1: Write the failing tests:**
  - `compareVersions('0.10.0', '0.9.0') === 1`.
  - A CRLF changelog with sections 0.10.0, 0.9.0, 0.8.1: `sectionsSince(parsed, '0.9.0')` returns only 0.10.0; `sectionsSince(parsed, '0.8.1')` returns 0.9.0 then 0.10.0 (Review Focus 5).
  - A section with `Tracker format: 2` and two `Setup:` lines gives `trackerFormat: 2` and both reasons, and `body` has neither line.
  - In `plugin.test.mjs`: `CHANGELOG.md` has a section for the version in `plugin.json`; the newest `Tracker format:` line equals `FORMAT_VERSION`, or there is none while `FORMAT_VERSION` is 1.
  - CLI: `changelog --file CHANGELOG.md --since 0.0.0 --json` returns the 0.1.0 section.

- [ ] **Step 2: Run them and see them fail**

Run: `node --test scripts/changelog.test.mjs scripts/plugin.test.mjs`
Expected: FAIL, module not found.

- [ ] **Step 3: Implement `changelog.mjs`, the command and `CHANGELOG.md`**

- [ ] **Step 4: Run the suite**

Run: `npm test`
Expected: PASS.

- [ ] **Step 5: Commit**

`feat(pmkit): changelog with tracker format and setup lines`

---

### Task 8: Setup runs again

**Files:**
- Modify: `pmkit/scripts/pmkit.mjs` (`runInit`)
- Create: `pmkit/scripts/lib/diff.mjs`
- Test: `pmkit/scripts/cli-init.test.mjs`

**Interfaces:**
- Consumes: `setScalar`, `addMapEntry` (Task 1).
- Produces: `lineDiff(before: string, after: string) → string`, unified-style lines prefixed `-`, `+` or two spaces, from a longest-common-subsequence match. `init` gains, on first run and with `--update`:
  - `--estimate-unit points|hours|sizes` (sets `estimate.unit`; `sizes` also sets `estimate.scale` to `[XS, S, M, L, XL]`, and `hours` leaves the scale alone because hours accept any finite number **(plan's call)**);
  - `--members-file f` (YAML map `id: { name, email }`, `-` for stdin), every member added with `addMapEntry`; on `--update` an id already present is left as it is and listed in `kept`.
- `init --update [--git-host h] [--estimate-unit u] [--members-file f] [--replace path ...] [--dry-run]` needs an existing `.pmkit/config.yaml` (else `INVALID_INPUT`, next step `run init without --update`) and refuses `--prefix` (`INVALID_INPUT`: `id_prefix cannot change after setup`). It changes only the lines its flags name, with `setScalar` and `addMapEntry`. For each file `init` copies from `templates/`: missing → `create`; equal to the template → `keep`; different → `differs` with `diff`, replaced only when `--replace <path>` names it, then `replace`.
- JSON: `{ dryRun, files: [{ path, action, diff? }], kept: [memberId] }`, `action` one of `create`, `change`, `replace`, `differs`, `keep`. `change` and `replace` carry `diff` too.

- [ ] **Step 1: Write the failing tests:**
  - `lineDiff('a\nb\n', 'a\nc\n')` returns `'  a\n-b\n+c\n'`.
  - First run with `--estimate-unit hours --members-file -` (two members on stdin) writes both members and `unit: hours`.
  - `--update --git-host github` on a repo whose `.pmkit/config.yaml` has comments and `confirm: none`: only the `system:` line changes, byte-for-byte elsewhere (Review Focus 3).
  - A hand-edited `.issues/.gitattributes` comes back `differs` with a diff and stays unchanged; with `--replace .issues/.gitattributes` it is replaced.
  - `--update --dry-run` leaves `hashTree` unchanged; `--update --prefix ABC` exits 2.

- [ ] **Step 2: Run them and see them fail**

Run: `node --test scripts/cli-init.test.mjs`
Expected: FAIL.

- [ ] **Step 3: Implement `lineDiff` and the new `init` paths**

- [ ] **Step 4: Run the suite**

Run: `npm test`
Expected: PASS.

- [ ] **Step 5: Commit**

`feat(pmkit): init --update keeps answers and comments and shows diffs`

---

### Task 9: Command conventions and structure tests

**Files:**
- Create: `pmkit/skills/pmkit/references/conventions.md`
- Modify: `pmkit/scripts/plugin.test.mjs`

**Interfaces:**
- Produces: the shape every command file follows, which Tasks 10-13 rely on:
  - Frontmatter: `description` (one sentence, what it does), `argument-hint`, `disable-model-invocation: true`.
  - Body: `# <Title>`, `Arguments: \`$ARGUMENTS\``, then `## Parameters`, `## Steps`, `## Confirmation points`, `## Output`, `## If something is missing`, in that order. These merge the runbooks command shape with the MVP file's skill shape (lines 36-65).
  - Line 2 of `## Steps` reads `Read \`${CLAUDE_PLUGIN_ROOT}/skills/pmkit/references/conventions.md\` first.`
- `conventions.md` holds what every command applies, so no command repeats it: the six rules of the MVP file (lines 55-62); the main spec's "Write policy" section, verbatim; how to show a write (run it with `--dry-run --json`, show `before` → `after` field by field, ask with `AskUserQuestion` per `write_policy.confirm`, run it again without `--dry-run`); how to read `--json` errors (`error.code`, `error.message`, `error.nextStep`, exit 2) and show the next step; the issue table columns (ID, title, status, assignee, estimate); that commands never edit `.issues/` by hand.
- Tests added to `plugin.test.mjs`, data-driven so later tasks only extend the lists:
  - `COMMANDS = { '': [...], issues: [...], spec: [...], backlog: [...], report: [...], cycle: [...], team: [...], local: [...] }`, starting empty and filled by Tasks 10-13.
  - every file under `commands/**` has the frontmatter keys, `disable-model-invocation: true`, and the six headings in order;
  - every `pmkit.mjs" <words>` in a command file names a command in `COMMANDS` of `pmkit.mjs` (imported), so a typo like `issues show` fails;
  - every command is listed in `skills/pmkit/SKILL.md` and `README.md` (enabled in Task 14; skip while the skill file does not exist).

- [ ] **Step 1: Write the tests** and run them: they pass with no command files.
- [ ] **Step 2: Write `conventions.md`.**
- [ ] **Step 3: Run the suite.** Expected: PASS, including the `${CLAUDE_PLUGIN_ROOT}` path test.
- [ ] **Step 4: Commit** `docs(pmkit): command conventions and command structure tests`

---

### Tasks 10-13: The command files

Each of these tasks writes command files, adds their names to `COMMANDS` in `plugin.test.mjs`, runs `npm test`, and commits `feat(pmkit): <group> commands`. The flow of each command (inputs, steps, confirmation points, output, edge cases) comes from the MVP file section named in the table; the CLI calls come from the main spec's Commands table plus the commands this plan adds. A step that the MVP file describes but no CLI command performs is done by the command on the `--json` output (sorting, filtering by missing fields) and says so in its `## Steps`.

#### Task 10: Setup, help and upgrade

| File | Command | MVP file | CLI calls |
|---|---|---|---|
| `commands/setup.md` | `/pmkit:setup` | lines 69-82 | `init --dry-run`, `init`, `init --update --dry-run`, `init --update`, `validate`, `discover`, `capabilities` |
| `commands/help.md` | `/pmkit:help [capability or text]` | lines 121-133 | `capabilities`; reads `README.md`, `CONTEXT.md` and the command files under `${CLAUDE_PLUGIN_ROOT}` |
| `commands/upgrade.md` | `/pmkit:upgrade` | upgrade design, "The flow" | `changelog --file <marketplace copy>/pmkit/CHANGELOG.md --since <installed>` with the installed CLI; `migrate --dry-run --json` and `migrate` with the new install's CLI |

- Setup, first run: detect the GitHub remote (`git remote get-url origin`) and `gh auth status`; ask only the ID prefix, the estimate unit (default points, MQ4 line 379) and the members, prefilled from `git log --format='%aN|%aE'` and passed as `--members-file -`; show one summary and write after approval. No remote: run with `--git-host none` and name the commands that lose features (`issues:work`, `issues:mine`, `issues:pause`, `report:status`, `cycle:close`, `team:standup`).
- Setup, existing config: `validate` first, then `init --update --dry-run`, show each `change` and `differs` diff, ask per `differs` file, then `init --update` with `--replace` for the approved ones. Never `init` without `--update` when a config exists.
- Upgrade: follow the upgrade design's six steps. Reuse the procedure of `runbooks/commands/upgrade.md` for finding installs, `--plugin-dir` sessions and `shownCommand` (copy it, adapted, since plugins install independently). Never pass `-y`. Step 6 prints `/reload-plugins` for Claude Code, plus "restart Claude Code if the new commands do not show" **(plan's call: the design asks the builder to check this; the builder runs `/reload-plugins` after a local `claude plugin update` and replaces the fallback line with what it observed)**; `codex plugin marketplace upgrade fredsvanelli` and a restart when `codex` is on `PATH`; for OpenCode when `opencode` is on `PATH`, the line `pmkit for OpenCode arrives with build step 3`. Then each `Setup:` reason with `/pmkit:setup`.
- Add to `plugin.test.mjs`: `upgrade.md` contains `--accept-command`, `migrate --dry-run` and `/reload-plugins`, and does not match `/\s-y\b/`.

#### Task 11: Issue basics

| File | Command | MVP file | CLI calls |
|---|---|---|---|
| `commands/issues/find.md` | `/pmkit:issues:find <question>` | lines 84-95 | `issues list` with flags from the question, shown in one line before running |
| `commands/issues/create.md` | `/pmkit:issues:create` | lines 97-109 | `issues create --dry-run`, then without |
| `commands/issues/update.md` | `/pmkit:issues:update <id>` | lines 97-109 | `issues update` |
| `commands/issues/move.md` | `/pmkit:issues:move <id> <category>` | lines 97-109 | `issues move` |
| `commands/issues/assign.md` | `/pmkit:issues:assign <id> <member>` | lines 97-109 | `issues assign` |
| `commands/issues/comment.md` | `/pmkit:issues:comment <id>` | lines 97-109 | `issues comment --body-file -` |
| `commands/issues/link.md` | `/pmkit:issues:link <from> <to>` | lines 97-109 | `issues link` (with `--remove` to unlink), `issues parent` |
| `commands/issues/summary.md` | `/pmkit:issues:summary <id>` | lines 111-119 | `issues get --comments --history` |

#### Task 12: Dev workflow

| File | Command | MVP file | CLI calls |
|---|---|---|---|
| `commands/issues/work.md` | `/pmkit:issues:work [id]` | lines 137-153 | `issues get`, `issues assign`, `issues move`, `issues branch`, `pr open`, `issues comment`, `issues create` |
| `commands/issues/mine.md` | `/pmkit:issues:mine` | lines 155-162 | `pr sync`, `issues list --assignee me`, `pr status` |
| `commands/issues/capture.md` | `/pmkit:issues:capture` | lines 164-171 | `issues list --text` (duplicates), `issues create` |
| `commands/issues/breakdown.md` | `/pmkit:issues:breakdown <id>` | lines 173-179 | `issues create --parent` per sub-issue (bulk preview), `issues link` |
| `commands/issues/progress.md` | `/pmkit:issues:progress [id]` | lines 181-187 | `issues comment`, `issues log-time`, `issues update --check` |
| `commands/issues/pause.md` | `/pmkit:issues:pause [id]` | lines 189-195 | `issues comment`, `issues move`, `issues assign`, `pr open --draft` |

- `issues:work` uses `issues branch` where the MVP file creates a branch (line 143), and leaves the move to `done` to `pr sync` (main spec, "GitHub git host").
- `issues:mine` sorts the `--json` output itself: `in_progress` first, then priority, due date, unblocked first (line 158).

#### Task 13: PM, EM and local commands

| File | Command | MVP file | CLI calls |
|---|---|---|---|
| `commands/spec/import.md` | `/pmkit:spec:import <file>` | lines 199-211 | `docs read`, `epic create`, `issues create --milestone`, `issues link` (bulk preview) |
| `commands/backlog/groom.md` | `/pmkit:backlog:groom` | lines 213-223 | `issues list`, `events`, `issues update`, `issues link --kind duplicate`, `issues move canceled` |
| `commands/report/status.md` | `/pmkit:report:status <epic>` | lines 225-236 | `pr sync`, `epic progress`, `epic updates`, `events`, `epic update-status` |
| `commands/cycle/plan.md` | `/pmkit:cycle:plan` | lines 240-253 | `metrics velocity`, `cycle capacity`, `issues list`, `cycle open`, `cycle add` |
| `commands/cycle/close.md` | `/pmkit:cycle:close` | lines 255-265 | `pr sync`, `cycle issues`, `events`, `metrics cycle-time`, `cycle close`, `cycle add`, `docs create` |
| `commands/team/standup.md` | `/pmkit:team:standup` | lines 267-275 | `pr sync`, `events --since`, `issues list`, `pr status` |
| `commands/local/doctor.md` | `/pmkit:local:doctor` | lines 279-291 | `validate`, `issues update` for fixes |

- `backlog:groom` finds issues with no estimate, no acceptance criteria or no parent in the `--json` output.
- `cycle:plan` computes the start after the last sprint and each member's capacity from availability and days off itself, then passes `cycle open --start` and `cycle capacity --set member=n`.
- `local:doctor` resolves git conflict markers by editing the conflicted file, one file at a time, after showing both sides and getting the user's approval, then runs `validate` again. This is the only hand edit any command makes. Drift needs no fix: the next write records it. Duplicate IDs and a cache rebuild are reported with the manual step; reassigning IDs and `reindex` wait for phase 2.

---

### Task 14: Routing skill, README, marketplace and glossary

**Files:**
- Create: `pmkit/skills/pmkit/SKILL.md`, `pmkit/docs/adr/0004-tracker-format-version-and-one-way-migrations.md`
- Modify: `pmkit/README.md`, `pmkit/CONTEXT.md`, `pmkit/scripts/plugin.test.mjs`, `.claude-plugin/marketplace.json`, `README.md` (repository root)

**Interfaces:**
- `SKILL.md`: frontmatter `name: pmkit` and a trigger-focused `description` (issues, sprints, epics, backlog, standup, status report in a repository with `.pmkit/config.yaml`). Body: one line that each command file holds the full procedure, then a table `Request | Command | File` for all 24 commands, files as `${CLAUDE_PLUGIN_ROOT}/commands/...`, like `runbooks/skills/runbooks/SKILL.md`.
- Marketplace entry: `{ "name": "pmkit", "source": "./pmkit", "description": "Project management for development agents: issues, sprints and epics kept in the repository." }`. Root README: a table row and `claude plugin install pmkit@fredsvanelli` in Install.
- `pmkit/README.md`: replace the "not installable yet" paragraph with install lines and the command list, one line per command.
- `CONTEXT.md`: add **Tracker format** and **Migration**, in the existing `**Term**:` style; add both to `TERMS` in `plugin.test.mjs`.
- ADR 0004 records the upgrade design's "Tracker format and migrations" decisions: one integer version in `.issues/config.yaml`, one-way steps, older formats read through a migrated copy, newer formats refused, no automatic migration.
- Tests: enable the listing test of Task 9; add one that `../.claude-plugin/marketplace.json` has the pmkit entry with `source: './pmkit'`, and one that `skills/pmkit/SKILL.md` has `name` and `description`.

- [ ] **Step 1: Enable and add the tests; run them and see them fail.**
- [ ] **Step 2: Write the files.**
- [ ] **Step 3: Run the suite.** Expected: PASS.
- [ ] **Step 4: Commit** `docs(pmkit): routing skill, README, marketplace entry, glossary and ADR 0004` (`git add -f pmkit/docs/adr/0004-*`).

---

### Task 15: Bring the main spec up to date

**Files:**
- Modify: `docs/superpowers/specs/2026-10-23-pmkit-design.md` (git-ignored, not committed, like the spec itself)

The upgrade design's "Changes to the main spec" section, plus what this plan added:
- Commands table: add `/pmkit:upgrade` (`commands/upgrade.md`, calls `changelog`, `migrate`); `issues:work` calls `issues branch` instead of `issues update --branch`; `spec:import` calls `docs read`; `report:status` calls `epic updates`; `cycle:close` calls `docs create`.
- CLI table: add `issues branch`, `epic updates`, `docs read`, `docs create`, `migrate [--dry-run]`, `changelog --file f --since v`, `init --update`, and `--milestone` on `issues create`.
- Local tracker section: the format rules from the upgrade design.
- Setup: runs again through `init --update`.
- Open questions: mark the plugin version `0.1.0` as decided.

No test. Check that every command in the Commands table has a file under `pmkit/commands/` and every CLI row a command in `pmkit.mjs`.
