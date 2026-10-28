# PMK-42 Linear customers implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: use superpowers:subagent-driven-development or superpowers:executing-plans, as the user picks, to implement this plan task by task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add `linear customers list`, `show`, `set` and `link`, and the Markdown command `/pmkit:linear:customers`, so a user lists and edits customers and links customer requests to issues and projects after a preview. On a workspace without customers, the commands say the capability is absent and a write changes nothing.

**Architecture:** A new module `scripts/lib/linear/customers.mjs` holds the GraphQL documents, the pure helpers and `createCustomers({ client, discovery, config })`. The raw Linear tracker exposes it as `tracker.customers` next to `tracker.triage`. `ctx.linear(feature)` picks the feature. The contract operations and `contractView` do not change.

**Tech stack:** Node.js ESM, `node:test`, the PMK-30 client, the PMK-33 discovery, and `fakeLinearFetch` from `scripts/fake-linear-api.mjs`.

**Spec:** `docs/superpowers/specs/2026-10-28-pmk-42-linear-customers-design.md`. The four open questions are resolved: no create or delete, `link --request` moves a request, a duplicate request on the same target is `CONFLICT`, and `list` sorts by revenue.

## Global constraints

- `npm test` opens no socket. Every Linear test injects `fakeLinearFetch`. Every test that reaches the user store sets `PMKIT_HOME` through `userStoreEnv()`.
- `package.json` gains no dependency (ADR-0003).
- Every Local tracker output and every existing golden stays byte-identical.
- The key never appears in output, a cache file, an error or a command line. Tests use `FAKE_KEY`.
- No file, commit or comment holds the real workspace URL key or team key. Examples use `acme` and `ACME`. Docs say "the sandbox workspace". Task 12 runs the private-name check.
- No task sends a write to Linear. The mutations are tested against the fake only. A live check is read-only and runs behind `PMKIT_LIVE`.
- A read command and every `--dry-run` send no mutation. A counting fetch asserts it.
- A workspace with `customersEnabled` false gets no customer query and no mutation.
- The plan strings come from `BUSINESS_PLANS` in `manifest.mjs`. No second list.
- PMK-36, PMK-37 and PMK-38 edit `scripts/pmkit.mjs`, the fake, `cli-linear.test.mjs`, the scenario count and the goldens. Keep each edit to those files small and in one block, so a merge conflict stays easy.
- Every commit message carries `(PMK-42)` and ends with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Code, comments, docs and messages follow `~/.claude/skills/unslop/SKILL.md`.

## ADR-0002 checklist for new commands

| Requirement | Task |
|---|---|
| Entries in `COMMANDS` with `summary`, `usage` and `flags` (the `--help` text comes from them) | 5, 6, 7, 8 |
| Markdown command file `commands/linear/customers.md` | 10 |
| `skills/pmkit/SKILL.md` and `README.md` list it | 10 |
| Golden case per CLI command, and the help golden | 11 |
| Scenario for the Markdown command, which raises the scenario count | 12 |

## Acceptance criteria map

| Criterion | Tasks |
|---|---|
| 1. Lists and edits customers with tier, revenue, size and status | 2, 3, 4 (views, plan, fake), 5 (`list`), 6 (`show`), 7 (`set`), 10 (Markdown steps 3, 5, 6). The present path is proven against the fake. |
| 2. Links customer requests to issues and projects after confirmation | 3, 8 (`link`, create, move, `CONFLICT`, `--dry-run`), 10 (Markdown steps 4 to 6 preview and ask once; the test on the dry-run and write forms). |
| 3. On a plan without customers it says the capability is absent | 1, 5 to 8 (six Free runs with zero customer queries and zero mutations), 11 (goldens on Local), 13 (live read-only check on the sandbox workspace). |

## Files

| File | Task |
|---|---|
| `scripts/lib/linear/customers.mjs`, `scripts/lib/linear/customers.test.mjs` | 1, 2, 3, 5, 6, 7, 8 |
| `scripts/fake-linear-api.mjs`, `scripts/fake-linear-api.test.mjs` | 4 |
| `scripts/lib/linear/tracker.mjs` | 5 |
| `scripts/pmkit.mjs` | 5 (hook), 5 to 8 (entries) |
| `scripts/cli-linear.test.mjs` | 5 to 8 |
| `scripts/cli-hosted.test.mjs` | 9 |
| `commands/linear/customers.md`, `skills/pmkit/SKILL.md`, `README.md`, `scripts/plugin.test.mjs` | 10 |
| `scripts/golden-cases.mjs`, `scripts/__goldens__/` | 11 |
| `scripts/__scenarios__/linear-customers.mjs` and its snapshot | 12 |
| `scripts/lib/linear/API-VERIFICATION.md` | 13 |

## Task 1: Availability

**Files:** `scripts/lib/linear/customers.mjs`, `scripts/lib/linear/customers.test.mjs`

- [ ] Write the failing tests for `customersAvailability(raw)`: `customersEnabled` true returns `{ available: true }` whatever the plan; plan `free` with the flag false returns `{ available: false, reason: 'plan', plan: 'free', enableHint: 'Linear customers need the Business or Enterprise plan' }`; `basic`, `trial` with the flag false and an unknown plan string do the same (reason `plan`); `business` and `enterprise` with the flag false return `reason: 'customers_off'` and the hint "Turn on customers in the workspace settings in Linear".
- [ ] Run `node --test scripts/lib/linear/customers.test.mjs` and see the import fail.
- [ ] Create `customers.mjs` with `customersAvailability`, importing `BUSINESS_PLANS` from `manifest.mjs` (already exported by PMK-43).
- [ ] Run and see it pass. Commit `feat(linear): decide whether customers are available (PMK-42)`.

## Task 2: Customer and request views

**Files:** `scripts/lib/linear/customers.mjs`, `scripts/lib/linear/customers.test.mjs`

- [ ] Write the failing tests. `customerView(node)` gives `{ id, name, status, tier, revenue, size, owner, requests, url }` from a `Customer` node, with `tier: null`, `revenue: null` and `size: null` kept as null, and `requests` from `approximateNeedCount`. `requestView(node)` gives `id`, `body` cut to 200 characters, `priority` (0 or 1), `important` (priority 1) and a `target`: `{ type: 'issue', id: 'ACME-12', title }`, `{ type: 'project', id, name }`, or `null`; an archived issue gives `archived: true`.
- [ ] Add tests for `sortCustomers(list)`: highest revenue first, name as the tie break, missing revenue last. Add `customersText(list)` tests for the aligned line in the spec and for "no customers yet".
- [ ] Run and see the failures.
- [ ] Implement the four helpers as pure functions.
- [ ] Run and see it pass. Commit `feat(linear): shape the customer and request views (PMK-42)`.

## Task 3: Edit and link planning

**Files:** `scripts/lib/linear/customers.mjs`, `scripts/lib/linear/customers.test.mjs`

- [ ] Write the failing tests for `planCustomerEdit(current, flags, statuses, tiers, memberIds)`: each flag (`status`, `tier`, `revenue`, `size`, `owner`, `name`) gives a `customerUpdate` input with the resolved id; names match case-insensitively; `--tier none` gives `tierId: null`; `--owner none` gives `ownerId: null`; no field flag is `INVALID_INPUT`; an unknown status or tier is `INVALID_INPUT` with the valid names in `nextStep`; a decimal, negative or text revenue or size is `INVALID_INPUT`; an owner outside `memberIds` is `INVALID_INPUT`; values equal to the current ones return `{ changed: false }`.
- [ ] Write the failing tests for `planLink({ customer, requests, flags, target })`: both `--issue` and `--project` is `INVALID_INPUT`; neither without `--request` is `INVALID_INPUT`; a create on a target where the customer already has a request is `CONFLICT` and names that request; a create gives `kind: 'create'` with priority 1 for `--important`, else 0; `--request` for a request the customer owns gives `kind: 'move'` with `from`; a request of another customer is `INVALID_INPUT`; `--body` or `--important` with `--request` is `INVALID_INPUT`; a malformed issue key fails `isIssueId` from `ids.mjs` before any request.
- [ ] Run and see the failures.
- [ ] Implement `planCustomerEdit`, `planLink` and `resolveCustomer(list, idOrName)` (id first, then exact name case-insensitive; two equal names are `INVALID_INPUT` listing the ids; none is `NOT_FOUND`).
- [ ] Run and see it pass. Commit `feat(linear): plan customer edits and request links (PMK-42)`.

## Task 4: Fake Linear routes

**Files:** `scripts/fake-linear-api.mjs`, `scripts/fake-linear-api.test.mjs`

- [ ] Write the failing tests: `fakeCustomers({ customers, statuses, tiers, needs, issues, projects, disabledError })` returns routes for `PmkitCustomersList`, `PmkitCustomerShow`, `PmkitCustomerStatuses`, `PmkitCustomerTiers`, `PmkitCustomerIssue`, `PmkitCustomerProjects`, `PmkitCustomerUpdate`, `PmkitCustomerNeedCreate` and `PmkitCustomerNeedUpdate`; the mutation routes echo the object built from their variables; with `disabledError` the two customer queries answer the GraphQL error "Customer requests are not available in this workspace."; `fakeWorkspace({ customersEnabled, subscription })` already sets the flag and the plan, so the test builds a Free and a Business workspace and checks that `fetch.calls` records each operation by name.
- [ ] Run and see the failures.
- [ ] Add the routes and the helper in one block at the end of the file. Keep existing exports unchanged. The operation names are the ones Tasks 5 to 8 use.
- [ ] Run the fake's tests and `node --test scripts/cli-linear.test.mjs` to confirm nothing else moved. Commit `test(linear): add customer routes to the fake Linear API (PMK-42)`.

## Task 5: `ctx.linear(feature)` and `linear customers list`

This task has two commits. The first is the small hook change, so a merge with PMK-36 to PMK-38 touches PMK-43's call sites once.

**Files:** `scripts/pmkit.mjs`, `scripts/lib/linear/tracker.mjs`, `scripts/lib/linear/customers.mjs`, `scripts/cli-linear.test.mjs`, `scripts/lib/linear/customers.test.mjs`

- [ ] Write a failing test that `ctx.linear('triage')` still runs the three PMK-43 commands (the existing triage tests in `cli-linear.test.mjs` cover this once the call sites change) and that `ctx.linear('customers')` is `null` on a Local tracker.
- [ ] Change `ctx.linear` to `linear: async (feature) => { ... return tracker[feature] }` and the three triage entries to `ctx.linear('triage')`. Run `node --test scripts/cli-linear.test.mjs` and see it pass. Commit `refactor(cli): pick the linear feature in ctx.linear (PMK-42)`.
- [ ] Write the failing CLI tests over `fakeLinearFetch({ ...fakeWorkspace(...), ...fakeCustomers(...) })`:
  - Free workspace (the proof for this issue): `linear customers list --json` exits 0 with `available: false`, `reason: 'plan'`, `plan: 'free'` and the hint; the text form prints the four lines of the spec; `callsOf(fetch, 'PmkitCustomersList')` is 0 and no call is a mutation.
  - Business workspace with the flag off: `reason: 'customers_off'`, no customer query.
  - Stale cache: the flag says on, the fake answers with the "not available" error, and the result is `available: false` with `reason: 'stale'`, the `pmkit discover` hint, and no mutation.
  - Present path: output sorted by revenue; `--status` and `--tier` filter by name in the query; an unknown name is `INVALID_INPUT` listing the names; `--limit` defaults to 50, caps at 100 with a warning; `hasMore` true adds a warning; an empty list prints "no customers yet".
  - `linear customers list` on a Local repository exits 2 with `NOT_SUPPORTED`. A run without `LINEAR_API_KEY` is `AUTH` with an empty `fetch.calls`. The key is in no stdout, stderr or error field.
- [ ] Run and see the failures.
- [ ] In `customers.mjs`, add the `PmkitCustomersList`, `PmkitCustomerStatuses` and `PmkitCustomerTiers` documents and `createCustomers({ client, discovery, config })` with `list({ status, tier, limit })`. It reads the cached discovery, runs `customersAvailability`, and queries only when available. It maps the "not available" GraphQL error to the stale result.
- [ ] In `tracker.mjs`, add `customers: createCustomers(...)` to the returned object. In `pmkit.mjs`, add the `linear customers list` entry with `usage: '[--status NAME] [--tier NAME] [--limit n]'`, `linear: true`, `flags: ['status', 'tier', 'limit']`.
- [ ] Run `node --test scripts/cli-linear.test.mjs scripts/lib/linear/customers.test.mjs` and see it pass. Run `node --test scripts/cli.test.mjs`; update only what lists commands.
- [ ] Commit `feat(cli): add linear customers list (PMK-42)`.

## Task 6: `linear customers show`

**Files:** `scripts/lib/linear/customers.mjs`, `scripts/pmkit.mjs`, `scripts/cli-linear.test.mjs`

- [ ] Write the failing CLI tests: Free workspace exits 0 with `available: false` and sends no `PmkitCustomerShow` query; Business workspace shows one customer with requests newest first, one on an issue, one on a project and one on neither (`target: null`), and an archived issue with `archived: true`; `--customer` matches by id, then by exact name case-insensitive; two customers with one name are `INVALID_INPUT` listing the ids; an unknown customer is `NOT_FOUND`; `--customer` is required.
- [ ] Run and see the failures.
- [ ] Add the `PmkitCustomerShow` document and `show({ customer })` to `createCustomers`, using `resolveCustomer`, and the entry `usage: '--customer ID_OR_NAME'`, `flags: ['customer']`.
- [ ] Run and see it pass. Commit `feat(cli): add linear customers show (PMK-42)`.

## Task 7: `linear customers set`

**Files:** `scripts/lib/linear/customers.mjs`, `scripts/pmkit.mjs`, `scripts/cli-linear.test.mjs`

- [ ] Write the failing CLI tests:
  - Free workspace: `set --customer acme --tier gold` and the same with `--dry-run` exit 2 with `NOT_SUPPORTED`, the message "customers are unavailable on this workspace (plan free)" and the hint in `nextStep`; the fetch log has no customer query and no mutation.
  - Business workspace: one run per field (`status`, `tier`, `revenue`, `size`, `owner`, `name`) and `--tier none`; each sends exactly one `PmkitCustomerUpdate` with the ids Linear returned and returns `{ before, after }`, `after` taken from the payload, `commit` equal to the customer name.
  - Each `INVALID_INPUT` case from Task 3 through the CLI; a no-op prints "nothing to change" and sends no mutation.
  - `--dry-run` reads the customer, returns `{ before, after }`, ends with "dry run: nothing was written" and sends zero mutations.
  - The key appears in no mutation body, log line or error.
- [ ] Run and see the failures.
- [ ] Add the `PmkitCustomerUpdate` document and `set({ customer, flags, dryRun })`. Availability runs first and throws `NOT_SUPPORTED` before any request. Add the entry with `write: true`, `linear: true`, `dryRun: true`, `flags: ['customer', 'status', 'tier', 'revenue', 'size', 'owner', 'name']`.
- [ ] Run and see it pass. Commit `feat(cli): add linear customers set (PMK-42)`.

## Task 8: `linear customers link`

**Files:** `scripts/lib/linear/customers.mjs`, `scripts/pmkit.mjs`, `scripts/cli-linear.test.mjs`

- [ ] Write the failing CLI tests:
  - Free workspace: `link --customer acme --issue ACME-12` and the `--dry-run` form exit 2 with `NOT_SUPPORTED`; zero customer queries and zero mutations. With the Task 5 to 7 runs this makes the six Free runs the spec names.
  - Business workspace, create on an issue: the command reads `issue(id:)` for the id and title, sends one `PmkitCustomerNeedCreate` with priority 1 for `--important`, and returns `{ customer, target, request: { kind: 'create' } }` with the request id from the payload.
  - Create on a project: one exact case-insensitive match is the target; zero is `NOT_FOUND` with the hint to use the slug; several is `INVALID_INPUT` with the names; `hasMore` adds a warning.
  - Move with `--request`: sends one `PmkitCustomerNeedUpdate`, returns `kind: 'move'` with `from`.
  - Errors: a malformed key is `INVALID_INPUT` with no request sent; a missing issue is `NOT_FOUND`; both targets, no target, and `--body` or `--important` with `--request` are `INVALID_INPUT`; a request of another customer is `INVALID_INPUT`; a duplicate request on the target is `CONFLICT` with the request named and `--request` in `nextStep`, and no mutation.
  - `--dry-run` resolves with reads, returns the same shape, and sends zero mutations. Each real write sends exactly one. The key is in no body, log line or error.
- [ ] Run and see the failures.
- [ ] Add the `PmkitCustomerIssue`, `PmkitCustomerProjects`, `PmkitCustomerNeedCreate` and `PmkitCustomerNeedUpdate` documents and `link({ customer, issue, project, request, body, important, dryRun })`. Availability runs first. Add the entry with `write: true`, `linear: true`, `dryRun: true`, `booleans: ['important']`, `flags: ['customer', 'issue', 'project', 'request', 'body']`.
- [ ] Run and see it pass. Commit `feat(cli): add linear customers link (PMK-42)`.

## Task 9: Hosted mirror and Local checks

**Files:** `scripts/cli-hosted.test.mjs`

- [ ] Change the test on the `linear: true` list to include the four customer commands, so it asserts the three triage commands and `linear customers list`, `show`, `set`, `link`. `MIRRORED` already excludes `linear` commands. Another parallel issue may extend this list, so keep the edit to the one array.
- [ ] Add a test that `TRACKER_OPERATIONS` and the Local tracker output are unchanged.
- [ ] Run `node --test scripts/cli-hosted.test.mjs scripts/contract.test.mjs` and see it pass. Commit `test(cli): list the linear customers commands in the hosted check (PMK-42)`.

## Task 10: Markdown command, router and docs

**Files:** `commands/linear/customers.md`, `skills/pmkit/SKILL.md`, `README.md`, `scripts/plugin.test.mjs`

- [ ] In `plugin.test.mjs`, add `'customers'` to the `linear` list in `COMMANDS`, and a test that parses `customers.md` and asserts each `set` and `link` call has a `--dry-run` form in step 5 and a write form in step 6, like the triage check. Run and see it fail on the missing file.
- [ ] Write `commands/linear/customers.md` from "The Markdown command" in the spec: frontmatter with `disable-model-invocation: true` and `argument-hint: "[list|show|set|link]"`, the five sections the test checks, the six steps, the two confirmation points, the note that revenue has no currency in Linear's schema, and the stops for a missing key, a Local tracker and a Free workspace. Every operation is a `node "${CLAUDE_PLUGIN_ROOT}/scripts/pmkit.mjs" linear customers ...` call.
- [ ] List the command in `skills/pmkit/SKILL.md` with the natural-language triggers (customers, customer requests, who asks for this) and in `README.md`.
- [ ] Run `node --test scripts/plugin.test.mjs` and see it pass. Commit `docs: add /pmkit:linear:customers (PMK-42)`.

## Task 11: Goldens

**Files:** `scripts/golden-cases.mjs`, `scripts/__goldens__/`

- [ ] Add to `CASES` one block with `'linear customers list': () => [[]]`, `'linear customers show': () => [['--customer', 'acme']]`, `'linear customers set': () => [['--customer', 'acme', '--tier', 'gold']]` and `'linear customers link': () => [['--customer', 'acme', '--issue', 'ISS-1']]`.
- [ ] Run `node --test scripts/goldens.test.mjs` and see the new cases fail for missing goldens and the help golden fail for the new commands.
- [ ] Regenerate with `UPDATE_GOLDENS=1 node --test scripts/goldens.test.mjs`. Read the diff: only the new case files and the help listing change, each new case records the `NOT_SUPPORTED` refusal in text and JSON, and no existing golden changed apart from the help listing.
- [ ] Run `node --test scripts/goldens.test.mjs scripts/cli-hosted.test.mjs` and see it pass. Commit `test(cli): add goldens for the linear customers commands (PMK-42)`.

## Task 12: Scenario

**Files:** `scripts/__scenarios__/linear-customers.mjs` and its `.after.txt` snapshots

- [ ] Write the scenario like the PMK-43 one. Entry one runs on the `team` fixture (Local tracker): step 1 reads `capabilities`, the tracker is `local`, and the command stops. `skip` lists the Linear calls of steps 2 to 6 with the reason (the helper runs a child process and cannot inject the fake fetch). `notHit` lists the two confirmation points. `expect` asserts `saved.capabilities.tracker` is `local` and the tree is unchanged.
- [ ] Add a second entry with the config at `system: linear`, a workspace and no key, expecting step 1 to fail with `AUTH` through `expectError`.
- [ ] Run `UPDATE_GOLDENS=1 node --test scripts/scenarios.test.mjs`, read the new snapshots, then run without the variable and see it pass. If the scenario count is asserted in a test, change only that number, and keep it in one line for the merge with the parallel issues.
- [ ] Commit `test: add the linear-customers scenario (PMK-42)`.

## Task 13: Verification note

**Files:** `scripts/lib/linear/API-VERIFICATION.md`

- [ ] Add a section "Customers and customer requests" with the schema facts from the spec (types, queries, mutations, input fields), the live result (`customers(first: 1)` and `customerNeeds(first: 1)` fail on Free with "Customer requests are not available in this workspace.", `customerStatuses` answers with four statuses and `customerTiers` with an empty list), the Linear docs page for customers with the date it was read (read it first; the spec did not), and the answer: access `read/write`, Business plan or higher, with the mutations marked `schema` because none was sent.
- [ ] Add one line to "Paid-plan features on a Free workspace": customer reads fail on Free, but the statuses and tiers reads pass, so the flag decides.
- [ ] Run `node --test scripts/adr-linear-auth.test.mjs scripts/plugin.test.mjs`. Commit `docs: record the customers verification (PMK-42)`.

## Task 14: Verify

- [ ] Run `npm test` and read the end of the output. All tests pass and no test opens a socket.
- [ ] Run `/home/fred/projects/pmkit-worktrees/check-private-names.sh`. Only the three accepted hits in the PMK-30, PMK-33 and PMK-43 comment files may show. Fix any other hit.
- [ ] Live check, read-only, by hand and outside `npm test`: with the key loaded by the shell, run `PMKIT_LIVE=1 PMKIT_LIVE_WORKSPACE=$PMKIT_LIVE_WORKSPACE node scripts/pmkit.mjs linear customers list --json` against the sandbox workspace. Expect `available: false`, `reason: plan`. Record the answer in the PR. Never run `set` or `link` live, and never print or pass the key.
- [ ] Run `superpowers:verification-before-completion` before calling the work done.

## Review focus

- The Free path in Tasks 5 to 8: exit codes, no customer query, no mutation, six runs.
- `ctx.linear(feature)`: the PMK-43 commands and goldens do not change.
- The `link` rules: `CONFLICT` on a duplicate, `--request` moves only, nothing guessed from a name.
- The `set` plan: `--tier none`, whole numbers only, the no-op.
- The key and the private names in no file.
