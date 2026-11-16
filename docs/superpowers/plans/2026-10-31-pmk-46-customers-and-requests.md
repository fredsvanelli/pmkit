# PMK-46 customers and requests Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Customers and requests as files in the Local tracker, an inbox of requests accepted into issues or declined, and demand signals by issue, with `demand_signals` and `request_queue` native on Local.

**Architecture:** Two pure file modules (`customers.mjs`, `requests.mjs`) parse, validate, serialize and order the files. The Local tracker gets eight contract operations in one block after the goal operations, outside every issue function. The CLI adds the `customers`, `requests` and `demand` groups. The Linear manifest and stubs keep both capabilities `absent` there.

**Tech Stack:** Node.js ESM, `node:test`, no dependencies (ADR-0003).

**Spec:** `docs/superpowers/specs/2026-10-31-pmk-46-customers-and-requests-design.md`

## Global Constraints

- IDs are `CUS-` and `REQ-` and a code that follows `id_style`; `isId` runs on the normalized ID before any path is built.
- The tracker format stays 2. No migration.
- Record keys follow Linear's `customerView` and `requestView`: customer `{ id, name, status, tier, revenue, size, owner, requests, url, notes }`, request `{ id, title, body, priority, important, customer, from, state, target, created, triaged, reason }`.
- A file that does not parse never breaks a list: it is skipped, reported in `problems`, printed as a warning that points to `pmkit validate`, and `pmkit validate` reports it.
- Rewrites edit the stored frontmatter map, so unknown keys and the body stay.
- Text files are read with CRLF normalized (`parseFile` in `epics.mjs` does it).
- `tracker.mjs` changes stay in a new block after the goal operations and in the returned object; no issue function changes (PMK-52 edits them in the same round).
- Every commit message carries `(PMK-46)` and ends with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Never run the CLI inside `scripts/__fixtures__/`; tests copy fixtures with `makeRepo`.

## Review Focus

- A request whose issue or customer file is missing or broken: the list still returns it, with `title`/`name` `null` and a `problems` entry. Test in Task 2.
- An ID like `../config`, `REQ-1/../x` or `cus-1` in a get: `NOT_FOUND` for the first two, `CUS-1` for the last. Test in Task 2.
- Accepting a request whose file has an unknown key and a body: both survive. Test in Task 2.
- The same accept twice: the second writes nothing (file mtime and content unchanged). Test in Task 2.
- Two customers with the same name in `customers show <name>`: `INVALID_INPUT` listing both IDs. Test in Task 2.

---

### Task 1: File modules

**Files:**
- Create: `scripts/lib/local/customers.mjs`, `scripts/lib/local/requests.mjs`
- Test: `scripts/customers.test.mjs` (file-format part)

**Interfaces:**
- Produces, `customers.mjs`: `CUSTOMER_PREFIX = 'CUS'`; `mdStems(dir) -> Set<string>` (stems of `.md` files, empty for a missing folder); `parseCustomer(text, id) -> { id, name, status?, tier?, revenue?, size?, owner?, notes }` (throws `INVALID_INPUT` with `/pmkit:local:doctor`, `CONFLICT` for markers); `serializeCustomer(customer) -> string` with key order `name, status, tier, revenue, size, owner`; `sortCustomers(list)` (revenue desc, missing last, then name).
- Produces, `requests.mjs`: `REQUEST_PREFIX = 'REQ'`; `REQUEST_STATES = ['open', 'accepted', 'declined']`; `REQUEST_KEYS = ['title', 'customer', 'from', 'important', 'created', 'state', 'issue', 'reason', 'triaged', 'triaged_by']`; `parseRequest(text, id) -> { id, title, body, customer?, from?, important, created?, state, issue?, reason?, triaged?, triagedBy? }`; `serializeRequest(request) -> string`; `sortRequests(list)` (`created`, then ID, missing `created` last); `groupDemand(requests) -> [{ issue: id, count, important, requests, customers: [ids], from: [texts] }]` ordered by count, important, ID.

- [ ] **Step 1: Write failing tests** in `scripts/customers.test.mjs`: a customer file round-trips; `revenue: -1`, `revenue: 1.5`, a missing name, a two-line tier each throw `INVALID_INPUT`; conflict markers throw `CONFLICT`; CRLF text parses. A request file with only a title parses as `state: 'open', important: false`; `state: accepted` without `issue` throws; `issue` with `state: open` throws; `reason` with `state: accepted` throws; `important: yes` throws; `created: tomorrow` throws. `groupDemand` on three accepted requests (two on ISS-1, one important; one on ISS-2) gives ISS-1 first with `count: 2, important: 1`.
- [ ] **Step 2: Run** `node --test scripts/customers.test.mjs`, expect FAIL (module not found).
- [ ] **Step 3: Implement** both modules, reusing `parseFile` (epics.mjs), `validTimestamp` (sprints.mjs), `stringifyYaml`, `joinFrontmatter` and `compareIds`. Owner membership is not checked here (the tracker and validate check it against the config).
- [ ] **Step 4: Run** the test, expect PASS.
- [ ] **Step 5: Commit** `feat(customers): add the customer and request file formats (PMK-46)`.

### Task 2: Tracker operations

**Files:**
- Modify: `scripts/lib/contract.mjs`, `scripts/lib/local/tracker.mjs` (new block after `setEpicGoal`, and the returned object), `scripts/lib/linear/tracker.mjs` (`STUB_CAPABILITY`)
- Modify: `scripts/cli-hosted.test.mjs` (the PMK-42 test "the customers feature adds no contract operation" becomes "the contract view hides the Linear customers extension")
- Test: `scripts/customers.test.mjs` (tracker part)

**Interfaces:**
- Consumes: Task 1 exports.
- Produces (contract, in this order after the goal operations): `listCustomers()`, `getCustomer(idOrName)`, `createCustomer(input, actor, { dryRun })`, `listRequests({ state = 'open', customer } = {})`, `getRequest(id)`, `createRequest(input, actor, { dryRun })`, `acceptRequest(id, issue, actor, { dryRun })`, `declineRequest(id, reason, actor, { dryRun })`, `listDemandSignals()`. Return shapes as in the spec, "Contract operations" and "Demand signals".
- Linear: `STUB_CAPABILITY` maps `listCustomers`, `getCustomer`, `createCustomer`, `listDemandSignals` to `demand_signals` and `listRequests`, `getRequest`, `createRequest`, `acceptRequest`, `declineRequest` to `request_queue`.

- [ ] **Step 1: Write failing tests** on a `makeRepo('no-sprints')` copy: create a customer then a request with `--issue ISS-9B2X`, and `listDemandSignals().signals[0]` has `issue.id === 'ISS-9B2X'`, `count: 1`, `customers[0].name`. `createRequest` with an unknown customer and with an unknown issue is `INVALID_INPUT`. `acceptRequest` sets `state, issue, triaged, triagedBy`; a second identical call leaves the file bytes the same; a hand-written unknown key `source_ticket: 42` and the body survive. `declineRequest` removes `issue` and keeps `reason`. `listRequests()` returns only open ones; `{ state: 'all' }` returns every one. A broken request file (`---\ntitle: [\n---`) appears in `problems`, the others still list. A request pointing at a deleted issue lists with `target.title === null` and a problem. `getRequest('../config')` and `getRequest('REQ-1/../x')` are `NOT_FOUND`; `getCustomer('cus-1')` finds `CUS-1` (numbered style). Two customers named "Acme" make `getCustomer('acme')` `INVALID_INPUT` naming both IDs. `createCustomer` with `owner: 'nobody'` is `INVALID_INPUT`. A dry run writes no file.
- [ ] **Step 2: Run** `node --test scripts/customers.test.mjs scripts/contract.test.mjs`, expect FAIL.
- [ ] **Step 3: Implement** the block. IDs come from `nextNumberedId` or `newId` over `mdStems`, as `createGoal` does. `created` uses `createdStamp()`, `triaged` uses `stamp()`. Issue reads go through `getIssue`; a `NOT_FOUND` becomes `INVALID_INPUT` in writes and a problem in reads. Accept and decline rewrite with `parseFile` + `joinFrontmatter(data, body, { order: REQUEST_KEYS })` and `readBack`.
- [ ] **Step 4: Run** `npm test`, expect PASS except goldens and the capability tests changed in Task 3 if any fail.
- [ ] **Step 5: Commit** `feat(customers): add customer and request operations to the Local tracker (PMK-46)`.

### Task 3: CLI, capabilities and the Linear manifest

**Files:**
- Modify: `scripts/pmkit.mjs` (nine commands after `goal progress`), `scripts/lib/args.mjs` (`GROUPS` gains `customers`, `requests`, `demand`), `scripts/lib/format.mjs` (`customerRecord`, `requestRecord`), `scripts/lib/capabilities.mjs`, `scripts/lib/linear/manifest.mjs`
- Modify tests: `scripts/cli.test.mjs`, `scripts/capabilities.test.mjs`, `scripts/lib/linear/manifest.test.mjs`, `scripts/cli-degraded-coverage.test.mjs` (REFUSALS and COVERED), `scripts/cli-autocommit.test.mjs` (WRITES), `scripts/golden-cases.mjs` (CASES), fixture `scripts/__fixtures__/no-sprints/.issues/customers/CUS-3T7W.md` and `requests/REQ-5H2M.md` (accepted into ISS-9B2X), `requests/REQ-6J8P.md` (open), regenerated `scripts/__goldens__/`

**Interfaces:**
- Consumes: Task 2 operations.
- Produces: commands `customers list`, `customers show`, `customers create`, `requests list`, `requests get`, `requests create`, `requests accept`, `requests decline`, `demand list`, with the flags and JSON of the spec's CLI table; `SERVED_BY` values from the spec's Capability section.

- [ ] **Step 1: Write failing tests**: `cli.test.mjs` runs each command with `--json` on a no-sprints copy and checks `customers list` keys `available, customers, hasMore, problems`, `customers show CUS-3T7W` keys `available, customer, requests`, `requests list` returns only `REQ-6J8P`, `requests accept REQ-6J8P ISS-6R3N --dry-run` changes nothing on disk, `demand list` first signal is ISS-9B2X, and a broken request file prints a `warning:` with `pmkit validate` and the same text in the JSON. `capabilities.test.mjs`: Local paths `demand_signals: native`, `request_queue: native`, and only `user_inbox` absent. `manifest.test.mjs`: the Business workspace gives `demand_signals` absent with `detail: { workspace: 'native', unsupported: ['listCustomers', 'getCustomer', 'createCustomer', 'listDemandSignals'] }` and hint "The Linear adapter serves customer requests through linear customers only; Linear offers them on this workspace", and `request_queue` absent with `detail: { workspace: 'conditional', unsupported: ['listRequests', 'getRequest', 'createRequest', 'acceptRequest', 'declineRequest'] }` and hint "The Linear adapter does not serve Asks yet; Linear offers them on this workspace". REFUSALS lists every new command on Linear.
- [ ] **Step 2: Run** those test files, expect FAIL.
- [ ] **Step 3: Implement** the commands, the records, `SERVED_BY` and the two `workspaceAnswers` entries.
- [ ] **Step 4: Regenerate goldens** with `UPDATE_GOLDENS=1 node --test scripts/goldens.test.mjs`, read `git diff --stat scripts/__goldens__`, then run `npm test`, expect PASS.
- [ ] **Step 5: Commit** `feat(customers): add the customers, requests and demand commands and serve demand_signals and request_queue (PMK-46)`.

### Task 4: Validate, doctor, migration and docs

**Files:**
- Modify: `scripts/lib/validate.mjs`, `commands/local/doctor.md`, `scripts/lib/local/migrate-reader.mjs`, `scripts/lib/linear/migrate-fields.mjs`, `README.md`, `CHANGELOG.md`, `CONTEXT.md`, `docs/superpowers/specs/2026-10-23-pmkit-design.md`, `docs/adr/0001-local-tracker-is-the-reference-implementation.md`
- Test: `scripts/validate-customers.test.mjs`, `scripts/lib/local/migrate-reader.test.mjs`, `scripts/lib/linear/migrate-fields.test.mjs`

**Interfaces:**
- Consumes: Task 1 parsers.
- Produces: problem kinds `customer`, `request` and `reference`; snapshot counts `customers` and `requests`; losses `customers` ("N customers stay in .issues/customers/; pmkit creates no Linear customers") and `requests` ("N requests stay in .issues/requests/; pmkit creates no Linear customer requests").

- [ ] **Step 1: Write failing tests**: a bad customer stem, a bad revenue, an owner not in members give `customer` problems; a broken request and `state: accepted` without issue give `request` problems; a request naming `CUS-9999` or `ISS-ZZZZ` gives `reference` problems; the clean no-sprints fixture gives none. The export snapshot counts 1 customer and 2 requests, and the losses list both.
- [ ] **Step 2: Run** them, expect FAIL.
- [ ] **Step 3: Implement**, add `customer` and `request` to the doctor's hand-fix list, and update the docs: README CLI rows, a CHANGELOG line at the top of `## Unreleased`, Customer, Request and Demand signal glossary entries, the entities and contract family in the design spec, ADR-0001 counts (19 served, 15 native, `user_inbox` the one absent).
- [ ] **Step 4: Run** `npm test`, expect PASS.
- [ ] **Step 5: Commit** `feat(customers): validate customers and requests, count them in the export and document them (PMK-46)`.
