# PMK-40 design: exercise the degraded paths of every command against Linear

Issue PMK-40, epic EPC-5 (Linear tracker adapter), milestone `linear`. Status: draft. An autonomous run wrote it without dialogue, and "Open questions" holds the choices that belong to the user.

## Problem

ADR-0001 says the Local tracker's seven `absent` capabilities are the only gaps that tests against it exercise. A hosted adapter that lacks a capability reports it as `absent` or `conditional`, and a capability can also be `derived`. MVP skills rule 4, which `skills/pmkit/references/conventions.md` repeats as rule 4, says: "When a result is derived or degraded, say so in one line, for example 'velocity computed from the last 3 sprints'."

Three facts shape the work.

- The CLI prints no such line today. `metrics velocity` on Linear computes from issue history and prints the same text as on Local. `cycle capacity` reads `.pmkit/capacity.yaml` and does not say so. Only `linear triage` and `linear customers` print an availability answer, and theirs takes four lines.
- Some refusals name the wrong path. `issues log-time` and the five `release` commands reach the generic stub, which says "the Linear adapter does not implement logTime yet" and sends the user to the Local tracker. The manifest already holds the right answer ("Linear has no time tracking", "Linear releases need the Business or Enterprise plan ...").
- No test runs a command, as opposed to a tracker operation, against the sandbox workspace. PMK-39's live run calls the tracker contract only.

Sources:

- ADR-0001, "Consequences", the bullet on gaps.
- MVP skills, "Rules", rule 4; `skills/pmkit/references/conventions.md`, "Rules", rule 4.
- The PMK-33 spec and `scripts/lib/linear/manifest.mjs` (the capability manifest).
- The PMK-37 spec ("Opening and closing", `cycle open` and `cycle close` are `NOT_SUPPORTED`) and the PMK-38 spec (`milestone create` and `docs create` are `NOT_SUPPORTED`).
- The PMK-43 and PMK-42 specs (triage and customers on Free answer with `available: false`).
- The PMK-39 spec and `scripts/lib/linear/sandbox.mjs`, `scripts/lib/linear/contract-live.mjs` (the live harness this design reuses).

Acceptance criteria:

1. Each command that needs a conditional or absent capability takes its degraded path on Linear.
2. Each degraded result says which path it used.

## Facts checked against the sandbox workspace

A read-only probe on 2026-10-28 ran `discover` and `capabilities` for team `PKT` with the PMK-39 run config (`git_host: none`, no `mappings.fields.estimate`). It sent 8 requests, no write, and 6,072 complexity points. The manifest it returned:

| Capability | Path | Why |
| --- | --- | --- |
| `cycles` | native, `open: false`, `close: false` | PKT has cycles on; Linear has no call to open or close a cycle |
| `estimation` | absent | PKT has estimates off |
| `native_triage` | native | PKT has triage on |
| `deliverables` | native, `derived: [deliverableProgress]`, `unsupported: [createMilestone]` | PMK-38 |
| `documents` | native, `unsupported: [createDocument]` | PMK-38 |
| `capacity` | derived, `source: local` | `.pmkit/capacity.yaml` |
| `native_metrics` | derived, `source: history` | PMK-36 |
| `linked_code` | derived, `source: git`, hint "Set git_host" | no Git integration, `git_host: none` |
| `releases`, `demand_signals`, `strategic_goals`, `request_queue` | absent | Free plan |
| `time_tracking`, `security_alerts` | absent | Linear has neither |
| `saved_views`, `agent_delegation`, `user_inbox` | absent | no pmkit command serves them |

Triage rotation is unavailable (Free plan) although `native_triage` is native. Customers are unavailable (`customersEnabled` false).

The sandbox reaches every path except `conditional`. A conditional entry needs two teams in scope with different settings. The Free workspace allows two teams and the second one is a real team, so the live run does not use it, and offline tests cover `conditional`.

## Goals

- Every command whose capability is not `native` on the current tracker prints one line that names the path it took.
- Every refusal on Linear names the capability's real reason and the manifest's `enableHint`, not the generic stub text.
- An offline test proves both rules for every pair of capability and command in `SERVED_BY`, plus the Linear-only commands.
- An opt-in live run proves them on the sandbox workspace and trashes what it made.

## Non-goals

- Mapping Linear releases, time tracking, initiatives or Asks. They stay absent.
- Rewriting the `/pmkit:cycle:close` and `/pmkit:cycle:plan` skills for a hosted ritual (PMK-41).
- Turning team settings on or off in the sandbox. That needs `teamUpdate`, which no allowlist holds.

## Anti-goals

- The note must not change stdout. Goldens and JSON schemas stay as they are.
- `npm test` must not touch the network, and `package.json` gains no dependency.
- No new mutation in the live allowlist beyond the ones `SUITE_ALLOWLIST` already checks.

## Approaches

### Who writes the line

1. **A central hook in the CLI.** After `command.run`, the CLI looks up the command's capabilities in `SERVED_BY`, reads the manifest, and prints a note for each non-native one. It covers every command in one place. It does not see the result, so it cannot say "from the last 3 sprints" or which basis `release-notes` chose. The Linear-only commands have no capability id.
2. **Each command returns `notes`, built by one shared helper.** `pathNote(manifest, id, facts)` turns a manifest entry and the facts a command knows (sprint count, basis, file) into one line. The CLI prints each note. A coverage test walks `SERVED_BY` and fails when a command on a non-native path prints no note and does not refuse. The note can cite the result. It touches about 25 run functions.
3. **The skills say it.** Each skill reads `capabilities` and phrases the line. CLI users see nothing, and only `scenarios-live.mjs` (paid `claude -p` runs) could test it.

**Choice: 2.** It is the only approach that can print the example in rule 4, and the coverage test gives approach 1's guarantee. Approach 3 cannot meet the anti-goal on `npm test`.

### Where the line goes

1. A `note: <line>` on stderr, the same channel as `warning:`. Stdout, goldens and schemas do not change. An agent that runs `--json` through Bash sees stderr too.
2. A `path` field in the JSON. Every schema and golden changes, and the text mode still needs a line.

**Choice: 1.**

### How the live run calls commands

1. Through `run()` from `scripts/pmkit.mjs`, with `adapters: { ...ADAPTERS, linear: linearDescriptor({ fetch: guarded }) }`. It runs the real argument parsing, the refusals and the notes.
2. Through the tracker operations, as PMK-39 does. It skips the CLI, which is where the notes live.

**Choice: 1.**

## Design

### Files

| File | Change |
| --- | --- |
| `scripts/lib/path-notes.mjs` | New. `pathNote(entry, facts)` returns one line or `null` for a native entry. One phrase per capability (table below). |
| `scripts/pmkit.mjs` | Each command in the list below returns `notes`. The runner prints `note: <line>` on stderr for each, after the warnings, in text and `--json` modes. |
| `scripts/lib/linear/tracker.mjs` | `logTime` and the five release operations throw `NOT_SUPPORTED` with the manifest's reason and `enableHint`, not the stub text. Release reads follow "Open questions", question 1. |
| `scripts/lib/linear/triage.mjs`, `customers.mjs` | The unavailable answer adds one note: "triage rotation is unavailable on this workspace (plan free); <hint>". The four text lines stay. |
| `scripts/lib/linear/degraded-live.mjs` | New. The opt-in live run (see "The live run"). `npm test` does not load it. |
| `scripts/cli-degraded.test.mjs` | New. The offline coverage test over the fake Linear API. |
| `scripts/lib/linear/API-VERIFICATION.md` | A "Degraded paths (PMK-40)" section with the run command and the measured request count. |
| `skills/pmkit/references/conventions.md` | Rule 4 adds: "The CLI prints the line as `note:`. Repeat it, do not rephrase it." |

### The note phrases

| Capability and path | Note |
| --- | --- |
| `native_metrics` derived, source history | `<metric> computed from Linear issue history` |
| `native_metrics` derived, source events (Local) | `<metric> computed from .issues/events.jsonl` |
| `metrics velocity`, any tracker | `velocity computed from the last <n> closed sprints` and, when estimation is absent, `counted issues: estimates are off (<enableHint>)` in the same line |
| `capacity` derived, source local | `capacity read from .pmkit/capacity.yaml; Linear has no capacity field` |
| `deliverables` with `derived: [deliverableProgress]` | `progress computed from the project's issues` |
| `linked_code` derived, source git | `branch and PR state read from git, not from the tracker` |
| `releases` absent, `release-notes` on another basis | `release notes built from sprint <id>: <enableHint>` |
| any `conditional` | `<capability> is on for teams <keys> only; <issue> is in team <key>` when the command names an issue, else `<capability> is on for teams <keys> only` |
| any `absent`, read answered empty | `<capability> is absent: <enableHint>` |

A refusal is one line too. The CLI prints `error: NOT_SUPPORTED <message>` and `next: <nextStep>`. The first line names the path, the second the way to turn it on. No note follows a refusal.

### Every command on Linear

"Live" says whether `degraded-live.mjs` runs the command on the sandbox. Every row runs offline in `cli-degraded.test.mjs`, which also sets each capability to `conditional` and `absent`.

| Command | Capability | Path on the sandbox | What it prints | Live |
| --- | --- | --- | --- | --- |
| `init` | none | not a tracker command | `--tracker linear` refuses: `tracker "linear" is not supported yet` | no |
| `capabilities` | all | native | the manifest table, no note | yes |
| `discover` | none | native | the discovery summary, no note | setup |
| `whoami` | none | native | the key owner, no note | yes |
| `issues list`, `issues get` | none | native | the issues; `--filter` with a value Linear cannot match refuses with `Leave this filter out on Linear` | yes |
| `issues dependencies` | `dependencies`, `multilevel_hierarchy` | native | the graph, no note | yes |
| `issues create`, `issues update` | `estimation` | absent | without `--estimate`, no note. With `--estimate 3`, refuses `NOT_SUPPORTED`, sends no mutation. With `--milestone` or `--release`, refuses with `Leave <key> out on Linear` | yes |
| `issues move` | `native_triage` | native | moves; to a category the team lacks, refuses `team <key> has no status in the <category> category` | yes |
| `issues assign`, `issues link`, `issues parent`, `issues comment`, `issues resolve`, `issues archive` | native or none | native | the write result, no note | no, PMK-39 covers them |
| `issues log-time` | `time_tracking` | absent | refuses `Linear has no time tracking` | yes |
| `cycle list`, `cycle current`, `cycle issues`, `cycle add` | `cycles` | native | the cycles, no note | read ones yes |
| `cycle open`, `cycle close` | `cycles`, `open: false`, `close: false` | native, operation unsupported | refuses with the PMK-37 messages | yes |
| `cycle capacity` | `capacity` | derived, local file | the capacity and `note: capacity read from .pmkit/capacity.yaml; ...` | yes, read and `--set` (a local write) |
| `epic list`, `epic get`, `epic create` | `deliverables` | native | the projects, no note | read ones yes |
| `epic progress` | `deliverables`, `derived: [deliverableProgress]` | derived | the progress and `note: progress computed from the project's issues` | no, it needs a project and `SUITE_ALLOWLIST` has no `projectCreate` |
| `epic update-status`, `epic updates` | `status_update` | native | the updates, no note | `updates` yes |
| `milestone list`, `milestone get` | `deliverables` | native | the milestones, no note | yes |
| `milestone create` | `deliverables`, `unsupported: [createMilestone]` | native, operation unsupported | refuses `the Linear adapter reads project milestones but does not create them` | yes |
| `release list`, `release get`, `release issues` | `releases` | absent | question 1: an empty answer with `note: releases is absent: <hint>`, or a refusal | yes |
| `release create`, `release mark-released` | `releases` | absent | refuses `NOT_SUPPORTED` with the plan hint | yes |
| `release-notes` | `releases`, `cycles` | releases absent | `--release` refuses; `--sprint current` builds notes with `note: release notes built from sprint <id>: <hint>` | yes |
| `docs read` | `documents` | native | the document, no note | no, needs a document |
| `docs create` | `documents`, `unsupported: [createDocument]` | native, operation unsupported | refuses `the Linear adapter reads project documents but does not create them` | yes |
| `metrics velocity` | `native_metrics`, `estimation` | derived, estimates absent | the table and `note: velocity computed from the last <n> closed sprints; counted issues: estimates are off (...)` | yes |
| `metrics cycle-time`, `lead-time`, `throughput`, `aging` | `native_metrics` | derived | the numbers and `note: <metric> computed from Linear issue history` | yes |
| `events` | `native_metrics` | derived | the events and `note: events computed from Linear issue history` | yes |
| `risks` | `native_metrics`, `linked_code` | derived, no git host | the risks, the existing `warning: no git host is configured, ...`, and one note for history | yes |
| `issues branch`, `pr open`, `pr ready`, `pr status`, `pr sync` | `linked_code` | derived, `git_host: none` | refuses `this repository has no git host configured` | `pr status` yes, the rest offline (they need a git repository) |
| `changelog` | none | not a tracker command | unchanged | no |
| `render`, `migrate`, `reindex` | none | Local only | refuses `<command> works only with the Local tracker` | `render` yes |
| `validate` | none | reads the config | unchanged | no |
| `linear triage show`, `linear triage suggestions` | triage rotation | unavailable, Free | the four availability lines and `note: triage rotation is unavailable on this workspace (plan free); <hint>`. Sends no triage query | yes |
| `linear triage set` | triage rotation | unavailable | refuses `NOT_SUPPORTED`, no mutation | yes |
| `linear customers list`, `linear customers show` | `demand_signals` | absent | the availability lines and one note. Sends no customer query | yes |
| `linear customers set`, `linear customers link` | `demand_signals` | absent | refuses `NOT_SUPPORTED`, no mutation | yes |

### The live run

`scripts/lib/linear/degraded-live.mjs` follows `contract-live.mjs`:

- Gate: `PMKIT_LIVE=1` and `PMKIT_LIVE_WORKSPACE`, through `skipReason`. Without them it skips with one reason and sends nothing.
- Setup: `preflight` (requires an empty test team), `findOrCreateTestTeam` (team `pmkit-test`, key `PKT`, reused), `waitForCycles`, then one `discover --refresh` in a temporary repository whose `.pmkit/config.yaml` names Linear, scope team `PKT`, `git_host: none`, and the PMK-39 mappings without `mappings.fields.estimate`.
- Guard: `createGuardedFetch` with `DEGRADED_ALLOWLIST`, the `issueCreate` and `issueUpdate` rules taken from `SUITE_ALLOWLIST`, plus the cleanup mutations `issueDelete` and `projectDelete`. Every degraded write must be refused by pmkit before it reaches the guard, and the run asserts the guard refused nothing.
- Seed data: 2 issues, one moved to started and then done, so the metrics have an entry. 4 mutations.
- Each row marked "Live" runs as `run([...argv, '--json'], { env, cwd, adapters })`. The test asserts the exit code, the `note:` line or the refusal's first line, and that the run sent no mutation other than the seed.
- Teardown: `trashTestTeamItems` in `after`, also on a signal through `installSignalHandlers`. `node scripts/lib/linear/contract-live.mjs cleanup [--yes]` cleans up after a crash, because both runs use the same team.

### Request budget

Counted from operations, not measured: preflight 4, team and states 3, cycles 1, discovery 8 (measured by the probe), seed 4, about 40 command runs at 1 to 4 requests each (about 110), cleanup 5. The run aims at about 140 requests, sets a cap of 300 and keeps 50 for cleanup. Preflight needs 400 requests and 300,000 complexity points left in the hour. Refusals send no request after the cached discovery. The first run records the real numbers in `API-VERIFICATION.md`.

## Tests

- `scripts/lib/path-notes.test.mjs`: one case per row of "The note phrases", and `null` for native.
- `scripts/cli-degraded.test.mjs`: for each capability in `SERVED_BY` and each command that serves it, a fake manifest sets the capability to `derived`, `conditional` and `absent` in turn. The command must print exactly one `note:` line or refuse with `NOT_SUPPORTED` whose message names the capability's reason. A list of exempt commands (the native write commands PMK-39 covers) needs a reason per entry. The Linear-only commands run against `fakeWorkspace` on Free.
- The test fails when a command joins `SERVED_BY` without a case, so a new command cannot skip rule 4.
- Existing goldens and `cli.test.mjs` keep their stdout. Local tests that check stderr gain the Local note for `native_metrics` and `linked_code` if question 2 is answered A.

## Acceptance criteria map

| Criterion | Design |
| --- | --- |
| 1. Each command that needs a conditional or absent capability takes its degraded path on Linear | "Every command on Linear" lists the path of each command. `tracker.mjs` replaces the stub text for `logTime` and the release operations. `cli-degraded.test.mjs` sets each capability to `conditional` and `absent` for every command in `SERVED_BY`. `degraded-live.mjs` runs the rows marked "Live" on the sandbox and asserts no unplanned mutation reached Linear. |
| 2. Each degraded result says which path it used | `path-notes.mjs` builds one line per capability and path. The CLI prints it as `note:` on stderr. A refusal's first line names the path. Both tests assert exactly one line per degraded result. Conventions rule 4 tells skills to repeat it. |

## Decisions

- Approach 2 (commands return `notes` from one helper), the note on stderr, and the live run through `run()`.
- `conditional` is covered offline only, because the sandbox's second team is real.
- The live run reuses the PMK-39 team and cleanup and adds no mutation to the allowlist.
- The native write commands that PMK-39 already exercises stay out of the live run.
- `epic progress` runs offline only. A live case would need `projectCreate`, which `SUITE_ALLOWLIST` does not hold.

## Open questions

1. **Release reads on a workspace without releases.** A: `release list`, `get` and `issues` answer with the empty shape their schema has, plus `note: releases is absent: <hint>`, as triage and customers answer on Free. B: all five release commands refuse with `NOT_SUPPORTED` and the hint. Recommendation: A, because skills that list releases then need no error branch, and the writes still refuse.
2. **The note on the Local tracker.** A: print it on every tracker, so Local `metrics` and `pr` commands say "computed from .issues/events.jsonl" and "read from git". B: print it on hosted trackers only. Recommendation: A, because rule 4 does not depend on the tracker. Some Local stderr assertions change.
3. **Who runs the live check.** The run sends 4 seed mutations to the test team. A: the implementation stage runs it once and records the numbers. B: the user runs it. Recommendation: A, inside the guard and the cap.

## Risks

- `capabilities()` must read the cached discovery without a request, or every command pays one request for its note. The plan checks this first.
- `release-notes` with no flag picks a basis today. With releases absent it must pick the sprint and say so, which changes its Linear behaviour.
- The coverage test depends on `SERVED_BY` being complete. A command that uses a capability but is missing from `SERVED_BY` escapes it.
- Seed issues count toward the 250 issues of the Free plan, and trashed issues may count too (unverified in `API-VERIFICATION.md`).
