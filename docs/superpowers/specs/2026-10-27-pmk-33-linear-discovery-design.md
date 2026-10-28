# PMK-33 design: discover a Linear workspace and build its capability manifest

Issue PMK-33, epic EPC-5 (Linear tracker adapter), milestone `linear`. Status: waiting for the user's answers to "Open questions". Decisions come from an autonomous brainstorming run on 2026-10-27 with no user dialogue, from the issue, ADR-0003, ADR-0005, the PMK-2, PMK-28 to PMK-32 specs, the code, and read-only calls to the sandbox workspace. Calls marked **(builder's call)** were made while writing this spec and change no acceptance criterion. The design below applies the recommended answer to each open question, and each question says what changes if the user picks another option.

## Problem

`tracker.system: linear` fails with `NOT_SUPPORTED`, because `ADAPTERS` in `scripts/lib/adapters.mjs` holds `local` only. PMK-30 built the client, PMK-31 the hosted config path and PMK-32 the user store, but nothing asks Linear what a workspace holds. Setup (`/pmkit:setup`) needs teams, states and members to write `.pmkit/config.yaml`. Commands need statuses with categories, members and the estimate scale. `/pmkit:help` and the commands that degrade need a capability manifest that says what this workspace offers on its plan.

Sources:

- Linear tab, "Cross-cutting skills", Setup and context: "Authenticates, discovers teams, states by category, labels, members and estimate scales; caches them locally".
- Linear tab, conventions: "(Business): feature restricted to the Business plan or higher; skills must degrade on Free and Basic plans."
- Unified model, "Capabilities by system", Linear column, and "Common status categories", Linear column.
- Technical spec, "Errors and capability manifest" (the manifest shape and its cache in the user store).
- `scripts/lib/linear/API-VERIFICATION.md` (PMK-29) for recurring issues, project dependencies, releases and Insights.
- ADR-0005 for the `auth` block of `discover --json` and for `agent_delegation`.

Acceptance criteria:

1. `discover` returns teams, states with categories, labels, members and estimate scales.
2. `capabilities` reports each of the 20 capabilities with the path the workspace plan allows.

User decisions that bind this issue:

- This issue registers `linear` in `ADAPTERS`.
- The client's page cap is 10 pages when the caller gives no limit.
- The client is the one place that refuses secret-like config keys.

## Facts checked against the Linear API

Read-only calls on 2026-10-27 against the sandbox workspace (Free plan), with a personal key loaded by the shell and a fetch wrapper that refused mutations. No write was sent.

| Call | Result |
|---|---|
| `organization { subscription { type seats } trialEndsAt releasesEnabled customersEnabled roadmapEnabled feedEnabled linearAgentEnabled integrations { nodes { service } } }` | `subscription: null`, `trialEndsAt: null`, `releasesEnabled: false`, `customersEnabled: false`, `linearAgentEnabled: true`. One integration, `githubCodeAccessPersonal`. No `github` integration. Complexity 59. |
| `teams { cyclesEnabled triageEnabled initiativesEnabled issueEstimationType issueEstimationAllowZero issueEstimationExtended states { name type position } labels members }` | One team. `cyclesEnabled: false`, `triageEnabled: false`, `initiativesEnabled: false`, `issueEstimationType: "notUsed"`. Ten states, five of type `started` (In Progress, In Review, Code Review, UAT, Ready to ship) and one of type `duplicate`. The nested query cost 4335 complexity. |
| `users(includeDisabled: true)` | Four users. One is inactive, one is an app (`app: true`, the built-in Linear agent, `isAssignable: false`). |
| `issueLabels` | Team labels, including a group whose children are XS, S, M, L and XL. |
| `initiatives(first: 1)`, `customViews(first: 1)`, `triageResponsibilities(first: 1)`, `documents(first: 1)`, `agentSessions(first: 1)` | Empty lists, no error. A read passes on Free even where the feature is a Business one. |
| `notifications(first: 1)` | One node. |
| `customers(first: 1)` | HTTP 200 with `extensions.code: FORBIDDEN`, `path: ["customers"]`. The PMK-30 client maps it to `AUTH`, "Linear refused the request for this key". |
| Introspection of `Organization`, `Team`, `WorkflowState`, `IssueLabel`, `User`, `PaidSubscription` | The fields above exist. `WorkflowState.type` is a `String`, not an enum. `PaidSubscription.type` is a `String`. `Team.issueEstimationType` is a `String`. |
| Type names matching `ask`, `sla`, `time`, `security` | `SlaConfiguration`, `SlackAsksSettingsInput`, `SlackAsksTeamSettings`, `TimeSchedule`, security settings inputs. No time entry type, no security alert type, no Ask object. |

Three consequences shape the design:

- A live read does not prove a plan allows a feature (initiatives answer on Free), and a refused read fails as `AUTH` in the client. Discovery therefore reads workspace and team settings, not probes.
- `subscription` is `null` on Free. The plan comes from that field, and the strings a paid plan returns are not verified.
- Linear has a `duplicate` state type that the Unified model's table does not list.

## Goals

- A Linear tracker that `ADAPTERS` creates for `tracker.system: linear`. Its `discover()` and `capabilities()` work. Every other contract operation throws `NOT_SUPPORTED` until PMK-35 to PMK-38 implement it.
- `discover()` returns the common shape the commands already read (`statuses`, `types`, `priorities`, `labels`, `members`, `estimate`), plus `auth`, `workspace` and `teams` with each team's states, labels and estimate scale.
- `capabilities()` returns the 20 capabilities with a path computed from the workspace plan, the workspace and team settings, the static schema facts, the configured team, `git_host` and the served-by rule.
- One discovery serves a whole CLI run, and the user store caches it across runs, so an actor lookup, an estimate parse or a release-notes run sends no request while the cache is fresh.
- The Linear descriptor's `configProblems` reports a missing `tracker.scope.workspace` and secret-like keys, so `pmkit validate` lists them.

## Non-goals

- Resolving `me` and the actor from `viewer` (PMK-35). Until then `requireMember` keeps matching the git email against discovered members.
- Asking for mappings the tracker cannot infer, and stopping when a mapped status disappears (PMK-34). "What PMK-34 gets" lists what discovery hands over.
- Issue, relation, search, history, comment, cycle and project operations (PMK-35 to PMK-38).
- The contract suite against a sandbox team (PMK-39), and the degraded paths of each command (PMK-40).
- Triage responsibility and Triage Intelligence (PMK-43). Discovery reports the plan that PMK-43 reads.
- Any write to Linear. Discovery sends queries only.
- A `setup` change. Setup's Linear branch already runs `discover --json` per ADR-0005; PMK-34 adds its questions.

## Anti-goals

- `npm test` opening a socket. Every test injects `fakeLinearFetch`.
- A new dependency (ADR-0003).
- A change to any Local tracker output. Every golden stays byte-identical.
- The key in output, in a cache file, in an error or on a command line (ADR-0005).
- The real workspace URL key or team key in any file. Examples use `acme` and `ACME`.

## Approaches

Two choices: how to learn what the workspace allows, and how to keep discovery cheap.

### How to learn what the workspace allows

1. **Static schema facts, plus workspace and team settings read in the discovery queries, plus the plan for wording.** A table in code holds what the API has (PMK-29 and the introspection above). The discovery queries read `releasesEnabled`, `customersEnabled`, the integrations, the app users and each team's `cyclesEnabled`, `triageEnabled` and `issueEstimationType`. The plan comes from `organization.subscription` and feeds the hints and `workspace.plan`. A settings flag decides wherever one exists.
2. **Runtime introspection and a live probe per capability.** Discovery fetches the schema and sends one read per gated object, then treats an error as "the plan forbids it". The sandbox shows why this fails. `initiatives` answers on Free, so a passing read proves nothing. `customers` answers `FORBIDDEN`, which the client turns into `AUTH` and which would abort the whole discovery unless every probe catches it. It also costs about 15 more requests per refresh and a large introspection answer.
3. **A plan table only.** Map `subscription.type` to fixed paths per plan. The API does not document the plan strings, a trial changes the answer, and per-team settings (cycles, estimates, triage) do not follow the plan. On the sandbox it would also miss that releases are off.

Chosen: approach 1. It reads one organization query that discovery needs anyway, and it answers from the flags Linear itself uses to turn a feature on.

### How to keep discovery cheap

A. **Cache the normalized discovery in the user store with a TTL, memoize it per run, refresh on `pmkit discover` and on request.** Build the manifest on each call from the cached discovery and the current config.

B. **Memoize per run only.** Each command that calls `discover()` still sends about six requests. The PMK-31 review found `discover()` on every actor lookup, estimate parse and release-notes run, so an agent session would spend requests on data that changes a few times a month.

C. **Cache the finished manifest at `cache/<repo-hash>/manifest.json`, as the Technical spec says.** The manifest depends on `tracker.scope.team`, `mappings` and `git_host`, which change without any API call, so the cache would need invalidation on every config edit. It also leaves `discover()` uncached.

Chosen: A. The cache holds API data only, so a config edit needs no invalidation, and the manifest stays a pure function that costs no request. The Technical spec's `manifest.json` path stays free for a later MCP server that wants a file **(builder's call)**.

## Design

### Files

| File | Change |
|---|---|
| `scripts/lib/linear/adapter.mjs` | New. `linearDescriptor({ fetch })` returns the `AdapterDescriptor`. It imports `secretKeyPaths` from `client.mjs` and loads `tracker.mjs` with a dynamic import in `create`. |
| `scripts/lib/linear/tracker.mjs` | New. `createLinearTracker(config, { env, now, fetch })`: the client, the discovery memo and cache, `discover`, `capabilities`, and a `NOT_SUPPORTED` stub for every other operation in `TRACKER_OPERATIONS`. |
| `scripts/lib/linear/discovery.mjs` | New. The GraphQL documents, `fetchDiscovery(client)`, which returns the raw normalized data, and `discoveryView(raw, pmkit)`, which applies the team scope and the status mappings. |
| `scripts/lib/linear/manifest.mjs` | New. `LINEAR_CAPABILITIES`, the static table, and `buildLinearCapabilities(raw, pmkit)`. It reuses `CAPABILITIES` and `SERVED_BY` from `scripts/lib/capabilities.mjs`. |
| `scripts/lib/adapters.mjs` | Adds `linear: linearDescriptor()`. |
| `scripts/pmkit.mjs` | `discover` calls `discover({ refresh: true })` and prints the `auth`, `workspace` and `teams` lines when present. `discover` and `capabilities` copy `warnings` from the result to the command's warnings. |
| `scripts/fake-linear-api.mjs` | Adds `fakeWorkspace(options)`, which returns routes for the discovery operations from a small description (plan, flags, teams, states, labels, users, integrations). |
| Tests | `scripts/lib/linear/discovery.test.mjs`, `manifest.test.mjs`, `tracker.test.mjs`, and CLI cases in `scripts/cli-linear.test.mjs`. Tests that use `linear` as the example of an unsupported system switch to `jira`. |

`linearDescriptor` takes `fetch` so a test passes `adapters: { ...ADAPTERS, linear: linearDescriptor({ fetch: fakeLinearFetch(...) }) }` to `run()`. `ADAPTERS.linear` uses `globalThis.fetch` **(builder's call)**.

### The descriptor

```js
export function linearDescriptor({ fetch = globalThis.fetch } = {}) {
  return {
    system: 'linear',
    hosted: true,
    configProblems: (pmkit) => [...workspaceProblems(pmkit), ...secretProblems(pmkit)],
    settings: () => ({ defaults: builtInDefaults(), epicPrefix: null }),
    create: async (config, { now, env }) => {
      const { createLinearTracker } = await import('./tracker.mjs')
      return createLinearTracker(config, { env, now, fetch })
    },
  }
}
```

- `workspaceProblems` returns `tracker.scope.workspace is required for linear` when the key is missing, the wording `fake-hosted.mjs` already uses. PMK-31 left this rule to the adapter.
- `secretProblems` returns one line per path from `secretKeyPaths(pmkit.tracker)`, such as `tracker.scope.token looks like a secret; keep the Linear key in LINEAR_API_KEY`. It names the path, never the value. PMK-30's resolved question 1 assigned this step to PMK-33. Open question 2 asks whether it stays.
- `settings` returns the built-in behavior defaults, as PMK-31 decided for hosted trackers.

`configProblems` feeds `pmkitProblems`, so `pmkit validate` lists both problems, a read prints them as a warning, and a write is refused before the tracker is created. The `INVALID_INPUT` refusal of a secret stays in `createLinearClient`, which runs for reads too.

### The tracker

`createLinearTracker(config, { env, now, fetch })` creates the client at once with `createLinearClient({ env, tracker: config.pmkit.tracker, requireWorkspace: false, fetch })`. A missing key therefore fails every Linear command with `AUTH`, `LINEAR_API_KEY is not set`, next step `/pmkit:setup`, before any request and before the cache is read. ADR-0005 asks for that on `discover`.

`requireWorkspace: false` lets `discover` and `capabilities` run during setup, before `tracker.scope.workspace` exists, as the PMK-30 spec planned. Every other operation checks the workspace itself and throws `NOT_CONFIGURED`, `tracker.scope.workspace is not set`, next step `/pmkit:setup`. In this issue those operations are stubs, so the stub throws `NOT_SUPPORTED` after the workspace check.

The stubs throw `NOT_SUPPORTED`, `the Linear adapter does not implement <operation> yet`, next step `Set tracker.system to local in .pmkit/config.yaml to use this command now`. One helper builds them from `TRACKER_OPERATIONS`, so `assertTracker` passes and PMK-35 to PMK-38 replace stubs one by one **(builder's call)**.

### Discovery queries

Discovery sends five operations after the client's session query. Each connection goes through `client.paginate` with `pageSize: 250` and no `limit`, so the user's cap of 10 pages applies: at most 2,500 nodes of each kind.

| Operation | Document (fields) | Notes |
|---|---|---|
| `PmkitWorkspace` | `organization { urlKey name releasesEnabled customersEnabled trialEndsAt integrations(first: 100) { nodes { service } } }` | One request. |
| `PmkitPlan` | `organization { subscription { type } }` | Its own request, so a key that may not read the subscription loses the plan and keeps the rest. A failure here gives `plan: 'unknown'` and a warning. |
| `PmkitTeams` | `teams(first, after) { nodes { id key name parent { key } cyclesEnabled triageEnabled issueEstimationType issueEstimationAllowZero issueEstimationExtended } pageInfo }` | Archived teams are left out by Linear's default. |
| `PmkitStates` | `workflowStates(first, after) { nodes { id name type position team { id } } pageInfo }` | Top-level, not nested under teams, so complexity stays near the number of states instead of the 4335 the nested query cost. |
| `PmkitLabels` | `issueLabels(first, after) { nodes { id name isGroup retiredAt team { id } parent { id name } } pageInfo }` | Retired labels are dropped. A label with no team is a workspace label. |
| `PmkitUsers` | `users(first, after) { nodes { id name displayName email active guest app teams(first: 50) { nodes { id } } } pageInfo }` | Disabled users are left out by Linear's default. |

The five run with `Promise.all` once the session resolves. When a connection returns `hasMore: true`, discovery keeps what it has, adds the kind to `truncated` and adds a warning such as `Linear has more than 2500 labels; discovery kept the first 2500`.

### The raw discovery and the cache

`fetchDiscovery(client)` returns plain data with Linear's ids, before any team scope or mapping:

```js
{
  version: 1,
  discoveredAt: '2026-10-27T12:00:00Z',
  workspace: { urlKey: 'acme', name: 'Acme', plan: 'free', trialEndsAt: null },
  flags: { releasesEnabled: false, customersEnabled: false },
  integrations: ['github'],
  teams: [{ id, key: 'ACME', name, parent: null, cyclesEnabled, triageEnabled, estimation: { type, allowZero, extended } }],
  states: [{ id, name, type, position, team: '<team id>' }],
  labels: [{ id, name, group: '<parent name>' | null, isGroup, team: '<team id>' | null }],
  users: [{ id, name, displayName, email, guest, app, teams: ['<team id>'] }],
  truncated: [],
}
```

The tracker keeps one promise per run, so `discover()` and `capabilities()` share one fetch.

The user store caches the raw discovery:

- Scope `repoHash(config.root)`, key `linear-<workspace>`, so `cache/<repo-hash>/linear-acme.json`. PMK-28 asked for a key by workspace URL key and repository hash. The workspace key already matches the store's name rule.
- TTL 3600 seconds **(builder's call)**. A refresh costs 7 requests out of the 2,500 per hour the sandbox key shows, and an hour keeps a plan upgrade or a new state from hiding for long. `pmkit discover` refreshes at any time.
- Read order: the run's memo, then `cacheGet`, then the API. A fetch writes the cache with `cachePut`.
- `discover({ refresh: true })` skips the memo and the cache, fetches and rewrites both. The `discover` command passes it (open question 3). PMK-34 and PMK-35 pass it when a name the user gave is missing from the cached data, to refresh once before they report the miss.
- With no `tracker.scope.workspace`, discovery runs without the cache, because the store has no key for it. Setup is the only caller in that state.
- The cache holds no `auth`. The viewer belongs to the key, and the key can change between runs while the cache does not notice. `auth` appears only in a fresh result. PMK-35 calls `client.session()` for `me`, which costs one request of 3 complexity per run.
- A failed `cachePut` (a store inside a repository, a full disk) becomes a warning and the result is still returned. The cache only saves requests **(builder's call)**.
- A cache hit sends no request, so the workspace pin runs only on the next operation that calls Linear. The cached data came from a run that passed the pin.
- `cachePut` refuses credential-shaped values. A test sets `LINEAR_API_KEY` to `FAKE_KEY`, runs `discover`, and checks that no file under `PMKIT_HOME` holds it.

`capabilities()` reads the same memo and cache, so `pmkit capabilities` costs no request when the cache is fresh.

### The discover result (criterion 1)

`discoveryView(raw, pmkit)` builds the result. The keys that Local returns keep their shape, so `requireMember`, `categoryLookup`, `parseEstimate` and release-notes work unchanged.

```js
{
  auth: { source: 'LINEAR_API_KEY', viewer: { id, name }, workspace: { urlKey, name } },  // fresh results only
  workspace: { urlKey: 'acme', name: 'Acme', plan: 'free' },
  team: 'ACME',                       // tracker.scope.team, or null
  teams: [{
    key: 'ACME', name: 'Acme', parent: null, cycles: false, triage: false,
    statuses: [{ name: 'Todo', category: 'todo', type: 'unstarted' }, ...],
    labels: [{ name: 'XS', group: 'Size' }, ...],
    estimate: { unit: 'points', scale: [], type: 'notUsed' },
  }],
  statuses: [{ name, category }],     // the common view, see below
  types: [],
  priorities: ['urgent', 'high', 'medium', 'low'],
  labels: ['bug', ...],
  members: [{ id, name, email, handle, guest, teams: ['ACME'] }],
  agents: [{ id, name }],
  estimate: { unit, scale },
  discoveredAt: '2026-10-27T12:00:00Z',
  warnings: [],
}
```

Rules:

- **Categories.** Each state's `type` maps to a category: `triage` to `triage`, `backlog` to `backlog`, `unstarted` to `todo`, `started` to `in_progress`, `completed` to `done`, `canceled` to `canceled`, and `duplicate` to `canceled`. The `duplicate` row comes from the sandbox, not the Unified model. An unknown type maps to `in_progress` with a warning that names the state and the type **(builder's call)**, because `WorkflowState.type` is a string and Linear can add values.
- **Status mappings.** `mappings.status.<category>` names a state, and every state with that name gets that category. This is how `in_review` exists on Linear, since no native type maps to it. A mapping that names no state adds a warning, `mappings.status.in_review names In Review, which team ACME does not have`. Stopping the command is PMK-34's rule. `mappings.status.blocked` is not a category, so discovery leaves it for PMK-34 and PMK-35.
- **The common view.** With `tracker.scope.team` set and found, `statuses`, `labels` and `estimate` come from that team, and `labels` adds the workspace labels. With no team, `statuses` lists every distinct pair of name and category across teams, `labels` lists every label name, and `estimate` is the shared scale when every team that uses estimates has the same one, else `{ unit: 'points', scale: [] }` with the per-team scales in `teams[]`. A configured team that does not exist gives the no-team view and a warning.
- **Labels.** Group labels (`isGroup: true`) cannot go on an issue, so the flat `labels` list leaves them out. `teams[].labels` keeps each label's group, which PMK-34 needs to offer a label group as the estimate or the type.
- **Members.** Active users who are not apps, with `id` set to Linear's user id. The id matches `MEMBER_ID` (lowercase hex and hyphens), stays the same across renames, and is what PMK-35 sends in `assigneeId`. `handle` is Linear's `displayName`. Guests stay, with `guest: true`. `availability` is absent, because Linear has none; PMK-37 keeps capacity in local context. Whether commands accept a handle as an assignee is PMK-35's choice **(builder's call)**.
- **Agents.** Users with `app: true` go to `agents`, which `agent_delegation` reads. They are not members, because Linear reports them as not assignable.
- **Priorities.** Linear's fixed priorities 1 to 4 map to `urgent`, `high`, `medium` and `low`. Priority 0 means none. This comes from the schema (`Issue.priority: Int`) and needs no query.
- **Types.** Linear has no issue type field. The Unified model maps the type to a label or a template, and which label group holds types is a mapping that PMK-34 asks for. Until then `types` is `[]` **(builder's call)**. "Risks" covers what that means for PMK-35 and PMK-39.
- **Estimate scales.** `issueEstimationType` gives the scale, and `allowZero` and `extended` change it. `notUsed` gives `{ unit: 'points', scale: [] }`. The builder copies the scales from Linear's docs page on estimates, records the date in a code comment, and tests each type. Expected values, to check against that page: `exponential` 1, 2, 4, 8, 16 (extended adds 32 and 64); `fibonacci` 1, 2, 3, 5, 8 (extended adds 13 and 21); `linear` 1, 2, 3, 4, 5 (extended adds more steps); `tShirt` XS, S, M, L, XL (extended adds XXL and XXXL), with unit `sizes` and a `values` map from each size to the number Linear stores. `allowZero` puts 0 first.
- **Warnings.** The session's rename warning (PMK-30), truncation, unknown state types, missing mapped states, a missing team, an unknown plan and a failed cache write all go to `warnings`. The `discover` and `capabilities` commands copy them to the command's warnings, so the CLI prints them on stderr, as PMK-30 asked.

The text output of `pmkit discover` adds a `workspace:` line (name, URL key, plan and viewer when `auth` is present) and a `teams:` block (key, name, cycles, triage, estimate type). It prints nothing new for the Local tracker, so the goldens stay as they are.

### The capability manifest (criterion 2)

`capabilities()` returns:

```js
{
  tracker: 'linear',
  gitHost: 'github',
  generatedAt: '2026-10-27T12:00:00Z',
  discoveredAt: '2026-10-27T11:40:00Z',
  workspace: { urlKey: 'acme', plan: 'free' },
  team: 'ACME',
  capabilities: [{ id, path, detail?, enableHint? }, ...],   // 20 entries, spec order
}
```

Every entry has a `path`, as in the Local manifest. `detail` values stay flat (a string, a number or a list of strings), because the text output of `pmkit capabilities` prints `key=value`.

#### Where each answer comes from

Each capability takes its answer from one of four sources:

- **Schema.** A fact fixed in `LINEAR_CAPABILITIES`, from PMK-29 and the introspection above. pmkit does not introspect at run time. If Linear removes a field that a discovery query names, the query fails with `UPSTREAM`, "Linear rejected pmkit's query".
- **Setting.** A workspace or team field read by the discovery queries.
- **Plan.** `workspace.plan`, from `subscription.type`. It decides no path where a setting exists. It supplies the hint text, and it is the only signal for features with no setting.
- **pmkit.** `SERVED_BY`, the configured team and `git_host`.

No capability uses a live probe. "Approaches" says why.

#### The paths

The rule for a setting: on gives the native or derived path, off gives `absent` with a hint that names the setting or the plan. A setting that varies by team gives `conditional` only when no team is configured and some teams have it on. `conditional` then carries `detail.teams`, the keys of the teams where it holds.

| Capability | Unified model | Served by a command | Source | Rule | Sandbox, no team configured |
|---|---|---|---|---|---|
| `cycles` | Native | yes | Setting: `Team.cyclesEnabled` | Team rule above. Hint `Turn on cycles in the team's settings in Linear`. | `absent` |
| `estimation` | Native | yes | Setting: `Team.issueEstimationType` | Not `notUsed` gives `native` with `detail: { unit, scale }`. Hint `Turn on estimates in the team's settings in Linear`. | `absent` |
| `multilevel_hierarchy` | Native | yes | Schema: `Issue.parent`, projects, initiatives | `native` | `native` |
| `dependencies` | Native | yes | Schema: `IssueRelation` | `native` | `native` |
| `native_triage` | Native | yes | Setting: `Team.triageEnabled` | Team rule above. Hint `Turn on triage in the team's settings in Linear`. | `absent` |
| `deliverables` | Native (projects) | yes | Schema: `Project` | `native`, `detail: { entity: 'project' }` | `native` |
| `strategic_goals` | Conditional (Business) | no | Plan (initiatives are Business; `Team.initiativesEnabled` is a team switch) | Not served, see below. Linear's answer: `native` on Business and Enterprise, else `absent`. | `absent` |
| `status_update` | Native | yes | Schema: `ProjectUpdate` | `native` | `native` |
| `releases` | Conditional (verify) | yes | Setting: `Organization.releasesEnabled` (PMK-29) | On gives `native`. Off gives `absent`, hint `Linear releases need the Business or Enterprise plan and releases turned on in the workspace settings`. | `absent` |
| `capacity` | Derived | yes | pmkit: follows `cycles` | `derived`, `detail: { source: 'local' }`, when `cycles` is not `absent`, else `absent` with hint `Capacity needs cycles`. PMK-37 decides where local capacity lives. | `absent` |
| `native_metrics` | Conditional (Insights) | yes | Schema: no Insights object (PMK-29) | `derived`, `detail: { source: 'history' }` on every plan. | `derived` |
| `saved_views` | Native | no | Schema: `CustomView` | Not served. Linear's answer: `native`. | `absent` |
| `documents` | Native | yes | Schema: `Document` | `native` | `native` |
| `demand_signals` | Conditional (Business) | no | Setting: `Organization.customersEnabled` | Not served. Linear's answer: `native` when on, else `absent`. | `absent` |
| `request_queue` | Conditional (Asks, Business) | no | Plan. No Ask object in the schema; Asks come in through Slack integration settings. | Not served. Linear's answer: `conditional` on Business and Enterprise, else `absent`. | `absent` |
| `time_tracking` | Absent | yes | Schema: no time entry type | `absent`, hint `Linear has no time tracking`. | `absent` |
| `linked_code` | Conditional (git integration) | yes | Setting: integrations with service `github` or `gitlab`; pmkit: `git_host` | Integration present gives `native`, `detail: { source: 'integration' }`. Otherwise `derived`, `detail: { source: 'git' }`, with the Local hint `Set git_host in .pmkit/config.yaml` when `git_host` is `none`. | `derived` |
| `agent_delegation` | Native; ADR-0005 says conditional | no | Setting: users with `app: true` | Not served. Linear's answer: `conditional`, `detail: { agents: [names] }`, as ADR-0005 states. Open question 1. | `absent` |
| `security_alerts` | Absent | no | Schema: no alert type | `absent`, hint `Linear has no security alerts`. | `absent` |
| `user_inbox` | Native | no | Schema: `Notification` | Not served. Linear's answer: `native`. | `absent` |

With `tracker.scope.team` set, the team rule uses that team alone, so `cycles`, `estimation` and `native_triage` are never `conditional`.

#### How an absent capability is reported

An entry is `{ id, path: 'absent', enableHint }`, plus `detail.workspace` when Linear offers the capability and pmkit does not serve it. The hint names the one reason, in this order:

1. Linear does not have it: `Linear has no time tracking`.
2. A plan or a workspace setting keeps it off: `Linear releases need the Business or Enterprise plan and releases turned on in the workspace settings`.
3. A team setting keeps it off: `Turn on cycles in the team's settings in Linear`.
4. No pmkit command serves it: `No pmkit command serves saved_views yet; Linear offers it on this workspace`, or `...; Linear offers it on the Business and Enterprise plans`.

#### Served-by rule (recommended answer to open question 1)

A capability that no command in `SERVED_BY` serves is `absent`, as PMK-2 decided for the Local tracker, so `/pmkit:help` and the commands never promise a path no command has. The path Linear offers on this workspace goes to `detail.workspace`, so help can still say what the plan allows. `unservedCapabilities` from `scripts/lib/capabilities.mjs` returns `[]` for every Linear manifest, and a test checks it.

This affects 7 capabilities: `strategic_goals`, `saved_views`, `demand_signals`, `request_queue`, `agent_delegation`, `security_alerts` and `user_inbox`. `agent_delegation` becomes `absent` with `detail: { workspace: 'conditional', agents: ['Linear'] }`, which departs from ADR-0005's line "PMK-33 reports `agent_delegation` as `conditional`". The question asks the user to confirm that or keep the ADR's wording.

The served-by rule does not look at which Linear operations exist yet. During the milestone, `cycles` can be `native` while `cycle list` throws `NOT_SUPPORTED` from a stub. The milestone ships with PMK-35 to PMK-38, and PMK-40 checks every degraded path against Linear.

### What PMK-34 gets

PMK-34 asks for "the mappings a hosted tracker cannot infer". Discovery gives it the inputs and applies only what is already in `.pmkit/config.yaml`:

- Applied by discovery, nothing to ask: native state categories, the plan, the estimate type of each team, the priorities.
- Handed over for questions: every `started` state per team, so setup can ask which one means `in_review` (the sandbox has four candidates); every state, so setup can ask which one means `blocked`; label groups per team, so setup can offer one as the estimate (the sandbox's sizes group on a team with estimates off) or as the type; teams and each member's teams, so setup can pick the default team when the viewer is in one team and ask when in several.
- Reported for PMK-34 to act on: warnings for a mapped state or a configured team that no longer exists. PMK-34 turns them into "the command stops and asks".
- Not done here: writing mappings, the summary approval, `mappings.fields`, and what `blocked` means for `isBlocked`.

## Testing

Every test injects `fakeLinearFetch` with routes from `fakeWorkspace()`, and sets `PMKIT_HOME` with `userStoreEnv()` from `scripts/test-helpers.mjs`. No test opens a socket or writes to the real home.

- `discovery.test.mjs`: each state type maps to its category, `duplicate` included; an unknown type warns; `mappings.status.in_review` turns a started state into `in_review`; a mapping to a missing state warns; the team view and the no-team view; a missing team warns; group labels leave the flat list; apps go to `agents`; inactive users never appear; each estimation type, with `allowZero` and `extended`; a connection with `hasMore: true` sets `truncated` and warns; a `PmkitPlan` answer of `FORBIDDEN` gives `plan: 'unknown'` and keeps the rest.
- `manifest.test.mjs`: 20 entries in spec order, each with a path; the sandbox description gives the "Sandbox" column above; a Business description with releases and customers on gives `releases: native` and `demand_signals` absent with `detail.workspace: 'native'`; a configured team turns `conditional` into `native` or `absent`; `git_host: none` and a `github` integration for `linked_code`; `unservedCapabilities(manifest, SERVED_BY)` is `[]`; every `absent` entry has a hint and every `detail` value is flat.
- `tracker.test.mjs`: `assertTracker` passes; a stub throws `NOT_SUPPORTED` and makes no request; a missing key throws `AUTH` before any request; with no workspace, `discover` works and writes no cache, and a stub throws `NOT_CONFIGURED`; two calls in one run send one discovery; a second tracker with the same store sends no discovery request until the TTL passes (injected `now`); `refresh: true` fetches again; a fresh result has `auth` and a cached one does not; a failing `cachePut` warns; no file under the store holds `FAKE_KEY`.
- `cli-linear.test.mjs`, through `run(argv, { env, adapters })` with `linearDescriptor({ fetch })`: `discover --json` returns `auth` before `teams` and `statuses`; `discover` without a key exits 2 with `AUTH` and the fake key appears in no stdout or stderr; `capabilities --json` reports 20 entries; `validate` lists the missing workspace and a secret-like key by path; the rename warning reaches stderr; `issues list` exits 2 with `NOT_SUPPORTED`.
- Existing tests that use `linear` as the unsupported example (`adapters.test.mjs`, `config.test.mjs`, `cli.test.mjs`) switch to `jira`. Every golden stays byte-identical.
- An opt-in live case joins `scripts/lib/linear/client-live.mjs` behind `PMKIT_LIVE=1` and `PMKIT_LIVE_WORKSPACE`. It runs `fetchDiscovery` read-only and checks the shape, without printing names. `npm test` does not load it.

## Acceptance criteria map

| Criterion | Design part |
|---|---|
| 1. `discover` returns teams, states with categories, labels, members and estimate scales | "Discovery queries" (one paged query per kind), "The discover result" (`teams[]` with `statuses`, `labels` and `estimate`; the common `statuses`, `labels`, `members` and `estimate`; the category table and status mappings), "The raw discovery and the cache", and the `discovery.test.mjs` and `cli-linear.test.mjs` cases |
| 2. `capabilities` reports each of the 20 capabilities with the path the workspace plan allows | "The capability manifest" (`workspace.plan`, the per-capability source and rule table, the absent reporting order, the served-by rule with `detail.workspace`), "Discovery queries" (`PmkitWorkspace` and `PmkitPlan`), and the `manifest.test.mjs` cases with a Free and a Business description |

## Decisions

| Decision | Reason |
|---|---|
| Settings decide, the plan words the hint, no live probes | A read passes on Free for initiatives, and a refused read fails as `AUTH`. Settings are what Linear uses to turn the feature on. |
| The plan has its own request | A key that cannot read `subscription` still discovers everything else. |
| Cache the raw discovery, not the manifest | The manifest depends on config that changes without an API call. |
| TTL of one hour, refresh on `pmkit discover` and on a miss | 7 requests per refresh is cheap, and a miss in PMK-34 or PMK-35 refreshes before it fails. |
| No `auth` in the cache | The viewer belongs to the key, and the cache cannot tell when the key changes. |
| Top-level `workflowStates`, `issueLabels` and `users` instead of nesting under `teams` | The nested query cost 4335 complexity for one team. Top-level paging stays near the node count and uses the client's page cap. |
| `duplicate` maps to `canceled` | The sandbox has a `duplicate` state, and a duplicate issue is closed without being done. |
| Member id is Linear's user id | It matches `MEMBER_ID`, survives renames, and is what the issue mutations take. |
| `types` is empty until PMK-34 | Linear has no type field, and inventing one would mislabel issues. |
| Stubs for the other operations | `assertTracker` needs every operation, and a named `NOT_SUPPORTED` tells the user what to do. |

## Risks

- **Plan strings.** `subscription.type` was `null` on Free. The strings for Basic, Business and Enterprise are not verified. `workspace.plan` keeps the raw string when it is not `free`, and settings decide every path that has one. A trial (`trialEndsAt` set) reports `plan: 'trial'`.
- **Non-admin keys.** The sandbox key belongs to an admin. A member's key may not read `subscription` or `integrations`. The plan request already tolerates a refusal. If `integrations` is refused, `PmkitWorkspace` fails with `AUTH`, and the plan should move `integrations` into a separate tolerant request too. The live case should run with a member key before the milestone ships.
- **Estimate scales.** The expected values above come from memory of Linear's docs and need the check the design asks for. The sandbox has estimates off, so it cannot confirm them.
- **Empty `types`.** The contract suite requires at least one type, and `issues create` passes the first type. PMK-39 and PMK-35 need PMK-34's type mapping first, or a decision that Linear issues have no type.
- **No `in_review` without a mapping.** The contract suite also requires a status in every category. On Linear, `in_review` exists only after setup maps it.
- **Status names across teams.** In the no-team view, the same name can map to two categories in two teams. `categoryLookup` reads by name. With a team configured the problem disappears, and setup always configures one.
- **A stale cache.** A plan upgrade or a new state can stay hidden for up to an hour. The `capabilities` text output prints `discoveredAt`, and `pmkit discover` refreshes.
- **Linear manifest during the milestone.** With the served-by rule, the manifest promises paths whose Linear operations are still stubs. Nobody can select Linear through `init`, which accepts `local` only, so this reaches only a hand-edited config.
- **Tests that named `linear` as unsupported.** The cases in `adapters.test.mjs`, `config.test.mjs` and `cli.test.mjs` change to `jira`. The plan should list them so a reviewer sees the change is mechanical.

## Open questions

1. **What path does the Linear manifest give a capability that Linear offers but no pmkit command serves?** This covers `saved_views`, `user_inbox`, `agent_delegation` and four others.
   - (a) The path Linear offers on this workspace, ignoring `SERVED_BY`. It matches the criterion word for word and ADR-0005's `conditional` for `agent_delegation`, but help would list paths no command has, which PMK-2 fixed for the Local tracker.
   - (b) `absent`, as for the Local tracker, with Linear's path in `detail.workspace` and in the hint. Help stays honest and still shows what the plan allows. ADR-0005's line on `agent_delegation` then describes `detail.workspace`, not `path`.
   - (c) As (b), and also `absent` for capabilities whose Linear operations are still stubs. The manifest is right at every commit, but most capabilities read `absent` until PMK-38, and each of PMK-35 to PMK-38 edits a list.
   - Recommendation: (b). It keeps one rule for both trackers, and the design above uses it. Picking (a) removes one step in `buildLinearCapabilities` and two test cases.
2. **Does the Linear descriptor list secret-like keys in `configProblems`?** The brief says the client is the one place that refuses them. PMK-30's resolved question 1 said `pmkit validate` lists them once PMK-33 adds `secretKeyPaths` to `configProblems`. Listing them there also refuses a write through `pmkitProblems` before the client runs.
   - (a) Yes, as PMK-30's answer says. `validate` shows the problem, and the `INVALID_INPUT` refusal stays in the client.
   - (b) No. Only the client reacts, and `validate` stays silent about secrets.
   - Recommendation: (a). A user who runs `validate` sees the problem without a network call. The design above uses it.
3. **Does `pmkit discover` always refresh the cache?**
   - (a) Always. It is the command a person or setup runs to look at the workspace now, and other commands read the cache.
   - (b) Only with a new `--refresh` flag, so a plain `discover` is free when the cache is fresh.
   - Recommendation: (a). Setup needs fresh data, and nobody runs `discover` in a loop. The design above uses it.

No ADR is needed. The choices stay inside the Linear adapter, and ADR-0005 already covers the credential.

## Left to the builder

- The module split inside `scripts/lib/linear/`, as long as the descriptor loads the tracker code lazily.
- Wording of warnings and hints beyond the templates above, as long as none names a secret.
- The shape of `fakeWorkspace()`.

## Self-review

- Placeholders: none. The estimate scales are marked as values to check, with the page to check them against.
- Consistency: "discovery" means `fetchDiscovery` plus `discoveryView`. "Linear's answer" and `detail.workspace` mean the same thing. Examples use `acme` and `ACME`.
- Scope: four new modules, one registry line, two command tweaks, one fake helper and tests. No write to Linear, no schema change, no ADR.
- Boundaries: `me` goes to PMK-35, mapping questions to PMK-34, triage rotation to PMK-43, degraded paths to PMK-40, and "Non-goals" says so.
