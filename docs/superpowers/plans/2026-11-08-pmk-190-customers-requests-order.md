# PMK-190 Customers and requests order Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix the order, the unread records and the manifest gaps of customers and requests on the Local tracker.

**Architecture:** Changes stay in `scripts/lib/local/requests.mjs`, `scripts/lib/local/tracker.mjs`, `scripts/lib/validate.mjs`, `scripts/lib/format.mjs`, `scripts/pmkit.mjs` and `scripts/lib/linear/manifest.mjs`. Each fix is test first.

**Tech Stack:** Node ESM, `node:test` through `npm test`.

**Spec:** `docs/superpowers/specs/2026-11-08-pmk-190-customers-requests-order-design.md`

## Global Constraints

- Commit trailer, exactly: `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`; every message carries `(PMK-190)`.
- No new command file, so no scenario or `COMMANDS` change.
- A read that may be incomplete says so in the JSON and the text; the command draws no conclusion from it (lessons round 3 and 7).
- Normalize CRLF to LF when reading files.
- Tests never run the CLI inside `scripts/__fixtures__/`; copy to a temp dir.

## Review Focus

- A request with no `created` in `customers show`: goes last, as in the inbox (task 1 test).
- Two requests at the same instant: id breaks the tie (task 1 test).
- `triaged` without `triaged_by`: no `by null` in text, `by` absent from nothing in JSON (task 3 test).
- A customer file that is held back by conflict markers: counts as unreadable in `validate` (task 4 test).
- A blank `--customer`: no filter, no error (task 4 test).

---

### Task 1: Order by instant (criteria 1 and 2)

**Files:** Modify `scripts/lib/local/requests.mjs` (`sortRequests`, new `sortRequestsNewest`), `scripts/lib/local/tracker.mjs` (`getCustomer`); Test `scripts/customers.test.mjs`.

**Interfaces:** Produces `sortRequests(list)` (oldest first by `Date.parse(created)`, then `compareIds`, no `created` last) and `sortRequestsNewest(list)` (newest first, ties by id descending, no `created` last).

- [ ] **Step 1:** Add tests `inbox sorts by instant not by text` (`created` `2026-11-01T09:00:00-05:00` listed after `2026-11-01T12:00:00Z` in `listRequests`) and `customers show lists requests newest first` (three requests, one without `created` last, two with the same instant ordered by id descending; `requests[0]` is the newest).
- [ ] **Step 2:** Run `node --test scripts/customers.test.mjs`; expect the two new tests to FAIL.
- [ ] **Step 3:** Implement the two functions in `requests.mjs` with one shared instant key; use `sortRequestsNewest` in `getCustomer`.
- [ ] **Step 4:** Run the same command; expect PASS.
- [ ] **Step 5:** Commit `fix(requests): order by instant and list a customer's requests newest first (PMK-190)`.

### Task 2: Manifest (criterion 5)

**Files:** Modify `scripts/lib/linear/manifest.mjs` (`demand_signals.detail.unsupported` adds `createRequest`); Test `scripts/lib/linear/manifest.test.mjs`.

- [ ] **Step 1:** Add test `demand_signals lists createRequest as unsupported`, and a check that every operation of `request_queue` plus `createRequest` appears in the `unsupported` list of one of the two capabilities.
- [ ] **Step 2:** Run `node --test scripts/lib/linear/manifest.test.mjs`; expect FAIL.
- [ ] **Step 3:** Add `'createRequest'` to the list.
- [ ] **Step 4:** Run it; expect PASS. If `scripts/contract-suite.mjs` or ADR counts change, fix them.
- [ ] **Step 5:** Commit `fix(linear): list createRequest as unsupported for demand_signals (PMK-190)`.

### Task 3: `requests get` problems and `by null` (criterion 3)

**Files:** Modify `scripts/lib/local/tracker.mjs` (`getRequest`), `scripts/lib/format.mjs` (`requestRecord`), `scripts/pmkit.mjs` (`requests get`); Test `scripts/customers.test.mjs`, `scripts/cli.test.mjs`.

**Interfaces:** `getRequest(id)` returns the request view plus `problems: Array<{id, code, message}>` (from `requestViews`).

- [ ] **Step 1:** Tests: `getRequest` of a request naming an unreadable customer returns one problem; CLI `requests get` of a request with `triaged` and no `triaged_by` prints `triaged <at>` without `by`, and its `--json` has `problems`; the text run prints a `warning:` for an unreadable customer.
- [ ] **Step 2:** Run both test files; expect FAIL.
- [ ] **Step 3:** Implement: `getRequest` spreads the view and `problems`; `requestRecord` adds ` by <who>` only when set; the command returns `warnings: problemWarnings(request.problems)`.
- [ ] **Step 4:** Run; expect PASS (also check `requests create/accept/decline` output unchanged, they use `viewOfRequest`).
- [ ] **Step 5:** Commit `fix(requests): requests get returns problems and never prints by null (PMK-190)`.

### Task 4: Unreadable customers and `--customer` (criterion 4)

**Files:** Modify `scripts/lib/validate.mjs` (reference loop for requests), `scripts/lib/local/tracker.mjs` (`getCustomer`, `listRequests`); Test `scripts/validate.test.mjs`, `scripts/customers.test.mjs`.

- [ ] **Step 1:** Tests: `validate` reports `customer CUS-1 does not parse, see customers/CUS-1.md` for a request naming a broken customer file (and still `does not exist` for a missing one); `getCustomer('Name')` with one unreadable customer file and no match is `NOT_FOUND` whose message says the lookup is incomplete; a found customer carries the customer-file problems; `listRequests({customer:'CUS-9'})` throws `INVALID_INPUT`, a blank customer does not.
- [ ] **Step 2:** Run both files; expect FAIL.
- [ ] **Step 3:** Implement: track parsed customer ids in `validate`; in `getCustomer` merge `all.problems` into `problems` and word the miss; in `listRequests` call `requireCustomer(customer)` when not blank and filter by its id.
- [ ] **Step 4:** Run; expect PASS.
- [ ] **Step 5:** Commit `fix(customers): report unreadable customers and refuse an unknown --customer (PMK-190)`.

### Task 5: Keep frontmatter comments on accept and decline (spec section 4)

**Files:** Modify `scripts/lib/local/tracker.mjs` (`triage`); Test `scripts/customers.test.mjs`.

**Interfaces:** `triage` edits the stored YAML with `setScalar` and `removeKey` from `scripts/lib/yaml-edit.mjs`, as `setEpicGoal` does; the `change` callbacks of `acceptRequest` and `declineRequest` receive `(stored, edit)` where `edit.set(key, value)` and `edit.remove(key)` update the text.

- [ ] **Step 1:** Test `accept and decline keep comments, unknown keys and the body byte for byte`: a request file with a `# note` line and an extra key; after `acceptRequest` then `declineRequest`, only the state keys differ.
- [ ] **Step 2:** Run; expect FAIL (comment lost).
- [ ] **Step 3:** Implement; a file the editor cannot edit gives `INVALID_INPUT` with `/pmkit:local:doctor`, nothing written (add a test with a `state` block value).
- [ ] **Step 4:** Run; expect PASS.
- [ ] **Step 5:** Commit `fix(requests): accept and decline keep frontmatter comments (PMK-190)`.

### Task 6: Docs, criteria, delivery prep

**Files:** Modify `CHANGELOG.md` (line at top of `## Unreleased`); `docs/superpowers/epc-6-follow-ups.md` only if it lists these defects.

- [ ] **Step 1:** Add the CHANGELOG line in the style of its neighbours.
- [ ] **Step 2:** Check each criterion with `node scripts/pmkit.mjs issues update PMK-190 --check <n>` (dry-run, then real) for n = 1..5; commit `.issues/`.
- [ ] **Step 3:** Run `npm test` in the foreground with a long timeout; require exit code 0.

## Self-review

Spec sections 1 to 6 map to tasks 1, 1, 3, 5, 4, 2. Names are consistent (`sortRequestsNewest`, `getRequest` with `problems`).
