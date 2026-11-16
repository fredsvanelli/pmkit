# PMK-221: improve customers and requests

Source: PMK-221, the PMK-46 items of `docs/superpowers/epc-6-follow-ups.md` (and the PMK-70 item merged into it). Builds on `2026-10-31-pmk-46-customers-and-requests-design.md` and `2026-10-28-pmk-42-linear-customers-design.md`.

The worker ran without a human in the loop (Orca dispatch). Every choice below that the issue does not state is marked **(builder's call)**.

## Intent

PMK-46 gave Local customers and requests that can be created and triaged but not edited, a two-call flow to turn a request into an issue, and generic commands that answer `NOT_SUPPORTED` on Linear while `linear customers` reads the same Linear data. PMK-221 closes those gaps so `customers show X` and `demand list` mean the same thing on both trackers, and PMK-68 (`prioritize-by-demand`) uses customer requests on Linear too.

## Goals

1. `customers update` edits a customer (name, status, tier, revenue, size, owner) on both trackers. `requests update` edits the text (title and body) of a Local request.
2. `requests accept <id> --create` creates the issue from the request and accepts the request into it, in one CLI call.
3. The Linear adapter serves the customer operations of the contract (`listCustomers`, `getCustomer`, `createCustomer`, `updateCustomer`, `createRequest`, `listDemandSignals`) on top of `scripts/lib/linear/customers.mjs`, returning the Local record shapes. `demand_signals` becomes native on Linear when customers are on.
4. `customers show` takes the customer as a positional or as `--customer` (the `linear customers show` spelling), on both trackers, with one JSON shape.

## Non-goals

- The Linear request queue. Linear's inbox is Asks; a Linear customer request has no open, accepted or declined state of its own. `listRequests`, `getRequest`, `acceptRequest`, `declineRequest` and `updateRequest` stay `NOT_SUPPORTED` on Linear, and `request_queue` stays `absent` there **(builder's call)**. So `/pmkit:backlog:request-queue` keeps stopping at step 1 on Linear, the same shape it has now.
- Migrating Local customers and requests to Linear: still a loss in `local-migrate export`.
- Changing the flow of `/pmkit:backlog:request-queue`. It keeps its create-then-accept pair, which its scenario pins; `--create` is available to it and to people **(builder's call)**.

## Contract

Two new operations in the Customers and requests family of `TRACKER_OPERATIONS`:

- `updateCustomer(idOrName, changes, actor, { dryRun })` returns `{ before, after }` (customer views). `changes` has any of `name`, `status`, `tier`, `revenue`, `size`, `owner`. No key is `INVALID_INPUT`. A change that leaves every value as it was writes nothing and returns `before` equal to `after`.
- `updateRequest(id, changes, actor, { dryRun })` returns `{ before, after, problems }` (request views). `changes` has `title` and/or `body`. Same no-op rule.

`listCustomers()` also returns `hasMore` (always `false` on Local), so `customers list` stops hard-coding it.

## CLI

| Command | Does |
|---|---|
| `customers update <id or name> [--name n] [--status s\|none] [--tier t\|none] [--revenue n] [--size n] [--owner member\|none]` | edits a customer; `--dry-run` previews. `none` clears the value; on Linear `--status none` is refused, since every Linear customer has a status (Linear's rule, from `planCustomerEdit`). |
| `requests update <id> [--title t \| --title-file f] [--body-file f]` | edits the title or body of a request (Local only). |
| `requests accept <id> --create` | creates an issue from the request and accepts the request into it. |
| `customers show [<id or name>] [--customer <id or name>]` | the positional or the flag; both at once is `INVALID_INPUT`. |

The customer flags parse as `customers create` does: digits become numbers and anything else reaches the tracker as text, which refuses it.

### Local `customers update`

The customer file's frontmatter is edited line by line with `yaml-edit.mjs` (`setScalar`, `removeKey`), as `triage` does for requests, so `#` comments, unknown keys, the key order and the notes stay. The validation is `createCustomer`'s: name and the free-text fields are one non-empty line, revenue a whole number of at least 0, size a number of at least 0, owner a member id. `none` (any case) removes `status`, `tier` or `owner` **(builder's call: the Linear `set` convention)**. A file that does not parse is refused with its own error, as `readRecord` does. The customer is found by id or by exact name, the rule of `getCustomer`, including the "lookup is incomplete" refusal.

### Local `requests update`

Title and body are edited, nothing else **(builder's call: the issue says "the text")**. The title is one non-empty line (`NORMALIZE.title`), the body plain text; an empty `--body-file` clears the body. The title is a frontmatter line edit; the body is replaced after the frontmatter. `triaged` does not change: editing the text is not triage. The result carries the `problems` of the links that cannot be read, like `requests accept`.

### `requests accept <id> --create`

`<issue>` and `--create` exclude each other; one of them is required.

1. Read the request (`getRequest`). An `accepted` request is refused with `CONFLICT` naming its issue and the next step `pmkit requests accept <id> <issue>` to move it **(builder's call: a second issue for an accepted request is almost always a mistake)**. Open and declined requests go on, since accept works from any state.
2. Create the issue (`createIssue`) with the request title and a description of the request body, a blank line, `Asked by: <name>` (the customer name when known, otherwise `from`, otherwise the customer id; the line is left out when the request has none of them) and `Request: <REQ id>`. This is the description `/pmkit:backlog:request-queue` step 4 writes.
3. Accept the request into the new issue (`acceptRequest`).

The result is `{ issue: { before: null, after }, request: { before, after }, problems }`.

The dry run runs the create as a dry run and projects the request: `state: accepted`, `target` the previewed issue, `reason: null`. A note says the issue ID is assigned when written, since with `id_style: random` the real one differs.

When step 3 fails after step 2 wrote the issue, the call fails with the code of the accept error and the message `issue <new id> was created, but request <id> was not accepted: <message>; the request is still <state>`, next step `pmkit requests accept <id> <new id>`. Nothing is undone. With `auto_commit`, the issue is committed before the error is raised **(builder's call: the write that happened is kept and named, the lesson for batch writes)**.

On Linear `--create` fails before any write, because `acceptRequest` is not supported there.

## Linear

All on top of `createCustomers` (`scripts/lib/linear/customers.mjs`), which gains `contract` operations. Each needs `customersEnabled`; with customers off the stubs keep refusing with the manifest's hint.

### Customer view

The Linear customer view gains `notes: null` (Linear has no notes field), so its keys equal the Local view.

### Request view on Linear

A Linear `CustomerNeed` has a body and no title. The generic request view on Linear is:

- `title`: the first line of the body, trimmed, or `null` for an empty body; `body`: the rest of the body, trimmed **(builder's call: `createRequest` writes the title as the first line, so the round trip holds and nothing is invented)**.
- `customer` `{ id, name }`, `important` and `priority` as Linear has them, `target` as `linear customers show` returns it (an issue or a project).
- `state`: `accepted` when the request has a target, `open` without one; `from`, `triaged` and `reason` are `null`; `created` is `createdAt`.

### Operations

- `listCustomers()`: up to 250 customers (the `lookup` cap), `hasMore` from the read and a problem `INCOMPLETE` when cut.
- `getCustomer(idOrName)`: the `resolveCustomer` rule, then `SHOW_QUERY`; the requests newest first. More than 50 requests is a problem `INCOMPLETE` naming the customer.
- `createCustomer(input)`: `customerCreate` with `name`, and `statusId`, `tierId`, `ownerId` resolved by name or member id as `set` does, `revenue`, `size`. `notes` is refused (`INVALID_INPUT`, no Linear field). The dry run returns the projected view with `id: null`.
- `updateCustomer(idOrName, changes)`: `planCustomerEdit` and `customerUpdate`, the logic of `linear customers set`, which now calls the same function.
- `createRequest(input)`: needs `customer` and `issue` (`INVALID_INPUT` otherwise: on Linear a request belongs to a customer, and an open request with no issue is an Ask, which pmkit does not serve); `from` is refused (no Linear field). It runs `planLink` (so a second request of the customer on the issue is `CONFLICT`) and `customerNeedCreate` with `body` = the title, plus a blank line and the body when there is one.
- `listDemandSignals()`: reads `customerNeeds` (the workspace's customer requests) page by page up to 1000, keeps the needs on an issue (a need on a project or on nothing is not demand for an issue), groups them with `groupDemand`, and maps the issue status with `stateCategory` and the priority with `priorityOf`. A cut read adds a problem `{ id: null, about: 'request', code: 'INCOMPLETE' }`, which makes PMK-68's ranking incomplete, as its step 3 already says for an `about: "request"` problem.

### Manifest

With customers on, `demand_signals` is `native`, `detail: { workspace: 'native' }`. With customers off it stays absent with its hint. `request_queue` keeps its answer, with `unsupported` now `listRequests`, `getRequest`, `acceptRequest`, `declineRequest`, `updateRequest` (`createRequest` is served). `SERVED_BY` adds `customers update` to `demand_signals` and `requests update` to `request_queue`.

ADR-0001 counts only the Local capabilities; Local still serves all of them, so its numbers stay.

## Commands and docs

- `prioritize-by-demand` step 1 no longer says Linear means comments and mentions: Linear with customers on is native.
- `request-queue` stays as it is.
- `linear customers`: one line saying the generic `customers` and `demand` commands read the same data.
- README CLI table: the new commands and flags. CHANGELOG line under Unreleased.

## Tests

- Local: `customers update` (each field, `none`, no-op, a name lookup, a bad value, a file that keeps a comment and an unknown key), `requests update` (title, body, clear body, no-op, keeps `triaged` and unknown keys), `requests accept --create` (the issue and the request, dry run writes nothing, an accepted request is refused, an accept failure after the create names both IDs).
- Linear with the fake API: each new operation, the view shapes equal the Local keys, the cut reads, the refusals, and `linear customers set` unchanged.
- Manifest: `demand_signals` native with customers on, and the new `unsupported` of `request_queue`.
- The contract suite lists the two new operations.
