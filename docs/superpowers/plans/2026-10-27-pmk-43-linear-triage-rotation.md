# PMK-43 Linear triage rotation implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: use superpowers:subagent-driven-development or superpowers:executing-plans, as the user picks, to implement this plan task by task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add `linear triage show`, `linear triage set` and `linear triage suggestions`, and the Markdown command `/pmkit:linear:triage-rotation`, so a user sees and changes who is on triage duty and reads Linear's Triage Intelligence suggestions. On a workspace without the Business plan, the commands say so and a write changes nothing.

**Architecture:** A new module `scripts/lib/linear/triage.mjs` holds the GraphQL documents, the pure view helpers and `createTriage({ client, discovery, config })`. The raw Linear tracker exposes it as `tracker.triage`. A command flag `linear: true` and `ctx.linear()` reach it, mirroring `local: true` and `ctx.local()`. The contract operations and `contractView` do not change.

**Tech stack:** Node.js ESM, `node:test`, the PMK-30 client, the PMK-33 discovery, and `fakeLinearFetch` from `scripts/fake-linear-api.mjs`.

**Spec:** `docs/superpowers/specs/2026-10-27-pmk-43-linear-triage-rotation-design.md`

## Global constraints

- `npm test` opens no socket. Every Linear test injects `fakeLinearFetch`. Every test that reaches the user store sets `PMKIT_HOME` through `userStoreEnv()`.
- `package.json` gains no dependency (ADR-0003).
- Every Local tracker output and every existing golden stays byte-identical.
- The key never appears in output, a cache file, an error or a command line. Tests use `FAKE_KEY`.
- No file, commit or comment holds the real workspace URL key or team key. Examples use `acme` and `ACME`. Docs say "the sandbox workspace".
- No task sends a write to Linear. The mutations are tested against the fake only.
- A read command and `set --dry-run` send no mutation. A test with a counting fetch asserts it.
- The plan strings come from `BUSINESS_PLANS` in `manifest.mjs`. No second list.
- Every commit message carries `(PMK-43)` and ends with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Code, comments, docs and messages follow `~/.claude/skills/unslop/SKILL.md`.

## ADR-0002 checklist for a new command

A new CLI command needs, in this plan: the entry in `COMMANDS` with `summary`, `usage` and `flags` (Tasks 5, 6, 7), a golden case per command (Task 10), a scenario for the Markdown command (Task 11), and the `--help` text, which the runner builds from `COMMANDS`, so the help test and golden in `goldens.test.mjs` change with Task 10. The Markdown command has the `## Parameters` section and `disable-model-invocation: true` that `plugin.test.mjs` checks (Task 9). The manifest has no entry for it, by the spec's answer to question 2.

## Acceptance criteria map

| Criterion | Tasks |
|---|---|
| 1. Shows and adjusts who is on triage duty | 1, 2, 4, 5 (availability, view, fake, `show`), 7 (`set`), 9 (Markdown steps 2, 3, 5 to 7). The Free path is proven in Tasks 5 and 7. |
| 2. Uses Triage Intelligence suggestions when the plan has them | 3, 4, 6 (`suggestions`), 9 (Markdown step 4). On Free the command reports them unavailable and sends no query (Task 6). |

## Files

| File | Task |
|---|---|
| `scripts/lib/linear/manifest.mjs` | 1 |
| `scripts/lib/linear/triage.mjs`, `scripts/lib/linear/triage.test.mjs` | 1, 2, 3, 5, 6, 7 |
| `scripts/fake-linear-api.mjs`, `scripts/fake-linear-api.test.mjs` | 4 |
| `scripts/lib/linear/tracker.mjs` | 5 |
| `scripts/pmkit.mjs` | 5, 6, 7 |
| `scripts/cli-linear.test.mjs` | 5, 6, 7 |
| `commands/linear/triage-rotation.md`, `skills/pmkit/SKILL.md`, `README.md`, `scripts/plugin.test.mjs` | 9 |
| `scripts/golden-cases.mjs`, `scripts/__goldens__/`, `scripts/cli-hosted.test.mjs` | 10 |
| `scripts/__scenarios__/linear-triage-rotation.mjs` and its snapshot | 11 |
| `scripts/lib/linear/API-VERIFICATION.md` | 12 |

## Task 1: Availability

**Files:** `scripts/lib/linear/manifest.mjs`, `scripts/lib/linear/triage.mjs`, `scripts/lib/linear/triage.test.mjs`

- [ ] Write the failing tests in `triage.test.mjs` for `triageAvailability(raw, team)`: plan `free` returns `{ available: false, reason: 'plan', plan: 'free', enableHint: 'Triage responsibility needs the Business or Enterprise plan' }`; an unknown plan string does the same; `business`, `enterprise` and `trial` with `triageEnabled` true return `{ available: true }`; `business` with `triageEnabled` false returns `reason: 'triage_off'` and the hint "Turn on triage in the team's settings in Linear"; a `free` plan with `triageEnabled` false still returns `plan` (plan first).
- [ ] Run `node --test scripts/lib/linear/triage.test.mjs` and see the import fail.
- [ ] Change `const BUSINESS_PLANS` to `export const BUSINESS_PLANS` in `manifest.mjs`. Create `triage.mjs` with `triageAvailability`, importing `BUSINESS_PLANS`.
- [ ] Run the test file and see it pass. Run `node --test scripts/lib/linear/manifest.test.mjs` to confirm the export changed nothing.
- [ ] Commit `feat(linear): decide whether triage rotation is available (PMK-43)`.

## Task 2: Duty view

**Files:** `scripts/lib/linear/triage.mjs`, `scripts/lib/linear/triage.test.mjs`

- [ ] Write the failing tests for `dutyView(node, raw)`: a manual node gives `source: 'manual'`, `current` from `currentUser`, `members` in `manualSelection.userIds` order with names from `raw.users`, `schedule: null`; a schedule node with a PagerDuty integration gives `source: 'schedule'`, empty `members` and `schedule.provider: 'pagerduty'`; a schedule with another service gives that service name; a schedule with no integration gives `linear`; a null node gives `source: 'none'`, `action: null`, `current: null`, empty `members`; a user id missing from `raw.users` gives `{ id, name: '(unknown user)' }` and a warning in the returned `warnings` list.
- [ ] Run and see the failures.
- [ ] Implement `dutyView` as a pure function that returns `{ duty, warnings }`, and `dutyText(team, duty)` for the plain text in the spec (five lines, "nobody is on triage duty" for `none`).
- [ ] Run and see it pass. Commit `feat(linear): shape the triage duty view (PMK-43)`.

## Task 3: Suggestions view

**Files:** `scripts/lib/linear/triage.mjs`, `scripts/lib/linear/triage.test.mjs`

- [ ] Write the failing tests for `suggestionsView(nodes)`: one suggestion of each `IssueSuggestionType` gives the matching `target` (team, project, user, label, issue); `reasons` uses `presentedReasons` when present, else `metadata.reasons`; a stale, accepted or dismissed suggestion is dropped; an issue left with no suggestion counts in `withoutSuggestions` and is not listed; order follows the input.
- [ ] Run and see the failures.
- [ ] Implement `suggestionsView` and `suggestionsText`.
- [ ] Run and see it pass. Commit `feat(linear): shape the Triage Intelligence suggestions (PMK-43)`.

## Task 4: Fake Linear routes

**Files:** `scripts/fake-linear-api.mjs`, `scripts/fake-linear-api.test.mjs`

- [ ] Write the failing tests: `fakeTriage({ responsibility, issues })` returns routes for `PmkitTriageShow`, `PmkitTriageSuggestions`, `PmkitTriageCreate`, `PmkitTriageUpdate` and `PmkitTriageDelete`; a mutation route echoes the new responsibility built from its variables; `fakeWorkspace({ subscription })` already sets the plan, so the test builds a Free and a Business workspace and checks `fetch.calls` records each operation by name.
- [ ] Run and see the failures.
- [ ] Add the routes and the helper. The operation names are the ones Task 5 to 7 use. Keep the existing exports unchanged.
- [ ] Run the fake's tests and `node --test scripts/cli-linear.test.mjs` to confirm nothing else moved. Commit `test(linear): add triage routes to the fake Linear API (PMK-43)`.

## Task 5: `createTriage.show` and `linear triage show`

**Files:** `scripts/lib/linear/triage.mjs`, `scripts/lib/linear/tracker.mjs`, `scripts/pmkit.mjs`, `scripts/lib/linear/triage.test.mjs`, `scripts/cli-linear.test.mjs`

- [ ] Write the failing CLI tests in `cli-linear.test.mjs` over `fakeLinearFetch({ ...fakeWorkspace({ ... }), ...fakeTriage(...) })`:
  - Free workspace (the proof for this issue): `linear triage show --json` exits 0 with `available: false`, `reason: 'plan'`, `plan: 'free'`, the team key and the hint; the text form prints the four lines of the spec; `callsOf(fetch, 'PmkitTriageShow')` is 0.
  - Business workspace with `triageEnabled` false: `reason: 'triage_off'`, no triage query.
  - Business workspace: manual rotation, schedule and no responsibility each print the shape in the spec.
  - Team choice: `--team` wins, then `tracker.scope.team`, then the only team; several teams and neither gives `INVALID_INPUT` with the team keys in `nextStep`.
  - `linear triage show` on a Local repository exits 2 with `NOT_SUPPORTED` ("`linear triage show` works only with the Linear tracker, and tracker.system is "local"").
  - A run without `LINEAR_API_KEY` is `AUTH`, and `fetch.calls` is empty.
  - The key appears in no stdout, stderr or error field.
- [ ] Run and see the failures.
- [ ] In `triage.mjs`, add the `PmkitTriageShow` document and `createTriage({ client, discovery, config })` with `show({ team })`. It reads the cached discovery, runs `triageAvailability`, and sends the query only when available.
- [ ] In `tracker.mjs`, add `triage: createTriage(...)` to the returned object. `contractView` keeps ignoring it.
- [ ] In `pmkit.mjs`, add `linear: true` to the command shape, `ctx.linear()` (returns `null` unless `system` is `linear`, else the raw tracker's `triage`), the runner refusal next to the `local` one, a comment line on the flag next to the `local: true` comment, and the `linear triage show` entry with `usage: '[--team KEY]'`, `flags: ['team']`.
- [ ] Run `node --test scripts/cli-linear.test.mjs scripts/lib/linear/triage.test.mjs` and see it pass. Run `node --test scripts/cli.test.mjs` for the help output; update only what lists commands, and leave Local outputs alone.
- [ ] Commit `feat(cli): add linear triage show (PMK-43)`.

## Task 6: `linear triage suggestions`

**Files:** `scripts/lib/linear/triage.mjs`, `scripts/pmkit.mjs`, `scripts/cli-linear.test.mjs`

- [ ] Write the failing CLI tests: Free workspace exits 0 with `available: false` and sends no `PmkitTriageSuggestions` query; Business workspace lists active suggestions with score and reasons and drops stale ones; an empty inbox prints "no issue is waiting in triage"; `--limit` defaults to 25, caps at 100 and a larger value is clamped with a warning; when more issues exist than the limit, a warning says how many were left out; issues are listed oldest first.
- [ ] Run and see the failures.
- [ ] Add the `PmkitTriageSuggestions` document (the filter in the spec) and `suggestions({ team, limit })` to `createTriage`, then the command entry with `usage: '[--team KEY] [--limit n]'`, `flags: ['team', 'limit']`. Reuse the team choice from Task 5.
- [ ] Run the tests and see them pass. Commit `feat(cli): add linear triage suggestions (PMK-43)`.

## Task 7: `linear triage set`

**Files:** `scripts/lib/linear/triage.mjs`, `scripts/pmkit.mjs`, `scripts/cli-linear.test.mjs`, `scripts/lib/linear/triage.test.mjs`

- [ ] Write the failing tests in `triage.test.mjs` for the pure `planChange(current, flags, members)`: `--members` on an existing manual responsibility gives an update that keeps the current person when still listed, else index 0; no responsibility gives a create with `action` `assign`; `--action` alone keeps the members and is `INVALID_INPUT` without a responsibility; `--off` excludes the other flags; a schedule responsibility with `--members` is `CONFLICT` and names the schedule; `--off` and `--action` work on a schedule; an id outside the team is `INVALID_INPUT`.
- [ ] Write the failing CLI tests:
  - Free workspace: `set --off` and `set --members ... --dry-run` exit 2 with `NOT_SUPPORTED`, the message "triage rotation is unavailable on this workspace (plan free)" and the hint in `nextStep`; `isMutation` calls are 0.
  - Business: `set --members` as create, `set --members` as update, `set --action notify`, `set --off`; each sends exactly one mutation with the ids Linear returned and returns `{ before, after }` with `commit` equal to the team key.
  - `--dry-run` reads the responsibility, returns `{ before, after }`, ends with "dry run: nothing was written" and sends zero mutations.
  - A counting fetch asserts zero mutations for `show`, `suggestions` and every `--dry-run`.
  - The key appears in no mutation body log line, header output or error.
- [ ] Run and see the failures.
- [ ] Implement `planChange`, the `PmkitTriageCreate`, `PmkitTriageUpdate` and `PmkitTriageDelete` documents, and `set({ team, flags, dryRun })`. Availability runs first and throws `NOT_SUPPORTED` before any request. Add the command entry with `write: true`, `dryRun: true`, `booleans: ['off']`, `flags: ['team', 'members', 'action']`.
- [ ] Run the tests and see them pass. Commit `feat(cli): add linear triage set (PMK-43)`.

## Task 8: Contract and Local checks

**Files:** `scripts/cli-hosted.test.mjs`, `scripts/contract.test.mjs`

- [ ] Add a test that `TRACKER_OPERATIONS` and the Local tracker output are unchanged, and a test in `cli-hosted.test.mjs` asserting the list of `linear: true` commands is `['linear triage show', 'linear triage set', 'linear triage suggestions']`.
- [ ] Change `MIRRORED` to exclude `linear` commands, as it does for `local`.
- [ ] Run `node --test scripts/cli-hosted.test.mjs scripts/contract.test.mjs` and see it pass. Commit `test(cli): keep linear commands out of the hosted mirror (PMK-43)`.

## Task 9: Markdown command, router and docs

**Files:** `commands/linear/triage-rotation.md`, `skills/pmkit/SKILL.md`, `README.md`, `scripts/plugin.test.mjs`

- [ ] In `plugin.test.mjs`, add `linear: ['triage-rotation']` to `COMMANDS`, and a test that parses `triage-rotation.md` and asserts the `set` call has a `--dry-run` form in step 6 and a write form in step 7, like the `cycle/close` check. Run and see it fail on the missing file.
- [ ] Write `commands/linear/triage-rotation.md` from "The Markdown command" in the spec: frontmatter with `disable-model-invocation: true` and `argument-hint: "[show|set|suggestions]"`, the five sections the test checks, the seven steps, the two confirmation points, and the missing-key and Local and Free stops. Every operation is a `node "${CLAUDE_PLUGIN_ROOT}/scripts/pmkit.mjs" linear triage ...` call.
- [ ] List the command in `skills/pmkit/SKILL.md` with the natural-language triggers (who is on triage duty, triage rotation, Triage Intelligence), and in `README.md`.
- [ ] Run `node --test scripts/plugin.test.mjs` and see it pass. Commit `docs: add /pmkit:linear:triage-rotation (PMK-43)`.

## Task 10: Goldens

**Files:** `scripts/golden-cases.mjs`, `scripts/__goldens__/`

- [ ] Add `'linear triage show': () => [[]]`, `'linear triage set': () => [['--off']]` and `'linear triage suggestions': () => [[]]` to `CASES`.
- [ ] Run `node --test scripts/goldens.test.mjs` and see the new cases fail for missing goldens and the help golden fail for the new commands.
- [ ] Regenerate with the project's golden update command (see `scripts/goldens.test.mjs` for the variable). Read the diff: only the new case files and the help listing change, each new case records the `NOT_SUPPORTED` refusal in text and JSON, and the write also records `--dry-run`. Confirm no existing golden changed.
- [ ] Run `node --test scripts/goldens.test.mjs scripts/cli-hosted.test.mjs` and see it pass. Commit `test(cli): add goldens for the linear triage commands (PMK-43)`.

## Task 11: Scenario

**Files:** `scripts/__scenarios__/linear-triage-rotation.mjs` and its `.after.txt` snapshot

- [ ] Write the scenario on the `team` fixture, Local tracker: step 1 reads `capabilities`, the tracker is `local`, and the command stops. `skip` lists the Linear calls of steps 2 to 7 with the reason (the helper runs a child process and cannot inject the fake fetch). `notHit` lists the two confirmation points. `expect` asserts `saved.capabilities.tracker` is `local` and the tree is unchanged.
- [ ] Add a second entry with the config at `system: linear`, a workspace and no key, expecting step 1 to fail with `AUTH` through `expectError`.
- [ ] Run `node --test scripts/scenarios.test.mjs`, create the snapshot the way the neighbouring scenarios do, and read it.
- [ ] Run again and see it pass. Commit `test: add the linear-triage-rotation scenario (PMK-43)`.

## Task 12: Verification note

**Files:** `scripts/lib/linear/API-VERIFICATION.md`

- [ ] Add a section "Triage responsibility and Triage Intelligence" with the schema facts from the spec (types, queries, mutations, enums), the live result (`triageResponsibilities(first: 5)` and `Issue.suggestions` answer with empty lists on Free), the docs page `https://linear.app/docs/triage` read 2026-10-27 (Business and Enterprise), and the answer: `yes`, access `read` for suggestions and `read/write` for triage responsibility, with the mutations marked `schema, docs` because none was sent.
- [ ] Add one line to "Paid-plan features on a Free workspace": a read passes on Free for these objects, so the plan decides.
- [ ] Run `node --test scripts/adr-linear-auth.test.mjs` and the text checks in `scripts/plugin.test.mjs`. Commit `docs: record the triage verification (PMK-43)`.

## Task 13: Verify

- [ ] Run `npm test` and read the end of the output. All tests pass and no test opens a socket.
- [ ] Run `git grep -niE 'cheap.?courier|\bCHE\b'` and fix any hit.
- [ ] By hand, outside `npm test`: with the key loaded by the shell, run `node scripts/pmkit.mjs linear triage show --json` and `... suggestions --json` against the sandbox workspace. Expect `available: false`, `reason: plan`. Record the answer in the PR. Never print or pass the key.
- [ ] Run `superpowers:verification-before-completion` before calling the work done.

## Review focus

- The Free path in Task 5 and 7 tests: exit codes, no triage query, no mutation.
- `ctx.linear()` and the runner refusal: no change for any existing command or golden.
- The `set` plan: the current person kept, the schedule `CONFLICT`, create against update.
- The key in no output.
