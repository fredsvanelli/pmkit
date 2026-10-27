# PMK-31: load hosted tracker configs

Decisions from an autonomous brainstorming run on 2026-10-27, with no user dialogue. Every choice below comes from the issue, the code, the ADRs, the Technical spec, the Unified model and the earlier specs. The choices that belong to the user are in "Open questions", each with a recommendation.

## Problem

`loadConfig` in `scripts/lib/config.mjs` (line 207) throws `NOT_SUPPORTED` for every `tracker.system` other than `local`, because `unsupportedTracker` returns a refusal for any name in `TRACKERS` except `local`. No hosted adapter can plug in. The EPC-5 issues that build the Linear adapter (PMK-30 client, PMK-33 discovery, PMK-35 issues) need a loading path that accepts a system once it has an adapter, and a boundary that commands use to reach it.

Three gaps sit between the CLI and a hosted adapter today:

1. **The loader.** `loadConfig` always reads `.issues/config.yaml` after the system check. A hosted tracker has no `.issues/` folder. `validatePmkitConfig` knows nothing about `tracker.scope` or `mappings`, which the Technical spec defines for hosted trackers.
2. **The commands.** `ctx.tracker()` in `scripts/pmkit.mjs` calls `createLocalTracker` directly. Commands call five Local tracker functions that are not in `TRACKER_OPERATIONS`: `eventsByIssue`, `categoryOf`, `issuesBySprint`, `listStatusUpdates` and `unfiledMilestones`. `reindex` and the auto-commit step call `reindex` and `writtenFiles`. Commands also read the Local tracker's config through `ctx.config().local`: the estimate scale, `members` for the actor, `types`, `defaults.*` and `auto_commit`. A hosted adapter that implements only the contract would break all of them.
3. **Promises.** `scripts/contract-suite.mjs` says "The suite awaits every operation, so an adapter may return values or promises", and `contract.test.mjs` runs the suite over a promise-returning copy of the Local tracker. The CLI never awaits. A hosted adapter that calls the network returns promises, and every command would print `{}` or fail.

Acceptance criteria:

1. The loader accepts each `tracker.system` that has an adapter and validates `scope` and `mappings`.
2. A system without an adapter still fails with `NOT_SUPPORTED`.
3. Commands reach the adapter only through the contract.

Sources: Technical spec, "Config schemas" (`tracker.scope: z.record(z.string())`, `mappings.status: z.record(z.string())`, `mappings.fields: z.record(z.string())`); Unified model, Q4 decision A ("one tracker plus one git host per repo, with a config shape ready for more"), Q5 (the example `.pmkit/config.yaml` with `scope.team`, `mappings.status.in_review`, `mappings.status.blocked` and `mappings.fields.estimate: native`), Q6 (the mappings setup confirms), "Common entity model" (field roles: estimate, priority, target date, start date, assignee, acceptance criteria, time spent) and "Layered architecture" (only the adapter layer knows a system).

## Goals

- An adapter registry that names the systems pmkit can load. The loader accepts a system that the registry holds and refuses any other known system with today's `NOT_SUPPORTED` error, word for word.
- `validatePmkitConfig` and `schemas/pmkit.config.schema.json` check the shape of `tracker.scope`, `mappings.status` and `mappings.fields`. Each adapter can add its own rules, such as "Linear needs `scope.team`".
- Every command reaches the tracker through a view that holds only the contract operations, and the CLI awaits every call. Features that exist only in the Local tracker go through one named door that is closed for any other system.
- A test proves the third criterion by running the commands over a fake hosted adapter that returns promises and exposes nothing but the contract.

## Non-goals

- The Linear API client (PMK-30), discovery and the Linear manifest (PMK-33), the Linear issue operations (PMK-35), the user store and the manifest cache (PMK-32), the setup questions for mappings (PMK-34), `link-repo` (PMK-53). This issue registers no hosted adapter.
- How pmkit authenticates to Linear. PMK-28 owns that, and `docs/adr/0005`. This issue writes no ADR.
- Checking a mapping against a live workspace, for example that the status "In Review" exists. That needs discovery and the network. PMK-34 owns "When a mapped status or field disappears, the command stops and asks".
- More than one tracker per repository (Q4 option B), or new `git_host.system` values.
- The MCP server.

## Anti-goals

- The loader or `npm test` touches the network. The loader reads files only.
- A new dependency in `package.json` (ADR-0003).
- A change to any Local tracker output. Every golden stays byte-identical, and the run uses no `UPDATE_GOLDENS=1`.
- A credential in `.pmkit/config.yaml`, in a fixture or in a test.

## Approaches

**A. A registry, a dispatch in `loadConfig`, a contract view, and an async CLI.** A new module `scripts/lib/adapters.mjs` maps each system to an adapter descriptor. `loadConfig` reads `.pmkit/config.yaml` as today, then either takes today's Local path or returns a hosted config with no `.issues/` read. The CLI builds the tracker through the descriptor, hands commands a frozen object with only `TRACKER_OPERATIONS`, and awaits every call. The few Local-only features go through `ctx.local()`.

**B. An allow-list in the loader and nothing else.** Replace the refusal with a check against a list of hosted systems, add the `scope` and `mappings` checks, and let PMK-35 switch `ctx.tracker()` to the Linear adapter. This meets criteria 1 and 2 and fails criterion 3. The commands would still call `eventsByIssue` and read `config.local`, and nothing would await a promise. Each hosted adapter would find these gaps one crash at a time. Rejected.

**C. Each adapter owns its whole config load.** `config.mjs` reads only `.pmkit/config.yaml`, and the Local adapter moves the `.issues/config.yaml` read, the format check and the migrated copy into `scripts/lib/local/`. This is the cleanest split, but it moves the format and migration logic that PMK-118 and PMK-120 just settled, and `validate.mjs`, `runMigrate`, `local/tracker.mjs` and many tests import `loadConfig`. The churn buys nothing that the three criteria need. Rejected for now. A later issue can still move it, because A keeps the Local branch in one function.

Inside A there is one more choice. **A1:** the CLI awaits the contract, as the contract suite already assumes. **A2:** the contract stays synchronous and a hosted adapter blocks, for example by running a child `node` process per HTTP request through `spawnSync`, as the GitHub host does with `gh`. A2 costs a Node start for each request (Linear pages its GraphQL results, so a search can take several), sends every error through a child's stdout, and contradicts the suite's comment. Node 18 has `fetch` and `node:https`, and both are async. A1 is chosen. Open question 2 asks whether the user wants the async change in this issue or in its own issue.

Chosen: A with A1.

## Design

### The adapter registry

New file `scripts/lib/adapters.mjs`. It has no static import of an adapter, so `config.mjs` can import it without an import cycle (`local/tracker.mjs` imports `config.mjs`).

```js
/**
 * @typedef {object} AdapterDescriptor
 * @property {string} system        a name in TRACKERS
 * @property {boolean} hosted       false only for local
 * @property {(pmkit: object) => string[]} configProblems   rules of this adapter on a parsed .pmkit/config.yaml whose shape is valid
 * @property {(config: object) => { defaults: object }} settings   the behavior defaults commands read
 * @property {(config: object, deps: { now, random, env, dryRun }) => Promise<object>} create   the tracker
 */
export const ADAPTERS = {
  local: {
    system: 'local',
    hosted: false,
    configProblems: () => [],
    settings: (config) => ({ defaults: config.local.defaults }),
    create: async (config, { now, random, env, dryRun }) => {
      const { createLocalTracker } = await import('./local/tracker.mjs')
      return createLocalTracker(config.root, { config, now, random, env, index: dryRun ? 'read' : true })
    },
  },
}

export const adapterFor = (system, adapters = ADAPTERS) => (Object.hasOwn(adapters, system) ? adapters[system] : null)
```

`create` uses a dynamic import, so a hosted adapter's code loads only when a repository uses it. A hosted adapter registers itself by adding one entry. Until then, the product registry holds `local` only, and every hosted system keeps failing as today.

Every function that decides support takes an optional `adapters` argument that defaults to `ADAPTERS`. Tests pass their own registry. That is the only seam, as `formatVersion` and `migrations` already are for `loadConfig`.

### `.pmkit/config.yaml` shape

Two optional keys, valid for every system:

```yaml
tracker:
  system: linear
  scope:                         # hosted trackers: team, project, space...
    team: ENG
    default_project: Mobile v2
mappings:                        # hosted trackers (Q6)
  status:                        # a category or blocked -> a status name of the tracker
    in_review: In Review
    blocked: Blocked
  fields:                        # a field role -> the tracker's field, or native
    estimate: native
```

Rules in `validatePmkitConfig`, mirrored in the JSON Schema:

| Key | Rule | Schema |
|---|---|---|
| `tracker.scope` | absent, or a map whose every value is a string with a non-space character | `type: object`, `additionalProperties: { type: string, pattern: "\\S" }` |
| `mappings` | absent, or a map; keys other than `status` and `fields` are allowed, as at the root | `type: object` with `properties` |
| `mappings.status` | absent, or a map; each key is a category or `blocked`; each value is a string with a non-space character | `propertyNames: { enum: STATUS_MAPPING_KEYS }`, `additionalProperties` as above |
| `mappings.fields` | absent, or a map; each key is a field role; each value is a string with a non-space character | `propertyNames: { enum: FIELD_ROLES }`, `additionalProperties` as above |

`null` is invalid for each of the four, as for every optional key except `tracker.path` (the existing "null for an optional key" test in `schemas.test.mjs`).

New constants in `scripts/lib/model.mjs`:

- `FIELD_ROLES = ['estimate', 'priority', 'target_date', 'start_date', 'assignee', 'acceptance_criteria', 'time_spent']`, from the field roles of the Unified model, in its order, in snake_case like every other config key.
- `STATUS_MAPPING_KEYS = [...CATEGORIES, 'blocked']`. Q5 and Q6 both map `blocked`, and PMK-34's criteria say setup asks for it. `CONTEXT.md` keeps Blocked out of the categories. This key only lets a hosted adapter name the status its team uses for blocked work. What that status means for `isBlocked` is for PMK-34 and PMK-35 to decide.

The messages follow the style of the existing ones. Example wordings, which the builder may adjust while keeping one message per bad key:

- `tracker.scope must be a map of names, such as team: ENG`
- `mappings must be a map with status or fields`
- `mappings.status must be a map from a category or blocked to a status name`
- `mappings.status.reviewing: reviewing is not a category or blocked`
- `mappings.fields.points: points is not a field role, use one of estimate, priority, target_date, start_date, assignee, acceptance_criteria, time_spent`
- `mappings.status.in_review must be a status name`

`tracker.scope` and `mappings` under `local`, and `tracker.path` under a hosted system, are valid and ignored **(builder's call)**. Q4 asks for a config shape that can grow, and a team that moves between trackers can keep both keys in the file. The schema's root description already says that keys pmkit does not know are allowed.

Schema text changes: `tracker.system` says "local works today. A hosted system works once pmkit has its adapter." `tracker.path` says "local only". `tracker.scope`, `mappings`, `mappings.status` and `mappings.fields` get a title and a description, as the structural test requires.

### Support and problems

In `scripts/lib/config.mjs`:

- `unsupportedTracker(system, adapters = ADAPTERS)` returns `null` when `system` is not in `TRACKERS` or when `adapterFor(system, adapters)` is not `null`. For any other system it returns today's `{ message, nextStep, problem }`, with the same strings.
- `pmkitConfigMessages(parsed, adapters = ADAPTERS)` returns `validatePmkitConfig(parsed)`, then the unsupported problem as today, then, when the system has an adapter and `validatePmkitConfig` found nothing, `adapter.configProblems(parsed)`. An adapter rule can then assume the shape is valid.
- `loadConfig(root, { adapters = ADAPTERS, formatVersion, migrations, checkFormat })` keeps steps 1 to 4 of today:
  1. No `.pmkit/config.yaml`: `NOT_CONFIGURED`.
  2. No string `tracker.system`: `INVALID_INPUT` with `details.pmkitConfig`.
  3. A known system with no adapter: `NOT_SUPPORTED`, today's message and next step.
  4. An unknown system or a bad `tracker.path`: `INVALID_INPUT` with every problem.
  5. **New.** A hosted adapter: return `{ pmkit, root, system, hosted: true, pmkitProblems }`. No `local`, no `issuesDir`, no `format`, no read under the repository besides `.pmkit/config.yaml`.
  6. `local`: the rest of today's function moves unchanged into an exported `loadLocalConfig(root, pmkit, pmkitProblems, options)`, and its results gain `system: 'local'` and `hosted: false`.

Read warnings and write refusals keep working with no change, because they read `pmkitProblems`. A hosted config with a bad mapping warns on reads and refuses writes, as any other problem does (PMK-120).

`validateRepo` in `scripts/lib/validate.mjs` passes `adapters` through. When the loaded config is hosted, it returns `{ checked: <all zeros>, problems: <the .pmkit/config.yaml problems> }` and checks no tracker file. That is the same early return it uses today when `.pmkit/config.yaml` blocks the load. `validate` stays offline, so it never checks a mapping against the workspace.

### The contract view

In `scripts/lib/contract.mjs`:

- `TRACKER_OPERATIONS` gains `listStatusUpdates`. `epic updates` needs it, `render-data.mjs` reads it, the Local tracker already has it, and Linear has project updates (PMK-38). The contract suite gets one test for it: a published update comes back first, newest first, with `epic`, `at`, `author`, `health` and `body`.
- New `contractView(tracker)`: calls `assertTracker`, then returns a frozen object with exactly one function per name in `TRACKER_OPERATIONS`, bound to the tracker. Any other property is `undefined`, so a call to `eventsByIssue` through the view throws a `TypeError`.

### The CLI context

In `scripts/pmkit.mjs`:

- `run(argv, { env, cwd, adapters = ADAPTERS })` becomes `async` and resolves to the same `{ code, stdout, stderr }`. The entry block at the bottom awaits it. `command.run(ctx)` may return a promise, and the runner awaits it.
- `ctx.config()` calls `loadConfig(root, { adapters })`.
- `ctx.tracker()` resolves, once per run, to `contractView(await adapter.create(config, { now, random, env, dryRun }))`. Commands only ever get this view, for the Local tracker too. A command that calls anything else fails on every system, so the Local tests catch it.
- `ctx.local()` returns the raw Local tracker when `config.system` is `local`, and `null` otherwise. It is the only way to the Local extras.
- `ctx.settings()` returns `adapter.settings(config)`. Commands read `defaults.*` from it instead of `ctx.config().local.defaults`.
- `ctx.actor()` becomes async. It resolves the actor from `(await tracker.discover()).members`, turned into the map `resolveActor` expects (id to `{ name, email, availability }`), with the same email, `PMKIT_USER` and `--as` order. The `NOT_CONFIGURED` next step stays "Add yourself to members in .issues/config.yaml or set PMKIT_USER" for the Local tracker. For a hosted tracker it says to set `PMKIT_USER` to a member id from `pmkit discover` **(builder's call on the wording)**.
- Auto-commit reads `config.local.auto_commit` and `ctx.local()?.writtenFiles()` only when the system is `local`. Auto-commit is runner code, not a command, and it commits Local tracker files, so a hosted tracker never commits.

### What each command stops doing

| Today | After |
|---|---|
| `tracker.eventsByIssue()` (release-notes, metrics, risks) | `eventsByIssue(await tracker.metricEvents())`, a pure helper in `scripts/lib/metrics.mjs` that groups by `event.issue` and drops the `issue` key |
| `tracker.categoryOf` | `categoryLookup((await tracker.discover()).statuses)`, a pure helper that maps a status name to its category, or `null` |
| `tracker.issuesBySprint()` (`metrics velocity`) | a pure helper over `searchIssues({ archived: true })` and the grouped events, with the same `{ id, estimate, status, doneAt }` records |
| `tracker.listStatusUpdates(id)` | the same call, now a contract operation |
| `ctx.config().local.estimate.scale` (issues create, update) | `(await tracker.discover()).estimate.scale` |
| `ctx.config().local.types` (release-notes) | `(await tracker.discover()).types` |
| `ctx.config().local.defaults.*` (release-notes, velocity, risks) | `ctx.settings().defaults.*` |
| `requireActor(ctx.config().local, ...)` (whoami, ctx.actor) | the discover-based actor above |
| `tracker.unfiledMilestones(id)` (milestone create) | `ctx.local()?.unfiledMilestones(id) ?? []`. The warning counts milestone files and points to `/pmkit:local:doctor`, so it is a Local tracker check and a hosted tracker skips it. |

### Local-only commands

`render`, `migrate` and `reindex` get `local: true` in `COMMANDS`. With any other system, the runner refuses them before `command.run` with `NOT_SUPPORTED`, the message `<command> works only with the Local tracker, and tracker.system is "<system>"`, and a next step that names `pmkit --help`. They then use `ctx.local()`, so their code keeps its synchronous calls and `render-data.mjs` does not change. `render` touches the tracker folder for `--save` and for its "inside the tracker folder" guard. Open question 3 asks whether `render` should instead serve hosted trackers now.

`validate` stays exempt and works for a hosted system as described above. `init` and `changelog` do not change. `init --tracker` still accepts only `local`, because setting up a hosted tracker is PMK-34 and PMK-53.

The rule that criterion 3 checks: **a command reaches the tracker only through `ctx.tracker()`, whose view holds only contract operations. `ctx.local()` is the one exception. It returns `null` for any system but `local`, and only Local-only features use it.**

### Docs

- `CONTEXT.md`, **Adapter**: add "The CLI picks the tracker adapter by `tracker.system` from the registry in `scripts/lib/adapters.mjs`, and commands reach it only through the contract operations." **Tracker**: "the `tracker.system` key names it, and `tracker.scope` names the team or project of a hosted tracker."
- `docs/superpowers/specs/2026-10-23-pmkit-design.md`, `.pmkit/config.yaml` section: "The MVP loader rejects a known `tracker.system` other than `local` with `NOT_SUPPORTED`" becomes "The loader rejects a known `tracker.system` that has no adapter with `NOT_SUPPORTED`". Add `tracker.scope` and `mappings` to the example with one line each. Add `listStatusUpdates(epic)` to the Deliverables row of the contract table.
- No `CHANGELOG.md` edit on this branch, as in PMK-3 and PMK-20.

## Acceptance criteria map

| Criterion | Design part | Tests |
|---|---|---|
| 1. The loader accepts each `tracker.system` that has an adapter and validates `scope` and `mappings` | The registry; `unsupportedTracker` and `loadConfig` step 5; the `scope` and `mappings` rules in `validatePmkitConfig` and the schema; `adapter.configProblems`; `validateRepo` for a hosted config | `config.test.mjs`: with a test registry that holds `linear`, `loadConfig` returns `{ system: 'linear', hosted: true }` and reads no `.issues/`, even when the folder is missing; each `scope` and `mappings` rule, valid and invalid, with its message; an adapter problem joins `pmkitProblems` only when the shape is valid. `schemas.test.mjs`: the parity probes pick up the new keys from the schema, and the null table gains four rows. `validate.test.mjs`: a hosted config with a bad mapping lists it with code `config` and zero counts. CLI test: a hosted config with a bad mapping warns on a read and refuses a write. |
| 2. A system without an adapter still fails with `NOT_SUPPORTED` | `unsupportedTracker(system, adapters)` with the product registry; `loadConfig` step 3 unchanged | The existing tests, listed in "Tests that change", keep their assertions. New: with a test registry that holds `linear` only, `jira` still throws today's `NOT_SUPPORTED` message and next step, and `run` with `jira` exits 2 with the same JSON error. |
| 3. Commands reach the adapter only through the contract | `contractView`; `ctx.tracker()`, `ctx.local()`, `ctx.settings()`, the discover-based actor; the table in "What each command stops doing"; `local: true`; `listStatusUpdates` in the contract; the async runner | `contract.test.mjs`: `contractView` has exactly the `TRACKER_OPERATIONS` keys, is frozen, and has no `eventsByIssue`. A new `scripts/cli-hosted.test.mjs` with a "mirror" adapter (below). Unit tests for `eventsByIssue`, `categoryLookup` and the `issuesBySprint` helper. The contract suite test for `listStatusUpdates` runs in its three setups. |

### The mirror test

`scripts/cli-hosted.test.mjs` registers a fake hosted adapter under `linear` in a test registry. Its `create` builds a Local tracker for the same repository with `loadLocalConfig(root, { ...pmkit, tracker: { system: 'local', path: '.issues' } }, [])`, wraps every operation in an `async` function, and returns that. Its `settings` returns the fixture's `defaults`. For each case, the test copies a fixture twice, sets `tracker.system: linear` in one copy, runs the same arguments through the in-process `run` in both copies (the plain copy with the product registry), and asserts the same exit code, stdout and stderr.

The cases cover every command in `COMMANDS` that is not `local: true`, `exempt` or a git host command, at least once, with the arguments of its golden case: every read, and every write both with `--dry-run` and for real. A missing `await` shows up as a difference, because the mirror's operations return promises. A command that reaches past the contract fails, because the view has nothing else. The three `local: true` commands under the mirror exit 2 with `NOT_SUPPORTED`.

`run` in process reads `git config user.email` through the test process's environment (PMK-9 spec). The mirror test passes `PMKIT_USER` in `env` and runs inside a temp `HOME` with `GIT_CONFIG_GLOBAL` and `GIT_CONFIG_NOSYSTEM` set on `process.env` for the file, or uses `--as` on writes **(builder's call)**.

## Tests that change

| Test | Change | Why |
|---|---|---|
| `config.test.mjs` "unsupportedTracker is null for local and for names outside TRACKERS, and gives a message, next step and problem for the others" | Keeps its assertions. Gains one: `unsupportedTracker('linear', { ...ADAPTERS, linear: fake })` is `null`. | The rule now depends on the registry. |
| `config.test.mjs` "pmkitConfigMessages adds the unsupported tracker problem to validatePmkitConfig" | Keeps its assertions. Gains the adapter problem case. | Same function, one more source of messages. |
| `config.test.mjs` "tracker.system jira throws NOT_SUPPORTED" | No change. | It is the loader guard of criterion 2. |
| `validate.test.mjs` "tracker.system linear alone is one config problem, not a throw" | No change now. | It holds while Linear has no adapter. |
| `validate.test.mjs` "every known tracker except local is listed" | Iterates `TRACKERS.filter((name) => !adapterFor(name))` and is renamed "every known tracker without an adapter is listed". | As written, it fails the day an adapter registers. |
| `cli.test.mjs` "validate lists tracker.system linear as a problem and exits 0", "validate with linear and a bad git_host lists both and exits 0", "issues list with linear still exits 2 with NOT_SUPPORTED" | Use `const UNSUPPORTED = TRACKERS.find((name) => !adapterFor(name))` instead of the literal `linear`, in `useLinear` (renamed `useUnsupported`) and in `LINEAR_LINE`. Assertions stay. | They run the CLI as a child process, so they cannot pass a test registry. Today `UNSUPPORTED` is `linear`, so the output they check does not change. |
| `cli.test.mjs` "an unknown tracker.system refuses reads with INVALID_INPUT" | No change. | Step 4 of `loadConfig` is unchanged. |
| `cli-risks.test.mjs`, `cli-pr.test.mjs`, `fixtures.test.mjs` | `await run(...)`, and their test bodies become `async`. | `run` is async. |
| `contract.test.mjs` "lists every missing operation" | No change. Its expected list comes from `TRACKER_OPERATIONS`, which now holds `listStatusUpdates`. | |
| `schemas.test.mjs` "null for an optional key is invalid on both sides" | Four rows: `tracker.scope`, `mappings`, `mappings.status`, `mappings.fields`, each `false`. | New optional keys. |
| `migrations.test.mjs` tests on `NOT_SUPPORTED` | No change. | Those are format errors, not tracker support. |
| `scripts/__goldens__` | No change. | The Local output must stay byte-identical. A difference stops the stage until the diff is read line by line. |

## Decisions

| Decision | Reason |
|---|---|
| A registry in `scripts/lib/adapters.mjs` with lazy `create` | One place lists what pmkit can load. The dynamic import avoids the `config.mjs` and `local/tracker.mjs` cycle and loads a hosted adapter's code only when needed. |
| The CLI awaits every contract call (A1) | The contract suite already accepts promises, and hosted adapters do network I/O. A2's `spawnSync` per request is slow and moves errors through a child's stdout. |
| Commands get a frozen view with only the contract operations, for the Local tracker too | Criterion 3 then holds by construction, and the 1487 existing tests check it on the Local tracker at every run. |
| `ctx.local()` for Local-only features, `null` elsewhere | `reindex`, `render`, `migrate`, the unfiled-milestone warning and auto-commit work on Local files. Moving them into the contract would make every hosted adapter implement file operations it has no files for. |
| `listStatusUpdates` joins the contract | `epic updates` is a command for every tracker, and the `status_update` capability lists it in `SERVED_BY`. |
| `eventsByIssue`, `categoryOf` and `issuesBySprint` become pure helpers over `metricEvents`, `discover` and `searchIssues` | They are derived data. The contract stays at the size the design spec gives it. |
| Field roles from the Unified model, and status keys of the seven categories plus `blocked` | The Technical spec gives the maps as free records. The common model gives the names, and Q5, Q6 and PMK-34 all map `blocked`. A typo such as `in-review` is then a problem instead of a silent no-op. |
| `scope` and `mappings` are shape-checked for every system, and their meaning is left to the adapter | Only the adapter knows whether its tracker needs a team, a project or an area path. `configProblems` gives it the hook. |
| `scope` and `mappings` under `local`, and `tracker.path` under a hosted system, are valid and ignored | The shape grows without breaking a file (Q4). An unknown key is already allowed. |
| `validate` with a hosted tracker checks `.pmkit/config.yaml` only, offline | It has no tracker files to check, and `npm test` must not touch the network. |
| `loadLocalConfig` is extracted unchanged | It keeps the PMK-118 and PMK-120 format and migration logic in one function, and the mirror test needs it. |

## Risks

- **A missing `await`.** The Local tracker returns values, so an `await` left out is invisible in the Local tests. The mirror test is the guard. It covers every non-local command, so its case list must grow with `COMMANDS`. The builder adds a check that every eligible command has a mirror case, as `goldens.test.mjs` does for goldens.
- **Event order.** `metricEvents` sorts all events by `at`. Today `eventsByIssue` keeps each file's order. The two differ only when an `events.jsonl` holds events out of time order, which a `merge=union` merge of two branches can produce. `lastEntry` takes the last match in array order, so `doneAt` could change for such an issue. The goldens and the metrics tests show whether any fixture hits this. If one does, the helper sorts each issue's events by file order through a stable sort key, or the builder stops and reports.
- **`issuesBySprint` over `searchIssues`.** The Local function reads `scanIssues()`. The builder confirms that `searchIssues({ archived: true }).issues` holds the same set, unparseable issues included or excluded in the same way, before switching.
- **Actor through `discover`.** `whoami` prints the member record. The map built from `discover().members` must hold the same keys as the config entry, or the `whoami` golden changes.
- **`run` becomes async.** Any caller outside the repository that imports `run` breaks. None is known. The plugin's commands call the CLI as a process.
- **The Linear switch of the CLI tests.** When an issue registers the Linear adapter, `UNSUPPORTED` becomes `jira`, and the three `cli.test.mjs` tests check `jira` text. That is intended, and their assertions need no edit.
- **Node 18 and `fetch`.** Node 18 marks `fetch` experimental and can print a warning on stderr. That is PMK-30's concern. This design only makes sure the CLI can await whatever PMK-30 picks.

## Open questions

1. **Where do a hosted tracker's behavior defaults come from?** `stale_days`, `stuck_business_days`, `sprint_length_days`, `sprint_start_weekday`, `velocity_window` and `status_update_window_days` live in `.issues/config.yaml` today, and a hosted tracker has no such file.
   - (a) The built-in values of `DEFAULTS.defaults` in `config.mjs`, with no config key, until a team asks for another value.
   - (b) An optional `defaults` block in `.pmkit/config.yaml`, validated by this issue and read only for hosted trackers.
   - (c) Personal defaults in the user store (PMK-32).
   - Recommendation: (a). It keeps this issue to the keys the Technical spec names, and `ctx.settings()` is the one place that changes when (b) comes. (b) is the natural next step, because Q5 puts shared settings in the repo file, but it creates a second home for keys that `.issues/config.yaml` already holds. (c) fits per-person values, and these are team norms.
2. **Does the async CLI belong to this issue?** It touches every command in `scripts/pmkit.mjs`, though each change is mechanical.
   - (a) Keep it here, as designed.
   - (b) Split it into a new issue that blocks PMK-33. PMK-31 then keeps a synchronous CLI, and its mirror adapter returns values instead of promises.
   - Recommendation: (a). The contract boundary that PMK-33 and PMK-35 plug into is incomplete without it, and only a promise-returning mirror catches a missing `await`. The estimate of 5 points already covers a change of this size.
3. **Should `render` serve a hosted tracker now?** Its data comes from contract operations. Only `--save` and the "inside the tracker folder" guard use the Local folder.
   - (a) `render` is Local-only for now, as designed. PMK-40 ("Exercise the degraded paths of every command against Linear") revisits it.
   - (b) `render` goes through the contract now. `--save` alone is Local-only, and the folder guard applies only to the Local tracker.
   - Recommendation: (a). Linear has its own boards and roadmap, so a Linear team gains little before PMK-40, and (a) keeps `render-data.mjs` and its tests untouched.

## Left to the builder

- The exact problem messages, within one message per bad key and the style above.
- The wording of the `NOT_SUPPORTED` refusal for `local: true` commands and of the hosted actor next step.
- The names of the pure helpers and the file they live in, `metrics.mjs` or a new one.
- How the mirror test isolates `git config` (temp `HOME` and `GIT_CONFIG_*`, or `--as`).
- Whether `contractView` binds or wraps, provided the view is frozen and holds only the contract names.

## Self-review

- Placeholders: none. Each builder's call leaves every criterion as designed.
- Consistency: "hosted" means a registry entry with `hosted: true` everywhere. `ctx.local()` is the only way past the contract, and the same three commands are `local: true` in the design, the map and the tests.
- Scope: one new module, one new test file, changes to `config.mjs`, `contract.mjs`, `model.mjs`, `validate.mjs`, `metrics.mjs`, `pmkit.mjs`, the pmkit schema, `CONTEXT.md` and the design spec. No hosted adapter, no network, no tracker file format change, no ADR.
- Builder check: read as the builder, with no reviewer agent, as the brief asks. Points that came up: how a test registers an adapter (decided, the `adapters` argument), how the mirror gets a Local tracker when the file says `linear` (decided, `loadLocalConfig`), what `validate` does for a hosted system (decided), and where the defaults come from (open question 1).
