# PMK-33 Linear discovery and capability manifest implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: use superpowers:subagent-driven-development or superpowers:executing-plans, as the user picks, to implement this plan task by task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Register `linear` in `ADAPTERS` with a tracker whose `discover()` returns teams, states with categories, labels, members and estimate scales, and whose `capabilities()` reports the 20 capabilities with the path the workspace allows.

**Architecture:** Four new modules under `scripts/lib/linear/`. `discovery.mjs` sends the read queries and builds the discover result, `manifest.mjs` builds the capability entries from that data and the config, `tracker.mjs` holds the run memo, the user-store cache and the `NOT_SUPPORTED` stubs, and `adapter.mjs` is the descriptor the registry holds. The cache holds raw API data only, so the manifest is a pure function of the cached data and the current config.

**Tech stack:** Node.js ESM, `node:test`, the PMK-30 client (`createLinearClient`), the PMK-32 user store (`cacheGet`, `cachePut`, `repoHash`), and `fakeLinearFetch` from `scripts/fake-linear-api.mjs`.

**Spec:** `docs/superpowers/specs/2026-10-27-pmk-33-linear-discovery-design.md`

## Global constraints

- `npm test` opens no socket. Every Linear test injects `fakeLinearFetch`. Every test that reaches the user store sets `PMKIT_HOME` through `userStoreEnv()`.
- `package.json` gains no dependency (ADR-0003).
- Every Local tracker output stays byte-identical. `npm test` runs the goldens.
- The key never appears in output, a cache file, an error or a command line. Tests use `FAKE_KEY`.
- No file, commit or comment holds the real workspace URL key or team key. Examples use `acme` and `ACME`. Docs say "the sandbox workspace".
- Discovery sends queries only. No task sends a write to Linear.
- The client's page cap is 10 pages when the caller gives no limit. Discovery passes `pageSize: 250` and no `limit`.
- `configProblems` reports a missing `tracker.scope.workspace` only. It lists no secret-like key; the client alone refuses one.
- A capability that Linear offers and no command in `SERVED_BY` serves is `absent`, with Linear's path in `detail.workspace`.
- `pmkit discover` always refreshes. Every other command reads the memo, then the cache, then the API.
- Cache: scope `repoHash(config.root)`, key `linear-<workspace>`, TTL 3600 seconds, value `version: 1`.
- Every commit message carries `(PMK-33)` and ends with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Code, comments and messages follow `~/.claude/skills/unslop/SKILL.md`.

## Review focus

1. A member's key that may not read `organization.integrations`. Discovery must still succeed, with `linked_code` derived from git and a warning. Task 2 adds a separate tolerant `PmkitIntegrations` request and its test, as the spec's "Non-admin keys" risk asked.
2. `RATE_LIMITED` while reading the plan or the integrations. The tolerance for those two requests must not swallow it. Task 2 tests that it propagates.
3. A cache file from an older format or a hand-edited one (`version` is not 1, or a list is missing). It must count as a miss and trigger a fetch, not a crash. Task 6 tests it.
4. A user who changes `tracker.scope.workspace`. The next run must not read the old workspace's cache. Task 6 tests that the key follows the workspace.
5. A workspace with no teams, as a new key in setup can see. `discover` and `capabilities` must return empty lists and `absent` team capabilities, not throw. Task 4 and Task 5 test it.

## Files

| File | Change | Task |
|---|---|---|
| `scripts/fake-linear-api.mjs` | Adds `fakeWorkspace(options)` and the `ACME_*` ids | 1 |
| `scripts/fake-linear-api.test.mjs` | Tests `fakeWorkspace` | 1 |
| `scripts/lib/linear/discovery.mjs` | New. Queries, `fetchDiscovery`, `estimateScale`, `categoryOfType`, `discoveryView` | 2, 3, 4 |
| `scripts/lib/linear/discovery.test.mjs` | New | 2, 3, 4 |
| `scripts/lib/linear/manifest.mjs` | New. `LINEAR_CAPABILITIES`, `buildLinearCapabilities` | 5 |
| `scripts/lib/linear/manifest.test.mjs` | New | 5 |
| `docs/adr/0005-linear-uses-a-personal-api-key-from-the-environment.md` | One line amended | 5 |
| `scripts/lib/linear/tracker.mjs` | New. `createLinearTracker` | 6 |
| `scripts/lib/linear/tracker.test.mjs` | New | 6 |
| `scripts/lib/linear/adapter.mjs` | New. `linearDescriptor` | 7 |
| `scripts/lib/adapters.mjs` | Adds `linear: linearDescriptor()`, updates the header comment | 7 |
| `scripts/adapters.test.mjs`, `scripts/config.test.mjs`, `scripts/validate.test.mjs` | `linear` as the unsupported example becomes `jira` | 7 |
| `scripts/pmkit.mjs` | `discover` and `capabilities` commands | 8 |
| `scripts/cli-linear.test.mjs` | New | 8 |
| `scripts/lib/linear/client-live.mjs` | One opt-in read-only discovery case | 9 |

## Acceptance criteria map

| Criterion | Tasks |
|---|---|
| 1. `discover` returns teams, states with categories, labels, members and estimate scales | Task 2 (queries and raw data), Task 3 (categories and scales), Task 4 (the result), Task 6 (memo and cache), Task 8 (`discover --json` through the CLI) |
| 2. `capabilities` reports each of the 20 capabilities with the path the workspace plan allows | Task 2 (plan, flags, integrations), Task 5 (the rules, the served-by rule, a Free and a Business workspace), Task 6 (the manifest object), Task 8 (`capabilities --json` reports 20 entries) |

---

### Task 1: The fake Linear workspace

**Files:**
- Modify: `scripts/fake-linear-api.mjs`
- Test: `scripts/fake-linear-api.test.mjs`

**Interfaces:**
- Consumes: `json`, `page`, `fakeLinearFetch` in the same file.
- Produces:
  - `ACME_TEAM_ID = 'team-acme'`.
  - `fakeWorkspace(options) -> routes`, an object keyed by operation name: `PmkitWorkspace`, `PmkitPlan`, `PmkitIntegrations`, `PmkitTeams`, `PmkitStates`, `PmkitLabels`, `PmkitUsers`. Pass it as `fakeLinearFetch(fakeWorkspace(...))`.
  - Options and defaults: `urlKey = 'acme'`, `name = 'Acme'`, `subscription = null` (a paid plan passes `{ type: 'business' }`), `trialEndsAt = null`, `releasesEnabled = false`, `customersEnabled = false`, `integrations = ['githubCodeAccessPersonal']`, `teams`, `states`, `labels`, `users` (raw Linear nodes, defaults below), `refuse = []` (operation names answered with HTTP 200 and `errors: [{ extensions: { code: 'FORBIDDEN' } }]`), `endless = []` (connection operations that always answer `hasNextPage: true` with a new cursor).
  - Default data, shaped like the sandbox workspace with `acme` names. One team `{ id: 'team-acme', key: 'ACME', name: 'Acme', parent: null, cyclesEnabled: false, triageEnabled: false, issueEstimationType: 'notUsed', issueEstimationAllowZero: false, issueEstimationExtended: false }`. Ten states on that team, in position order: Backlog `backlog`, Todo `unstarted`, In Progress, In Review, Code Review, UAT and Ready to ship `started`, Done `completed`, Canceled `canceled`, Duplicate `duplicate`. Labels: team labels Bug and Feature, a group Size (`isGroup: true`) with children XS, S, M, L, XL, a workspace label Docs (`team: null`) and a retired team label Old (`retiredAt` set). Users: `user-1` Test User (active, the viewer), `user-2` Ada Lovelace (active, `displayName: 'ada'`, `email: 'ada@example.com'`), `user-3` Gone (`active: false`), `user-4` Linear (`app: true`). Every user is on `team-acme`.
  - Connection routes read `variables.first` and `variables.after` and page through the node list. The cursor is the index of the next node as a string.

- [ ] **Step 1: Write the failing tests** in `scripts/fake-linear-api.test.mjs`
  - `fakeWorkspace answers every discovery operation with the default data`: for each of the seven names, posting `query <Name> { x }` through `fakeLinearFetch(fakeWorkspace())` returns `data`. `PmkitStates` holds 10 nodes, one of type `duplicate`. `PmkitPlan` returns `organization.subscription === null`.
  - `fakeWorkspace pages a connection by first and after`: `PmkitStates` with `{ first: 4 }` returns 4 nodes and `pageInfo: { hasNextPage: true, endCursor: '4' }`. With `{ first: 4, after: '8' }` it returns 2 nodes and `hasNextPage: false`.
  - `fakeWorkspace refuses and loops on request`: `refuse: ['PmkitPlan']` answers with `errors[0].extensions.code === 'FORBIDDEN'`. `endless: ['PmkitLabels']` answers `hasNextPage: true` on every page with a cursor that differs from `after`.
- [ ] **Step 2: Run** `node --test scripts/fake-linear-api.test.mjs`. Expected: FAIL, `fakeWorkspace` is not exported.
- [ ] **Step 3: Implement `fakeWorkspace(options)` and `ACME_TEAM_ID`** in `scripts/fake-linear-api.mjs`.
- [ ] **Step 4: Run** `node --test scripts/fake-linear-api.test.mjs`. Expected: PASS.
- [ ] **Step 5: Commit** with `test(linear): add a fake discovery workspace (PMK-33)`.

### Task 2: Fetch the raw discovery

**Files:**
- Create: `scripts/lib/linear/discovery.mjs`
- Test: `scripts/lib/linear/discovery.test.mjs`

**Interfaces:**
- Consumes: `createLinearClient({ env, tracker, requireWorkspace: false, fetch })` from `client.mjs`, with its `request(document, variables)` and `paginate(document, variables, { select, pageSize })`, which returns `{ nodes, hasMore }`. `fakeWorkspace` from Task 1.
- Produces: `fetchDiscovery(client, { now }) -> Promise<RawDiscovery>`, where `now` returns a `Date` and `RawDiscovery` is:

```js
{
  version: 1,
  discoveredAt,                                         // now().toISOString()
  workspace: { urlKey, name, plan, trialEndsAt },       // plan: string, see below
  flags: { releasesEnabled, customersEnabled },
  integrations: ['github'] | null,                      // null when Linear refused the read
  teams: [{ id, key, name, parent, cyclesEnabled, triageEnabled, estimation: { type, allowZero, extended } }],
  states: [{ id, name, type, position, team }],         // team: the team id
  labels: [{ id, name, group, isGroup, team }],         // group: parent label name or null; team: id or null
  users: [{ id, name, displayName, email, guest, app, teams }],  // teams: team ids
  truncated: [],                                        // 'teams' | 'states' | 'labels' | 'users'
}
```

Documents. Every connection selects `pageInfo { hasNextPage endCursor }` and takes `$first: Int!, $after: String`.

| Operation | Fields |
|---|---|
| `PmkitWorkspace` | `organization { urlKey name releasesEnabled customersEnabled trialEndsAt }` |
| `PmkitPlan` | `organization { subscription { type } }` |
| `PmkitIntegrations` | `organization { integrations(first: 100) { nodes { service } } }` |
| `PmkitTeams` | `teams(first: $first, after: $after) { nodes { id key name parent { key } cyclesEnabled triageEnabled issueEstimationType issueEstimationAllowZero issueEstimationExtended } }` |
| `PmkitStates` | `workflowStates(...) { nodes { id name type position team { id } } }` |
| `PmkitLabels` | `issueLabels(...) { nodes { id name isGroup retiredAt team { id } parent { id name } } }` |
| `PmkitUsers` | `users(...) { nodes { id name displayName email active guest app teams(first: 50) { nodes { id } } } }` |

Rules:
- `await client.session()` first, then the seven operations in `Promise.all`.
- `plan`: a string `subscription.type` gives that string in lowercase. Otherwise a `trialEndsAt` later than `now()` gives `'trial'`. Otherwise `'free'`. **(Builder's call:** a past `trialEndsAt` does not claim a trial.)
- `PmkitPlan` and `PmkitIntegrations` are tolerant. A `PmkitError` with code `AUTH` or `UPSTREAM` gives `plan: 'unknown'` or `integrations: null`. Any other error, `RATE_LIMITED` included, propagates. Every other operation propagates every error.
- Retired labels (`retiredAt` set) and users with `active: false` are dropped here. `parent` of a team becomes the parent's key or `null`.
- A connection whose result has `hasMore: true` adds its kind to `truncated`, in the order teams, states, labels, users.

- [ ] **Step 1: Write the failing tests** in `scripts/lib/linear/discovery.test.mjs`. A helper builds the client with `env: { LINEAR_API_KEY: FAKE_KEY }`, `tracker: { system: 'linear', scope: { workspace: 'acme' } }` and `fetch: fakeLinearFetch(fakeWorkspace(options))`, and `now = fixedNow('2026-10-27T12:00:00Z')`.
  - `fetchDiscovery returns the raw data of the default workspace`: `workspace` deep-equals `{ urlKey: 'acme', name: 'Acme', plan: 'free', trialEndsAt: null }`; `states.length === 10`; `labels` holds no `Old`; `users` holds no `user-3`; the label XS has `group: 'Size'`; `integrations` deep-equals `['githubCodeAccessPersonal']`; `truncated` deep-equals `[]`; `discoveredAt === '2026-10-27T12:00:00.000Z'`.
  - `fetchDiscovery sends the session and seven queries, and no mutation`: the fetch's `calls` hold `PmkitSession` once and each of the seven names once, and `isMutation` is false for every query.
  - `the plan comes from the subscription, a running trial or free`: `{ subscription: { type: 'Business' } }` gives `'business'`; `trialEndsAt: '2026-11-01T00:00:00Z'` gives `'trial'`; `trialEndsAt: '2026-10-01T00:00:00Z'` gives `'free'`.
  - `a refused plan gives unknown and keeps the rest`: `refuse: ['PmkitPlan']` gives `plan: 'unknown'` and `teams.length === 1`.
  - `refused integrations give null and keep the rest`: `refuse: ['PmkitIntegrations']` gives `integrations: null` and `states.length === 10`.
  - `a rate limit on the plan propagates`: a `PmkitPlan` route answering HTTP 429 rejects with `code: 'RATE_LIMITED'`.
  - `a refused teams read fails the discovery with AUTH`: `refuse: ['PmkitTeams']` rejects with `code: 'AUTH'`.
  - `an endless connection is truncated at the client's cap`: `endless: ['PmkitLabels']` gives `truncated` deep-equal to `['labels']`, and the fetch saw `PmkitLabels` 10 times.
- [ ] **Step 2: Run** `node --test scripts/lib/linear/discovery.test.mjs`. Expected: FAIL, the module does not exist.
- [ ] **Step 3: Implement the documents and `fetchDiscovery(client, { now })`** in `scripts/lib/linear/discovery.mjs`, with the rules above.
- [ ] **Step 4: Run** `node --test scripts/lib/linear/discovery.test.mjs`. Expected: PASS.
- [ ] **Step 5: Commit** with `feat(linear): fetch the raw workspace discovery (PMK-33)`.

### Task 3: State categories and estimate scales

**Files:**
- Modify: `scripts/lib/linear/discovery.mjs`
- Test: `scripts/lib/linear/discovery.test.mjs`

**Interfaces:**
- Produces:
  - `categoryOfType(type) -> string | null`. `triage` to `triage`, `backlog` to `backlog`, `unstarted` to `todo`, `started` to `in_progress`, `completed` to `done`, `canceled` to `canceled`, `duplicate` to `canceled`. Any other string gives `null`; Task 4 turns `null` into `in_progress` with a warning.
  - `estimateScale({ type, allowZero, extended }) -> { unit, scale, values? }`.

Scales. Source: https://linear.app/docs/estimates. Before you code them, open that page and compare. A search on 2026-10-27 gave the t-shirt numbers below and said "extended" adds two values to each five-value scale. Record the date you checked in a code comment above the table. If the page disagrees, use the page and change the tests to match.

| `type` | Scale | `extended` adds | Unit |
|---|---|---|---|
| `notUsed` | `[]` | nothing | `points` |
| `exponential` | 1, 2, 4, 8, 16 | 32, 64 | `points` |
| `fibonacci` | 1, 2, 3, 5, 8 | 13, 21 | `points` |
| `linear` | 1, 2, 3, 4, 5 | 6, 7 | `points` |
| `tShirt` | XS, S, M, L, XL | XXL, XXXL | `sizes`, with `values: { XS: 1, S: 2, M: 3, L: 5, XL: 8, XXL: 13, XXXL: 21 }` |

`allowZero` puts `0` first in a points scale. For `tShirt` it adds no size; Linear stores 0 as no estimate. An unknown `type` gives the `notUsed` result. Only `tShirt` has `values`, and `values` lists only the sizes in `scale`.

- [ ] **Step 1: Write the failing tests**
  - `categoryOfType maps every Linear state type`: the seven pairs above, and `categoryOfType('paused') === null`.
  - `estimateScale gives each scale`: one `deepEqual` per row of the table, with `extended: false` and with `extended: true`.
  - `allowZero puts 0 first`: `estimateScale({ type: 'fibonacci', allowZero: true, extended: false }).scale` deep-equals `[0, 1, 2, 3, 5, 8]`; tShirt with `allowZero` keeps five sizes.
  - `an unknown estimation type gives no scale`: `estimateScale({ type: 'logarithmic' })` deep-equals `{ unit: 'points', scale: [] }`.
- [ ] **Step 2: Run** `node --test scripts/lib/linear/discovery.test.mjs`. Expected: FAIL on the new tests.
- [ ] **Step 3: Implement `categoryOfType` and `estimateScale`** after checking the docs page.
- [ ] **Step 4: Run** `node --test scripts/lib/linear/discovery.test.mjs`. Expected: PASS.
- [ ] **Step 5: Commit** with `feat(linear): map state types and estimate scales (PMK-33)`.

### Task 4: The discover result

**Files:**
- Modify: `scripts/lib/linear/discovery.mjs`
- Test: `scripts/lib/linear/discovery.test.mjs`

**Interfaces:**
- Consumes: `RawDiscovery` (Task 2), `categoryOfType` and `estimateScale` (Task 3).
- Produces: `discoveryView(raw, pmkit, { session } = {}) -> DiscoverResult`. `pmkit` is `config.pmkit`: it reads `tracker.scope.team` and `mappings.status`. `session` is the client's session object (`{ source, viewer, workspace, warnings }`) on a fresh fetch and absent on a cache hit. Keys in this order:

```js
{
  auth: { source, viewer: { id, name }, workspace: { urlKey, name } },  // only with session
  workspace: { urlKey, name, plan },
  team,              // tracker.scope.team when found, else null
  teams: [{ key, name, parent, cycles, triage, statuses: [{ name, category, type }], labels: [{ name, group }], estimate: { unit, scale, values?, type } }],
  statuses: [{ name, category }],
  types: [],
  priorities: ['urgent', 'high', 'medium', 'low'],
  labels: [names],
  members: [{ id, name, email, handle, guest, teams: [team keys] }],
  agents: [{ id, name }],
  estimate: { unit, scale, values? },
  discoveredAt,
  warnings: [strings],
}
```

Rules, from the spec's "The discover result":
- Team states are sorted by `position`. A state's category is `mappings.status.<category>` when that mapping names the state, else `categoryOfType(type)`, else `in_progress` with the warning `Linear state <name> on team <key> has type <type>, which pmkit does not know; it counts as in_progress`. `mappings.status.blocked` is ignored here.
- A mapping that names a state no team has (or the configured team lacks) warns `mappings.status.<category> names <name>, which team <key> does not have`, or `..., which no team has` with no team.
- `teams[].labels` holds every non-group label of the team plus the workspace labels, sorted by name, each with its `group`. The flat `labels` list holds names only, without group labels, deduplicated and sorted.
- With `tracker.scope.team` set and found, `statuses`, `labels` and `estimate` come from that team. With no team, or a team key that no team has, `statuses` holds every distinct name and category pair in team order then position, `labels` holds every label name, and `estimate` is the shared scale when every team that uses estimates has the same one, else `{ unit: 'points', scale: [] }`. A configured team that does not exist warns `tracker.scope.team names <key>, which this workspace does not have` and gives `team: null`.
- `members` holds users without `app`, sorted by `id`, with `handle` from `displayName` and `teams` as keys. `agents` holds the `app: true` users.
- Warnings, in this order: `session.warnings`, one per kind in `truncated` (`Linear has more than 2500 <kind>; discovery kept the first 2500`), unknown state types, mappings, the team, `plan` of `unknown` (`Linear did not say which plan this workspace has; capability hints assume the Free plan`), `integrations` of `null` (`Linear refused to list this workspace's integrations for this key; linked_code assumes git only`).

- [ ] **Step 1: Write the failing tests.** A helper `raw(options)` runs `fetchDiscovery` over `fakeWorkspace(options)`.
  - `the default workspace gives the no-team view`: `team === null`; `statuses` has 10 entries, Duplicate is `canceled`, In Review is `in_progress`; `labels` deep-equals `['Bug', 'Docs', 'Feature', 'L', 'M', 'S', 'XL', 'XS']`; `members.map((m) => m.id)` deep-equals `['user-1', 'user-2']`; `agents` deep-equals `[{ id: 'user-4', name: 'Linear' }]`; `estimate` deep-equals `{ unit: 'points', scale: [] }`; `teams[0].estimate.type === 'notUsed'`; `types` deep-equals `[]`; `warnings` deep-equals `[]`.
  - `the team view uses the configured team`: `tracker.scope.team: 'ACME'` gives `team === 'ACME'` and `teams[0].labels` holds `{ name: 'XS', group: 'Size' }` and `{ name: 'Docs', group: null }`.
  - `a missing team warns and gives the no-team view`: `team: 'NOPE'` gives `team === null` and the team warning.
  - `mappings.status.in_review turns a started state into in_review`: `{ in_review: 'Code Review' }` gives Code Review `in_review` in `statuses` and in `teams[0].statuses`.
  - `a mapping to a missing state warns`: `{ in_review: 'Peer Review' }` with team ACME warns `mappings.status.in_review names Peer Review, which team ACME does not have`.
  - `an unknown state type counts as in_progress and warns`: a state of type `paused` gives `in_progress` and the warning.
  - `a fresh view starts with auth and the session warnings`: `Object.keys(view)[0] === 'auth'`; `auth.viewer` deep-equals `{ id: 'user-1', name: 'Test User' }`; a session warning comes first in `warnings`. Without `session`, `'auth' in view` is false.
  - `truncation, an unknown plan and refused integrations warn`: one view over `endless: ['PmkitUsers']` and `refuse: ['PmkitPlan', 'PmkitIntegrations']` holds the three warnings in the order above.
  - `estimates shared by every team give the common scale, mixed ones give none`: two teams on `fibonacci` give `scale` `[1, 2, 3, 5, 8]`; `fibonacci` and `exponential` give `[]`.
  - `a workspace with no teams gives empty lists`: `teams: [], states: [], labels: []` gives `statuses`, `labels` and `teams` all `[]` and no throw (Review focus 5).
- [ ] **Step 2: Run** `node --test scripts/lib/linear/discovery.test.mjs`. Expected: FAIL on the new tests.
- [ ] **Step 3: Implement `discoveryView(raw, pmkit, { session })`** with the rules above.
- [ ] **Step 4: Run** `node --test scripts/lib/linear/discovery.test.mjs`. Expected: PASS.
- [ ] **Step 5: Commit** with `feat(linear): build the discover result (PMK-33)`.

### Task 5: The capability entries and the ADR-0005 line

**Files:**
- Create: `scripts/lib/linear/manifest.mjs`
- Test: `scripts/lib/linear/manifest.test.mjs`
- Modify: `docs/adr/0005-linear-uses-a-personal-api-key-from-the-environment.md` (one line)

**Interfaces:**
- Consumes: `RawDiscovery`, `estimateScale`, and `CAPABILITIES`, `SERVED_BY`, `unservedCapabilities` from `scripts/lib/capabilities.mjs`.
- Produces: `LINEAR_CAPABILITIES`, the static table of schema facts, and `buildLinearCapabilities(raw, pmkit) -> [{ id, path, detail?, enableHint? }]`, 20 entries in `CAPABILITIES` order. `pmkit` gives `tracker.scope.team` and `git_host.system` (`'none'` when absent).

Rules. They are the spec's table "The paths". This list fixes only what the table leaves open.
- Team settings (`cycles` from `cyclesEnabled`, `native_triage` from `triageEnabled`, `estimation` from `estimation.type !== 'notUsed'`) look at the configured team when it exists, else at every team. All on gives `native`, none on (or no teams) gives `absent`, some on gives `conditional` with `detail: { teams: [keys] }`.
- `estimation` on `native` has `detail: { unit, scale }` from that team, or the common scale with no team (empty when the teams differ).
- `capacity` is `derived` with `detail: { source: 'local' }` when `cycles` is not `absent`.
- `linked_code` is `native` with `detail: { source: 'integration' }` when `integrations` includes `github` or `gitlab`. Otherwise it is `derived` with `detail: { source: 'git' }`, plus `enableHint: 'Set git_host in .pmkit/config.yaml'` when `git_host` is `none`.
- Business plans are `business`, `enterprise` and `trial` **(builder's call:** Linear's trial is a Business trial).
- Linear's answer for the unserved seven: `strategic_goals` `native` on a Business plan; `saved_views` `native`; `demand_signals` `native` when `customersEnabled`; `request_queue` `conditional` on a Business plan; `agent_delegation` `conditional` with `agents: [names]`; `user_inbox` `native`; `security_alerts` none. Each is `absent`. When Linear's answer is not absent, `detail.workspace` holds it.
- Hints follow the spec's order. Exact copy:
  - `Linear has no time tracking`, `Linear has no security alerts`
  - `Linear releases need the Business or Enterprise plan and releases turned on in the workspace settings`
  - `Linear initiatives need the Business or Enterprise plan`
  - `Linear customer requests need the Business or Enterprise plan and customers turned on in the workspace settings`
  - `Linear Asks need the Business or Enterprise plan`
  - `Turn on cycles in the team's settings in Linear`, `Turn on estimates in the team's settings in Linear`, `Turn on triage in the team's settings in Linear`, `Capacity needs cycles`
  - `No pmkit command serves <id> yet; Linear offers it on this workspace`
- Every `detail` value is a string, a number or a list of strings or numbers.

ADR-0005 amendment. Replace the sentence `PMK-33 reports \`agent_delegation\` as \`conditional\` for Linear.` with `PMK-33 reports \`agent_delegation\` as \`absent\` for Linear until a pmkit command serves it, with Linear's \`conditional\` in \`detail.workspace\`.` Change nothing else in the ADR. `scripts/adr-linear-auth.test.mjs` must still pass.

- [ ] **Step 1: Write the failing tests** in `scripts/lib/linear/manifest.test.mjs`. Build `raw` from `fakeWorkspace` through `fetchDiscovery`, as in Task 4.
  - `the manifest has 20 entries in spec order, each with a path`: `entries.map((e) => e.id)` deep-equals `CAPABILITIES`; each `path` is one of `native`, `derived`, `conditional`, `absent`.
  - `the default workspace gives the sandbox column`: one `deepEqual` of `Object.fromEntries(entries.map((e) => [e.id, e.path]))` against the spec's "Sandbox, no team configured" column, and `agent_delegation.detail` deep-equals `{ workspace: 'conditional', agents: ['Linear'] }`.
  - `a Business workspace with releases and customers on`: `subscription: { type: 'business' }, releasesEnabled: true, customersEnabled: true` gives `releases` `native`, `demand_signals` `absent` with `detail.workspace === 'native'`, and `strategic_goals.detail.workspace === 'native'`.
  - `team settings are conditional across teams and decided by the configured team`: two teams, ACME with cycles on and OPS off; no team gives `cycles` `conditional` with `detail.teams` `['ACME']` and `capacity` `derived`; `team: 'OPS'` gives `cycles` and `capacity` `absent`; `team: 'ACME'` gives `cycles` `native`.
  - `estimation on a team gives its scale`: ACME on `fibonacci` with `team: 'ACME'` gives `estimation` `{ path: 'native', detail: { unit: 'points', scale: [1, 2, 3, 5, 8] } }`.
  - `linked_code follows the integration and git_host`: `integrations: ['github']` gives `native`; the default with `git_host: { system: 'none' }` gives `derived` with the hint; `githubCodeAccessPersonal` alone does not count.
  - `refused integrations give a derived linked_code`: `integrations: null` gives `derived`.
  - `no entry claims a path no command serves`: `unservedCapabilities(entries, SERVED_BY)` deep-equals `[]`, for the default and the Business workspace.
  - `every absent entry has a hint and every detail is flat`: checked over the default, the Business and the no-team workspace (Review focus 5).
- [ ] **Step 2: Run** `node --test scripts/lib/linear/manifest.test.mjs`. Expected: FAIL, the module does not exist.
- [ ] **Step 3: Implement `LINEAR_CAPABILITIES` and `buildLinearCapabilities(raw, pmkit)`**, then amend the ADR-0005 line.
- [ ] **Step 4: Run** `node --test scripts/lib/linear/manifest.test.mjs scripts/adr-linear-auth.test.mjs`. Expected: PASS.
- [ ] **Step 5: Commit** with `feat(linear): build the capability manifest (PMK-33)`. The body says the commit amends the `agent_delegation` line of ADR-0005, as the user's answer to the spec's question 1 asked.

### Task 6: The Linear tracker

**Files:**
- Create: `scripts/lib/linear/tracker.mjs`
- Test: `scripts/lib/linear/tracker.test.mjs`

**Interfaces:**
- Consumes: `createLinearClient`, `fetchDiscovery`, `discoveryView`, `buildLinearCapabilities`, `cacheGet`, `cachePut`, `repoHash`, `TRACKER_OPERATIONS`.
- Produces: `createLinearTracker(config, { env, now = () => new Date(), fetch }) -> tracker` with one function per `TRACKER_OPERATIONS` entry:
  - `discover({ refresh = false } = {}) -> Promise<DiscoverResult>`
  - `capabilities() -> Promise<{ tracker: 'linear', gitHost, generatedAt, discoveredAt, workspace: { urlKey, plan }, team, capabilities, warnings }>`
  - every other operation: an async stub.

Rules:
- The client is created at once with `requireWorkspace: false`, so a missing key throws `AUTH` from `createLinearTracker` and a secret-like key throws `INVALID_INPUT`, both before any request.
- Read order: the run's memo, then `cacheGet(repoHash(config.root), 'linear-' + workspace, { env, now })`, then `fetchDiscovery`. A cached value counts only when `version === 1` and `teams`, `states`, `labels` and `users` are arrays. A fetch writes the cache with `ttlSeconds: 3600` and keeps the session in the memo for `auth`.
- With no `tracker.scope.workspace`, the tracker never reads or writes the cache.
- `refresh: true` skips the memo and the cache, fetches, and rewrites both.
- A `cachePut` that throws adds the warning `pmkit could not write the Linear discovery cache: <message>` and returns the result.
- `capabilities()` uses the same memo and returns `team` and `warnings` from `discoveryView`.
- A stub checks the workspace first: none gives `NOT_CONFIGURED`, `tracker.scope.workspace is not set`, next step `/pmkit:setup`. Then it throws `NOT_SUPPORTED`, `the Linear adapter does not implement <operation> yet`, next step `Set tracker.system to local in .pmkit/config.yaml to use this command now`.

- [ ] **Step 1: Write the failing tests** in `scripts/lib/linear/tracker.test.mjs`. Each test makes `root = tempDir()`, `const { env } = userStoreEnv()`, adds `LINEAR_API_KEY: FAKE_KEY`, and builds `config = { root, pmkit: { tracker: { system: 'linear', scope: { workspace: 'acme' } }, git_host: { system: 'github' } } }`.
  - `the tracker passes assertTracker`.
  - `a stub throws NOT_SUPPORTED and sends no request`: `searchIssues()` rejects with `NOT_SUPPORTED` and the message above; `fetch.calls.length === 0`.
  - `a stub without a workspace throws NOT_CONFIGURED`.
  - `a missing key throws AUTH before any request`: `env` without the key makes `createLinearTracker` throw `code: 'AUTH'`, and `fetch.calls.length === 0`.
  - `a secret-like key in the config throws INVALID_INPUT`: `scope: { workspace: 'acme', token: 'plainvalue' }` throws `code: 'INVALID_INPUT'` with a message that names `tracker.scope.token` and does not include `plainvalue`.
  - `discover and capabilities in one run share one discovery`: each discovery operation appears once in `fetch.calls`.
  - `a second tracker on the same store sends no request until the TTL passes`: the second tracker's fetch has 0 calls at `now + 59 minutes` and the full set at `now + 61 minutes`.
  - `refresh fetches again`: `discover({ refresh: true })` after a `discover()` doubles the `PmkitTeams` calls.
  - `a fresh result has auth and a cached one does not`.
  - `without a workspace discover works and writes no cache`: no file exists under `env.PMKIT_HOME` after the call.
  - `a cache entry in another format counts as a miss` (Review focus 3): `cachePut` a `{ version: 0 }` value at the tracker's key; `discover()` sends the discovery queries and returns 10 statuses.
  - `a new workspace key does not read the old cache` (Review focus 4): fill the cache for `acme`, then a tracker with `workspace: 'acme-two'` and a fetch built with `fakeLinearFetch(fakeWorkspace({ urlKey: 'acme-two' }), { workspace: 'acme-two' })` sends the discovery queries.
  - `a failing cache write warns and still returns the result`: `PMKIT_HOME` set to a folder inside a `git init`-ed temp repository; `warnings` holds the cache warning and `statuses.length === 10`.
  - `capabilities returns the manifest object`: keys in the order above, `capabilities.length === 20`, `workspace` deep-equals `{ urlKey: 'acme', plan: 'free' }`.
  - `no file under the store holds the key`: after `discover()`, every file under `env.PMKIT_HOME` is read and none includes `FAKE_KEY`.
- [ ] **Step 2: Run** `node --test scripts/lib/linear/tracker.test.mjs`. Expected: FAIL, the module does not exist.
- [ ] **Step 3: Implement `createLinearTracker`** with the rules above.
- [ ] **Step 4: Run** `node --test scripts/lib/linear/tracker.test.mjs`. Expected: PASS.
- [ ] **Step 5: Commit** with `feat(linear): add the Linear tracker with a discovery cache (PMK-33)`.

### Task 7: The descriptor and the registry

**Files:**
- Create: `scripts/lib/linear/adapter.mjs`
- Modify: `scripts/lib/adapters.mjs`, `scripts/adapters.test.mjs`, `scripts/config.test.mjs`, `scripts/validate.test.mjs`

**Interfaces:**
- Consumes: `createLinearTracker` (Task 6), `builtInDefaults` from `scripts/lib/config.mjs`.
- Produces: `linearDescriptor({ fetch = globalThis.fetch } = {}) -> AdapterDescriptor` with `system: 'linear'`, `hosted: true`, `configProblems(pmkit)` that returns `['tracker.scope.workspace is required for linear']` when the key is missing and `[]` otherwise, `settings()` that returns `{ defaults: builtInDefaults(), epicPrefix: null }`, and `create(config, { now, env })` that imports `./tracker.mjs` and returns `createLinearTracker(config, { env, now, fetch })`. `ADAPTERS.linear` is `linearDescriptor()`.

Import cycle. `config.mjs` imports `adapters.mjs`, which now imports `linear/adapter.mjs`, which imports `config.mjs`. That is safe only because nothing calls `builtInDefaults` while the modules load. Write `linearDescriptor` and its helpers as function declarations so either entry order works, and update the header comment of `adapters.mjs` to say it imports descriptors only and each tracker loads in `create`.

Tests that used `linear` as the unsupported example. A trial run that registered `linear` failed these seven, and they switch to `jira`:
- `adapters.test.mjs`: `the product registry holds local only` becomes `the product registry holds local and linear`. Keys `['local', 'linear']`, `adapterFor('linear').hosted === true`, `adapterFor('jira') === null`.
- `config.test.mjs`: `unsupportedTracker is null for local ...` and `pmkitConfigMessages adds the unsupported tracker problem ...` use `jira` in the expected messages and add `assert.equal(unsupportedTracker('linear'), null)`.
- `validate.test.mjs`: `MSG` names `jira`, and the tests `tracker.system linear alone ...`, `linear and git_host.system gitlab ...`, `linear and breakPmkit ...` and `validate and loadConfig share one rule list` edit `system: jira` and rename `linear` to `jira`. `linear with a broken .issues/config.yaml ...` passes only because of the workspace problem, so switch it too.
- `cli.test.mjs` picks its unsupported system with `TRACKERS.find((name) => !adapterFor(name))` and needs no change.

- [ ] **Step 1: Write the failing tests** in `scripts/adapters.test.mjs`
  - The renamed registry test above.
  - `the linear descriptor asks for a workspace and lists no secret`: `configProblems({ tracker: { system: 'linear' } })` deep-equals `['tracker.scope.workspace is required for linear']`; `configProblems({ tracker: { system: 'linear', scope: { workspace: 'acme', token: 'plainvalue' } } })` deep-equals `[]`.
  - `the linear descriptor creates a contract tracker from an injected fetch`: `linearDescriptor({ fetch: fakeLinearFetch(fakeWorkspace()) }).create(config, { now, env })` passes `assertTracker`.
  - `adapter.mjs loads first or second without a cycle error`: `spawnSync(process.execPath, ['--input-type=module', '-e', script])` with `cwd` at the repository root, once importing `./scripts/lib/linear/adapter.mjs` before `./scripts/lib/adapters.mjs` and once after, each printing `JSON.stringify(ADAPTERS.linear.settings().epicPrefix)`. Expected stdout `null` and status 0.
- [ ] **Step 2: Run** `node --test scripts/adapters.test.mjs`. Expected: FAIL.
- [ ] **Step 3: Implement `linearDescriptor`**, register it in `ADAPTERS`, and switch the seven tests above to `jira`.
- [ ] **Step 4: Run** `npm test`. Expected: every test passes, the goldens included.
- [ ] **Step 5: Commit** with `feat(linear): register the Linear adapter (PMK-33)`. The body lists the seven tests that switched to `jira`.

### Task 8: The discover and capabilities commands

**Files:**
- Modify: `scripts/pmkit.mjs` (the `capabilities` and `discover` entries in `COMMANDS`)
- Create: `scripts/cli-linear.test.mjs`

**Interfaces:**
- Consumes: `linearDescriptor({ fetch })`, `fakeWorkspace`, `FAKE_KEY`, `useLinear` from `scripts/fake-hosted.mjs`, `childEnv` from `scripts/golden-helpers.mjs`, `userStoreEnv` and `makeRepo`.
- Produces, in `scripts/pmkit.mjs`:
  - `discover` calls `discover({ refresh: true })`. The Local tracker ignores the argument.
  - Both commands return `warnings: result.warnings ?? []`.
  - `discover` text, only when the result has `workspace`, before `statuses:`. `workspace: Acme (acme), plan free` with `, viewer Test User` when `auth` is present. Then `teams:` and one line per team, `  ACME  Acme  cycles off, triage off, estimate notUsed`.
  - `capabilities` text, only when the manifest has `workspace`, adds the fields `workspace` (`acme (free)`), `team` (the key or `(none)`) and `discovered` (`discoveredAt`) after `git host`.

- [ ] **Step 1: Write the failing tests** in `scripts/cli-linear.test.mjs`. Set `GIT_CONFIG_GLOBAL`, `GIT_CONFIG_NOSYSTEM` and `GIT_CEILING_DIRECTORIES` as `cli-hosted.test.mjs` does. A helper runs `run(args, { cwd: root, env: { ...childEnv(), ...userStoreEnv().env, LINEAR_API_KEY: FAKE_KEY }, adapters: { ...ADAPTERS, linear: linearDescriptor({ fetch }) } })` on `useLinear(makeRepo('basic'))`.
  - `discover --json returns auth before teams and statuses`: code 0; `Object.keys(data)` starts with `['auth', 'workspace', 'team', 'teams', 'statuses']`; the Duplicate status has category `canceled`.
  - `discover always refreshes`: two `discover --json` runs on one store send `PmkitTeams` twice; `capabilities --json` after them sends none.
  - `discover prints the workspace and teams lines`: text stdout matches `/^workspace: Acme \(acme\), plan free, viewer Test User$/m` and `/^  ACME  Acme  cycles off, triage off, estimate notUsed$/m`.
  - `discover without a key exits 2 with AUTH`: `LINEAR_API_KEY` removed gives code 2 and `error.code === 'AUTH'`.
  - `a refused read prints no key`: with `FAKE_KEY` set and `refuse: ['PmkitTeams']`, `discover` exits 2 with `AUTH`, and neither stdout nor stderr includes `FAKE_KEY`, in JSON and in text mode.
  - `capabilities --json reports 20 entries`: `capabilities.length === 20` and `workspace.plan === 'free'`.
  - `validate lists a missing workspace and no secret-like key`: with `scope.workspace` removed and `scope.token: plainvalue` added, stdout lists `tracker.scope.workspace is required for linear` and does not include `token`.
  - `discover with a secret-like key exits 2 with INVALID_INPUT`: with `scope.token: plainvalue`, `error.message` includes `tracker.scope.token` and does not include `plainvalue`.
  - `the workspace rename warning reaches stderr`: `fakeLinearFetch(fakeWorkspace({ urlKey: 'acme-new' }), { workspace: 'acme-new', previousUrlKeys: ['acme'] })` gives stderr matching `/^warning: Linear renamed workspace acme to acme-new/m`.
  - `issues list exits 2 with NOT_SUPPORTED`: `error.message === 'the Linear adapter does not implement searchIssues yet'`.
- [ ] **Step 2: Run** `node --test scripts/cli-linear.test.mjs`. Expected: FAIL on the refresh, text and warning cases.
- [ ] **Step 3: Implement** the command changes above.
- [ ] **Step 4: Run** `npm test`. Expected: every test passes and every golden stays byte-identical.
- [ ] **Step 5: Commit** with `feat(cli): print Linear discovery and refresh it on discover (PMK-33)`.

### Task 9: The opt-in live check and the final checks

**Files:**
- Modify: `scripts/lib/linear/client-live.mjs`

**Interfaces:**
- Consumes: `fetchDiscovery`, `discoveryView`, `buildLinearCapabilities`, and the file's `client()`, `skip` and `KEY`.

- [ ] **Step 1: Add the test** `discovery reads the workspace and builds 20 capabilities`, with `{ skip }`. It runs `fetchDiscovery(client(), { now: () => new Date() })` through the file's `guardedFetch`, then checks `raw.workspace.urlKey === WORKSPACE`, `raw.teams.length >= 1`, that every state has a known `categoryOfType`, that `discoveryView(raw, {})` holds the keys of Task 4, that `buildLinearCapabilities(raw, {}).length === 20`, and that `JSON.stringify(raw)` does not include `KEY`. It prints no names. Update the comment at the top to say the file also checks discovery.
- [ ] **Step 2: Run** `node --test scripts/lib/linear/client-live.mjs` without `PMKIT_LIVE`. Expected: every test skipped.
- [ ] **Step 3 (optional, read-only):** run it live with the sandbox workspace passed only on the command line, never in a file: `set -a; . /home/fred/projects/pmkit/.env; set +a; PMKIT_LIVE=1 PMKIT_LIVE_WORKSPACE=<url key> node --test scripts/lib/linear/client-live.mjs`. Expected: PASS. If a member key is available, run it with that key too, as the spec's "Non-admin keys" risk asks. Report the result without names.
- [ ] **Step 4: Run** `npm test`, then the private-name check. Expected: every test passes, and the grep prints nothing.
- [ ] **Step 5: Commit** with `test(linear): add a live discovery check (PMK-33)`.

## Self-review

- Spec coverage. Discovery queries (Task 2), the raw data and the cache (Tasks 2 and 6), the discover result (Tasks 3 and 4), the manifest and the served-by rule (Task 5), the descriptor and the registry (Task 7), the command tweaks (Task 8), the live case (Task 9), the tests that switch to `jira` (Task 7), the ADR line (Task 5). "What PMK-34 gets" needs no code beyond `teams[].statuses`, `teams[].labels` with groups and `members[].teams`, which Task 4 builds.
- Departures from the spec. Integrations have their own tolerant request (`PmkitIntegrations`, 8 requests per refresh instead of 7), as the spec's "Non-admin keys" risk asked. A `trialEndsAt` in the past gives `free`, not `trial`. `trial` counts as a Business plan. The Linear manifest carries `warnings`, so the `capabilities` command can print them.
- Type consistency. `RawDiscovery`, `discoveryView(raw, pmkit, { session })`, `buildLinearCapabilities(raw, pmkit)`, `createLinearTracker(config, { env, now, fetch })` and `linearDescriptor({ fetch })` keep one signature across tasks.
- Open risk. The estimate scales depend on the docs check in Task 3. The sandbox has estimates off, so the live check cannot confirm them.
