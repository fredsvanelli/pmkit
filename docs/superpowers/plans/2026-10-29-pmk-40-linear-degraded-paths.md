# PMK-40 plan: degraded paths of every command against Linear

Spec: `docs/superpowers/specs/2026-10-29-pmk-40-linear-degraded-paths-design.md` (read its "Every command on Linear" table and "Answers" first). Issue PMK-40, epic EPC-5. Every commit message carries `(PMK-40)`.

Rules for every task. Write the failing test first, run it, see it fail, then implement. Run `node --test <file>` for the task, and `npm test` at the end of the task. Stdout, goldens and JSON schemas must not change. `npm test` must not touch the network. Each task is one commit. Text follows the unslop rules and no real workspace name appears anywhere; examples use `acme` and `ACME`.

## Task 1. Read the manifest without a request

Context: `scripts/lib/capabilities.mjs` (`SERVED_BY`, `buildCapabilities`), `scripts/lib/linear/tracker.mjs` `capabilities()` (line ~99), `scripts/lib/linear/tracker.test.mjs` (line ~142, ~167).
Test: after one `discover()`, `capabilities()` sends zero extra requests (count calls on the fake API from `scripts/fake-linear-api.mjs`).
Do: if the test fails, make `capabilities()` reuse the cached discovery. If it passes, commit only the test.
Commit: `test: capabilities() reuses the cached discovery (PMK-40)`.
Criteria: supports 1 and 2 (no extra cost per note).

## Task 2. The note helper

Context: new `scripts/lib/path-notes.mjs`, new `scripts/lib/path-notes.test.mjs`. A manifest entry has `id`, `path` (`native`, `derived`, `conditional`, `absent`), `enableHint`, `detail` (for example `{ source: 'history' }`). Spec table "The note phrases" lists the phrases.
Test: one case per row of that table, plus `null` for a native entry.
Do: export `pathNote(entry, facts)` returning one line or `null`.
Commit: `feat: add the path-note helper (PMK-40)`.
Criteria: 2.

## Task 3. The runner prints `note:`

Context: `scripts/pmkit.mjs` lines ~1820 to 1832 (the success path pushes `warning:` lines to `stderr`), and the error path below it. `scripts/cli.test.mjs` for how tests read stderr.
Test: a command whose result has `notes: ['x']` prints `note: x` on stderr after the warnings, in text and `--json` modes, and stdout is unchanged. A refusal prints no note.
Do: print `result.notes` the way `result.warnings` is printed.
Commit: `feat: print result notes as note lines on stderr (PMK-40)`.
Criteria: 2.

## Task 4. Notes for the metrics commands and `events`

Context: `scripts/pmkit.mjs` commands `metrics velocity` (line ~770), `metrics cycle-time`, `lead-time`, `throughput`, `aging`, `events`. Metric sources: `native_metrics` entry `detail.source` is `history` (Linear) or `events` (Local). Use `ctx.tracker()` then `capabilities()`.
Test: in `scripts/metrics.test.mjs` or a new `scripts/cli-degraded.test.mjs`, each command prints exactly one note on Linear (fake API, `fakeWorkspace`) and on Local (answer 2). Velocity prints `velocity computed from the last <n> closed sprints`, plus `counted issues: estimates are off (<enableHint>)` when `estimation` is absent.
Do: return `notes` built with `pathNote`. Update the Local stderr assertions that now see a note.
Commit: `feat: say which path metrics and events took (PMK-40)`.
Criteria: 1, 2.

## Task 5. Notes for capacity, epic progress, risks and linked code

Context: commands `cycle capacity` (line ~533), `epic progress`, `risks`, and the `pr` and `issues branch` commands (`pr status` at ~913). The existing `warning: no git host is configured` stays. `linked_code` derived with `git_host: none` refuses with `this repository has no git host configured`.
Test: `cycle capacity` prints `capacity read from .pmkit/capacity.yaml; Linear has no capacity field`. `epic progress` prints `progress computed from the project's issues`. `risks` prints one history note beside its warning. The `linked_code` commands on Linear and Local with git configured print `branch and PR state read from git, not from the tracker`; without git they refuse.
Do: return `notes` from each.
Commit: `feat: say which path capacity, progress, risks and pr commands took (PMK-40)`.
Criteria: 1, 2.

## Task 6. Real refusals for time tracking and the manifest-driven writes

Context: `scripts/lib/linear/tracker.mjs` `stub(operation)` (line ~146) and where `logTime` and the release writes use it; `scripts/lib/linear/manifest.mjs` holds the reasons ("Linear has no time tracking", the releases plan hint).
Test in `scripts/lib/linear/tracker.test.mjs`: `logTime`, `createRelease` and `markReleased` throw `NOT_SUPPORTED` with the manifest reason in the message and the `enableHint` in `nextStep`. No request is sent after discovery.
Do: replace the stub text for those operations with the manifest's reason and hint.
Commit: `fix: refuse log-time and release writes with the manifest reason (PMK-40)`.
Criteria: 1, 2.

## Task 7. Release reads answer empty with a note

Context: same file as Task 6; the release read operations (`listReleases`, `getRelease`, `releaseIssues` or the names the grep finds with `grep -n "elease" scripts/lib/linear/tracker.mjs`), and the schemas in `scripts/__fixtures__` or `schemas` for `release list`, `get`, `issues`. `scripts/lib/linear/customers.mjs` shows the "unavailable answer" pattern.
Test: on Free, `release list` returns the empty list shape and prints `note: releases is absent: <hint>`; `release get` and `release issues` do the same with the schema's empty shape (answer 1). Output validates against the schema. No release query is sent.
Do: implement it in the adapter and return the note from the commands.
Commit: `feat: answer release reads empty on a workspace without releases (PMK-40)`.
Criteria: 1, 2.

## Task 8. `release-notes` picks the sprint and says so

Context: `scripts/pmkit.mjs` `release-notes` (line ~677), `scripts/lib/release-notes.mjs` (`chooseBasis`), `scripts/release-notes.test.mjs`.
Test: on Linear with `releases` absent, `--release` refuses `NOT_SUPPORTED`; `--sprint current` builds notes and prints `release notes built from sprint <id>: <enableHint>`; with no flag it picks the sprint and prints the same note. Local behaviour does not change.
Do: pass the capability into `chooseBasis`, return the note.
Commit: `feat: release-notes falls back to the sprint on Linear without releases (PMK-40)`.
Criteria: 1, 2.

## Task 9. Triage and customers notes

Context: `scripts/lib/linear/triage.mjs`, `scripts/lib/linear/customers.mjs`, `scripts/cli-linear.test.mjs`. Their unavailable answer has four text lines.
Test: on Free, `linear triage show` and `suggestions` keep the four lines and add `note: triage rotation is unavailable on this workspace (plan free); <hint>`. `customers list` and `show` add one note. `triage set`, `customers set` and `link` refuse `NOT_SUPPORTED` and send no mutation. No triage or customer query is sent.
Do: add `notes` to the unavailable answers.
Commit: `feat: add a note to the unavailable triage and customers answers (PMK-40)`.
Criteria: 1, 2.

## Task 10. The coverage test

Context: new `scripts/cli-degraded.test.mjs`; `SERVED_BY` in `scripts/lib/capabilities.mjs`; `scripts/fake-linear-api.mjs` (`fakeWorkspace`, how `cli-linear.test.mjs` builds the config and `adapters`).
Test: for each capability in `SERVED_BY` and each command listed, set a fake manifest entry to `derived`, `conditional` and `absent` in turn. The command prints exactly one `note:` line or refuses `NOT_SUPPORTED` whose message names the capability's reason. Exempt commands (native writes PMK-39 covers) need a reason per entry. The test fails when a command joins `SERVED_BY` without a case. Add the conditional note phrases (`<capability> is on for teams <keys> only`) in `path-notes.mjs` if Task 2 left them out.
Do: fix the commands the test finds. Also cover the refusals of the spec table (`cycle open`, `cycle close`, `milestone create`, `docs create`, `issues create --estimate 3`, `init --tracker linear`, Local-only commands) offline.
Commit: `test: cover the degraded path of every command on Linear (PMK-40)`.
Criteria: 1, 2.

## Task 11. Conventions rule 4 and the API note section

Context: `skills/pmkit/references/conventions.md` (rule 4), `scripts/lib/linear/API-VERIFICATION.md`. Check `scripts/plugin.test.mjs` for tests on the conventions text.
Do: add to rule 4 "The CLI prints the line as `note:`. Repeat it, do not rephrase it." Add a "Degraded paths (PMK-40)" section to the API note with the run command and a placeholder line "request count: filled in by the live run".
Commit: `docs: tell skills to repeat the note line (PMK-40)`.
Criteria: 2.

## Task 12. The live run script (written and unit-checked, not executed)

Context: new `scripts/lib/linear/degraded-live.mjs`. Reuse from `scripts/lib/linear/contract-live.mjs`: `skipReason` (line 34), `runCleanup` (61), `buildLiveRun` (90), `installSignalHandlers` (187), `registerLiveSuite` (203); from `sandbox.mjs`: `createGuardedFetch`, `SUITE_ALLOWLIST`, `preflight`, `findOrCreateTestTeam`, `waitForCycles`, `trashTestTeamItems`. Test pattern: `scripts/lib/linear/sandbox.test.mjs`.
Test (offline): without `PMKIT_LIVE=1` and `PMKIT_LIVE_WORKSPACE` the module skips with one reason and sends nothing. `DEGRADED_ALLOWLIST` holds the `issueCreate` and `issueUpdate` rules of `SUITE_ALLOWLIST` plus `issueDelete` and `projectDelete`, and nothing else. The row list for the "Live" rows of the spec table is a data array that the test can count.
Do: write the module as the spec's "The live run" describes: temporary repository config (Linear, scope team `PKT`, `git_host: none`, no estimate mapping), seed of 2 issues, each live row through `run([...argv, '--json'], { env, cwd, adapters })`, assertion that the guard refused nothing, request cap 300, teardown in `after` and on signal. `npm test` must not load it.
Commit: `test: add the opt-in live run for degraded paths (PMK-40)`.
Criteria: 1, 2 (the live proof itself is Task 13).

## Task 13. Live run on the sandbox (not run in stage 3)

A separate agent runs this in stage 6. The implementation stage skips it.
Run: `PMKIT_LIVE=1 PMKIT_LIVE_WORKSPACE=$PMKIT_LIVE_WORKSPACE node scripts/lib/linear/degraded-live.mjs` (use the same invocation `contract-live.mjs` documents). Confirm the rows marked "Live" pass, the guard refused nothing, and the team is clean afterwards. If the run crashes, run `node scripts/lib/linear/contract-live.mjs cleanup --yes`.
Record the measured request count and complexity in the "Degraded paths (PMK-40)" section of `scripts/lib/linear/API-VERIFICATION.md`. Run the private-name check before the commit.
Commit: `docs: record the PMK-40 live run in the API note (PMK-40)`.
Criteria: 1 and 2 on the real workspace.

## Acceptance map

| Criterion | Tasks |
| --- | --- |
| 1. Each command that needs a conditional or absent capability takes its degraded path | 4, 5, 6, 7, 8, 9, 10, 12, 13 |
| 2. Each degraded result says which path it used | 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 13 |
