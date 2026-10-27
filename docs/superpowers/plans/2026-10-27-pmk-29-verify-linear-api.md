# PMK-29 verify the Linear API Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A written note says yes or no for recurring issues, dependencies between projects, releases and Insights, with the API object for each. A read-only script repeats the check.

**Architecture:** `scripts/lib/linear/verify-api.mjs` has pure functions (name matching, per-feature summary, read-only guard), a GraphQL sender that takes `fetch` as an argument, and a `run` function that the entry point calls. The unit test passes a fake `fetch`. The note `scripts/lib/linear/API-VERIFICATION.md` is written by hand from one live read-only run.

**Tech Stack:** Node 18+ ES modules, global `fetch`, `node:test`, no dependency (ADR 0003). Run the suite with `npm test`.

**Spec:** `docs/superpowers/specs/2026-10-27-pmk-29-verify-linear-api-design.md`. The spec wins where this plan differs, and the implementer reports the difference.

## Global Constraints

- No write to Linear. Every document the script sends is a query, and `assertQuery` rejects one that starts with `mutation` before any call.
- `npm test` makes no network call. The script file does not end in `.test.mjs`. The test imports it, and importing starts nothing because `run` only executes when the file is the entry point.
- The live run needs `PMKIT_LIVE=1`. Without it the script prints one line, exits with code 0 and sends nothing. With it and without `LINEAR_API_KEY` it exits with code 2.
- The key is read from `process.env.LINEAR_API_KEY` inside code only. It goes in the `Authorization` header and nowhere else: not in output, errors, the note, a commit or a command line. To run live: `set -a; . /home/fred/projects/pmkit/.env; set +a; PMKIT_LIVE=1 node scripts/lib/linear/verify-api.mjs`. Never cat, grep or echo that file.
- `package.json` does not change. No change to the CLI, the manifest or other adapters.
- Answers are `yes` or `no`. `no` needs the schema to lack the object. A failed call is `unverified`, never `no`. Recurring issues is `yes`, access `read`, caveat "schedule and rules are not in the API" (spec question 1).
- Code, the note and commits are in English and follow the unslop rules. Every commit carries `(PMK-29)` and ends with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Acceptance criterion map

| Criterion | Tasks |
|---|---|
| Each of the four has a yes or no | 5 (live data), 6 (the note, four rows, none `unverified`) |
| with the API object that exposes it | 1, 2 (code that lists the objects), 5 (output), 6 (`API object` column and evidence sections) |
| recorded next to the Linear adapter | 6 (file at `scripts/lib/linear/API-VERIFICATION.md`), 7 (`npm test` passes with the folder) |

## File Structure

- Create `scripts/lib/linear/verify-api.mjs`: the script.
- Create `scripts/lib/linear/verify-api.test.mjs`: offline tests.
- Create `scripts/lib/linear/API-VERIFICATION.md`: the note.

## Task 1: Name matching over a schema

**Files:** Create `scripts/lib/linear/verify-api.test.mjs`, `scripts/lib/linear/verify-api.mjs`.

- [ ] **Step 1: Write the failing test.** Inline fixture shaped like an introspection `__schema`: `types` (each with `name`, `kind`, `fields: [{ name }]`), `queryType: { name: 'Query' }`, `mutationType: { name: 'Mutation' }`.

```js
import assert from 'node:assert/strict'
import test from 'node:test'
import { findMatches } from './verify-api.mjs'

const schema = {
  queryType: { name: 'Query' },
  mutationType: { name: 'Mutation' },
  types: [
    { name: 'Query', kind: 'OBJECT', fields: [{ name: 'releases' }, { name: 'projectRelations' }, { name: 'issues' }] },
    { name: 'Mutation', kind: 'OBJECT', fields: [{ name: 'releaseCreate' }, { name: 'projectRelationCreate' }, { name: 'issueCreate' }] },
    { name: 'Release', kind: 'OBJECT', fields: [{ name: 'id' }] },
    { name: 'Issue', kind: 'OBJECT', fields: [{ name: 'recurringIssueTemplate' }, { name: 'releases' }, { name: 'title' }] },
  ],
}

test('findMatches lists types, queries, mutations and fields whose name matches', () => {
  const found = findMatches(schema, /release/i)
  assert.deepEqual(found.types, ['Release'])
  assert.deepEqual(found.queries, ['releases'])
  assert.deepEqual(found.mutations, ['releaseCreate'])
  assert.deepEqual(found.fields, ['Issue.releases'])
})

test('findMatches returns empty lists when nothing matches', () => {
  assert.deepEqual(findMatches(schema, /insight|analytic|metric/i), { types: [], queries: [], mutations: [], fields: [] })
})
```

- [ ] **Step 2: Run it and see it fail.** `node --test scripts/lib/linear/verify-api.test.mjs` fails: no export `findMatches`.
- [ ] **Step 3: Implement.** Start the file with a comment saying it is a verification tool, not adapter code. `findMatches(schema, pattern)` returns sorted `{ types, queries, mutations, fields }`. Query and mutation names come from the root types' fields, so the root types themselves are not in `types` and their fields are not in `fields`. Other types' fields appear as `Type.field`.
- [ ] **Step 4: Run it and see it pass.**
- [ ] **Step 5: Commit.** `feat(linear): match feature names in a schema (PMK-29)`.

## Task 2: Feature definitions and the per-feature summary

**Files:** Modify both `verify-api.*` files.

- [ ] **Step 1: Write the failing tests.** Export `FEATURES`: four entries with `id`, `pattern` and `liveQueries`.
  - `recurring`: pattern `/recurr/i`, live query `templates` and `recurringIssueTemplate` on one issue.
  - `project_dependencies`: pattern `/projectRelation/i`, live query `projectRelations(first: 1)`.
  - `releases`: pattern `/release/i`, live queries `releases(first: 1)` and `releasePipelines(first: 1)`.
  - `insights`: pattern `/insight|analytic|metric/i`, no live query.
  
  Test `summarize(feature, schema, liveResults)` returns `{ feature, found, live }` where `live` is `ok`, `empty`, `{ error: { code, message } }` or `skipped` (no live query). A `liveResults` entry with `data` and a list that has nodes gives `ok`, with an empty list gives `empty`, and with `errors` gives the error. Check that a feature whose pattern matches nothing has all four `found` lists empty.
- [ ] **Step 2: Run and see it fail.**
- [ ] **Step 3: Implement** `FEATURES` and `summarize`. `summarize` never decides `yes` or `no`; the person writing the note does, by the answer rules in the spec.
- [ ] **Step 4: Run and see it pass.**
- [ ] **Step 5: Commit.** `feat(linear): summarize the four features (PMK-29)`.

## Task 3: The read-only guard and the GraphQL sender

**Files:** Modify both `verify-api.*` files.

- [ ] **Step 1: Write the failing tests.**
  - `assertQuery('mutation { x }')` and `assertQuery('  mutation M { x }')` throw. `assertQuery('query { viewer { id } }')` and `assertQuery('{ viewer { id } }')` do not. Comments and whitespace before the keyword do not hide a mutation.
  - `graphql({ fetch, key, query })` with a fake `fetch` that records its arguments: calls the URL `https://api.linear.app/graphql` with method `POST`, header `Authorization` equal to the key, and a JSON body with `query`. The key appears in no other argument.
  - With a `mutation` document the fake `fetch` is never called and the function throws.
  - An HTTP error status or a non-JSON body throws an error whose message holds the status and not the key. Test with a key value of `lin_test_SECRET` and assert the message does not include it.
- [ ] **Step 2: Run and see it fail.**
- [ ] **Step 3: Implement** `assertQuery(document)` and `graphql({ fetch = globalThis.fetch, key, query, variables })`. GraphQL `errors` in a 200 response are returned to the caller, not thrown, so `summarize` can report them.
- [ ] **Step 4: Run and see it pass.**
- [ ] **Step 5: Commit.** `feat(linear): read-only GraphQL sender (PMK-29)`.

## Task 4: The `run` function and the entry gate

**Files:** Modify both `verify-api.*` files.

- [ ] **Step 1: Write the failing tests.** `run({ env, fetch, write })` with a fake `fetch` that answers from a queue.
  - `env = {}`: writes one line that says it skipped and how to enable it, returns exit code 0, calls `fetch` zero times.
  - `env = { PMKIT_LIVE: '1' }` without a key: returns 2, writes one line, calls `fetch` zero times, and the line has no part of any key.
  - With both set and a canned introspection plus list answers: returns 0 and writes JSON that holds `organization.urlKey`, then one object per feature from `summarize`. Every `fetch` call has a body that starts a query. The written text does not contain the key.
  - A failing live query for one feature is reported in that feature's `live` and does not stop the others.
- [ ] **Step 2: Run and see it fail.**
- [ ] **Step 3: Implement** `run`. It sends the introspection query (`__schema` with `queryType`, `mutationType` and `types { name kind fields { name } }`), a query for `viewer`/`organization { urlKey }`, then the live queries of each feature. At the bottom, call `run` with `process.env`, the global `fetch` and `process.stdout.write` only when `process.argv[1]` equals `fileURLToPath(import.meta.url)`, and set `process.exitCode` from the result.
- [ ] **Step 4: Run and see it pass.** Then run `node scripts/lib/linear/verify-api.mjs` with no variables and see the skip line.
- [ ] **Step 5: Commit.** `feat(linear): add the read-only verification script (PMK-29)`.

## Task 5: Run it live on the Free workspace

**Files:** none changed. Output goes to the scratchpad, not the repository.

- [ ] **Step 1: Run.** `set -a; . /home/fred/projects/pmkit/.env; set +a; PMKIT_LIVE=1 node scripts/lib/linear/verify-api.mjs > <scratchpad>/linear-verify.json`. Never print the environment.
- [ ] **Step 2: Check the workspace.** `organization.urlKey` in the output is `acme`. If not, stop and report.
- [ ] **Step 3: Compare with the spec's "Observed" list.** Releases, project relations and recurring issues match; Insights finds nothing. Any difference goes into the note and into the report.
- [ ] **Step 4: Read the `Template` type and the docs.** From the same output, record the `Template.type` values and the Linear docs page for recurring issues and for releases, with the date. If a schedule field exists on `Template`, stop and report, because it changes the recurring answer.
- [ ] **Step 5: Confirm no key leaked.** Run `grep -c "lin_api_" <scratchpad>/linear-verify.json` and expect 0. The pattern is a prefix, not the key.
- [ ] **Step 6: No commit.**

## Task 6: Write the note

**Files:** Create `scripts/lib/linear/API-VERIFICATION.md`.

- [ ] **Step 1: Header.** Date of the check, workspace plan (Free, `acme`), endpoint, the script name and the command to repeat it. One sentence says the folder holds a verification tool and no adapter code yet. A line `Note path: scripts/lib/linear/API-VERIFICATION.md` is not needed in the note; the path is the file itself.
- [ ] **Step 2: Summary table** with the columns Feature, Answer, API object, Access, Plan, Verified by, Caveat, and these rows from the task 5 output:
  - Recurring issues: `yes`, `Issue.recurringIssueTemplate` (`Template`), `read`, caveat "schedule and rules are not in the API".
  - Dependencies between projects: `yes`, `ProjectRelation`, `projectRelations`, `projectRelationCreate`/`Update`/`Delete`, `read/write`.
  - Releases: `yes`, `Release`, `ReleasePipeline`, `ReleaseStage`, `releases`, `releasePipelines`, `releaseCreate`, `releaseComplete`, `issueToReleaseCreate`, `Issue.releases`, `read/write`.
  - Insights: `no`, no type, query or mutation matches `insight`, `analytic` or `metric`. Caveat: PMK-33 treats `native_metrics` as `derived`.
  
  The Plan and Verified by cells say `schema, live read, docs` or `schema, docs` as the evidence shows. Write access is never marked `live` because no write ran.
- [ ] **Step 3: One section per feature** with the matched names from the script output, the live query result, the docs page and date, and the reason for the answer under the spec's answer rules.
- [ ] **Step 4: A section "Paid-plan features on a Free workspace"** with the four-step order from the spec, and a section "Repeat the check" with the command and the comparison to make on another workspace.
- [ ] **Step 5: Review against the criterion.** Four rows, each `yes` or `no`, none `unverified`. Each `yes` row names an object that appears in the script output. Run `grep -n "unverified" scripts/lib/linear/API-VERIFICATION.md` and expect no table row with it. Check the text against the unslop rules (no em dash, no filler).
- [ ] **Step 6: Commit.** `docs(linear): record the API check for four features (PMK-29)`.

## Task 7: Verify

- [ ] **Step 1:** `npm test` passes, including `scripts/lib/linear/verify-api.test.mjs`, and makes no network call (the test uses a fake `fetch`).
- [ ] **Step 2:** `git diff main --stat` lists only the three files in `scripts/lib/linear/`, the spec and this plan. `package.json` is not in it.
- [ ] **Step 3:** `git grep -n "lin_api_\|LINEAR_API_KEY"` shows the key name only in the script, its test and the docs, and no key value.
- [ ] **Step 4:** Use `superpowers:verification-before-completion`, then hand over to delivery (step 9 of `/pmkit:issues:work`).

## Self-review

- Criterion coverage: the map above gives every criterion at least one task.
- Order: tests come before code in tasks 1 to 4. Tasks 5 and 6 need the script from task 4.
- Placeholders: none. The answers in task 6 come from the spec's observed list and are confirmed in task 5.
- Risk: if task 5 differs from the observed list, the note follows the live output and the report says so.
