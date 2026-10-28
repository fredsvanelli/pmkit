# PMK-42 design: add the linear-customers command

Issue PMK-42, epic EPC-5 (Linear tracker adapter), milestone `linear`. Status: approved. The user accepted every recommendation in "Open questions" (all four answers are A). Decisions come from an autonomous brainstorming run on 2026-10-28 with no user dialogue, from the issue, ADR-0002, ADR-0005, the PMK-33 and PMK-43 specs, the code, and read-only schema calls to the sandbox workspace. Calls marked (builder's call) were made while writing this spec and change no acceptance criterion.

## Problem

The Unified model lists `linear-customers` as a Linear (Business) skill: "Manages customers (tier, revenue, size, status) and links customer requests to issues and projects". The Linear tab, domain 11, marks two rows as read and write: "Customers (tier, revenue, size, status)" for impact-based prioritization, and "Customer requests linked to issues and projects" for "Who is asking for what". No command reads or edits a customer, and no code creates a link between a request and an issue.

Three facts shape the work.

- An admin turns customers on in any plan, and the sandbox workspace has the flag off (`customersEnabled` false). The command cannot be proven end to end here. The proof of this issue is the path where the capability is absent, plus tests of the present path against a fake.
- Unlike triage responsibility, customer queries fail on Free (see the facts below). A live read cannot be the availability test, and the command must not send one.
- A command reaches the tracker through `ctx.tracker()`, which holds the contract operations only. Customers exist in Linear and in no other tracker. In the Unified model, other systems have a demand signal, not an entity.

Sources:

- Unified model, "System-specific skills", row `linear-customers`.
- Linear tab, domain 11 "Customer Requests and Asks (Business)", and the convention "(Business): feature restricted to the Business plan or higher; skills must degrade on Free and Basic plans".
- ADR-0002 (commands are the source for every agent) and ADR-0005 (the key comes from `LINEAR_API_KEY`).
- The PMK-43 spec, whose pattern this design follows (`linear: true`, `ctx.linear()`, own availability result).
- The PMK-33 spec and `scripts/lib/linear/manifest.mjs`, where `demand_signals` is `native` when `customersEnabled` is true and `absent` otherwise.
- `scripts/lib/linear/API-VERIFICATION.md` for the rule on gated features.

Acceptance criteria:

1. Lists and edits customers with tier, revenue, size and status.
2. Links customer requests to issues and projects after confirmation.
3. On a plan without customers it says the capability is absent.

## Facts checked against the Linear API

Read-only introspection and reads on 2026-10-28 against the sandbox workspace (Free plan), with a personal key loaded by the shell. The calls were queries only, sent after checking the workspace. The names below are Linear's own, and none is workspace-specific.

| Object | Result |
|---|---|
| `Organization.customersEnabled` | `false` on the sandbox workspace. PMK-33 already reads it into `raw.flags.customersEnabled`. |
| `Customer` | `id`, `name`, `status` (a `CustomerStatus`), `tier` (a `CustomerTier`, nullable), `revenue` (`Int`, nullable), `size` (`Float`, nullable), `owner` (`User`), `domains`, `externalIds`, `slackChannelId`, `logoUrl`, `approximateNeedCount`, `slugId`, `url`, `needs`, timestamps. |
| `CustomerStatus`, `CustomerTier` | `id`, `name`, `displayName`, `color`, `description`, `position`. Statuses and tiers are workspace records, picked by id. |
| `CustomerNeed` | The customer request. `customer`, `issue`, `project`, `comment`, `attachment`, `priority` (`Float`, 0 or 1), `body`, `creator`, `url`. A need has an issue or a project, and may have neither. |
| `Issue.needs`, `Project.needs`, `Issue.customerTicketCount` | Fields exist. |
| Queries | `customers`, `customer`, `customerNeeds`, `customerNeed`, `customerStatuses`, `customerTiers`. `customers` takes a `CustomerFilter` (name, status, tier, owner, revenue, size) and a `CustomerSort`. |
| Mutations | `customerCreate`, `customerUpdate`, `customerUpsert`, `customerDelete`, `customerMerge`, `customerNeedCreate`, `customerNeedUpdate`, `customerNeedDelete`, `customerNeedArchive`, plus status and tier create, update and delete. The mutations come from the schema only. None was sent. |
| `CustomerUpdateInput` | `name`, `statusId`, `tierId`, `revenue` (`Int`), `size` (`Int`), `ownerId`, `domains`, `externalIds`, `slackChannelId`, `logoUrl`, `mainSourceId`. |
| `CustomerNeedCreateInput` | `customerId`, `issueId`, `projectId`, `priority`, `body`, and fields for comments, attachments and external ids. `CustomerNeedUpdateInput` takes the same ids and can move a need to another issue or project. |
| Payloads | `CustomerPayload` and `CustomerNeedPayload` return `success` and the object. |
| Live reads on Free | `customers(first: 1)` and `customerNeeds(first: 1)` fail with the GraphQL error "Customer requests are not available in this workspace." `customerStatuses` answers with four default statuses and `customerTiers` answers with an empty list. |

Consequences:

- The feature flag is the test. `customersEnabled` false means the workspace has no customers, whatever the plan string says, and the failing reads confirm it. The command checks `raw.flags.customersEnabled` in the cached discovery and sends nothing when it is false. This is the same rule the manifest uses for `demand_signals`, so the command and `capabilities` agree.
- `customerStatuses` and `customerTiers` answer on Free, so they prove nothing, as the triage reads did. They are also not needed to decide availability.
- The schema shows no unit for `revenue`. The Linear UI treats it as the annual contract value. The command shows and sets the integer as Linear stores it and does not convert (builder's call).
- `size` is a Float in the schema. The command accepts a number of at least 0 with an optional decimal part. `revenue` stays a whole number.
- Linear's docs page for customers was not read in this run. Stage 3 records the page and date in `API-VERIFICATION.md`, as PMK-43 did for triage. The docs say all plans, so the plan gate in the Linear tab and the Unified model does not apply.

## Goals

- A CLI group `linear customers` with four commands. `list` prints customers with status, tier, revenue, size and request count. `show` prints one customer with its requests and what each is linked to. `set` edits status, tier, revenue, size, owner and name of one customer. `link` links a customer request to an issue or a project.
- On a workspace without customers, each command says so and says how to turn them on, and a write changes nothing.
- A Markdown command `/pmkit:linear:customers` that walks the user through listing, editing and linking, and that only runs `node ".../pmkit.mjs" linear customers ...`.
- All of it testable with the fake Linear fetch. `npm test` sends nothing.

## Non-goals

- Creating, deleting, merging or archiving customers, and creating tiers or statuses (resolved question 1).
- Deleting, archiving or unlinking a request. `link` creates a request or moves one.
- Customer-based prioritization (the generic `prioritize-by-demand` skill). It would read this command's output and is a separate issue.
- Asks, and the Zendesk, Intercom and Front integrations. They are separate rows in domain 11.
- A new capability ID or a manifest change. The Technical spec fixes the 20 IDs, and `demand_signals` already carries the flag.
- Any write to Linear while building or testing on Free.
- Code from PMK-36, PMK-37 and PMK-38. They are parallel issues and may not be merged.

## Anti-goals

- `npm test` opening a socket, or a new dependency (ADR-0003).
- A change to a Local tracker output or to a golden that exists today. The new commands add golden cases of their own.
- The key in output, in an error, in a cache file or on a command line (ADR-0005).
- The real workspace URL key or team key in any file. Examples use `acme` and `ACME`, and docs say "the sandbox workspace".
- A customer query sent when `customersEnabled` is false, and a mutation sent from a read command or from `--dry-run`.

## Approaches

### Where the code lives

1. Customer operations in the contract (`listCustomers`, `updateCustomer`, `linkCustomerRequest`). Every tracker must implement them. The Local tracker and `fake-hosted.mjs` get stubs that throw `NOT_SUPPORTED`, and the contract suite grows cases no other tracker can pass. Customers are a Linear-only entity, so the contract would carry a one-system feature.
2. A Linear extension reached with `linear: true`, with its own file `customers.mjs` and an object `tracker.customers` next to `tracker.triage`. It follows PMK-43 and leaves the contract alone.
3. A Markdown command that calls the GraphQL API itself. ADR-0002 forbids it, and the key must stay inside code.

Chosen: approach 2. It is the pattern the code already has, and the only change to shared code is how `ctx.linear()` picks the feature (see "Files").

### How the command decides the capability is absent

1. A live probe of `customers`. It fails on Free with a GraphQL error, so it would work, but it sends a request that the cache already answers and it relies on Linear's message text. Rejected as the test.
2. The cached flag `raw.flags.customersEnabled`, with the plan only choosing the reason and the hint. No extra request, and the answer matches the manifest.
3. A new manifest capability. It changes the fixed list of 20 IDs for one system-specific skill. Rejected, as in PMK-43.

Chosen: approach 2. A stale cache can say "enabled" when Linear has turned customers off. The command then catches the "Customer requests are not available" GraphQL error and returns the same absent result with `reason: stale` and the hint to run `pmkit discover` (builder's call).

### How `link` names its targets

1. Linear ids only. The user would have to find a UUID for a project, which `pmkit discover` does not list.
2. An issue key (`ACME-12`) for issues and a project name or slug for projects, resolved by the command with read queries, and a customer name or id for customers.
3. A free search over issues and projects. It guesses, and a write needs an exact target.

Chosen: approach 2. A name that matches several records is `INVALID_INPUT` and the next step lists them. Nothing is guessed.

## Design

### Files

| File | Change |
|---|---|
| `scripts/lib/linear/customers.mjs` | New. The GraphQL documents, `createCustomers({ client, discovery, config })`, and the pure helpers `customersAvailability(raw)`, `customerView(node)`, `requestView(node)` and `planCustomerEdit(current, flags, statuses, tiers, memberIds)`. |
| `scripts/lib/linear/tracker.mjs` | Adds `customers` to the object `createLinearTracker` returns, next to `triage`. `contractView` ignores it. |
| `scripts/pmkit.mjs` | `ctx.linear(feature)` returns `tracker[feature]` for `'triage'` or `'customers'`. The three PMK-43 commands change from `ctx.linear()` to `ctx.linear('triage')`. The four new commands go in `COMMANDS` with `linear: true`. The runner refusal already exists. |
| `commands/linear/customers.md` | New. The procedure for `/pmkit:linear:customers`. |
| `skills/pmkit/SKILL.md`, `README.md`, `scripts/plugin.test.mjs` | List the command. |
| `scripts/golden-cases.mjs`, `scripts/__goldens__/` | Cases for the four commands on the Local fixtures, which record the refusal. |
| `scripts/__scenarios__/linear-customers.mjs` and its snapshot | The scenario for the command file (see Tests). |
| `scripts/fake-linear-api.mjs` | Routes for the customer queries and mutations, and a `fakeCustomers(options)` helper. `fakeWorkspace` already takes `customersEnabled`. |
| `scripts/lib/linear/customers.test.mjs`, `scripts/cli-linear.test.mjs` | Unit and CLI tests. |
| `scripts/lib/linear/API-VERIFICATION.md` | A section for customers with the facts above and the docs page checked. |

`CHANGELOG.md` and the plugin version do not change in this issue. The release adds the entry and the bump, as in the other EPC-5 issues.

The `ctx.linear` change touches the three PMK-43 call sites by one argument. PMK-36, PMK-37 and PMK-38 may also edit this area of `pmkit.mjs`, so the merge may need a manual step. The risk is small and named in "Risks".

### The CLI commands

| Command | Kind | What it does |
|---|---|---|
| `linear customers list [--status NAME] [--tier NAME] [--limit n]` | read | Prints customers, highest revenue first. |
| `linear customers show --customer ID_OR_NAME` | read | Prints one customer and its requests. |
| `linear customers set --customer ID_OR_NAME [--status NAME] [--tier NAME\|none] [--revenue n] [--size n] [--owner MEMBER_ID\|none] [--name TEXT] [--dry-run]` | write, takes `--dry-run` | Edits the fields named. At least one field flag is required. |
| `linear customers link --customer ID_OR_NAME (--issue KEY \| --project NAME) [--body TEXT] [--important] [--request ID] [--dry-run]` | write, takes `--dry-run` | Creates a request for the customer on an issue or a project. With `--request`, moves that existing request instead. |

A customer matches by id first, then by exact name, case-insensitive. Two customers with the same name are `INVALID_INPUT`, and the next step lists their ids. `ctx.linear('customers')` returns `null` when `tracker.system` is not `linear`, and the runner refuses a `linear` command on another tracker with `NOT_SUPPORTED`, as it does for the triage commands.

### The availability check

`customersAvailability(raw)` returns `{ available: true }` or `{ available: false, reason, plan, enableHint }`, in this order.

| Order | Condition | `reason` | `enableHint` |
|---|---|---|---|
| 1 | `raw.flags.customersEnabled` is true | none, available | none |
| 2 | The flag is not true, on any plan | `customers_off` | An admin can turn on customer requests in the workspace settings. |

Linear's docs say Customer Requests exist on all plans and an admin turns them on. The user decided in the PMK-42 review that the docs win over the Linear tab, so the plan never changes the reason or the hint. The result still carries `plan` for display. The check reads the cached discovery (one hour, refreshed by `pmkit discover`). A user whose admin has just turned the feature on runs `pmkit discover`.

### What each command prints and returns

`list` on a workspace with customers:

```
ACME Corp   status Active   tier Gold     revenue 120000   size 450   requests 7
Globex      status Prospect tier -        revenue -        size 30    requests 1
```

```json
{
  "available": true,
  "customers": [
    {
      "id": "cust-1",
      "name": "ACME Corp",
      "status": { "id": "st-1", "name": "Active" },
      "tier": { "id": "tier-1", "name": "Gold" },
      "revenue": 120000,
      "size": 450,
      "owner": { "id": "user-2", "name": "Ana Souza" },
      "requests": 7,
      "url": "https://linear.app/acme/customer/acme-corp"
    }
  ],
  "hasMore": false
}
```

- Customers sort by revenue, highest first, then by name. A missing revenue sorts last. Linear's own sort is not used, because the order must not depend on a sort that is unverified on a Business workspace (builder's call).
- `--status` and `--tier` take a name and match case-insensitively against `customerStatuses` and `customerTiers`. An unknown name is `INVALID_INPUT` and the next step lists the names. The filter runs in the query (`CustomerFilter`).
- `--limit` defaults to 50 and caps at 100, with a warning above the cap. When more customers exist, `hasMore` is true and a warning says so.
- With no customer, the text is "no customers yet".

`show` adds the requests, newest first, each with `id`, `body` (first 200 characters), `priority` (0 or 1), `important` and a `target`. The target is `{ type: "issue", id: "ACME-12", title }`, `{ type: "project", id, name }` or `null` when the request has neither. A request on an archived issue shows the issue with `archived: true`.

`list`, `show`, `set` and `link` on a workspace without customers print the absent result. The reads exit 0:

```
customers: unavailable
reason: customers_off
plan: free
enable: An admin can turn on customer requests in the workspace settings.
```

```json
{
  "available": false,
  "reason": "customers_off",
  "plan": "free",
  "enableHint": "An admin can turn on customer requests in the workspace settings."
}
```

The write commands (`set`, `link`, with or without `--dry-run`) exit 2 with `NOT_SUPPORTED`, the message "customers are unavailable on this workspace (customers are off)" and the same `enableHint` as the next step. They send no query and no mutation. This follows PMK-43 (question 1 there, answered A). A read answers a question, and "this workspace has no customers" is an answer. A write that cannot happen is an error. An agent that reads the JSON branches on `available`.

`set` rules, with the capability present:

- At least one field flag is required, or the command is `INVALID_INPUT`.
- `--status` and `--tier` resolve a name to an id through `customerStatuses` and `customerTiers`, case-insensitive. `--tier none` clears the tier (`tierId` null). An unknown name is `INVALID_INPUT` and lists the valid names. The command creates no status or tier (resolved question 1).
- `--revenue` takes a whole number of at least 0, and `--size` takes a number of at least 0 that may be a decimal such as 2.5. A decimal revenue, a negative number or text is `INVALID_INPUT`. There is no way to clear them in the first version (builder's call).
- `--owner` takes a member id from `pmkit discover` that is not an app user, or `none`. `none` is case-insensitive, like `--tier none`.
- `--dry-run` reads the customer, builds the change and returns `{ before, after }` in the shape `list` uses for one customer. It sends no mutation. The text ends with "dry run: nothing was written".
- A real run sends one `customerUpdate` and returns `{ before, after }` with `after` taken from the mutation payload. A change that equals the current values sends nothing and prints "nothing to change". The commit id is the customer name. A hosted tracker never auto-commits, so it has no effect.

`link` rules, with the capability present:

- Exactly one of `--issue` and `--project` is required, unless `--request` is given. Both are `INVALID_INPUT`.
- `--issue` takes a key such as `ACME-12`. The command reuses the pure helper `isIssueId` from `issues.mjs` to reject a malformed key before any request, then reads the issue with `issue(id:)` for its id and title. A missing issue is `NOT_FOUND`.
- `--project` takes a project name or slug. The command reads `projects` with a name filter, and one exact match (case-insensitive) is the target. Zero is `NOT_FOUND`, several is `INVALID_INPUT` with the names.
- Without `--request`, the command sends `customerNeedCreate` with the customer id, the target id, `--body` and a priority of 1 for `--important`, else 0. If the customer already has a request on that target, the command stops with `CONFLICT`, and the next step names the request and says to pass `--request` to move it or to edit it in Linear.
- With `--request ID`, the request must belong to the customer, or the command is `INVALID_INPUT`. The command sends `customerNeedUpdate` with the new target. `--body` and `--important` are rejected with `--request`, because the move changes the target only.
- `--dry-run` resolves the customer and the target with reads and returns `{ customer, target, request: { kind: "create" | "move", from } }`. It sends no mutation. The real run returns the same shape with the request id from the payload.
- The Markdown command always previews and asks once, as the next section says. The CLI does not read `write_policy`, as in PMK-43.

### The Markdown command

`commands/linear/customers.md` has the frontmatter and the five sections that `plugin.test.mjs` checks. `argument-hint` is `"[list|show|set|link]"`.

1. Run `node "${CLAUDE_PLUGIN_ROOT}/scripts/pmkit.mjs" capabilities --json`. When `tracker` is not `linear`, say the command works only with Linear and stop. This is the step the scenario runs on a Local fixture.
2. Run `linear customers list --json`. When `available` is false, print the reason and the `enableHint`, and stop. Say that an admin can turn on customer requests in the workspace settings on any plan.
3. Show the customers with status, tier, revenue, size and request count. For one customer the user names, run `linear customers show` and show its requests and their targets.
4. Ask with `AskUserQuestion` what to do next. The choices are edit a customer, link a request, or stop.
5. For an edit, run `linear customers set ... --dry-run --json`, show `before` and `after`, and ask once to apply. For a link, run `linear customers link ... --dry-run --json`, show the customer, the target and whether it creates or moves a request, and ask once to apply. The preview is shown whatever `write_policy.confirm` says, because both writes change data the sales and product teams read.
6. On approval, run the same command without `--dry-run`. Run `show` again and compare it with the preview.

Confirmation points are the next action (step 4) and the preview (step 5). Declining changes nothing.

Output is the customers, what changed, and for a link the request and its target.

If something is missing, no `LINEAR_API_KEY` is `AUTH` and the conventions say what to tell the user. A Local tracker stops at step 1. A workspace with customers off stops at step 2 with the hint.

### What this command needs from other issues

Nothing from PMK-36, PMK-37 or PMK-38, and no operation from PMK-35. It reads the workspace through the discovery PMK-33 built, uses the pure helper `isIssueId` from PMK-35 to check an issue key, and runs its own read queries for customers, issues and projects. The contract's issue operations stay unused so that this command does not wait for a change to them.

## Tests

- `customers.test.mjs`. `customersAvailability` for each row of the table, including `trial`, an unknown plan and a Business plan, each with the flag off. `customerView` and `requestView` for each target type, a missing tier, revenue and size, and an archived issue. `planCustomerEdit` for each flag, `--tier none` and `--owner none` in any case, a decimal size, an unknown status or tier, a no-op, a decimal revenue and a request that is not the customer's.
- CLI tests in `cli-linear.test.mjs` over `fakeLinearFetch(fakeWorkspace({ ... }))` plus the customer routes.
  - Free workspace (the proof for this issue). `list` and `show` exit 0 with `available: false`, `reason: customers_off` and the hint, in text and JSON. `set`, `link` and each with `--dry-run` exit 2 with `NOT_SUPPORTED`. The fetch log shows no customer query and no mutation in any of the six runs.
  - Business workspace with customers off. The same `reason: customers_off`.
  - Stale cache. The flag says on and the fake answers with Linear's "not available" error. The result is `available: false` with `reason: stale`, and no mutation goes out.
  - Present path. `list` with a filter, a limit and the sort. `show` with requests on an issue, on a project and on neither. `set` for each field, `--tier none` and each `INVALID_INPUT` case. `link` as create on an issue and on a project, as move with `--request`, and each `NOT_FOUND`, `INVALID_INPUT` and `CONFLICT` case. `--dry-run` sends no mutation, and each real write sends exactly one.
  - The mutation carries the ids Linear returned and no key in any body, log line or error.
  - `linear customers list` on a Local repository exits 2 with `NOT_SUPPORTED`.
- A counting fetch asserts zero mutations for `list`, `show` and every `--dry-run`.
- Goldens. `CASES` gets `'linear customers list': () => [[]]`, `'linear customers show': () => [['--customer', 'acme']]`, `'linear customers set': () => [['--customer', 'acme', '--tier', 'gold']]` and `'linear customers link': () => [['--customer', 'acme', '--issue', 'ISS-1']]`. On the Local fixtures each records the `NOT_SUPPORTED` refusal in text and JSON. The four commands are excluded from the hosted mirror, as the `linear: true` ones are, and `cli-hosted.test.mjs` asserts the list of `linear` commands.
- Scenario `linear-customers.mjs`, built like the PMK-43 one. The scenario helper runs the real CLI in a child process, so it cannot inject the fake fetch. One entry runs on the `team` fixture (a Local tracker) and covers step 1, which stops the command. A second entry sets the config to `system: linear` with a workspace and no key, and expects step 1 to fail with `AUTH`. `skip` lists the Linear calls of steps 2 to 6 with the reason, and `notHit` lists the two confirmation points.
- A test parses `customers.md` and asserts that each `set` and `link` call has a `--dry-run` form in step 5 and a write form in step 6.
- `npm test` passes, including `plugin.test.mjs`, `scenarios.test.mjs` and `goldens.test.mjs`, and sends no request.
- Live check, by hand and outside `npm test`: with the key loaded by the shell, run `linear customers list` on the sandbox workspace and record the `available: false` answer in the PR. A live `set` and `link` on a Business or trial workspace is a follow-up and stays `schema` in the verification note.

## Acceptance criteria map

| Criterion | Design part |
|---|---|
| 1. Lists and edits customers with tier, revenue, size and status | "The CLI commands" (`list`, `show`, `set`), "What each command prints and returns" (the customer shape, the filters and the `set` rules), "The Markdown command" (steps 3, 5 and 6). The present path is proven with the fake in the unit and CLI tests. |
| 2. Links customer requests to issues and projects after confirmation | "The CLI commands" (`link`), "What each command prints and returns" (the `link` rules and `--dry-run` preview), "The Markdown command" (steps 4 to 6, which preview and ask once before any write), and the test on the dry-run and write forms in `customers.md`. The tests use the fake. |
| 3. On a plan without customers it says the capability is absent | "The availability check", the `available: false` result for reads and the `NOT_SUPPORTED` result for writes, and "The Markdown command" (step 2). Proven by the Free workspace CLI tests (six runs, zero customer queries and zero mutations), the goldens on Local, and the live check on the sandbox workspace. |

## Decisions

| Decision | Reason |
|---|---|
| A `linear: true` extension in `customers.mjs`, not contract operations | Customers exist only in Linear. The contract and every other tracker stay unchanged, and PMK-43 set the pattern. |
| `ctx.linear(feature)` picks `triage` or `customers` | Two features now share the hook. Returning one object of features would work too, but the argument keeps each call site explicit (builder's call). |
| Availability from `raw.flags.customersEnabled`, with the plan only choosing the hint | Linear enforces the flag, the live reads fail on Free, and the manifest uses the same flag for `demand_signals`. No request is needed. |
| Reads exit 0 with `available: false`, writes exit 2 with `NOT_SUPPORTED` | It follows PMK-43 and the Linear tab's rule to report `customers_off` on every plan. |
| No manifest change | `demand_signals` already reports `native` or `absent` from the same flag. |
| Names, not ids, for status, tier, customer and project | A user does not hold Linear ids. An ambiguous or unknown name fails with the valid choices. |
| `link` creates or moves a request and never deletes one | The acceptance criterion says link. A destructive change on customer data needs its own decision (resolved question 1). |
| The command always previews and asks once before `set` and `link` | Both change data other teams read. The criterion says "after confirmation". |
| Revenue and size are plain integers as Linear stores them | The schema states no unit, and a conversion would invent one. |
| The command uses `isIssueId` from PMK-35 and no issue operation | It checks a key without a dependency on the issue write path. |

## Resolved questions

1. Create and delete of customers, tiers and statuses: no. `set` edits only an existing customer with an existing tier and status. Create can follow once a Business workspace is available.
2. `link` can move an existing request to another issue or project with `--request`.
3. A request that already exists on the same target answers `CONFLICT` and names the request.
4. `list` sorts by revenue, highest first, in code.

## Risks

- The present path is tested against a fake built from the schema. A real Business workspace may return different plan strings, refuse the mutations for a non-admin key, or reject an `issueId` that is a key and not a UUID. The command reads the issue first and sends its id, so the last case does not arise. The mutations are unverified live, and the verification note says `schema` for them.
- Linear's error message for a workspace without customers is matched by its text ("not available") for the stale-cache path. A change in the wording turns that path into an `UPSTREAM` error. The flag check is the main test and does not depend on the text.
- The unit of `revenue` is not in the schema. A user who reads 120000 as euros when the workspace means dollars is misled. The text shows the integer with no currency symbol, and the Markdown command says so.
- The discovery cache lasts an hour. A user who turned customers on sees "unavailable" until `pmkit discover` runs. The hint says so.
- A project name filter may behave differently on a workspace with archived or many projects. The command reads one page of 25 and reports `hasMore` as a warning, so a miss is `NOT_FOUND` with the hint to use the slug.
- The `ctx.linear(feature)` change touches the PMK-43 call sites. PMK-36, PMK-37 and PMK-38 are parallel and may edit the same part of `pmkit.mjs`, so a merge conflict is possible and small.
- The sandbox workspace keeps the flag off. Nobody can run the present path live until a workspace with customers turned on exists.

## Self-review

- Every acceptance criterion maps to a design part and to a test above.
- The present path has no live proof, and the spec says so in "Risks" and in the verification note.
- No section depends on code from PMK-36, PMK-37 or PMK-38, and the only PMK-35 code used is one pure helper.
- Names in examples are `acme` and `ACME`.
