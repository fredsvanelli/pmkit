# PMK-43 design: add the linear-triage-rotation command

Issue PMK-43, epic EPC-5 (Linear tracker adapter), milestone `linear`. Status: draft, with four open questions at the end. Decisions come from an autonomous brainstorming run on 2026-10-27 with no user dialogue, from the issue, ADR-0002, ADR-0005, the PMK-29 and PMK-33 specs, the code, and read-only schema calls to the sandbox workspace. Calls marked **(builder's call)** were made while writing this spec and change no acceptance criterion.

## Problem

The Unified model lists `linear-triage-rotation` as a Linear (Business) skill: "Views and adjusts triage responsibility (manual rotation or PagerDuty) and uses Triage Intelligence suggestions". The Linear tab, domain 4, marks two rows as read-only uses: "Triage responsibility, rotation or PagerDuty (Business)" for "Who is on duty", and "Triage Intelligence (Business)" for "Reuse native suggestions". No command shows or changes who is on duty, and no code reads Linear's suggestions.

Two facts shape the work.

- The feature needs Linear's Business plan, and the sandbox workspace is on Free. The command cannot be proven end to end here. The proof of this issue is the path where the capability is absent, plus tests of the present path against a fake.
- A command reaches the tracker through `ctx.tracker()`, which holds the contract operations only. Triage responsibility exists in Linear and in no other tracker.

Sources:

- Unified model, "System-specific skills", row `linear-triage-rotation`.
- Linear tab, domain 4 "Triage", and the convention "(Business): feature restricted to the Business plan or higher; skills must degrade on Free and Basic plans".
- ADR-0002 (commands are the source for every agent) and ADR-0005 (the key comes from `LINEAR_API_KEY`).
- The PMK-33 spec for the manifest, the plan names and the rule "absent, with Linear's path in `detail.workspace`".
- `scripts/lib/linear/API-VERIFICATION.md` for the rule on gated features: schema first, docs second, live read third.

Acceptance criteria:

1. Shows and adjusts who is on triage duty.
2. Uses Triage Intelligence suggestions when the plan has them.

## Facts checked against the Linear API

Read-only introspection and reads on 2026-10-27 against the sandbox workspace (Free plan), with a personal key loaded by the shell. The calls were queries only. The names below are Linear's own, and none is workspace-specific.

| Object | Result |
|---|---|
| `Team.triageResponsibility` | Field of type `TriageResponsibility`, null when the team has none. On the sandbox team it is null. |
| `Team.triageEnabled`, `Team.triageIssueState`, `Team.requirePriorityToLeaveTriage` | Fields exist. `triageEnabled` is false on the sandbox team. |
| `TriageResponsibility` | `id`, `action`, `manualSelection`, `team`, `timeSchedule`, `currentUser`, plus timestamps. |
| `TriageResponsibilityAction` | Enum with two values, `assign` and `notify`. |
| `TriageResponsibilityManualSelection` | `userIds` (list of user ids) and `assignmentIndex` (position of the current person in that list). |
| `TimeSchedule` | `name`, `entries`, `externalId`, `externalUrl`, `config`, `integration`. A schedule synced from PagerDuty has an `integration`. A responsibility uses either a `manualSelection` or a `timeSchedule`. |
| Queries | `triageResponsibilities`, `triageResponsibility`, `timeSchedules`, `timeSchedule`. |
| Mutations | `triageResponsibilityCreate` (`teamId`, `action`, `manualSelection`, `timeScheduleId`), `triageResponsibilityUpdate` (`action`, `manualSelection`, `timeScheduleId`), `triageResponsibilityDelete`. Also `integrationPagerDutyConnect`, `integrationPagerDutyRefreshScheduleMappings` and `timeScheduleUpsertExternal`. The mutations come from the schema only. None was sent. |
| `IssueSuggestion` | The object behind Triage Intelligence. Fields `issue`, `type`, `state`, `metadata` (`score`, `classification`, `reasons`), `suggestedTeam`, `suggestedProject`, `suggestedUser`, `suggestedLabel`, `suggestedIssue`, `presentedReasons`, `dismissalReason`. |
| `IssueSuggestionType` | `team`, `project`, `assignee`, `label`, `similarIssue`, `relatedIssue`. |
| `IssueSuggestionState` | `active`, `stale`, `accepted`, `dismissed`. |
| `Issue.suggestions`, `Issue.suggestionsGeneratedAt`, `Issue.startedTriageAt`, `Issue.triagedAt` | Fields exist. |
| Mutations on suggestions | None found. The schema has no accept or dismiss mutation whose name matches `suggest`. An accepted suggestion is applied through the normal issue update. |
| Live reads | `triageResponsibilities(first: 5)` returns an empty list and `Issue.suggestions` returns an empty list, both without error. |

Consequences:

- A live read does not prove the plan. The reads pass on Free, as PMK-33 found for initiatives and views. The command cannot treat a successful empty read as "no rotation configured" when the plan has no rotation. The plan and the team's `triageEnabled` flag decide first.
- Which plan strings Linear returns for Business and Enterprise is still unverified. PMK-33's `BUSINESS_PLANS` list (`business`, `enterprise`, `trial`) is the one source, and this command reuses it.
- The Business gate on triage responsibility and on Triage Intelligence comes from the Linear tab and the Unified model. The schema shows the objects exist on every plan. No docs page was read in this run for the exact plan names **(builder's call)**. Stage 2 repeats the PMK-29 docs check for triage responsibility and Triage Intelligence and records the page and date in `API-VERIFICATION.md`.
- Triage Intelligence is read-only. The Linear tab marks it "R".

## Goals

- A CLI group `linear triage` with three commands. `show` prints who is on duty for a team. `set` changes the rotation. `suggestions` prints the active Triage Intelligence suggestions for the issues in the team's triage inbox.
- On a workspace without the capability, each command says so and says how to get it, and a write changes nothing.
- A Markdown command `/pmkit:linear:triage-rotation` that walks the user through showing, changing and reading suggestions, and that only runs `node ".../pmkit.mjs" linear triage ...`.
- All of it testable with the fake Linear fetch. `npm test` sends nothing.

## Non-goals

- Connecting PagerDuty or building a schedule. `show` reads a schedule that already exists. `set` does not create or change one (open question 3).
- Accepting or dismissing a suggestion in Linear. The schema has no mutation for it.
- Applying a suggestion to an issue (team, project, assignee, label, duplicate). That is `issues update` and `issues link`, which Linear gets in PMK-35. This command needs nothing from PMK-34 or PMK-35 and does not use their code.
- Changing `/pmkit:backlog:triage` so it reads suggestions (open question 4).
- A new capability ID. The Technical spec fixes the 20 IDs (open question 2).
- Any write to Linear while building or testing on Free.

## Anti-goals

- `npm test` opening a socket, or a new dependency (ADR-0003).
- A change to a Local tracker output or to a golden that exists today. The new command adds golden cases of its own.
- The key in output, in an error, in a cache file or on a command line (ADR-0005).
- The real workspace URL key or team key in any file. Examples use `acme` and `ACME`, and docs say "the sandbox workspace".
- A mutation sent from a read command, or from `set --dry-run`.

## Approaches

### Where the code lives

1. **Three new contract operations** (`getTriageDuty`, `setTriageDuty`, `triageSuggestions`) in `TRACKER_OPERATIONS`. Every tracker has to implement them, so the Local tracker and `fake-hosted.mjs` get stubs that throw `NOT_SUPPORTED`, and the contract suite grows three cases that no other tracker can pass. Triage responsibility exists only in Linear, so the contract would carry a Linear feature for every future tracker.
2. **A Linear extension, reached with `linear: true` and `ctx.linear()`.** It mirrors what `local: true` and `ctx.local()` do for the Local tracker. The runner refuses a `linear` command when `tracker.system` is not `linear`, and `ctx.linear()` returns the raw Linear tracker's `triage` object. The contract stays as it is.
3. **A Markdown command that calls the GraphQL API itself.** ADR-0002 forbids it. Commands never compute, and the key must stay inside code.

Chosen: approach 2. It follows a pattern the code already has, keeps the contract free of a one-system feature, and lets the other system-specific skills (`linear-customers` and the Jira ones) take the same shape later **(builder's call)**.

### How the command decides the capability is absent

1. **A new manifest capability** such as `triage_rotation`. It changes the fixed list of 20 IDs in the Technical spec, every manifest golden and `/pmkit:help`, for one system-specific skill.
2. **Plan and team setting from the discovery the tracker already caches.** The plan comes from `raw.workspace.plan`, the team setting from `team.triageEnabled`. No extra request, and the answer follows the rule PMK-33 uses for the same facts.
3. **A live probe** of `triageResponsibilities`. It answers empty on Free, so it proves nothing. Rejected on the evidence above.

Chosen: approach 2.

## Design

### Files

| File | Change |
|---|---|
| `scripts/lib/linear/triage.mjs` | New. The GraphQL documents, `createTriage({ client, discovery, config })`, and the pure helpers `triageAvailability(raw, team)`, `dutyView(node, raw)` and `suggestionsView(nodes)`. |
| `scripts/lib/linear/tracker.mjs` | Adds `triage` to the object `createLinearTracker` returns. `contractView` ignores it, so commands that use `ctx.tracker()` do not see it. |
| `scripts/lib/linear/manifest.mjs` | Exports `BUSINESS_PLANS`, so `triage.mjs` and the manifest share one list. |
| `scripts/pmkit.mjs` | Adds `linear: true` to the command shape, `ctx.linear()`, the runner refusal for any other `tracker.system`, and the three commands in `COMMANDS`. |
| `commands/linear/triage-rotation.md` | New. The procedure for `/pmkit:linear:triage-rotation`. |
| `skills/pmkit/SKILL.md`, `README.md`, `scripts/plugin.test.mjs` | List the command. The test adds a `linear` folder to `COMMANDS`. |
| `scripts/golden-cases.mjs`, `scripts/__goldens__/` | Cases for the three commands on the Local fixtures, which record the refusal. |
| `scripts/__scenarios__/linear-triage-rotation.mjs` and its snapshot | The scenario for the command file (see Tests). |
| `scripts/fake-linear-api.mjs` | Adds routes for the triage operations and the `fakeTriage(options)` helper. |
| `scripts/lib/linear/triage.test.mjs`, `scripts/cli-linear.test.mjs` | Unit and CLI tests. |
| `scripts/lib/linear/API-VERIFICATION.md` | Adds a section for triage responsibility and Triage Intelligence with the facts above and the docs page checked. |

`CHANGELOG.md` and the plugin version do not change in this issue. The release adds the entry and the bump, as in the other EPC-3 and EPC-5 issues.

### The CLI commands

All three take `--team KEY`. Without it the command uses `tracker.scope.team`. With neither and exactly one team in the workspace it uses that team. With neither and several teams it fails with `INVALID_INPUT` and lists the team keys in the next step.

| Command | Kind | What it does |
|---|---|---|
| `linear triage show [--team KEY]` | read | Prints who is on duty for the team. |
| `linear triage set [--team KEY] (--members id,.. [--action assign\|notify] \| --action assign\|notify \| --off) [--dry-run]` | write, takes `--dry-run` | Changes the manual rotation, the action, or removes the responsibility. |
| `linear triage suggestions [--team KEY] [--limit n]` | read | Prints the active suggestions for the issues in the team's triage inbox. |

`ctx.linear()` returns `null` when `tracker.system` is not `linear`. The runner refuses a command with `linear: true` before any adapter work, with `NOT_SUPPORTED` ("`linear triage show` works only with the Linear tracker, and tracker.system is "local""), as `local: true` does for `render`, `migrate` and `reindex`.

### The availability check

`triageAvailability(raw, team)` returns `{ available: true }` or `{ available: false, reason, enableHint }`, in this order.

| Order | Condition | `reason` | `enableHint` |
|---|---|---|---|
| 1 | `raw.workspace.plan` is not in `BUSINESS_PLANS` | `plan` | Triage responsibility needs the Business or Enterprise plan |
| 2 | The team has `triageEnabled` false | `triage_off` | Turn on triage in the team's settings in Linear |

The plan comes first because on Free the second answer would send the user to a setting that cannot help. The check reads the cached discovery (one hour, refreshed by `pmkit discover`). A user who has just upgraded runs `pmkit discover` to see the new plan.

### What each command prints and returns

`show` on a workspace with the capability:

```
team: ACME
action: assign
source: manual
on duty: Ana Souza
rotation: Ana Souza (current), Bruno Lima
```

```json
{
  "available": true,
  "team": "ACME",
  "duty": {
    "action": "assign",
    "source": "manual",
    "current": { "id": "user-2", "name": "Ana Souza" },
    "members": [{ "id": "user-2", "name": "Ana Souza" }, { "id": "user-3", "name": "Bruno Lima" }],
    "schedule": null
  }
}
```

- `source` is `manual` when `manualSelection` is set, `schedule` when `timeSchedule` is set, and `none` when the team has no responsibility. With `none`, `duty` has `current: null`, an empty `members` list and `action: null`, and the text says "nobody is on triage duty".
- `current` is `TriageResponsibility.currentUser`. For a manual rotation, `members` is `manualSelection.userIds` in order. For a schedule, `members` is empty, `schedule` holds `{ id, name, provider, url }`, and `provider` is `pagerduty` when the schedule's `integration.service` is PagerDuty, else the service name, else `linear`.
- A user id that Linear no longer returns (a user who left) shows as `(unknown user)` with its id, and the text adds a warning.

`show` and `suggestions` on a workspace without the capability exit 0:

```
triage rotation: unavailable
reason: plan
plan: free
enable: Triage responsibility needs the Business or Enterprise plan
```

```json
{
  "available": false,
  "reason": "plan",
  "plan": "free",
  "team": "ACME",
  "enableHint": "Triage responsibility needs the Business or Enterprise plan"
}
```

A read answers a question, and "nobody can be on duty here" is an answer. An agent or a command that reads the JSON branches on `available` and needs no error handling. The Linear tab asks every skill to degrade on Free, and this is the degraded result **(builder's call, open question 1)**.

`set` on a workspace without the capability exits 2 with `NOT_SUPPORTED`, the message "triage rotation is unavailable on this workspace (plan free)", and the same `enableHint` as the next step. It sends no mutation. A write that cannot happen is an error, as the other commands treat a refused write.

`set` rules, with the capability present:

- `--members` takes a comma-separated list of member IDs from `pmkit discover`. An ID that is not a member of the team is `INVALID_INPUT`. The order is the rotation order. The first ID becomes the current person (`assignmentIndex` 0) unless the existing current person is in the new list, in which case that person stays current **(builder's call)**.
- `--action` takes `assign` or `notify`. Alone, it changes the action and keeps the members. If the team has no responsibility yet, `--action` alone is `INVALID_INPUT`, because there is nobody to assign or notify.
- `--off` removes the responsibility (`triageResponsibilityDelete`). It excludes the other flags.
- A responsibility that already exists is updated with `triageResponsibilityUpdate`. A team without one gets `triageResponsibilityCreate`, with `action` defaulting to `assign`.
- A team whose current responsibility comes from a schedule is not edited. `set --members` on it fails with `CONFLICT` and the next step names the schedule and says to change it in Linear. `--off` is allowed, and so is `--action` (open question 3).
- `--dry-run` reads the current responsibility with the same query as `show`, builds the change and returns `{ before, after }`. It sends no mutation. Text ends with "dry run: nothing was written".
- A write returns `{ before, after }` in the shape `show` uses for `duty`, with `after` read back from the mutation payload. The commit id (`commit`) is the team key. A hosted tracker never auto-commits, so it has no effect.

`suggestions` with the capability present:

```
ACME-12  Login fails on Safari
  team ACME (score 0.82)
  assignee Ana Souza (score 0.74)
  label bug (score 0.91)
  similar issue ACME-3 (score 0.67)
```

```json
{
  "available": true,
  "team": "ACME",
  "issues": [
    {
      "id": "ACME-12",
      "title": "Login fails on Safari",
      "suggestions": [
        { "type": "label", "target": { "id": "label-1", "name": "bug" }, "score": 0.91, "reasons": ["..."] }
      ]
    }
  ],
  "withoutSuggestions": 2
}
```

- The query is `issues(filter: { team: { key: { eq } }, state: { type: { eq: "triage" } } }, first: n)` with `suggestions(filter: { state: { eq: active } })` on each node. It is a read-only query that belongs to this command. It does not use the contract's `searchIssues`, which PMK-35 implements.
- `type` is the `IssueSuggestionType` value. `target` is the suggested team, project, user, label or issue, whichever the suggestion carries. `score` and `reasons` come from `metadata`. `reasons` uses `presentedReasons` when present, else `metadata.reasons`.
- Issues are listed oldest first. `--limit` defaults to 25 and caps at 100. The page cap of the client applies. When more issues exist, a warning says how many were left out.
- An empty inbox prints "no issue is waiting in triage". An issue with no active suggestion counts in `withoutSuggestions` and is not listed.
- Stale, accepted and dismissed suggestions are not shown. A suggestion is a hint from Linear, and the text says so.

### The Markdown command

`commands/linear/triage-rotation.md` has the frontmatter and the five sections that `plugin.test.mjs` checks. `argument-hint` is `"[show|set|suggestions]"`.

1. Run `node "${CLAUDE_PLUGIN_ROOT}/scripts/pmkit.mjs" capabilities --json`. When `tracker` is not `linear`, say the command works only with Linear and stop. This is the step the scenario exercises on a Local fixture.
2. Run `linear triage show --json`. When `available` is false, print the reason and the `enableHint`, and stop. Mention that `native_triage` and the rest of the triage commands work on the plan.
3. Show who is on duty, the action, the source, and the rotation. When the source is a schedule, show the provider and say pmkit does not change a schedule.
4. Run `linear triage suggestions --json` and show the suggestions per issue, with the score and reasons, labeled as Linear's suggestions. Say that applying one is a normal issue edit.
5. Ask with `AskUserQuestion` what to do next. The choices are change the rotation, change the action, turn the responsibility off, or stop.
6. For a change, run `linear triage set ... --dry-run --json`, show `before` and `after`, and ask once to apply. The preview is shown whatever `write_policy.confirm` says, because the change decides who receives new triage issues.
7. On approval, run the same command without `--dry-run`. Run `show` again and compare it with the preview.

Confirmation points: the next action (step 5) and the preview (step 6). Declining changes nothing.

Output: the team, who is on duty now, the rotation, the suggestions per issue, and what changed.

If something is missing: no `LINEAR_API_KEY` is `AUTH` and the conventions say what to tell the user. A Local tracker stops at step 1. A Free workspace stops at step 2 with the hint.

### What this command needs from other issues

Nothing from PMK-34 (mappings and setup) or PMK-35 (issues, relations and search). It reads the team through the discovery PMK-33 built, and it queries triage issues itself. Two follow-ups stay out of scope.

- PMK-35 gives `/pmkit:backlog:triage` the Linear issue operations. Reading suggestions there waits for that.
- PMK-34 may map a pmkit status to Linear's triage state. The inbox query uses the state type `triage`, which does not depend on the mapping.

## Tests

- `triage.test.mjs`. `triageAvailability` for each row of the table, including `trial` and an unknown plan. `dutyView` for manual, schedule (PagerDuty and other providers) and none, and for an unknown user. `suggestionsView` for each suggestion type, the `presentedReasons` fallback and stale suggestions dropped.
- CLI tests in `cli-linear.test.mjs` over `fakeLinearFetch(fakeWorkspace({ subscription: ... }))` plus the triage routes.
  - Free workspace (the proof for this issue). `show` and `suggestions` exit 0 with `available: false`, `reason: plan` and the hint, in text and JSON. The fetch log shows no triage query and no mutation. `set` and `set --dry-run` exit 2 with `NOT_SUPPORTED`, and the log shows no mutation.
  - Business workspace with triage off. `reason: triage_off`.
  - Present path. `show` for a manual rotation, a schedule and no responsibility. `set --members` as create and as update, `set --action`, `set --off`, and each `INVALID_INPUT` and `CONFLICT` case. `--dry-run` sends no mutation, and the real write sends exactly one. `suggestions` with active and stale suggestions and an empty inbox.
  - The single mutation carries the ids Linear returned and no key in any body, header log line or error.
  - `linear triage show` on a Local repository exits 2 with `NOT_SUPPORTED`.
- A test that `isMutation` is true only in the three `set` paths: a counting fetch asserts zero mutations for `show`, `suggestions` and every `--dry-run`.
- Goldens. `CASES` gets `'linear triage show': () => [[]]`, `'linear triage set': () => [['--off']]` and `'linear triage suggestions': () => [[]]`. On the Local fixtures each records the `NOT_SUPPORTED` refusal, in text and JSON, and the write also runs with `--dry-run`. The three commands are excluded from the hosted mirror, as the `local: true` ones are, and `cli-hosted.test.mjs` asserts the list of `linear` commands.
- Scenario `linear-triage-rotation.mjs`. The scenario helper runs the real CLI in a child process, so it cannot inject the fake fetch. The scenario runs on the `team` fixture (a Local tracker) and covers the step that can run there: step 1 reads `capabilities`, the tracker is `local`, and the command stops. `skip` lists the Linear calls of steps 2 to 7 with the reason. `notHit` lists the two confirmation points. `expect` asserts that `saved.capabilities.tracker` is `local` and the tree is unchanged. A second entry sets the config to `system: linear` with a workspace and no key, and expects step 1 to fail with `AUTH` through `expectError`, which also proves that the command makes no request without a key.
- A test parses `triage-rotation.md` and asserts that the `set` call has a `--dry-run` form in step 6 and a write form in step 7, like the check that exists for `cycle/close`.
- `npm test` passes, including `plugin.test.mjs`, `scenarios.test.mjs` and `goldens.test.mjs`, and sends no request.
- Live check, by hand and outside `npm test`: with the key loaded by the shell, run `linear triage show` and `linear triage suggestions` on the sandbox workspace and record the `available: false` answer in the PR. A live `set` on a Business or trial workspace with a dedicated test team is a follow-up and stays `schema` in the verification note.

## Acceptance criteria map

| Criterion | Design part |
|---|---|
| 1. Shows and adjusts who is on triage duty | "The CLI commands" (`show`, `set`), "What each command prints and returns" (the shapes and the `set` rules), "The Markdown command" (steps 2, 3, 5, 6 and 7). The absent path on Free is "The availability check" and the `available: false` and `NOT_SUPPORTED` results, proven in the Free workspace CLI tests. The present path is proven with the fake in the unit and CLI tests. |
| 2. Uses Triage Intelligence suggestions when the plan has them | "The CLI commands" (`suggestions`), "What each command prints and returns" (the suggestions shape and the active-only rule), "The availability check" (the plan decides whether the command reads them), "The Markdown command" (step 4). The suggestions tests use the fake. On Free the command reports them unavailable and sends no query. |

## Decisions

| Decision | Reason |
|---|---|
| A `linear: true` command flag and `ctx.linear()`, not contract operations | Triage responsibility exists only in Linear. The contract and every other tracker stay unchanged, and the pattern already exists for `local: true`. |
| No new capability ID | The Technical spec fixes 20 IDs. The command carries its own availability result. |
| Availability from the cached plan and the team's `triageEnabled`, plan first | A live read passes on Free and proves nothing. The plan answer needs no request, and the hint matches the cause. |
| `show` and `suggestions` exit 0 with `available: false`, `set` exits 2 | A read answers the question and degrades as the Linear tab asks. A write that cannot happen is an error. |
| Reuse `BUSINESS_PLANS` from the manifest | One list decides the plan in both places. |
| Manual rotation and action only in `set`, schedules are read-only | The schedule and PagerDuty mutations come from the schema only and cannot be tried on Free. Connecting PagerDuty is an integration setup in Linear. |
| The command makes its own triage inbox query | PMK-35 owns the contract's issue search. Waiting for it would block this issue for no gain. |
| Suggestions are read-only and active only | The schema has no accept or dismiss mutation, and the Linear tab marks the row "R". |
| Always preview and ask once before `set` | The change decides who receives new triage issues. |
| The scenario covers the Local and no-key paths only | The scenario helper runs a child process, and the present path is covered by the CLI tests with the fake. |

## Risks

- The present path is tested against a fake built from the schema. A real Business workspace may return a different plan string, a different `currentUser` when the rotation just advanced, or refuse the mutation for a non-admin key. The mutations are unverified live. The verification note says `schema` for them.
- A plan string that is not in `BUSINESS_PLANS` makes the command report the capability unavailable on a paid plan. The `enableHint` names the plan, and `pmkit discover` shows the plan Linear returned, so the mismatch is visible. PMK-33 carries the same risk.
- `assignmentIndex` semantics are inferred from the field name. If Linear advances the index itself, `set --members` could reset the current person. The spec keeps the existing current person when still listed, and the Business check must confirm it.
- The discovery cache lasts an hour. A user who upgraded sees "unavailable" until `pmkit discover` runs. The hint says so.
- Triage Intelligence may need a separate setting on Business. The schema shows no organization flag for it. If suggestions are off, the list is empty and the command says "no active suggestions", which cannot tell "off" from "none yet".
- The `linear: true` flag is a second system-specific escape from the contract. If later issues add more Linear skills, a shared `linear` extension object may replace the per-feature `triage` object.

## Open questions

1. **What a read prints on Free.**
   - A. Exit 0 with `available: false`, the reason and the hint. A write exits 2 with `NOT_SUPPORTED`.
   - B. Exit 2 with `NOT_SUPPORTED` for all three commands.
   - C. Exit 0 with an empty result and a warning.
   - Recommendation: A. The Linear tab asks skills to degrade, a command can branch on `available`, and a read stays safe to call in a loop.
2. **Whether the manifest reports rotation.**
   - A. No change. The command reports its own availability.
   - B. Add `detail: { rotation: true | false }` to `native_triage` on Linear.
   - C. Add a 21st capability ID, `triage_rotation`.
   - Recommendation: A. B changes a manifest entry that other commands read, and C changes the fixed list in the Technical spec. Both can follow once a second system has a similar feature.
3. **How far "adjusts" goes.**
   - A. Manual rotation and action only. A schedule (PagerDuty) is read, and `--off` and `--action` work on it.
   - B. A plus `--schedule <id>` to switch to an existing schedule.
   - C. B plus connecting PagerDuty.
   - Recommendation: A. The schedule mutations cannot be tried on Free, and connecting PagerDuty is a Linear integration setup that needs a PagerDuty account.
4. **Whether `/pmkit:backlog:triage` uses the suggestions.**
   - A. No. Suggestions appear only in this command, and PMK-35 or a later issue wires them into `backlog:triage`.
   - B. Add an optional step to `/pmkit:backlog:triage` that calls `linear triage suggestions` when the tracker is Linear.
   - Recommendation: A. `backlog:triage` reads the queue through `issues list`, which the Linear tracker does not implement until PMK-35, so B would be dead code today.

## Self-review

- Every acceptance criterion maps to a design part and to a test above.
- The available path has no live proof, and the spec says so in "Risks" and in the verification note.
- No section depends on code from PMK-34 or PMK-35.
- Names in examples are `acme` and `ACME`.
