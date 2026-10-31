# PMK-46 customers and requests for the Local tracker

Source: Local adapter, Entity mapping ("`customers/*.md` and `requests/*.md`, linked to issues") and Capabilities (`request_queue`: "`requests/` as an inbox, triaged into issues"); Unified model, `list_demand_signals`, `list_requests`.

## Goal

A team records the customers it serves and the requests that reach it. A request lands in an inbox, and someone accepts it into an issue or declines it. The accepted requests are the demand signals of their issues. `demand_signals` and `request_queue` become native on the Local tracker.

Two commands build on these CLI calls: PMK-68 (`prioritize-by-demand`) ranks issues by demand, and PMK-70 (`request-queue`) works the inbox. Their `--json` output is complete and stays stable. The customer and request records use the key names Linear's `linear customers` commands already return (`scripts/lib/linear/customers.mjs`), so a later Linear implementation of the same operations can return the same shape.

## Non-goals

- Editing, renaming or deleting a customer, and editing a request's text. None is in the acceptance criteria. They are follow-ups.
- Creating the issue inside the accept call. The command creates it with `issues create` and then accepts the request into it (see "Turning a request into an issue").
- Customers, requests or demand on Linear through the generic commands. The `linear customers` commands keep serving Linear customers, and the new commands answer `NOT_SUPPORTED` there.
- A computed list of requests on the issue record. The link lives on the request, and `demand list` reads it. Changing `getIssue` would touch the issue code, which PMK-52 changes in the same round.
- Ranking. `demand list` orders by request count so the busiest issues come first, and PMK-68 owns the ranking rule.

## Design

### IDs

A customer ID is `CUS-` and a code, a request ID is `REQ-` and a code. The code follows `id_style` in `.issues/config.yaml`, as goal IDs do: `CUS-7K3Q` and `REQ-7K3Q` with `random`, `CUS-1` and `REQ-1` with `numbered`. Both shapes stay valid when the style changes. Input is normalized like other IDs, so `req-1` names `REQ-1`.

The prefixes are fixed (builder's call, following the `GOAL` prefix of PMK-45). A customer or request ID only appears where one is expected, so an issue prefix of `CUS` or `REQ` makes no reference ambiguous.

Every read checks the normalized ID with `isId` before it builds a path, so `../config` or `CUS-1/../../x` never reaches the file system. The file stem is the ID, so the frontmatter holds no `id` key and an `id` key there is ignored.

### Customer file

`.issues/customers/<ID>.md` holds one customer.

```markdown
---
name: Acme Corp
status: active
tier: enterprise
revenue: 120000
size: 450
owner: fred
---

Notes in free text.
```

`name` is required and fits on one line. The other keys are optional: `status` and `tier` are one-line free text (the Local tracker has no list of statuses or tiers to check them against), `revenue` is a whole number of at least 0, `size` a number of at least 0, and `owner` a member ID from `.issues/config.yaml`. The body holds notes.

The customer record has the keys of Linear's `customerView`, plus `notes`:

```json
{ "id": "CUS-1", "name": "Acme Corp", "status": { "id": "active", "name": "active" }, "tier": { "id": "enterprise", "name": "enterprise" },
  "revenue": 120000, "size": 450, "owner": { "id": "fred", "name": "Fred Vanelli" }, "requests": 2, "url": null, "notes": "Notes in free text." }
```

`status` and `tier` are `{ id, name }` with the text as both, because Linear returns objects there. A missing key is `null`. `requests` counts the requests that name the customer, in any state. `url` is always `null` on Local.

### Request file

`.issues/requests/<ID>.md` holds one request.

```markdown
---
title: Export the board to CSV
customer: CUS-1
from: support
important: true
created: 2026-10-31T12:00:00.000Z
state: accepted
issue: ISS-4F2K
triaged: 2026-10-31T13:00:00Z
triaged_by: fred
---

The request as the customer wrote it.
```

`title` is required and fits on one line. The rest is optional, so a person can drop a request in the inbox by hand with a title alone:

- `customer`: the customer who asked, a customer ID. A request from inside the company, such as from support, has no customer.
- `from`: one line of free text naming where the request came from, such as `support` or `sales`.
- `important`: `true` or `false`. Linear's request priority is 0 or 1, with 1 meaning important.
- `created`: when the request was recorded, a timestamp. `requests create` writes it.
- `state`: `open`, `accepted` or `declined`. A missing `state` is `open`.
- `issue`: the issue the request is accepted into. It is required when `state` is `accepted` and not allowed otherwise.
- `reason`: one line, why the request was declined. Allowed only when `state` is `declined`.
- `triaged` and `triaged_by`: when and by whom the request was accepted or declined. `requests accept` and `requests decline` write them.

The body is the request text.

The request record has the keys of Linear's `requestView` (`id`, `body`, `priority`, `important`, `target`) plus the Local keys:

```json
{ "id": "REQ-1", "title": "Export the board to CSV", "body": "The request as the customer wrote it.", "priority": 1, "important": true,
  "customer": { "id": "CUS-1", "name": "Acme Corp" }, "from": "support", "state": "accepted",
  "target": { "type": "issue", "id": "ISS-4F2K", "title": "CSV export" },
  "created": "2026-10-31T12:00:00.000Z", "triaged": { "at": "2026-10-31T13:00:00Z", "by": "fred" }, "reason": null }
```

`target` is `null` until the request is accepted. Linear's target can also be a project. Local targets are issues only. When the issue or the customer cannot be read (no such file, a file that does not parse), the request is still returned: `target.title` or `customer.name` is `null`, and the result's `problems` names the request and the missing record. The read never guesses a title or a name.

### States and triage

```
open ──accept <issue>──▶ accepted
  └──decline [reason]──▶ declined
```

- `requests create` writes an `open` request, or an `accepted` one when it gets `--issue`. The second form is Linear's `customers link`: it records that a customer asked for an existing issue. Nobody triaged it, so `triaged` stays `null`.
- `requests accept <id> <issue>` sets `state: accepted`, `issue`, `triaged` and `triaged_by`, and removes `reason`.
- `requests decline <id> [--reason text]` sets `state: declined`, `triaged`, `triaged_by` and `reason` when given, and removes `issue`.

Either call works from any state, so a request accepted into the wrong issue moves to the right one, and a declined request can be accepted later. A call that changes nothing (the same issue, or declining a declined request with the same reason) writes nothing and returns `before` equal to `after`.

The rewrite edits the stored frontmatter map, as `epic goal` does, so keys pmkit does not know and the body stay as they are. The tracker parses the new text before writing it, so a write that would not read back is refused.

The accept refuses an issue that does not exist or does not parse. It reads the issue through `getIssue` and changes nothing in the issue folder. Requests keep no `events.jsonl`: the state change sits in the file, and git keeps the history.

#### Turning a request into an issue

`requests accept` links to an issue that exists. To turn a request into a new issue, the command runs `issues create` with the request's title and body, then `requests accept <id> <new issue>`. If the second call fails, the issue exists and the request is still `open`. The command reports both IDs and runs the accept again; nothing else needs undoing. This keeps every CLI call a single-record write (builder's call).

### Demand signals

A demand signal is an accepted request: someone asked for that issue. `demand list` groups the accepted requests by issue:

```json
{ "signals": [{ "issue": { "id": "ISS-4F2K", "title": "CSV export", "status": { "name": "todo", "category": "todo" }, "priority": "high" },
    "count": 2, "important": 1, "requests": ["REQ-1", "REQ-3"],
    "customers": [{ "id": "CUS-1", "name": "Acme Corp", "tier": { "id": "enterprise", "name": "enterprise" }, "revenue": 120000, "size": 450 }],
    "from": ["support"] }],
  "problems": [] }
```

`count` is the number of accepted requests on the issue, `important` how many of them are important, `customers` the distinct customers who asked (in the order of their first request), and `from` the distinct `from` values of the requests without a customer. A request from support counts as demand too. Signals are ordered by `count`, then `important`, then issue ID, most first (builder's call). The issue's status is included and no issue is filtered out, so PMK-68 decides what to do with done or canceled issues. An issue that cannot be read keeps its signal with `title`, `status` and `priority` set to `null`, and `problems` names it.

### Contract operations

Eight new operations in `TRACKER_OPERATIONS`, in a Customers and requests family:

- `listCustomers()` returns `{ customers, problems }`, highest revenue first, then by name, a missing revenue last (Linear's `sortCustomers` rule).
- `getCustomer(idOrName)` returns `{ customer, requests }`, the customer and its requests in creation order. The argument is an ID, or a name matched exactly and case-insensitively. Two customers with that name is `INVALID_INPUT` listing their IDs. No match is `NOT_FOUND`.
- `createCustomer(input, actor, { dryRun })` takes `name` and optional `status`, `tier`, `revenue`, `size`, `owner`, `notes`, and returns `{ before: null, after }`.
- `listRequests({ state, customer })` returns `{ requests, problems }` in creation order (`created`, then ID; a request without `created` goes last). `state` is `open` (the default), `accepted`, `declined` or `all`.
- `getRequest(id)` returns the request record.
- `createRequest(input, actor, { dryRun })` takes `title` and optional `body`, `customer`, `from`, `important`, `issue`, and returns `{ before: null, after }`.
- `acceptRequest(id, issue, actor, { dryRun })` and `declineRequest(id, reason, actor, { dryRun })` return `{ before, after }`.
- `listDemandSignals()` returns `{ signals, problems }`.

The accept and decline operations avoid the word "triage" in their names, because the contract keeps Linear's triage rotation out of it and a test checks that no operation name contains it.

A list skips a file that does not parse, has conflict markers, or whose stem is not an ID of its kind, and reports it in `problems` as `{ id, code, message }`. A get of such a file is `INVALID_INPUT` (or `CONFLICT`) with `/pmkit:local:doctor` as the next step. A missing ID is `NOT_FOUND`. A create refuses a customer or an issue that does not exist or does not parse, and an owner that is not a member.

### CLI

New groups `customers`, `requests` and `demand`:

| Command | Does |
|---|---|
| `customers list` | the customers with status, tier, revenue, size and request count; `--json` prints `{ available: true, customers, hasMore: false, problems }`, the keys of `linear customers list` |
| `customers show <id or name>` | one customer with its requests; `--json` prints `{ available: true, customer, requests }`, the keys of `linear customers show` |
| `customers create --name n [--status s] [--tier t] [--revenue n] [--size n] [--owner member]` | a write; creates `customers/<ID>.md` |
| `requests list [--state open\|accepted\|declined\|all] [--customer id]` | the inbox by default; `--json` prints `{ requests, problems }` |
| `requests get <id>` | one request |
| `requests create --title t [--customer id] [--from text] [--important] [--issue id] [--body-file f]` | a write; creates `requests/<ID>.md`, open, or accepted with `--issue` |
| `requests accept <id> <issue>` | a write; accepts a request into an issue |
| `requests decline <id> [--reason text]` | a write; declines a request |
| `demand list` | the demand signals by issue; `--json` prints `{ signals, problems }` |

Each file in `problems` also prints as a warning that points to `pmkit validate`, and the same text sits in the JSON. No `commands/` file changes: PMK-68 and PMK-70 add the commands that use these calls.

### Capability

- `SERVED_BY.demand_signals = ['customers list', 'customers show', 'customers create', 'requests create', 'demand list']`.
- `SERVED_BY.request_queue = ['requests list', 'requests get', 'requests create', 'requests accept', 'requests decline']`.

The Local manifest then reports both as native. ADR-0001 counts 19 served capabilities, 15 of them native, and `user_inbox` as the one absent.

`SERVED_BY` applies to Linear too, so without a change the Linear manifest would report `demand_signals` native when customers are on, and `request_queue` conditional on a Business plan, while every new call fails. The Linear entries become:

- `demand_signals` with customers on: `absent`, `detail: { workspace: 'native', unsupported: ['listCustomers', 'getCustomer', 'createCustomer', 'listDemandSignals'] }`, hint "The Linear adapter serves customer requests through linear customers only; Linear offers them on this workspace". With customers off it stays `absent` with its current hint.
- `request_queue` on a Business plan: `absent`, `detail: { workspace: 'conditional', unsupported: ['listRequests', 'getRequest', 'createRequest', 'acceptRequest', 'declineRequest'] }`, hint "The Linear adapter does not serve Asks yet; Linear offers them on this workspace". On other plans it stays `absent` with the plan hint.

The Linear stubs map each new operation to its capability, so the refusal carries the manifest's hint. The `linear customers` extension and its test that no contract operation reaches Linear customers stay: the Linear-only `customers` object remains outside the contract, and the PMK-42 test changes from "no operation names a customer" to "the contract view hides `tracker.customers`", because Local now has customers of its own.

### Tracker format

The tracker format stays 2 (builder's call, following ADR-0004: the format goes up only when files change shape). The change adds two optional folders and touches no existing file. A plugin from before this change ignores them. Milestones, releases, views and goals were added the same way. No migration is needed.

### Validate and doctor

`pmkit validate` checks `customers/*.md` and `requests/*.md`:

- A `customer` problem: a stem that is not a customer ID, a file that does not parse or has conflict markers, a missing or multi-line name, a multi-line status or tier, a bad revenue or size, an owner that is not a member.
- A `request` problem: a stem that is not a request ID, a file that does not parse, a missing or multi-line title, an unknown state, a non-boolean `important`, a bad `created` or `triaged` timestamp, an `accepted` request without `issue`, an `issue` or `reason` on a request in the wrong state.
- A `reference` problem: a request whose `customer` names no customer file, or whose `issue` names no issue.

`/pmkit:local:doctor` lists `customer` and `request` with the codes the user fixes by hand.

### Migration to Linear

`local-migrate export` lists `customers` and `requests` among the losses: the files stay in `.issues/customers/` and `.issues/requests/`, and pmkit creates no Linear customer or customer request.

### Docs

The README CLI table, a CHANGELOG line, Customer, Request and Demand signal entries in `CONTEXT.md`, the Customer and Request entities and the contract family in the design spec, and ADR-0001's counts.

## Decisions taken without the user

- The fixed `CUS` and `REQ` prefixes, with the code following `id_style`.
- No tracker format change and no migration.
- The customer fields mirror Linear's customer, with `status` and `tier` as free text.
- A request's state is `open`, `accepted` or `declined`, kept in the file with `issue`, `reason`, `triaged` and `triaged_by`. Accept and decline work from any state.
- Turning a request into a new issue takes two calls, `issues create` then `requests accept`.
- A request without a customer counts as demand, listed by its `from`.
- Linear reports both capabilities `absent`, with Linear's own answer in `detail.workspace` and the new operations in `detail.unsupported`.
