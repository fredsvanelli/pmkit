# PMK-10: command scenario tests

Design for PMK-10 (epic EPC-1, "Local tracker: close the gaps of 0.1.0"). Nobody was available to answer the brainstorming questions, so Claude made every call in this document from the issue, the command files, the code, `CONTEXT.md` and the ADRs. Treat each one as a builder's call that the user has not confirmed. The "Decisions" section lists them with their reasons.

## Why

The Technical spec, Testing item 4, asks for "a scripted prompt per skill run against a fixture repo, with checks on the resulting files and the confirmation points the skill must hit". That document is not in the repository, so this quote is the whole source. The issue leaves one question open: how a scenario drives an agent headless.

pmkit's behavior lives in the 24 Markdown files under `commands/**` (ADR-0002). Each one is a procedure: numbered steps that call `node "${CLAUDE_PLUGIN_ROOT}/scripts/pmkit.mjs" ...`, a "Confirmation points" section that says where the agent must stop and ask, and an "Output" section. Today the suite checks their shape and little else:

- `scripts/plugin.test.mjs` checks the frontmatter, the six sections in order, that each `pmkit.mjs` call names a CLI command, and that the 24 files exist.
- `scripts/goldens.test.mjs` (PMK-9) pins the output of every CLI command on four fixtures, one command at a time.

Nothing checks that a command's sequence of calls works on a real repository. A flag that the CLI does not take, a dry run that writes a file, a step that needs an ID the previous step does not return, or a write with no confirmation before it all pass the suite. Each one breaks the command for every agent that reads the file.

## Goals

- One scenario per command file under `commands/**`. A command file with no scenario fails `npm test`, and so does a scenario with no command file.
- A scenario runs the command's sequence of CLI calls against a fresh copy of a fixture, approves its confirmation points, and checks the files the run leaves behind.
- A scenario checks that every confirmation point the command file declares is hit before the write it guards, and that every write in the run is guarded.
- The scenario and its command file cannot drift apart silently. A call, a flag or a confirmation point added to or removed from the Markdown fails the test until the scenario follows.
- The GitHub path (`issues branch`, `pr open`, `pr ready`, `pr status`, `pr sync`), which PMK-9 left out, runs in the scenarios that use it, with a fake `gh`.
- An opt-in live suite runs the same scenarios with a real agent (`claude -p`) for the cases the deterministic suite cannot prove.

## Non-goals

- No test of `write_policy.confirm: none` or `single_writes` behavior. The CLI never reads `write_policy`. Only the agent applies it, so only the live suite could see it, and that suite runs every fixture with the setting the fixture has.
- No check of the text an agent shows (tables, summaries, warnings). The deterministic suite runs no agent, and the live suite's text is not deterministic.
- No golden output per call. PMK-9 pins the CLI output. A scenario pins the sequence and the files.
- No fix to a command's behavior. A scenario records what the command file says today. A wrong procedure it exposes becomes a new issue created with the CLI. The one allowed command-file edit is listed under "Command file edits".
- No change to the four PMK-9 fixtures, the goldens or `scripts/__goldens__/`.

## Anti-goals

- An `npm test` that needs network, credentials, money or a `claude` binary. The required suite is deterministic and offline.
- A scenario that passes while its command file says something else. The drift checks below exist so that the script cannot fall behind the Markdown.
- A new dependency (ADR-0003). The live suite shells out to `claude` like the GitHub host shells out to `gh`. No Agent SDK.
- A scenario that edits `.issues/` by hand, except the conflict edit that `/pmkit:local:doctor` step 2.3 itself makes after approval.

## Constraints

- Node 18+ ES modules, `node:test`, no dependencies. `npm test` runs `node --test "scripts/**/*.test.mjs"` and stays as it is.
- The CLI reads `PMKIT_NOW` and `PMKIT_SEED`. With a seed, every process draws the same IDs in the same order, and `newId` draws again when an ID exists, so IDs created in a scenario are stable from run to run.
- `scripts/golden-helpers.mjs` already builds a child environment from scratch (`childEnv()`), runs the CLI as a child process (`runPmkit()`), and replaces temp paths (`makeNormalizer()`). Scenarios reuse them. `runPmkit(args, cwd)` takes no environment and closes stdin at once, so it gains an optional third argument `{ env, input }`. The goldens call it without one and keep their behavior.
- `scripts/test-helpers.mjs` has `makeRepo(fixture)` and `hashTree(dir)`. `hashTree` walks `.git` too, so it gains an optional list of top-level names to skip, and the scenarios pass `['.git']`. Its current callers pass nothing. `scripts/lib/diff.mjs` has `lineDiff(before, after)`.
- `scripts/cli-pr.test.mjs` holds a fake `gh` that answers from a JSON file and logs its calls, and a bare repository as `origin` for `pr open` pushes.
- This branch starts from PMK-9's branch (PR #11, still open). If PMK-9 changes in review, rebase before building.

## The open question: how a scenario drives an agent

Three approaches, with what each one costs and what it proves.

| | A. Real agent headless | B. Scripted calls, no agent | C. B in `npm test`, A opt-in |
|---|---|---|---|
| How it runs | `claude -p "<prompt>" --plugin-dir <repo> --output-format stream-json --settings <hooks>` in a fixture copy | A script per command runs the CLI calls the command file lists, in order, with dry run, approval and write | B on every `npm test`. A when `PMKIT_LIVE=1` and `claude` is on the `PATH` |
| Cost | API spend on every run, 24 runs of several turns each | Free, a few seconds | Free by default. Spend only when someone opts in |
| Needs | Network, credentials, a `claude` binary | Node | Node, plus A's needs for the live part |
| Determinism | None. The agent picks words, order of reads and sometimes extra calls | Full, with `PMKIT_NOW`, `PMKIT_SEED` and a built environment | Full for B. Loose checks for A |
| Proves | An agent that reads the Markdown follows it, asks before it writes and ends with the right files | The CLI supports the exact sequence the Markdown lists, on a realistic repository. Dry runs write nothing. Every write is behind a declared confirmation. The files after the run are right | Both, with B as the gate and A as a periodic check |
| Does not prove | Anything stable enough to gate a merge | That an agent reads the Markdown that way | A's result on every PR |

How A answers `AskUserQuestion` headless, and how it knows the question came before the write: the settings file passed with `--settings` defines two `PreToolUse` hooks. One on `Bash` appends the command to a log file. One on `AskUserQuestion` appends the question to the same log and answers it from the scenario's answer list. The log order then shows whether a question sat between the dry run of a call and the real call. Three details are unproven on the installed `claude` version, and the first task of the live part is a spike on them (see "Live suite").

**Recommendation: C.** B is the required test. It meets both acceptance criteria offline and deterministically, which is the only kind of test that can gate a merge. A cannot gate anything, but it is the only way to learn whether an agent follows the Markdown, so it ships as an opt-in suite that reuses B's scenario files, so nobody maintains two scripts per command.

## Design

### Files

| Path | What it holds |
|---|---|
| `scripts/__scenarios__/<name>.mjs` | One scenario module per command file |
| `scripts/__scenarios__/<name>.after.txt` | The snapshot of that scenario: its trace and the file changes it left |
| `scripts/__scenarios__/_inputs/` | Body files the scenarios pass with `--body-file`, `--description-file`, `--criteria-file`, `--members-file` and `changelog --file` |
| `scripts/scenario-helpers.mjs` | The Markdown parser, the trace rules, the tree diff and the runner |
| `scripts/scenario-helpers.test.mjs` | Unit tests of the parser and the rules, like `golden-helpers.test.mjs` |
| `scripts/scenarios.test.mjs` | The required suite |
| `scripts/scenarios-live.mjs` | The opt-in live suite. Its name does not end in `.test.mjs`, so `npm test` never loads it |
| `scripts/fake-gh.mjs` | The fake `gh` and the bare-remote helper, moved out of `cli-pr.test.mjs`, which then imports them |

`<name>` is the command file's path under `commands/` with `/` turned into `-` and no extension: `commands/issues/create.md` gives `issues-create`, `commands/help.md` gives `help`.

### A scenario

A scenario module exports one object. It is data, plus an optional `expect` function:

```js
export default {
  command: 'issues/move',
  fixture: 'team',
  prompt: '/pmkit:issues:move ISS-2X6D done',
  answers: ['Yes'],
  steps: [
    { step: '1', read: ['issues', 'get', 'ISS-2X6D'] },
    // ISS-2X6D is blocked by ISS-5N1R, which is in_progress, so step 2 looks it up and warns.
    { step: '2', read: ['issues', 'get', 'ISS-5N1R'] },
    { step: '4', dryRun: ['issues', 'move', 'ISS-2X6D', 'done'] },
    { confirm: 'Step 5' },
    { step: '4', write: ['issues', 'move', 'ISS-2X6D', 'done'] },
  ],
  skip: { '3 discover': 'done has one status in the team fixture, so step 3 does not ask' },
  notHit: {},
  expect(repo) {
    assert.equal(repo.issue('ISS-2X6D').status, 'done')
    assert.equal(repo.newEvents('ISS-2X6D').filter((e) => e.op === 'move').length, 1)
  },
}
```

The IDs and values in this example come from the `team` fixture. The builder confirms them when writing the real module.

The fields:

- `command`: the command file, as its path under `commands/` without `.md`.
- `fixture`: a PMK-9 fixture name, or `null` for an empty folder. Optional `github: true` and `git: true` (see "Fixtures and the GitHub path"). Optional `setup(root)` for a change the fixture needs before the run, such as an older tracker format for `/pmkit:upgrade`.
- `prompt` and `answers`: what the live suite types and answers. The required suite does not read them.
- `steps`: the trace, in the order the command file runs it. Each entry is one of:
  - `{ step, read: args }`: a read. The runner adds `--json`.
  - `{ step, dryRun: args }`: a write run with `--dry-run --json`.
  - `{ confirm: '<key>' }`: an approved confirmation point. `<key>` is the label of a bullet in the command's "Confirmation points" section.
  - `{ step, write: args }`: the real write, run with `--json`.
  - `{ step, edit: { file, content } }`: a file edit the agent makes itself. Only `local/doctor` uses it, for step 2.3.
  - `{ step, git: args }`: a git command the procedure runs or the user would run, such as the commit of `/pmkit:issues:work` step 8. It runs, and the drift checks ignore it.
  - Any entry can add `stdin: '<text>'` for `--body-file -` and `--members-file -`, `save: '<name>'` to keep its JSON result, and `expectError: '<CODE>'` when the command file's "If something is missing" path is the one under test.
  - `args` can be a function of the saved results, as in `({ child }) => ['issues', 'link', child.id, 'ISS-5N1R', '--kind', 'blocks']`. With a seed, IDs are stable, but a function survives a fixture change.
- `skip`: calls of the command file the scenario does not make, keyed `'<step> <cli command>'`, each with a reason. A procedure with branches (an epic parent or an issue parent, a GitHub host or none) cannot take every branch in one run.
- `notHit`: confirmation points the scenario does not reach, keyed by their label, each with a reason.
- `expect(repo)`: intent checks on the files after the run. `repo` gives `issue(id)` (the parsed frontmatter), `epic(id)`, `sprint(id)`, `file(path)`, `newEvents(id)` (the events the run appended) and `ghCalls()`. Two or three assertions per scenario, on facts an agent cannot word differently: a status, an assignee, a count of new issues or events, a link, a sprint state.

A module may export an array when one command needs a second path, for example `/pmkit:setup` on an empty folder and on an existing config. Each entry gets its own snapshot, named `<name>.<index>.after.txt`. The coverage check needs at least one entry per command file.

### Reading the command file

`scripts/scenario-helpers.mjs` parses each command file into two lists.

**Calls.** Every `pmkit.mjs" <rest>` match in the file, as in `plugin.test.mjs`. Checks 3 and 4 read every match. Checks 5 and 6 read the matches in "Steps" and in "If something is missing". A call in "If something is missing" gets the step id `missing`, so an `expectError` scenario or the branch-recording write of `/pmkit:issues:pause` can match it. A call in another section, such as the `epic list` in the "Parameters" of `/pmkit:report:status`, is not part of the procedure. Each call keeps:

- its CLI command, matched against `COMMANDS` names (two words first, then one);
- its flags, every `--name` token, with the ones inside `[...]` marked optional. A call with a placeholder for its flags, such as `issues list <flags>`, `issues update <id> <flags>` or `issues create ... <fields>`, accepts every flag the CLI command takes. Flags named in the prose around a call are not parsed;
- whether it carries `--dry-run`;
- its step id. A top-level item `N.` gives `N`, a nested numbered item `M.` under it gives `N.M`, a heading `### N. Title` gives `N` to the items under it (`/pmkit:upgrade`), and a heading without a number, such as `### First run` in `/pmkit:setup`, prefixes the ids under it: `First run 7`. A call in a `-` bullet belongs to the numbered item above it.

**Confirmation points.** Every `-` bullet of the "Confirmation points" section whose text has a label followed by `: `, such as `Step 5: the status change` or `First run: the one summary`. The key is the label. Bullets without that shape ("Step 3 is a choice of input, not a confirmation", "The rest is read-only") are notes, not points.

### The checks

`scripts/scenarios.test.mjs` runs these for each command file.

**Coverage.**

1. Every file under `commands/**` has a scenario module, and every scenario module names a command file that exists. The failure names each missing or extra file.
2. Every snapshot file matches a scenario. A stale snapshot fails, and `UPDATE_GOLDENS=1` deletes it.

**Drift between the scenario and its command file.** These need no run.

3. Every flag in every call of the command file exists in the CLI: in the command's `flags` or `booleans` in `COMMANDS`, or one of the global flags `json` and `root`, or `dry-run` for a write or for `init`, or `as` for a write. `init` is not a write and does not take `--as` (`pmkit.mjs` refuses it). This check covers all 24 files whether or not a scenario uses the call.
4. Every call in the command file ends with `--json`, as the conventions require.
5. Every `read`, `dryRun` and `write` entry of the scenario matches a call of the command file in the same step: same CLI command, and the scenario's flags are a subset of the call's flags. A `dryRun` entry needs a call that carries `--dry-run`. A `write` entry matches a call without `--dry-run` of the same CLI command in its step when the file has one: `init --update --replace` in `/pmkit:setup`, `epic create` and `issues create --parent` in steps 7 and 8 of `/pmkit:spec:import`, `cycle close <id> --json` in `/pmkit:cycle:close`, `migrate --json` in `/pmkit:upgrade` and `/pmkit:local:doctor`, `cycle capacity --set` in `/pmkit:cycle:plan`, and the links of `/pmkit:issues:breakdown` and `/pmkit:spec:import`. Otherwise it matches the call its dry run matched, because the procedure says "run the same command without `--dry-run`".
6. Every call of the command file is used by at least one entry or listed in `skip`. A `skip` key that matches no call fails, so a removed call cannot leave a stale excuse.
7. The confirmation keys of the command file equal the keys the scenario confirms plus the keys in `notHit`. A `notHit` key that is not in the file fails.

**The run.** The runner copies the fixture, applies `github`, `git` and `setup`, records `hashTree` of the copy (without `.git`), then plays the steps in order with `runPmkit` and the scenario environment.

8. Every `read` and `dryRun` exits 0 (or with the declared `expectError`), prints JSON, and leaves the tree hash unchanged. This is where "a dry run writes nothing, not even the event log" is tested for each call of each procedure.
9. Every `write` and `edit` comes after a `confirm`. One `confirm` covers every write between it and the next `confirm`, because a bulk change asks once. A write that matched its dry run's call ("the same command without `--dry-run`") must also follow a `dryRun` with the same arguments. The dry run may come before or after the `confirm`: `/pmkit:issues:breakdown`, `/pmkit:spec:import` and `/pmkit:cycle:plan` ask on the proposal table first and dry-run the values after the approval, and the conventions do not forbid that order.
10. Every `confirm` key is a key of the command file. A key may appear more than once, because some points ask once per write (`Step 9` of `/pmkit:issues:work`).
11. `expect(repo)` passes.
12. The snapshot matches `<name>.after.txt` (below).

Check 9 cannot tell which point guards which write. A scenario could put an input question, such as step 1 of `/pmkit:issues:work`, right before a write and pass. The snapshot shows the key above each write, so the reviewer sees it, and the live suite checks the real order. Mapping keys to the steps they guard would need a parser for labels like `First run` and the branch-recording bullet of `/pmkit:issues:pause`, for little gain.

A command that only reads still gets a scenario, and it checks something real. Checks 3 to 6 tie each of its calls to the Markdown. Check 8 runs each read against the fixture, checks that it exits 0 with JSON, and checks that it wrote nothing. The snapshot then records `(no file changed)`. Per command:

- `/pmkit:help` runs `capabilities --json` on `team`.
- `/pmkit:issues:find` runs `discover` and two or three `issues list` filter sets that the file's plain-language examples map to, such as `--category in_progress --assignee me` and `--type bug --sprint current`.
- `/pmkit:issues:mine` and `/pmkit:team:standup` run on `team` with GitHub, with a fake `gh` that reports no merged pull request. `pr sync --dry-run` then has nothing to move, so their only confirmation point (step 1, the sync preview) goes in `notHit` with that reason, and the rest are reads. A second entry with a merged PR would hit it. That entry is the builder's call.
- `/pmkit:issues:summary` reads an issue with its comments and history, then takes the offer of step 5 and posts the summary as a comment, after the command file edit below. Its snapshot has one changed issue.

### The snapshot

`<name>.after.txt` is the scenario's trace followed by the file changes, in the PMK-9 transcript style:

```
$ pmkit issues get ISS-2X6D --json                   [step 1, read]
exit 0
$ pmkit issues get ISS-5N1R --json                   [step 2, read]
exit 0
$ pmkit issues move ISS-2X6D done --dry-run --json   [step 4, dry run, tree unchanged]
exit 0
? Step 5                                             [confirmed]
$ pmkit issues move ISS-2X6D done --json             [step 4, write]
exit 0

--- changed .issues/issues/ISS-2X6D/issue.md
  ...
- status: in_progress
+ status: done
--- changed .issues/issues/ISS-2X6D/events.jsonl
+ {"at":"2026-10-23T12:00:00.000Z","by":"fred","op":"move",...}
--- gh calls
(none)
```

- The file changes compare every file of the copy (without `.git`) with the fixture: `added` with the full content, `removed` with the path only, `changed` with `lineDiff`. A run that changes nothing prints `(no file changed)`.
- The trace shows the exit code but not stdout. The goldens already pin the output of each command, and repeating it here would turn one output change into 30 snapshot diffs.
- Paths go through `makeNormalizer`, as in the goldens.
- `gh calls` lists the fake `gh` log, so a change in what pmkit asks GitHub shows in review.
- `UPDATE_GOLDENS=1 node --test scripts/scenarios.test.mjs` writes every snapshot and deletes stale ones. Every other check still runs in that mode, so regeneration cannot bless a dry run that writes or a write without a confirmation. The test's header comment and every failure message give the command.

The snapshot catches everything the run changes. `expect` states the intent, so a regenerated snapshot that loses the point of the command still fails.

### Fixtures and the GitHub path

Scenarios use the PMK-9 fixtures as they are. The assignment below is a starting point. The builder may move a scenario to another fixture when the data fits better.

| Fixture | Scenarios |
|---|---|
| `team` | `help`, `issues/assign`, `issues/breakdown`, `issues/capture`, `issues/comment`, `issues/create`, `issues/find`, `issues/link`, `issues/move`, `issues/progress`, `issues/update`, `backlog/groom`, `cycle/plan` |
| `team` with `github: true` | `issues/work`, `issues/pause`, `issues/mine`, `team/standup`, `report/status`, `cycle/close` |
| `no-sprints` | `issues/summary` (it has the comment and the epic), `spec/import` (it has `.issues/docs/specs/overview.md` to read) |
| `messy-merge` | `local/doctor` (it has conflict markers, two active sprints and out-of-order events) |
| `basic` with `git: true` and `setup` to tracker format 1 | `upgrade` |
| `null` (empty folder, `git: true`) | `setup`, first run. A second entry runs the existing-config path on `basic` |

`github: true` does at runtime what `teamRepo()` in `cli-pr.test.mjs` does: `git init`, an initial commit, a bare repository as `origin`, and `git_host.system: github` with `default_branch: main` in the copy's config. It is not a new fixture folder, because a fixture cannot hold a nested `.git`. The scenario names the canned `gh` answers in a `gh` field (`{ '<args>': { stdout, status } }`), and the runner puts `scripts/fake-gh.mjs`'s script first on the `PATH`. The git commands get the same isolated environment as the CLI, with `-c user.name -c user.email` on the harness's own commits.

`setup` and `upgrade` also run commands the scenario cannot (`claude plugin ...`). Those are not `pmkit.mjs` calls, so the drift checks never see them, and the scenario says in a comment which steps it leaves to the live suite.

### The live suite

`scripts/scenarios-live.mjs` loads the same scenario modules and runs each one with a real agent. It is a `node:test` file run as `PMKIT_LIVE=1 node --test scripts/scenarios-live.mjs [name ...]`. Each test skips when `PMKIT_LIVE` is not `1` or `claude` is not on the `PATH`.

For one scenario it:

1. Builds the copy and the environment as the required suite does, plus the fake `gh`.
2. Writes a settings file with two `PreToolUse` hooks, both small Node scripts in the scratch folder. The `Bash` hook appends `{ tool: 'Bash', command }` to a log. The `AskUserQuestion` hook appends `{ tool: 'AskUserQuestion', questions }` and answers with the next entry of `answers`.
3. Runs `claude -p "<prompt>" --plugin-dir <repo root> --settings <file> --output-format stream-json --verbose --max-budget-usd 1` in the copy.
4. Turns the log into the same trace kinds: a `pmkit.mjs` call with `--dry-run` is a dry run, one without it is a read or a write by `COMMANDS`, a question is a confirmation.
5. Checks rule 9 on that trace (every write after a question and after its dry run), that the number of questions is at least the number of keys the scenario confirms, and the scenario's `expect(repo)`. It does not compare the snapshot, because the agent writes its own titles and comments.

The first task of the live part is a spike on the installed `claude` version. It answers three questions: does `-p` run a plugin slash command with `disable-model-invocation: true`; is `AskUserQuestion` offered in `-p` mode; and can a `PreToolUse` hook answer it (by returning `updatedInput` with the answers, or by denying with the answer in the reason). If the hook cannot answer, the live suite ships without the confirmation check and says so in its header, and a follow-up issue is created with the CLI. If `-p` cannot run the command at all, the live part is dropped from PMK-10 and moved to a follow-up issue. The required suite does not depend on any of this.

### Command file edits

The parser needs one shape, and one file breaks it today. `commands/issues/summary.md` writes its one confirmation point (posting the summary as a comment, step 5) as a paragraph after "None for the summary". The builder turns it into a bullet, `- Step 5: the comment, before it is posted. ...`, keeping the words. That changes no behavior. If the parser finds another file whose confirmation points are not bullets, the same edit applies, listed in the PR. Any other mismatch between a command file and the CLI that a scenario finds becomes a new issue.

### Size

The issue's estimate is 8. The work, in the order a plan would take it:

1. `scripts/fake-gh.mjs`, moved out of `cli-pr.test.mjs` with no behavior change.
2. The parser and the trace rules in `scenario-helpers.mjs`, test first, with fixtures of small Markdown strings.
3. `scenarios.test.mjs` with checks 1 to 4, which run over all 24 files before any scenario exists. Check 3 may find real flag mismatches, which become issues or, for a typo, a fix in the same PR.
4. The runner, the snapshot and checks 5 to 12, built with the `issues/move` scenario.
5. The other 23 scenarios. Most are 20 to 40 lines of data. `issues/work`, `local/doctor`, `cycle/close` and `spec/import` are the long ones, at 60 to 100 lines each.
6. The live spike, then `scenarios-live.mjs` if the spike allows it.

Items 1 to 5 meet both acceptance criteria. Item 6 is the part to cut if the work runs over.

## Decisions

| Decision | Reason |
|---|---|
| Approach C: scripted CLI sequences in `npm test`, the real agent as an opt-in suite over the same files. | Only a deterministic, offline test can gate a merge, and only an agent run shows whether the Markdown is followed. One scenario file serves both, so there is one script per command to maintain. |
| No Agent SDK. The live suite shells out to `claude -p` with hooks from `--settings`. | ADR-0003. The GitHub host already depends on a CLI the same way. |
| Confirmation points are the labeled bullets of each command's "Confirmation points" section, keyed by label. | The section exists in all 24 files (`plugin.test.mjs` enforces it) and already uses `Step N: ...`. Parsing it makes the Markdown the source, so a new point fails the scenario until it is handled. |
| A scenario declares `{ confirm: key }` entries, and the runner enforces that each write follows a confirmation and its own dry run, in either order between the two. | The conventions require a dry run and an approval before each write, and the order of the trace is the only thing B can observe about a confirmation. Three commands ask on a proposal table before their dry runs, and they are not wrong. |
| Check 9 does not map each key to the writes it guards. | That needs a parser for free-form labels. The snapshot shows the key above each write for the reviewer, and the live suite checks the real order. |
| Drift checks tie each scenario call to a call of the same step in the Markdown, and every Markdown call needs a use or a `skip` with a reason. | It catches drift in both directions: a call added to the Markdown fails until the scenario runs or skips it, and a scenario call the Markdown no longer has fails at once. |
| Every flag in every command file is checked against `COMMANDS`, independent of the scenarios. | It is the cheapest check with the widest reach, and `plugin.test.mjs` today checks only command names. |
| Every read and dry run must leave the tree byte-identical. | "A dry run writes nothing, not even the event log" is a promise the confirmations rely on. Checking it per call per procedure costs one hash. |
| Files after the run: a snapshot of the trace and the file diffs, plus two or three `expect` assertions. | The snapshot catches every change, in the reviewable form PMK-9 uses. The assertions keep the intent when someone regenerates. The live suite can use the assertions, not the snapshot. |
| The trace shows exit codes, not stdout. | The goldens own the output. Repeating it would multiply every output change. |
| Snapshots regenerate with `UPDATE_GOLDENS=1`, the PMK-9 variable, and every other check still runs in that mode. | One variable to remember. Regeneration must not bless a broken procedure. |
| One module per command file, `scripts/__scenarios__/<group>-<action>.mjs`, data plus an `expect` function. | The file list of a PR names the commands whose scenarios changed, as with the goldens. Data keeps most scenarios short. A function where IDs come from earlier results keeps them working when a fixture changes. |
| Reuse the four PMK-9 fixtures. The GitHub path is `team` plus a runtime `git init`, bare `origin`, `git_host: github` and the fake `gh`. | The fixtures already cover the states the commands need. A fixture folder cannot hold a `.git`, and `cli-pr.test.mjs` already builds this setup. |
| Move the fake `gh` to `scripts/fake-gh.mjs`. | Two copies of it would drift. |
| `runPmkit` gains optional `{ env, input }`, and `hashTree` an optional skip list. | The scenarios need the fake `gh` on the `PATH`, stdin for `--body-file -`, and a hash without `.git`. Both changes keep the current callers as they are. |
| Calls in "If something is missing" count for coverage, under the step id `missing`. Calls in other sections count only for the flag and `--json` checks. | Some writes live there, such as the branch record of `/pmkit:issues:pause`, and `expectError` scenarios test that section. |
| `summary.md`'s confirmation point becomes a bullet. No other command file changes, except flag typos check 3 finds. | The parser needs the bullet shape. Other problems a scenario exposes go to new issues, as PMK-9 did. |
| Scenarios run with the fixture's `write_policy` and do not test `confirm: none`. | The CLI never reads the write policy. Only an agent applies it. |
| The live spike comes last and is the part to cut. | The acceptance criteria are met without it, and its feasibility depends on `claude` features nobody has checked yet. |

## Acceptance criteria

| Criterion | Where the design meets it |
|---|---|
| One scripted scenario per command in `commands/**` | "A scenario" and "Files": one module per command file under `scripts/__scenarios__/`. Check 1 fails when a command file has no scenario or a scenario has no command file. The "Fixtures and the GitHub path" table assigns all 24. |
| Each scenario checks the files after the run | Checks 11 and 12: the `expect` assertions and the `<name>.after.txt` snapshot of every added, removed and changed file. Check 8 adds that no read or dry run changed a file. |
| Each scenario checks the confirmation points the command must hit | "Reading the command file" parses the points from the Markdown. Check 7 ties them to the scenario (hit or `notHit` with a reason). Checks 9 and 10 enforce that each write comes after a declared confirmation and after its own dry run. The live suite checks the same order with a real agent. |

## Left to the builder

- Which fixture and which IDs each scenario uses, within the table above.
- The answers in `answers` and the wording of `prompt`.
- The exact snapshot layout, as long as it shows the trace with step labels, exit codes and confirmations, then every file change.
- The `repo` helper's method names in `expect`.
- How many `issues list` filter sets `/pmkit:issues:find` runs.
- Which of the two hook answer methods the live suite uses, from the spike.
