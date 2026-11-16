# PMK-221 Customers and Requests Improvements Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Edit customers and request text, turn a request into an issue in one call, and serve the customer operations of the contract on Linear with the Local shapes.

**Architecture:** Two new contract operations (`updateCustomer`, `updateRequest`) on the Local tracker, a CLI-level composition for `requests accept --create`, and a `contract` block in `createCustomers` (Linear) wired into the Linear tracker in place of the stubs. The manifest turns `demand_signals` native on Linear when customers are on.

**Tech Stack:** Node.js ESM, `node:test`, the fake Linear API in `scripts/fake-linear-api.mjs`.

**Spec:** `docs/superpowers/specs/2026-11-10-pmk-221-customers-and-requests-improvements-design.md`

## Global Constraints

- Every commit message carries `(PMK-221)` and ends with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Text from data goes by file (`--title-file`, `--body-file`), never on the shell line.
- A read that may be incomplete (`hasMore`, page cap) is reported as `INCOMPLETE` in `problems`, never as a full answer.
- `npm test` exits 0, run in the foreground.
- Normalize CRLF when reading text files.

## Review Focus

- A customer file with a `#` comment and an unknown key keeps both after `customers update` (test in Task 1).
- `requests update` on a request with a body and no change writes nothing (test in Task 2).
- `requests accept --create` whose accept fails after the create names both IDs and leaves the issue (test in Task 3).
- `listDemandSignals` on Linear with more requests than the cap reports `about: 'request'` `INCOMPLETE` (test in Task 5).
- `customers show` with both a positional and `--customer` is `INVALID_INPUT` (test in Task 4).

---

### Task 1: Local `updateCustomer` and `customers update`

**Files:**
- Modify: `scripts/lib/contract.mjs` (add `updateCustomer`, `updateRequest` to `TRACKER_OPERATIONS`)
- Modify: `scripts/lib/local/tracker.mjs` (customers section)
- Modify: `scripts/pmkit.mjs` (new `customers update`; `customers list` takes `hasMore` from the tracker)
- Modify: `scripts/lib/capabilities.mjs` (`SERVED_BY.demand_signals` + `customers update`, `request_queue` + `requests update`)
- Modify: `scripts/lib/linear/tracker.mjs` (`STUB_CAPABILITY`: `updateCustomer` → `demand_signals`, `updateRequest` → `request_queue`)
- Test: `scripts/customers.test.mjs`, `scripts/cli-degraded-coverage.test.mjs` (COVERED/REFUSALS), contract lists

**Interfaces:**
- Produces: `tracker.updateCustomer(ref: string, changes: { name?, status?, tier?, revenue?, size?, owner? }, actor, { dryRun }) → { before, after }` (customer views); `listCustomers()` returns `{ customers, problems, hasMore: false }`.

- [ ] **Step 1: Failing tests** in `scripts/customers.test.mjs`:
  - `updateCustomer edits each field, clears status, tier and owner with none, and keeps comments and unknown keys`: a file `---\nname: Acme # the name\nplan: gold\nstatus: active\ntier: t1\nowner: fred\n---\n\nNotes.\n`; `updateCustomer('Acme', { tier: 'enterprise', revenue: 5, size: 1.5, status: 'none', owner: 'none' }, 'fred')` → `after.tier.name === 'enterprise'`, `after.status === null`, `after.owner === null`, the file still holds `# the name`, `plan: gold` and `Notes.`.
  - `updateCustomer with no change writes nothing; dry run writes nothing; bad values are INVALID_INPUT`: same value → `hashTree` unchanged and `before` deep-equals `after`; `{}` → `INVALID_INPUT`; `revenue: -1`, `size: 'big'`, `owner: 'nobody'`, `name: ''` → `INVALID_INPUT`; unknown customer → `NOT_FOUND`.
- [ ] **Step 2: Run** `node --test scripts/customers.test.mjs` → FAIL (`updateCustomer is not a function`).
- [ ] **Step 3: Implement** `updateCustomer` in the Local tracker: resolve with the `getCustomer` lookup (extract a `findCustomer(ref)` helper both use), validate as `createCustomer` does (share the field checks), edit the frontmatter with `setScalar`/`removeKey` from `yaml-edit.mjs` after CRLF normalization, read back with `parseCustomer` before writing. Add the CLI command `customers update` (`args: ['customer']`, flags `name status tier revenue size owner`, number parsing as `customers create`), returning `{ data: result, text: writeText(result, { ...ctx, record: customerRecord }), commit: result.after.id }`. Update the contract lists and the coverage tables the suite names.
- [ ] **Step 4: Run** `node --test scripts/customers.test.mjs scripts/cli-degraded-coverage.test.mjs scripts/contract*.test.mjs` → PASS.
- [ ] **Step 5: Commit** `feat(customers): add customers update (PMK-221)`.

### Task 2: Local `updateRequest` and `requests update`

**Files:** `scripts/lib/local/tracker.mjs`, `scripts/pmkit.mjs`, `scripts/customers.test.mjs`

**Interfaces:**
- Produces: `tracker.updateRequest(id, changes: { title?, body? }, actor, { dryRun }) → { before, after, problems }`.

- [ ] **Step 1: Failing tests**: `updateRequest edits the title and the body, keeps triaged and unknown keys` (a request with `triaged`, `triaged_by`, `extra: 1` and body; after the update the file keeps those lines and `triaged` is unchanged); `updateRequest clears the body with an empty body, and the same text writes nothing`; `updateRequest refuses no change keys, an empty title and a title with a line break` (`INVALID_INPUT`).
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement** with the same frontmatter line edit as `triage`, without stamping `triaged`; the body after the frontmatter is `\n${body}\n` or nothing. CLI `requests update <id> [--title t | --title-file f] [--body-file f]`; `--title` with `--title-file` is a usage error; read files with `readInput`.
- [ ] **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** `feat(requests): add requests update (PMK-221)`.

### Task 3: `requests accept <id> --create`

**Files:** `scripts/pmkit.mjs`, `scripts/customers.test.mjs` (CLI cases via `run` from test helpers, or `scripts/cli.test.mjs` where CLI customer cases live)

**Interfaces:**
- Consumes: `tracker.getRequest`, `tracker.createIssue({ title, description }, actor, { dryRun })`, `tracker.acceptRequest`.
- Produces: JSON `{ issue: { before: null, after }, request: { before, after }, problems }`.

- [ ] **Step 1: Failing tests** (CLI): `requests accept --create creates the issue with Asked by and Request lines and accepts the request`; `requests accept --create --dry-run writes nothing and projects the request`; `requests accept --create refuses an accepted request with CONFLICT and writes nothing`; `requests accept refuses both an issue and --create, and neither` (`INVALID_INPUT`); `an accept that fails after the create names both ids` (make the request file unparseable after the read is not possible from the CLI, so test the composition function `acceptIntoNewIssue(tracker, id, actor, options)` directly with a tracker whose `acceptRequest` throws: the error message contains the new issue id and `still open`, `nextStep` is `pmkit requests accept REQ-1 <new id>`).
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement** `acceptIntoNewIssue` in `scripts/pmkit.mjs` (exported for the test) and switch `requests accept` to `args: ['id', 'issue?']`-style handling with flag `create` (check how optional args are declared in `COMMANDS`; use `ctx.args[1]`). Description: body, blank line, `Asked by: <customer name | from | customer id>` (left out when none), `Request: <id>`. Dry run adds the note `the issue ID is assigned when written`. `commit` names both ids.
- [ ] **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** `feat(requests): accept a request into a new issue with --create (PMK-221)`.

### Task 4: `customers show --customer`

**Files:** `scripts/pmkit.mjs`, `scripts/cli.test.mjs` or `scripts/customers.test.mjs`

- [ ] **Step 1: Failing tests**: `customers show takes --customer as well as the positional`, same JSON for both; both at once → `INVALID_INPUT`; neither → `INVALID_INPUT`.
- [ ] **Step 2–4:** make the positional optional, add flag `customer`; run → PASS.
- [ ] **Step 5: Commit** `feat(customers): customers show takes --customer (PMK-221)`.

### Task 5: Linear contract operations and manifest

**Files:**
- Modify: `scripts/lib/linear/customers.mjs` (`customerView` adds `notes: null`; new `genericRequestView(node, customer)`; `contract` object returned next to `list/show/set/link`; queries `CREATE_MUTATION`, `NEEDS_QUERY`)
- Modify: `scripts/lib/linear/tracker.mjs` (wire `listCustomers getCustomer createCustomer updateCustomer createRequest listDemandSignals` through `guarded` + a customers-on check that refuses like the stub)
- Modify: `scripts/lib/linear/manifest.mjs` (`demand_signals` native with customers on; `request_queue.unsupported`)
- Modify: `scripts/fake-linear-api.mjs` (`PmkitCustomerCreate`, `PmkitCustomerNeeds`)
- Modify: `scripts/lib/linear/API-VERIFICATION.md` (`customerCreate`, `customerNeeds` used, schema only)
- Test: `scripts/lib/linear/customers.test.mjs`, `scripts/cli-linear.test.mjs`, `scripts/lib/linear/manifest.test.mjs`

**Interfaces:**
- Produces: `createCustomers(...).contract = { listCustomers, getCustomer, createCustomer, updateCustomer, createRequest, listDemandSignals }`, with the Local signatures; views with the Local keys.

- [ ] **Step 1: Failing tests**:
  - unit: `genericRequestView splits the title from the body and derives the state` (`'Export\n\nPlease'` → title `Export`, body `Please`, state `accepted` with an issue target, `open` without, `from`/`triaged`/`reason` null; empty body → title null).
  - CLI with the fake: `customers list on Linear returns the Local keys` (key set equals the Local view keys); `customers show on Linear lists the requests with the Local keys and an INCOMPLETE problem past 50`; `customers create on Linear sends customerCreate with resolved ids; --dry-run sends nothing`; `customers update on Linear sends customerUpdate`; `requests create on Linear needs --customer and --issue and refuses --from`; `requests create on Linear writes the title as the first body line`; `demand list on Linear groups the requests on issues, skips projects, maps status and priority`; `demand list on Linear past the cap has an about request INCOMPLETE problem`; `the generic customer commands on a workspace with customers off are NOT_SUPPORTED with the hint`; `requests list on Linear stays NOT_SUPPORTED`.
  - manifest: Business with customers on → `demand_signals` `{ path: 'native', detail: { workspace: 'native' } }`; `request_queue.detail.unsupported` = `['listRequests', 'getRequest', 'acceptRequest', 'declineRequest', 'updateRequest']`.
- [ ] **Step 2: Run** `node --test scripts/lib/linear/customers.test.mjs scripts/cli-linear.test.mjs scripts/lib/linear/manifest.test.mjs` → FAIL.
- [ ] **Step 3: Implement.** `NEEDS_QUERY` = `customerNeeds(first, after)` with `id body priority createdAt customer { id name tier { id name } revenue size } issue { id identifier title priority archivedAt state { id name type } team { id } } project { id }`; paginate pageSize 100, limit 1000. Group via `groupDemand` from `scripts/lib/local/requests.mjs` (map each need to `{ id, state, issue: identifier, customer: id, important, created }`), status `{ name, category: stateCategory(state, makeContext(raw, config.pmkit, null)) }`, priority `priorityOf`. `createCustomer` resolves status/tier by name (`pickByName`) and owner by member id; `refuseWrite` when customers are off. `linear customers set` calls the shared update planner.
- [ ] **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** `feat(linear): serve customers and demand through the generic commands (PMK-221)`.

### Task 6: Command files, docs, full suite

**Files:** `commands/backlog/prioritize-by-demand.md` (step 1 and "If something is missing"), `scripts/__scenarios__/backlog-prioritize-by-demand.mjs` (comment for the Linear entry), `commands/linear/customers.md` (one line), `README.md` (CLI table), `CHANGELOG.md` (Unreleased line), `docs/superpowers/specs/2026-10-31-pmk-46-customers-and-requests-design.md` untouched.

- [ ] **Step 1:** edit the files.
- [ ] **Step 2: Run** `npm test` in the foreground → exit code 0.
- [ ] **Step 3: Commit** `docs: describe customers and requests improvements (PMK-221)`.
