# PMK-9 Golden Outputs Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Record the full output of every CLI command on four fixture repositories as checked-in golden files, and fail `npm test` on any difference.

**Architecture:** One test file, `scripts/goldens.test.mjs`, holds the `FIXTURES` and `CASES` maps. It runs each case as a child process on a fresh copy of the fixture, builds a text transcript and compares it with `scripts/__goldens__/<fixture>/<command>.txt`. Pure helpers live in `scripts/golden-helpers.mjs` so they have their own unit tests. `UPDATE_GOLDENS=1` rewrites the goldens.

**Tech Stack:** Node 18+ ES modules, `node:test`, `node:assert`, `node:child_process`, `node:fs`. No dependencies (ADR-0003).

**Spec:** `docs/superpowers/specs/2026-10-25-pmk-9-golden-outputs-design.md`. Read it whole before starting. Also read `CONTEXT.md` and `docs/adr/0002-commands-are-the-source-for-every-agent.md` and `0003-no-dependencies.md`.

## Global Constraints

- Issue PMK-9 (epic EPC-1). Every commit message carries `(PMK-9)`. Nothing is pushed, no branch is switched, nothing under `.issues/` is edited by hand.
- Every commit ends with the trailer `Co-Authored-By: Claude <model of the implementer> <noreply@anthropic.com>`, naming the model that made that commit (for example `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`).
- Do not edit `CHANGELOG.md`, `package.json`, `scripts/pmkit.mjs` (except a sort fix, see Task 3), or the fixtures `basic`, `team` and `broken`.
- Goldens are never edited by hand. They come only from `UPDATE_GOLDENS=1 node --test scripts/goldens.test.mjs`.
- Code, comments, specs and commits are in English. Tests that create temporary directories remove them in `finally`.
- **Fixtures**, all in `scripts/__fixtures__/` (PMK-10 reuses them):
  - `basic` is the empty repository (existing, unchanged).
  - `team` is the small team (existing, unchanged).
  - `messy-merge` is new. `.issues/config.yaml` has `id_style: numbered` and `id_prefix: ISS`. `.pmkit/config.yaml` has `git_host.system: none`. IDs are `ISS-1` to `ISS-8` and `EPC-1`. Contents: `ISS-4` is an add/add conflict (markers around two frontmatters, two `create` events); `ISS-5` has markers on the `status:` line and two `move` events with the same `from`; `ISS-6` merged clean with its `events.jsonl` lines out of `at` order; two sprint files `2026-10-05.yaml` and `2026-10-12.yaml` both `state: active`; two files under `epics/EPC-1/updates/`; `ISS-1`, `ISS-2`, `ISS-3`, `ISS-7`, `ISS-8` are clean. All dates are before `2026-10-23T12:00:00Z`.
  - `no-sprints` is new. Config like `team` (same members, labels, statuses, `git_host.system: none`), random-style IDs, `.issues/sprints/.gitkeep` only. About 6 issues across the status categories with no `sprint` field, at least two with `move` events to `in_progress` then `done`, one epic with a child issue, one comment, and `.issues/docs/specs/overview.md`.
- **Environment of every child process**, built from scratch and never spread from `process.env`: `PATH` (from the test process), `TZ=UTC`, `PMKIT_USER=fred`, `PMKIT_NOW=2026-10-23T12:00:00Z`, `PMKIT_SEED=1`, `GIT_CONFIG_GLOBAL` set to `os.devNull`, `GIT_CONFIG_NOSYSTEM=1`. On Windows also `SYSTEMROOT`. Working directory is the fixture copy, no `--root`, empty stdin. The copy is not a git repository.
- **Golden path:** `scripts/__goldens__/<fixture>/<command with spaces turned into hyphens>.txt`, LF only. Input files live in `scripts/__goldens__/_inputs/` (`comment.md`, `description.md`, `criteria.md`, `update.md`, `doc.md`, `CHANGELOG.md` as a frozen sample) and are passed by absolute path.
- **Golden format.** A golden is the runs of one command on one fixture, in case order, each run being:
  ```
  $ pmkit <args as passed, with --dry-run before --json>
  exit <code>
  --- stdout
  <stdout, or (empty)>
  --- stderr
  <stderr, or (empty)>
  ```
  Runs are separated by one blank line and the file ends with one newline. A stream that does not end in a newline gets a final line `\ no newline at end`. Per case the order is: real text, real `--json`; for writes (`write: true` and `init`) then `--dry-run` text, `--dry-run --json`. Before comparing, the copy's root becomes `<root>` and the inputs folder becomes `<inputs>`, in plain, `realpath` and JSON-escaped forms, longest and `realpath` first.
- **Coverage rule:** the keys of `CASES` equal the names in `COMMANDS` (exported by `scripts/pmkit.mjs`). The test names every missing and every extra key.
- **Regeneration:** `UPDATE_GOLDENS=1 node --test scripts/goldens.test.mjs` writes every golden and deletes golden files that match no command. Every failure message ends with that command.
- **Speed:** about 650 child processes. Run them through a pool (`mapLimit`, limit `Math.max(2, os.cpus().length)`), never one after the other. Measure `npm test` before and after. If the increase is over 60 seconds on an ordinary machine, say why and what was done to cut it.

## Review Focus

1. Goldens contain no temporary path (`/tmp`, `pmkit-`, `/private`, `\\Users`) and no real date or time. A grep over `scripts/__goldens__/` finds none.
2. Running the regeneration twice leaves `git diff scripts/__goldens__/` empty (determinism, including file order).
3. A command added to `COMMANDS` with no entry in `CASES` fails the test and names the command.
4. A golden changed by hand fails the test with a readable line diff and the regeneration command.
5. `UPDATE_GOLDENS=1` deletes a golden file that matches no command and still fails when `CASES` and `COMMANDS` disagree.
6. Each write runs on a fresh copy: reordering the cases does not change any golden.
7. `basic`, `team` and `broken` are byte-identical to `main` (`git diff main -- scripts/__fixtures__/basic scripts/__fixtures__/team scripts/__fixtures__/broken` is empty), and every test that uses them still passes.
8. The `npm test` time before and after is recorded.
9. Developer environment leakage: running with `PMKIT_USER=other` and a global git email set gives the same goldens.

---

### Task 1: Fixtures `messy-merge` and `no-sprints`

Complexity: standard
Covers: Fixtures exist for an empty repository, a small team, a messy merge and a repository with no sprints

**Files:**
- Create: `scripts/__fixtures__/messy-merge/**` and `scripts/__fixtures__/no-sprints/**` (contents in Global Constraints)
- Create: `scripts/fixtures.test.mjs`

**Interfaces:**
- Consumes: `makeRepo(name)` and `fixedNow` from `scripts/test-helpers.mjs`; `run(argv, { env, cwd })` from `scripts/pmkit.mjs` returning `{ code, stdout, stderr }`.
- Produces: the two fixture folders. Task 2 reads these anchors: `messy-merge` has `issue: 'ISS-1'`, `other: 'ISS-2'`, `conflicted: 'ISS-4'`, `epic: 'EPC-1'`, `sprint: '2026-10-12'`; `no-sprints` has `issue`, `other`, `epic` set to real IDs the implementer picks and writes in `FIXTURES`, `conflicted: 'ISS-0000'`, `sprint: '2026-10-12'`, `doc: 'specs/overview.md'`.

- [ ] **Step 1: Write `scripts/fixtures.test.mjs`** with these tests, each making its copy with `makeRepo`, running the CLI in-process with `run([...], { env: { PMKIT_NOW: '2026-10-23T12:00:00Z', PMKIT_USER: 'fred' }, cwd })`, and removing the copy in `finally`:
  - `messy-merge: validate reports the merge leftovers`. Parse `validate --json` and assert that the problems name `ISS-4` and `ISS-5` (conflict markers), the second active sprint, and that `ISS-1`, `ISS-2`, `ISS-3`, `ISS-7`, `ISS-8` have no problem. Read `scripts/lib/validate.mjs` for the problem codes and assert those codes.
  - `messy-merge: issues list --json has the clean issues`. Assert `ISS-1` and `ISS-2` are present.
  - `messy-merge: ISS-6 events are out of order on disk`. Read `events.jsonl` and assert the `at` values are not sorted.
  - `no-sprints: validate has no problems and no sprint exists`. Assert exit 0, an empty problem list and `cycle list --json` returning no sprints.
  - `no-sprints: metrics cycle-time prints a number`. Assert the median in the JSON is a number, not null.
  - `no-sprints: docs read specs/overview.md exits 0`.

- [ ] **Step 2: Run `node --test scripts/fixtures.test.mjs`.** Expected: FAIL because the fixture folders do not exist.

- [ ] **Step 3: Create the two fixtures** following Global Constraints. Copy the layout of `scripts/__fixtures__/team` for config files, events (`create` event carries the full `to` object) and `issue.md` frontmatter. Use the same formats the CLI writes. The builder picks titles, dates and the remaining issues.

- [ ] **Step 4: Run `node --test scripts/fixtures.test.mjs`, then `npm test`.** Expected: PASS, whole suite green. Adjust the fixtures, not the assertions, if a state is not what Global Constraints describes.

- [ ] **Step 5: Commit** `test: add messy-merge and no-sprints fixtures (PMK-9)` with the trailer from Global Constraints.

---

### Task 2: Golden runner, helpers and cases

Complexity: hard
Covers: Each CLI command has a golden output per fixture, and the test fails on a difference

**Files:**
- Create: `scripts/golden-helpers.mjs`, `scripts/golden-helpers.test.mjs`, `scripts/goldens.test.mjs`
- Create: `scripts/__goldens__/_inputs/*` (the six input files named in Global Constraints; `CHANGELOG.md` has two or three short version sections in the format `scripts/lib/changelog.mjs` parses)

**Interfaces:**
- Consumes: `COMMANDS` from `scripts/pmkit.mjs`; `makeRepo` from `scripts/test-helpers.mjs`; fixtures from Task 1.
- Produces, in `scripts/golden-helpers.mjs`:
  - `NOW = '2026-10-23T12:00:00Z'`, `SEED = '1'`
  - `goldenName(command: string): string` (`'issues get'` gives `'issues-get'`)
  - `findCollisions(commandNames: string[]): string[][]` (groups of names with the same `goldenName`)
  - `compareNames(caseNames: string[], commandNames: string[]): { missing: string[], extra: string[] }` (`missing` are commands without a case, `extra` are cases without a command)
  - `childEnv(): Record<string, string>`
  - `expandCase(isWrite: boolean, args: string[]): string[][]` (the argument lists in golden order)
  - `makeNormalizer({ root: string, inputs: string }): (text: string) => string`
  - `formatRun({ args: string[], code: number, stdout: string, stderr: string }): string`
  - `runPmkit(args: string[], cwd: string): Promise<{ code: number, stdout: string, stderr: string }>` using async `execFile('node', [pmkitPath, ...args])`, a non-zero exit read from the error object, and `child.stdin.end()`
  - `mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]>` keeping input order
  - `staleGoldens(dir: string, commandNames: string[]): string[]` (files in `dir` that match no command)

- [ ] **Step 1: Write `scripts/golden-helpers.test.mjs`** (helpers do not exist yet). Tests, all pure or using a temp dir removed in `finally`:
  - `goldenName turns spaces into hyphens`
  - `findCollisions finds two names that map to one file` (`['a b', 'a-b']` gives `[['a b', 'a-b']]`)
  - `compareNames names missing and extra` (commands `['x','y']`, cases `['y','z']` gives `missing ['x']`, `extra ['z']`)
  - `expandCase gives two runs for a read and four for a write, dry-run before json`
  - `childEnv has no key from the caller's env` (set `process.env.PMKIT_USER='other'` and `GIT_AUTHOR_NAME`, assert the result has `PMKIT_USER === 'fred'` and no `GIT_AUTHOR_NAME`)
  - `makeNormalizer replaces plain, realpath and JSON-escaped roots` (including a root with a backslash, and the `realpath` of a symlinked temp dir)
  - `formatRun shows (empty) for an empty stream and marks a missing final newline`
  - `mapLimit keeps order and never runs more than the limit at once`
  - `staleGoldens lists a file that matches no command and ignores _inputs`

- [ ] **Step 2: Run `node --test scripts/golden-helpers.test.mjs`.** Expected: FAIL (module not found).

- [ ] **Step 3: Implement `scripts/golden-helpers.mjs`** with the signatures above. The normalizer applies the longest and `realpath` forms first so a prefix never leaves half a path.

- [ ] **Step 4: Run `node --test scripts/golden-helpers.test.mjs`.** Expected: PASS.

- [ ] **Step 5: Create the six files under `scripts/__goldens__/_inputs/`.** Short, fixed text.

- [ ] **Step 6: Write `scripts/goldens.test.mjs`.** Header comment documents the regeneration command. Contents:
  - `FIXTURES`: `basic` (`issue 'ISS-0000'`, `other 'ISS-0001'`, `conflicted 'ISS-0000'`, `epic 'EPC-0000'`, `sprint '2026-10-12'`, `doc 'missing.md'`), `team` (`issue 'ISS-5N1R'`, `other 'ISS-4M2S'`, `conflicted 'ISS-3Q6T'`, `epic 'EPC-2M9D'`, `sprint '2026-10-12'`, `doc 'missing.md'`), plus `messy-merge` and `no-sprints` from Task 1. Each entry has `about`.
  - `CASES`: one entry per command, `(anchors) => string[][]`, and `input(name)` returning the absolute path under `_inputs/`. Required main cases (the builder adds one to three read cases per read command for flags that change the output's shape, such as `issues list --sprint current`, `issues list --blocked`, `cycle list --state closed`, `issues get <id> --comments --history`):

    | Command | Main case |
    |---|---|
    | `init` | `[]` and `['--update']` |
    | `capabilities`, `discover`, `whoami`, `validate`, `events`, `migrate`, `pr sync`, `epic list`, `cycle list`, `cycle current`, `metrics velocity`, `metrics cycle-time`, `issues list` | `[]` |
    | `issues get`, `issues archive` | `[issue]` |
    | `issues create` | `['--title','Golden sample','--type','task','--description-file',input('description.md')]` |
    | `issues update` | `[issue,'--title','Renamed','--criteria-file',input('criteria.md')]` |
    | `issues move` | `[issue,'done']` and `[conflicted,'done']` |
    | `issues assign` | `[issue,'fred']` |
    | `issues link` | `[issue,other,'--kind','blocks']` |
    | `issues parent` | `[issue,epic]` |
    | `issues comment` | `[issue,'--body-file',input('comment.md')]` |
    | `issues log-time` | `[issue,'30']` |
    | `issues branch` | `[issue]` |
    | `cycle issues`, `cycle close`, `cycle capacity` | `[sprint]` |
    | `cycle open` | `['--start','2026-10-26']` |
    | `cycle add` | `[issue,'--to','current']` |
    | `epic get`, `epic progress`, `epic updates` | `[epic]` |
    | `epic create` | `['--title','Golden epic']` |
    | `epic update-status` | `[epic,'--health','on_track','--body-file',input('update.md')]` |
    | `docs read` | `[doc]` |
    | `docs create` | `['golden/new.md','--body-file',input('doc.md')]` |
    | `pr open`, `pr ready` | `['--issue',issue]` |
    | `pr status` | `[]` |
    | `changelog` | `['--file',input('CHANGELOG.md'),'--since','0.0.0']` |

    Check each flag name against `usage` in `scripts/pmkit.mjs`; a usage error is a valid golden, but a case that only shows a usage error for a wrong flag is a mistake.
  - Test 1, `CASES covers exactly COMMANDS`: uses `compareNames` and fails naming each missing and extra command, plus `findCollisions`.
  - For each fixture one `test`. It runs all commands through `mapLimit` (each run: `makeRepo(name)`, `runPmkit` with `childEnv()`, `fs.rmSync(root, { recursive: true, force: true })` in `finally`), builds the transcript per command, then one subtest per command compares with `assert.equal(actual, expected, message)`. A missing golden fails with its path. In update mode it writes instead.
  - Test last, `no stale goldens`: `staleGoldens` per fixture folder must be empty. In update mode it deletes them first.

- [ ] **Step 7: Measure the baseline.** Check out `HEAD~1` into a scratch worktree (or stash these files), run `/usr/bin/time -p npm test`, and write the seconds down.

- [ ] **Step 8: Run `node --test scripts/goldens.test.mjs`.** Expected: FAIL with one failure per fixture and command naming the missing golden path (goldens do not exist yet). This is the failing test that Task 3 turns green.

- [ ] **Step 9: Commit** `test: add golden output runner and cases (PMK-9)` with the trailer. The suite is red at this commit only because of missing goldens, so say so in the commit body.

---

### Task 3: Generate goldens, verify, time

Complexity: standard
Covers: Each CLI command has a golden output per fixture, and the test fails on a difference

**Files:**
- Create: `scripts/__goldens__/{basic,team,messy-merge,no-sprints}/*.txt` (164 files)
- Modify: `scripts/pmkit.mjs` or `scripts/lib/**` only if the second regeneration differs from the first because of unsorted output; sort there and say so in the commit body.

**Interfaces:**
- Consumes: everything from Task 2.
- Produces: the committed goldens.

- [ ] **Step 1: Run `UPDATE_GOLDENS=1 node --test scripts/goldens.test.mjs`.** Expected: PASS and 164 files (`find scripts/__goldens__ -name '*.txt' -not -path '*_inputs*' | wc -l`; `CHANGELOG.md` in `_inputs` is not a golden).

- [ ] **Step 2: Check determinism.** Run the regeneration again, then `git status --short scripts/__goldens__` shows no change between the two runs (commit nothing yet; compare with `git stash`-free means such as copying the folder to the scratchpad and `diff -r`). Run once more with `PMKIT_USER=other GIT_AUTHOR_EMAIL=x@y.z npm test` and expect PASS. A difference from unstable order is fixed in the CLI with a sort.

- [ ] **Step 3: Check for leaks.** `grep -rEn "/tmp|pmkit-[A-Za-z0-9]{6}|/private/|[A-Z]:\\\\" scripts/__goldens__` returns nothing. `grep -rEn "20[0-9]{2}-[0-9]{2}-[0-9]{2}T" scripts/__goldens__` shows only dates from fixtures or `2026-10-23T12:00:00Z`. Read the diff of `issues-get`, `validate`, `init` and `issues-create` goldens for each fixture; a surprising output (wrong behavior the golden reveals) is not fixed here, it becomes a new issue created with the pmkit CLI and is listed in the report.

- [ ] **Step 4: Prove the guards.** Each check is undone right after, and none is committed:
  - Append a line to one golden, run `node --test scripts/goldens.test.mjs`, expect FAIL with a line diff and the regeneration command, then `git checkout` the file.
  - Delete one key from `CASES`, expect FAIL naming the command, then restore it.
  - Create `scripts/__goldens__/basic/ghost.txt`, expect FAIL as stale; run with `UPDATE_GOLDENS=1`, expect the file deleted; confirm `git status` is clean.
  - Confirm `git diff main -- scripts/__fixtures__/basic scripts/__fixtures__/team scripts/__fixtures__/broken` is empty.

- [ ] **Step 5: Run `/usr/bin/time -p npm test`.** Expected: all tests PASS. Record the time next to the baseline from Task 2. If the increase is over 60 seconds, reduce it (raise the pool limit, drop redundant extra cases) and write down why. Put both times in the commit body and in the task report.

- [ ] **Step 6: Commit** `test: add golden outputs for four fixtures (PMK-9)` with the trailer. The body lists the before and after `npm test` times.
