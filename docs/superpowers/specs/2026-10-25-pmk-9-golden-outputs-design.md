# PMK-9: golden output tests on fixture repositories

Design for PMK-9 (epic EPC-1, "Local tracker: close the gaps of 0.1.0"). Nobody was available to answer the brainstorming questions, so Claude made every call in this document from the issue, the code, `CONTEXT.md` and the ADRs. Treat each one as a builder's call that the user has not confirmed. The "Decisions" section lists them with their reasons.

## Why

The Technical spec, Testing item 3, asks for "sample repos in `fixtures/` (empty, small team, messy merge, no sprints) with golden outputs for CLI commands". That document is not in the repository, so this quote is the whole source.

Today `scripts/cli.test.mjs` and its siblings assert on parts of the output: a regex here, one JSON field there. A change to a table column, a warning line or a JSON key that no assertion names passes the suite. The commands under `commands/**` parse the CLI's `--json` output, and users read its text, so either change can break someone. A golden test records the whole stdout, stderr and exit code of each command on each fixture and fails on any difference. The reviewer then sees every output change as a file diff in the PR.

PMK-10 ("Add command scenario tests") depends on this issue and will run its scenarios on the same fixtures.

## Goals

- Fixtures for an empty repository, a small team, a messy merge and a repository with no sprints, under `scripts/__fixtures__/`.
- For every entry of `COMMANDS` in `scripts/pmkit.mjs` and every one of those four fixtures, a checked-in golden file with the command's full output, text and `--json`.
- `npm test` fails when an output differs from its golden, when a golden is missing, and when a command in `COMMANDS` has no golden.
- One environment variable regenerates every golden, and the result is a plain text diff a reviewer can read.

## Non-goals

- No checks on the files a write leaves behind. PMK-10 checks those.
- No golden for `--help`, for a missing command or for an unknown command. They are not entries of `COMMANDS`.
- No happy path through GitHub. The four fixtures set `git_host.system: none`, so `issues branch` and the `pr` commands record their `NOT_SUPPORTED` error. `scripts/cli-pr.test.mjs` already covers the GitHub path with a fake `gh`.
- No fix to CLI behavior that a golden exposes, with one exception: unstable output order (see Determinism). A golden records what the CLI does today. A wrong output it reveals becomes a new issue, created with the CLI.
- No migration golden from an old tracker format. `scripts/migrations.test.mjs` covers migrations.

## Anti-goals

- A golden test that passes on one machine and fails on another. Every input to the output is fixed by the test, not read from the developer's environment.
- A new dependency. ADR-0003 holds: `node:test`, `node:assert`, `node:child_process` and `node:fs` only.
- A golden edited by hand. Goldens come only from the regeneration command, so a hand edit is a test that no longer matches the CLI.
- Changing `basic`, `team` or `broken` in a way that breaks the tests that use them today.

## Constraints

- Node 18+ ES modules, no dependencies (ADR-0003). The test runs under the existing `npm test` script, `node --test "scripts/**/*.test.mjs"`, with no change to `package.json`.
- The CLI already reads `PMKIT_NOW` (fixed clock) and `PMKIT_SEED` (seeded IDs) in `scripts/pmkit.mjs`, and the library never reads them. The golden test uses these two variables and adds no new hook.
- The actor comes from `git config user.email` first, then `PMKIT_USER` (`scripts/lib/actor.mjs`). The CLI runs `git config` with the inherited environment.
- Root `.gitattributes` sets `* text=auto eol=lf`, so goldens stay LF on every platform.
- Open branches of the same epic (PMK-2 to PMK-8) change CLI output. See "Maintenance".

## Design

### Fixtures

The golden set is four fixtures. Each one maps to a name from the Technical spec:

| Spec name | Fixture | State |
|---|---|---|
| empty | `basic` (existing, unchanged) | Config files only. No issues, epics, sprints or documents. |
| small team | `team` (existing, unchanged) | 2 members, 13 issues, 1 epic, a closed and an active sprint. One issue (`ISS-3Q6T`) already holds conflict markers. |
| messy merge | `messy-merge` (new) | The tracker right after two branches that both wrote to it were merged. |
| no sprints | `no-sprints` (new) | A team that works without sprints: issues, an epic, a document, no sprint files. |

`broken` stays out of the golden set and stays as it is. It is a catalog with one file per validation problem, and `scripts/validate.test.mjs` asserts its exact problem list.

**`messy-merge`.** It uses `id_style: numbered`, so numbered IDs get output coverage too. The repository the epic runs in uses numbered IDs. The fixture holds the states that a real merge of two tracker branches leaves, with `events.jsonl` merged by `merge=union` as `.issues/.gitattributes` sets:

1. **An ID both branches took.** Each branch created `ISS-4` with a different title. `issues/ISS-4/issue.md` holds an add/add conflict (markers around the two frontmatters), and `events.jsonl` holds both `create` lines.
2. **An issue both branches moved.** `issue.md` has conflict markers on the `status:` line, and `events.jsonl` has a `move` line from each branch, both with the same `from`.
3. **A clean merge with interleaved events.** One branch changed the priority and the other the assignee, so git merged `issue.md` without conflict. The union merge left the `events.jsonl` lines out of `at` order: the branch with the later event's lines come first.
4. **Two active sprints.** Each branch opened a sprint, so two sprint files say `state: active`. Today the CLI takes the first one as current and `validate` reports the second.
5. **Status updates from both branches** on one epic, each in its own file under `updates/`.

Every other issue in the fixture is clean, so list and metric commands have real rows to print. The builder picks titles, dates and the remaining issues. All dates fall before `PMKIT_NOW`.

**`no-sprints`.** A config like `team` (same members, labels and statuses), with `.issues/sprints/.gitkeep` only. About six issues spread over the categories, none with a `sprint` field, at least two with `move` events to `in_progress` and then `done` so `metrics cycle-time` prints a number. One epic with a child issue, one comment on an issue, and one document under `.issues/docs/`, so `docs read` has a success case.

The test file holds a `FIXTURES` map. Each entry has a one-line description of the fixture and its anchors, the IDs the case templates use:

```js
const FIXTURES = {
  basic: { about: 'empty: config only', issue: 'ISS-0000', other: 'ISS-0001', epic: 'EPC-0000', sprint: '2026-10-12', doc: 'missing.md' },
  team: { about: 'small team', issue: 'ISS-5N1R', other: 'ISS-4M2S', epic: 'EPC-2M9D', sprint: '2026-10-12', doc: 'missing.md' },
  // messy-merge and no-sprints are filled in with the fixtures
}
```

An anchor that does not exist in its fixture (`ISS-0000` in `basic`) is on purpose: the golden then records the `NOT_FOUND` error, which is that command's real output on that repository.

### Cases

A `CASES` map in the test file has one entry per command name in `COMMANDS`. Each entry is a function from a fixture's anchors to a list of cases. A case is the argument list and, when the command reads a file, the input file name:

```js
const CASES = {
  'issues get': (a) => [[a.issue], [a.issue, '--comments', '--history']],
  'issues comment': (a) => [[a.issue, '--body-file', input('comment.md')]],
  // one entry per command
}
```

The rules for the cases:

- **Reads** run the main invocation, plus one case per filter or flag that changes the output's shape, such as `issues list --sprint current`, `issues list --blocked` or `cycle list --state closed`. The builder picks the extra cases. Two to four per read command is the expected range.
- **Writes** (`write: true`, plus `init`) run each case twice: once for real and once with `--dry-run`. The output differs between the two ("would ..." and "dry run: nothing was written"), and commands rely on both.
- **Every case runs twice more**, once as text and once with `--json`, because commands parse the JSON and users read the text. With the write rule, one write case produces four runs.
- **Each run gets a fresh copy** of the fixture from `makeRepo(name)`. No case depends on an earlier one, so cases can run in parallel and in any order.
- **Input files** for `--body-file`, `--description-file`, `--criteria-file` and `changelog --file` live in `scripts/__goldens__/_inputs/` and are passed by absolute path. No case uses stdin. `changelog` reads `_inputs/CHANGELOG.md`, a frozen sample, so a pmkit release does not touch the goldens.
- **Commands that cannot succeed** on a fixture still run and record the error: `init` on a repository that has a config (`CONFLICT`), `issues branch` and `pr ...` with no git host (`NOT_SUPPORTED`), a missing anchor (`NOT_FOUND`), `cycle add --to current` with no active sprint. `init` also gets an `--update --dry-run` case so it has a success golden on every fixture.

### Golden files

One file per fixture and command: `scripts/__goldens__/<fixture>/<command>.txt`, where `<command>` is the command name with spaces turned into hyphens (`issues get` becomes `issues-get.txt`). That gives 4 × 41 = 164 files today. Each file is a transcript of every run of that command on that fixture, in case order:

```
$ pmkit issues get ISS-5N1R
exit 0
--- stdout
id: ISS-5N1R
...
--- stderr
(empty)

$ pmkit issues get ISS-5N1R --json
exit 0
--- stdout
{
  "id": "ISS-5N1R",
...
```

The `$` line shows the arguments as passed, with the copy's root and the inputs folder replaced (see Determinism). Text and JSON sit in one file, so a reviewer sees both forms of one change side by side. The CLI already pretty-prints JSON with two spaces, so the git diff is line by line.

One file per command, not one per fixture, because a PR diff then names the commands whose output changed in its file list.

### The test

`scripts/goldens.test.mjs`:

1. Asserts that the keys of `CASES` equal the names in `COMMANDS` (imported from `./pmkit.mjs`). The failure message names each command that has no case and each case that names no command. This is how a new command in `COMMANDS` cannot ship without a golden.
2. Asserts that the command-to-file-name mapping has no collisions.
3. For each fixture in `FIXTURES` and each command, runs every case and builds the transcript.
4. Compares the transcript with the golden file using `assert.equal`, so `node:test` prints a line diff. A missing golden fails with its path. The failure message ends with the regeneration command.
5. Lists each `scripts/__goldens__/<fixture>/` folder and fails on a file that matches no command, so a renamed or removed command does not leave a stale golden behind.

The CLI runs as a child process (`node scripts/pmkit.mjs ...`), like `cli.test.mjs` does, with the fixture copy as its working directory and no `--root` flag, with the async `execFile` so runs overlap. Fixtures run as concurrent subtests. One run takes about 30 ms on the dev machine, and the suite makes about 650 runs, so the file should finish in a few seconds. The builder confirms the number. The process gets empty stdin.

### Regeneration

`UPDATE_GOLDENS=1 node --test scripts/goldens.test.mjs` writes every transcript to its golden file and deletes stale golden files, then passes. It cannot write a golden for a command that has no entry in `CASES`, so step 1 still fails in that mode. The test file's header comment documents the command, and every failure message repeats it. No `package.json` script is added. The developer then reads `git diff scripts/__goldens__/` and commits the goldens with the code change that caused them.

### Determinism

| Source | What the test does |
|---|---|
| Current time | `PMKIT_NOW=2026-10-23T12:00:00Z`, the value the other CLI tests use. It falls inside `team`'s active sprint (2026-10-12 to 2026-10-25), so "today", `--sprint current` and `cycle open` dates are fixed. |
| Random IDs | `PMKIT_SEED=1`. The CLI seeds `mulberry32` with it. Numbered IDs in `messy-merge` need no seed. |
| Actor and git email | The child environment is built from scratch, not spread from `process.env`: `PATH`, `TZ=UTC`, `PMKIT_USER=fred`, `PMKIT_NOW`, `PMKIT_SEED`, `GIT_CONFIG_GLOBAL` set to `os.devNull` and `GIT_CONFIG_NOSYSTEM=1` and `GIT_CEILING_DIRECTORIES` set to the real path of the temp folder, so a repository around the temp folder is never read. The fixture copy is not a git repository, so `git config user.email` is empty and the actor is always `fred` from `PMKIT_USER`. A developer's own `PMKIT_USER` or git email never reaches the CLI. On Windows the builder also passes `SYSTEMROOT`. |
| Temporary paths | Before comparing, the test replaces the copy's root with `<root>` and the inputs folder with `<inputs>`, in both their plain form and their `realpath` form (macOS puts temp folders under `/private`), and also in their JSON-escaped form for Windows backslashes. The missing-config error prints the root today ("no .pmkit/config.yaml in ..."), and any later message that names a path would too. |
| File order | The CLI sorts its output today: `issues list` by creation, `validate` by path. If a golden differs between two runs or two machines, the fix is a sort in the CLI, because users would see the same instability. That is the one CLI change in scope. |
| Line endings | Root `.gitattributes` keeps goldens LF. The test compares the CLI's output as it comes. |

### Maintenance

Every PR that changes CLI output must carry the regenerated goldens. That is the point of the test, and the cost is real while the epic has open branches. PMK-2 (capability manifest), PMK-3 (milestones), PMK-4 (days off), PMK-5 (labels), PMK-6 (auto commit), PMK-7 (query index) and PMK-8 (JSON schemas) are each likely to change some output. The rule for whichever lands second:

- After rebasing on `main`, run `UPDATE_GOLDENS=1 node --test scripts/goldens.test.mjs`, read the diff, and commit the goldens in the same PR.
- Resolve a merge conflict in `scripts/__goldens__/` by regenerating, never by editing the conflicted file.
- A golden diff the PR did not mean to cause is a regression. Fix the code, not the golden.

A new fixture is one entry in `FIXTURES` plus a regeneration. A new command is one entry in `CASES` plus a regeneration, and step 1 of the test fails until it has one.

## Decisions

| Decision | Reason |
|---|---|
| `basic` is the "empty repository" fixture. No rename, and no extra fixture without a config. | `basic` already holds a config and nothing else. 39 calls in 18 test files use `makeRepo('basic')` or its default, and the open PMK-2 to PMK-8 branches likely add more, so a rename would break those branches after they merge. A folder with no config would give 40 identical `NOT_CONFIGURED` goldens for little coverage. |
| `team` is the "small team" fixture, unchanged. | It already has two members, a closed and an active sprint, an epic and 13 issues, and other tests depend on its exact content. |
| `messy-merge` is a new fixture, separate from `broken`. | `broken` lists one problem per validation code, and `validate.test.mjs` pins its output. A messy merge is a realistic story: a shared ID, a double move, interleaved union-merged events, two active sprints. It also needs numbered IDs, which `broken` does not use. |
| `no-sprints` is a new fixture with issues and an epic but no sprint files. | `basic` has no sprints, but it has no issues either, so it cannot show how lists, metrics and `cycle add` behave for a team without sprints. |
| Goldens record text and `--json` for every case, in one file per command and fixture. | Commands parse the JSON (ADR-0002) and users read the text. One file per command makes the PR's file list name the commands that changed. |
| Writes run for real and with `--dry-run`, each on a fresh fixture copy. | The two outputs differ and both are used. Fresh copies keep the cases independent and parallel. |
| `issues branch` and `pr ...` record their `NOT_SUPPORTED` error, with no fake `gh`. | The fixtures have no git host, so the output is deterministic and needs no network. `cli-pr.test.mjs` already covers the GitHub path. |
| No new time hook. Use `PMKIT_NOW` and `PMKIT_SEED`. | Both exist, only the CLI reads them, and the other CLI tests already use the same values. |
| A child environment built from scratch, with git's global and system config turned off. | The actor would otherwise depend on the developer's git email or `PMKIT_USER`. |
| `UPDATE_GOLDENS=1` regenerates and deletes stale files. No `package.json` script. | One documented variable is enough, and it keeps `package.json` as it is. |
| The test asserts that `CASES` and `COMMANDS` have the same names, and fails on stale golden files. | That is the guard that a new or renamed command cannot skip its golden. |
| `changelog` reads a frozen sample under `_inputs/`. | The real `CHANGELOG.md` changes every release, and it would change four goldens each time. |
| Child processes, not the in-process `run()`. | `run()` reads `git config` with the test process's environment and cannot take stdin, so a child process isolates the actor better. Async `execFile` keeps the time down. |

## Acceptance criteria

| Criterion | Where the design meets it |
|---|---|
| Fixtures exist for an empty repository, a small team, a messy merge and a repository with no sprints | Fixtures: `basic` (empty), `team` (small team), new `messy-merge`, new `no-sprints`, mapped in the table and in `FIXTURES`. |
| Each CLI command has a golden output per fixture | Golden files: one `scripts/__goldens__/<fixture>/<command>.txt` for every entry of `COMMANDS` on every fixture. The test, step 1, fails when a command has no case. |
| The test fails on a difference | The test, step 4: `assert.equal` between the transcript and the golden, plus failures for a missing golden (step 4) and a stale one (step 5). Determinism keeps the comparison stable across machines. |

## Left to the builder

- The content of `messy-merge` and `no-sprints` beyond the states listed above: titles, dates, the extra clean issues.
- The extra read cases per command, within the rules in "Cases".
- The anchors for the two new fixtures.
- The exact transcript layout, as long as it shows the arguments, the exit code, stdout and stderr, and an empty stream is visible.
- The concurrency limit, if running every fixture at once is slower than a pool.
