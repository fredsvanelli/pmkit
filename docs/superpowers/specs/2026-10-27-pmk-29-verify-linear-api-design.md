# PMK-29 design: verify the Linear API for recurring issues, project dependencies, releases and Insights

Issue PMK-29, epic EPC-5 (Linear tracker adapter), milestone `linear`. Status: approved, with the user's answers applied in "Resolved questions". Calls marked **(builder's call)** were made while writing this spec and change no acceptance criterion.

## Problem

The Linear tab lists four features with a "verify" mark: recurring issues, dependencies between projects, releases and Insights. Open questions of the tab: "Verify in the API: recurring issues, dependencies between projects, releases and Insights exposure". The Unified model needs a yes or no for each one before PMK-33 builds the capability manifest of a Linear workspace and before PMK-30 and later issues write queries against objects that may not exist.

Acceptance criterion:

1. Each of the four has a yes or no with the API object that exposes it, recorded next to the Linear adapter.

The deliverable is a written note, plus the means to repeat the check. No adapter code is part of this issue.

## Goals

- A note with one row per feature: the answer (`yes` or `no`), the GraphQL object or field that exposes it, the operations it allows (read, write), the plan that gates it, and how the answer was verified.
- A script that repeats the read-only checks, so anyone can re-run them on another workspace (for example a Business one) and compare.
- A rule for how paid-plan features are verified from a Free workspace.

## Non-goals

- Any write to Linear. The brief for this stage does not authorize one.
- The Linear API client (PMK-30), config loading (PMK-31) and discovery (PMK-33).
- Mapping the four features to capability names in the manifest. PMK-33 does that from the note.
- Verifying other "(Business)" features such as SLAs, Initiatives or Triage Intelligence.

## Anti-goals

- No network access from `npm test`. The script is not named `*.test.mjs`, and no test imports it.
- No dependency in `package.json` (ADR-0003). The script uses the global `fetch` of Node 18+.
- The key never appears in the repository, in output, in a log or on a command line. The script reads `LINEAR_API_KEY` from the environment only.
- A `no` is never written because a query failed. A failure is `unverified` until the cause is known (see "Answer rules").

## Terms

- **Schema evidence.** The GraphQL introspection result (`__schema`, `__type`) shows the object, its fields and its mutations.
- **Live evidence.** A real query against the workspace returns a valid response (data or an empty list) instead of a schema or permission error.
- **Docs evidence.** The Linear documentation or changelog states the plan that gates the feature.

## Approaches

1. **Docs only.** Read Linear's documentation and changelog and write the answers. Cheap, but the Linear tab already cites a third-party page for facts that later changed, and the docs do not name API objects reliably. It cannot back a "yes" with an object name.
2. **Introspection plus read-only live queries, with a re-runnable script.** The script asks the schema for each feature's objects, then runs one list query per object to see whether the workspace answers. Docs evidence covers only the plan gate. Reads are free (Technical spec write policy) and the organization check is not needed for reads.
3. **Approach 2 plus live writes on a dedicated test team.** Creates a release, a project relation and a template, then reads them back and deletes them. It proves write support and plan gating on creation. It needs a brief that authorizes writes and a new team, and it risks side effects on a real workspace.

Chosen: approach 2. It answers "which API object exposes it" from the schema, which is what the criterion asks for, and needs no write. Approach 3 stays available for a later issue if the note leaves a gate in doubt (question 2, resolved as not now).

## Design

### Note

`Note path: scripts/lib/linear/API-VERIFICATION.md`

**Why there (builder's call).** The Linear adapter does not exist yet. Adapters live under `scripts/lib/<name>/`, as `scripts/lib/github/host.mjs` shows, and the Local tracker lives in `scripts/lib/local/`. The Linear adapter will therefore live in `scripts/lib/linear/`. The note sits in that folder and the folder is created by this issue with the note and the script. The name is upper case so it does not read as a module next to `client.mjs`, and PMK-30 and PMK-33 find it by listing the folder. No test reads the folder, so adding Markdown there breaks nothing; the builder confirms this by running `npm test`.

The note has three parts.

1. A header with the date of the check, the workspace plan (Free), the Linear API endpoint and the script name.
2. A summary table, one row per feature.
3. A section per feature with the evidence (the type names, the fields, the mutations, and the query that was run).

Summary table columns:

| Column | Content |
|---|---|
| Feature | One of the four names from the Linear tab |
| Answer | `yes` or `no` |
| API object | Type, query and mutation names, such as `Release`, `releases`, `releaseCreate` |
| Access | `read`, `write` or `read/write`, as the schema allows |
| Plan | The plan the docs say is needed, or `all plans` |
| Verified by | `schema`, `live read`, `docs`, in any combination |
| Caveat | One sentence, or empty |

### Answer rules

- `yes` needs an object in the schema and a successful read (live or, for a plan-gated feature, schema plus docs).
- `no` needs the schema to lack any object for the feature, checked by listing every query, mutation and type whose name matches the feature, and the docs to give no API route. Absence of a type is the proof, not an error from the server.
- A feature present in the schema but gated off for the workspace plan is `yes` with the plan in the Plan column and `schema, docs` in Verified by. The Answer column says whether the API exposes it. The Plan column says who can use it.
- A feature the schema exposes only as a read-only link, with no way to configure it, is `yes` with access `read` and the limit in Caveat.
- If neither schema nor docs settle it, the row says `unverified` and the cause. The acceptance criterion needs yes or no, so an `unverified` row is reported to the user as a blocker, never hidden.

### How each feature is checked

| Feature | Schema check | Live check |
|---|---|---|
| Recurring issues | Fields of `Issue` and `Template` that mention `recurring`; any mutation or type with `recurr` in its name | `templates` list, and `recurringIssueTemplate` selected on one issue |
| Dependencies between projects | `ProjectRelation` type, `projectRelations` query, `projectRelation*` mutations, and the relation type values | `projectRelations(first: 1)` |
| Releases | `Release`, `ReleasePipeline`, `ReleaseStage`, `issueToRelease*` mutations, the `releases` field on `Issue` | `releases(first: 1)` and `releasePipelines(first: 1)` |
| Insights | Any type, query or mutation whose name matches `insight`, `analytic` or `metric` | none when the schema lacks the object |

Observed while writing this spec (read-only introspection on the `acme` workspace, Free plan; the builder repeats it and records it in the note):

- Releases. `Release`, `ReleasePipeline`, `ReleaseStage`, `releases`, `releasePipelines`, `releaseCreate`, `releaseComplete`, `issueToReleaseCreate` and an `Issue.releases` connection exist. Both list queries answer on the Free workspace (empty lists). Expected `yes`, read and write. The plan that gates creation is not shown by a read.
- Dependencies between projects. `ProjectRelation` and `projectRelationCreate`, `Update` and `Delete` exist. `projectRelations` answers (empty list). The type has `anchorType` and `relatedAnchorType`, so a relation can also point at a milestone. The enum of `type` is not exposed under the name `ProjectRelationType`, so the builder reads the field's real type name. Expected `yes`, read and write.
- Recurring issues. `Issue.recurringIssueTemplate` (type `Template`) exists and is not deprecated. `Template` has `templateData` and no schedule field, and the schema has no `RecurringIssueTemplate` type and no mutation with `recurr` in its name. So the API shows the link from an issue to the template that created it, but not the schedule, and it cannot create a recurring rule. Decided (question 1, option a): `yes`, access `read`, caveat "schedule and rules are not in the API". The builder still checks the `Template.type` values and the docs and records them in the note; they can add to the caveat but not change the answer unless the schema shows a schedule field.
- Insights. The schema has no type, query or mutation matching `insight`, `analytic` or `metric`. Expected `no`. The consequence for PMK-33 is that `native_metrics` on Linear is `derived` from issue history, never `native`.

### Script

`scripts/lib/linear/verify-api.mjs` (builder's call on the name). It:

- runs the live checks only when `PMKIT_LIVE=1` is set, in the pattern of `scripts/scenarios-live.mjs`. Without it the script prints one line saying it skipped and exits with code 0, and sends nothing. Its name does not end in `.test.mjs`, so `npm test` never runs it live;
- with `PMKIT_LIVE=1`, reads `process.env.LINEAR_API_KEY` and exits with code 2 and a one-line message when it is missing, without printing any part of it;
- sends GraphQL over `fetch` to `https://api.linear.app/graphql`, with the key in the `Authorization` header only;
- runs the introspection and live queries of the table above and prints one JSON object per feature with `found` (types, fields, queries, mutations) and `live` (`ok`, `empty`, or the error code and message);
- prints `organization.urlKey` so the note records which workspace was checked;
- never writes: every operation is a query, and the script refuses to send a document that starts with `mutation`.

A small pure function builds the list of matching names from a `__schema` result, so a unit test can cover the matching without a network. The test lives in `scripts/lib/linear/verify-api.test.mjs`, uses a trimmed schema fixture inline, and makes no network call. The fetch call stays in a separate function the test never calls, and the script runs its main function only when it is the entry point, so importing it in the test starts nothing.

### Paid-plan features on a Free workspace

The workspace is on the Free plan. A feature gated by a paid plan is checked in this order.

1. **Schema.** Introspection lists every object regardless of the plan. If the object is missing here, the answer is `no` on every plan. If it is present, the API exposes it.
2. **Docs.** Linear's documentation says which plan unlocks it. Record the page and the date.
3. **Live read.** A list query on the Free workspace shows whether the server answers. An empty list proves the query is allowed. A permission or "feature not available" error proves a gate and goes into the Caveat.
4. **Live write.** Not done here. A write that depends on the plan (creating a release pipeline, for example) is `unverified live` and stays `schema, docs`. A later issue with a Business or trial workspace can confirm it with the same script (read) and a dedicated test team (write).

The Plan column and the Verified by column together tell PMK-33 how sure each answer is: `schema, docs` means "the API has it, the plan was not tried".

## Tests per criterion

| Criterion | Part of the design | Test or check |
|---|---|---|
| Each of the four has a yes or no | Summary table, "Answer rules" | Review of the note: four rows, each `yes` or `no`, none `unverified` |
| with the API object that exposes it | `API object` column and per-feature section | Review: each `yes` row names a type or field that the script output lists; the script output is quoted in the section |
| recorded next to the Linear adapter | `Note path` in `scripts/lib/linear/` | A check that the file exists at the path above; `npm test` still passes with the new folder |
| (support) the matching logic is right | Pure matching function | `verify-api.test.mjs` with an inline schema fixture, no network |
| (support) the script cannot write | Mutation refusal | `verify-api.test.mjs` asserts a `mutation` document is rejected before any call |

## Decisions

| Decision | Reason |
|---|---|
| Introspection plus read-only live queries | It names the API object, which the criterion asks for, and needs no write permission. |
| The note lives in `scripts/lib/linear/` | Adapters live under `scripts/lib/<name>/`. PMK-30 and PMK-33 build in the same folder and find the note there. |
| `no` needs schema absence, not a failed call | A server error may come from the plan or the key, and would give a false `no`. |
| The script is kept in the repository | Anyone can re-run it on a Business workspace and compare. It is outside the test glob and holds no key. |
| Answer column is `yes` or `no`, plan is a separate column | The criterion asks for yes or no. Mixing the plan into the answer would hide the object. |

## Risks

- The schema changes. Linear adds objects often (Releases appeared recently). The note records the date, and the script is the way to refresh it.
- Free-plan limits hide a gate. A list query can pass on Free and creation can still fail. The Verified by column says so, and the note does not claim write support from a read.
- Recurring issues have no clear API shape. The answer `yes` with access `read` is a judgment call (question 1), and the caveat states its limit.
- Introspection could be disabled for a key type or an OAuth app. The personal key works today; PMK-28's auth decision may change the credential, so the script is re-run once after it.
- `scripts/lib/linear/` holds a script before it holds an adapter. A reader may take it for adapter code. The note's header and the script's first comment say it is a verification tool.

## Resolved questions

1. **Recurring issues.** Option (a). `yes`, access `read`, caveat "schedule and rules are not in the API". PMK-33 can show which issues came from a recurring template and treats creating a recurring rule as absent.
2. **Proof of writes with a test team.** Option (a). None in this issue. Gated writes stay `schema, docs`. A later issue can add them with its own brief and a new team, never ACME.
3. **The script.** Option (a). `scripts/lib/linear/verify-api.mjs` stays in the repository with its offline unit test. The live run only reads and only runs with `PMKIT_LIVE=1`.
4. **The folder.** Option (a). `scripts/lib/linear/`, and the note is `scripts/lib/linear/API-VERIFICATION.md`.

## Left to the builder

- The exact field list per query, and the output layout of the script.
- The docs pages cited in the note.
- The wording of the caveats.

## Self-review

- Placeholders: none. The "Observed" list is evidence from a read-only check, and the builder repeats it before writing the note.
- Consistency: `yes` and `no` are the only answers in the criterion. `unverified` is a blocker state, never a delivered value.
- Scope: one Markdown note, one script, one unit test, no change to `package.json`, to the CLI or to the manifest.
- Risk to the brief: the note path is stated on its own line as `Note path:` for PMK-30 and PMK-33.
