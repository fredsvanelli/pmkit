# PMK-190 order and unread records of customers and requests

Source: PMK-190, the defects the review of PR #100 found in PMK-46 (customers and requests on the Local tracker). Extends `2026-10-31-pmk-46-customers-and-requests-design.md`.

## Goal

The Local tracker answers `customers show`, the request inbox, `requests get`, `requests list --customer` and `validate` the way Linear does and never hides a record it could not read. The Linear manifest lists every request operation the adapter does not serve.

## Non-goals

- The improvements in `docs/superpowers/epc-6-follow-ups.md`.
- Serving requests on Linear.

## Design

### 1. `customers show` lists requests newest first

Linear sorts the `needs` of a customer by `createdAt`, newest first, so `requests[0]` is the newest. Local does the same: by instant descending, then by id descending. A request without `created` goes last, as it does in the inbox. `requests list` stays oldest first (the inbox), and its summary already says so.

### 2. Requests are ordered by instant

`sortRequests` compares `Date.parse(created)` and not the text, so `2026-11-01T09:00:00-05:00` (14:00Z) sorts after `2026-11-01T12:00:00Z`. Ties go to the id, as before. `validTimestamp` guarantees every stored `created` parses. `groupDemand` keeps the order it gets.

### 3. `requests get` returns `problems` and never prints `by null`

`getRequest` returns the view plus `problems` (the same entries as the list: an unreadable customer or issue). The CLI prints each as a `warning:` line through `problemWarnings` and the JSON carries the same list. `requestRecord` prints `triaged <at>` with ` by <who>` only when `triaged_by` is set. A `(unreadable)` target or customer keeps its marker, and the warning says why.

### 4. A request rewrite keeps the frontmatter as it is

`accept` and `decline` edit the stored frontmatter text with the line editor of `scripts/lib/yaml-edit.mjs` (`setScalar`, `removeKey`), as `epic goal` does, so `# comment` lines, unknown keys, key order and the body stay byte for byte. The text is normalized to LF first. New keys go at the end of the block. The result is read back with `parseRequest` before it is written. When the editor cannot edit the file, the command fails with `INVALID_INPUT` and the doctor as next step, and writes nothing.

### 5. `validate` and the customer reads treat an unreadable customer as unreadable

- `validate`: a request whose `customer` is a file that exists but does not parse yields a `reference` problem on the request (`customer CUS-1 does not parse, see customers/CUS-1.md`), next to the customer file's own problem. A request naming a customer with no file keeps `does not exist`. A customer file held back by conflict markers counts as unreadable.
- `customers show <name>`: a name that matches no readable customer, while a customer file could not be read, answers `NOT_FOUND` with the message that the lookup was not complete and names the unreadable files. The result of a found customer carries the problems of the customer files too, so the warning shows.
- `requests list --customer <id>` refuses a customer that is not a readable customer file with `INVALID_INPUT` (`customer X does not exist`, next step `pmkit customers list`), as `requests create --customer` does. A blank value means no filter.

### 6. The Linear manifest

`demand_signals.detail.unsupported` adds `createRequest` (`requests create` is served by that capability in `SERVED_BY`). The test compares the list with the operations the capability serves.

## Acceptance criteria map

1. `customers show` order: section 1, `scripts/customers.test.mjs`.
2. Inbox by instant: section 2, `scripts/customers.test.mjs`.
3. `problems` and `by null`: section 3, `scripts/customers.test.mjs`, `scripts/cli.test.mjs`.
4. `validate` and `--customer`: section 5, `scripts/validate.test.mjs`, `scripts/customers.test.mjs`.
5. Manifest: section 6, `scripts/lib/linear/manifest.test.mjs`.
6. Comments kept (scope, no criterion): section 4, byte-compare test.

## Decisions taken without the user

- Newest-first ties go to the higher id, so the order is the exact reverse of the inbox for requests that have `created`.
- `getRequest` carries `problems` in the view object rather than a new return shape, so `data` of `requests get` stays one request.
- Unreadable customer on a name lookup is `NOT_FOUND` with an "incomplete" message, not a silent miss, following the lessons on incomplete reads.
