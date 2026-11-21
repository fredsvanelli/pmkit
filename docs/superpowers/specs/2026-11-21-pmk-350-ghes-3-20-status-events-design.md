# PMK-350: read Status change events from GHES 3.20

Issue: PMK-350 (EPC-8, feature). Found by PMK-335 (PR #327), whose schema validation (`docs/specs/2026-11-18-pmk-335-github-live-checks-design.md`, "One fact did not lead to a change") saw `ProjectV2ItemStatusChangedEvent` in the published GHES 3.20 schema.

## Intent

On GHES 3.20 pmkit reads no Status change events, so `issues get --history` and the flow metrics see moves only as opens and closes, and warn so, though the host can answer them. Turn them on from 3.20.

## Today

- `hostFeatures` in `scripts/lib/github/documents.mjs`: `statusEvents: compareVersions(ghesVersion, '3.21') >= 0`. It gates the `PROJECT_V2_ITEM_STATUS_CHANGED_EVENT` item type (`ITEM_TYPES`), the `ProjectV2ItemStatusChangedEvent` fragment of the history read, and the warning `STATUS_WARNING` in `scripts/lib/github/history-ops.mjs` ("on GitHub Enterprise Server before 3.21, ...").
- The fake GitHub (`scripts/fake-github-issues.mjs`) takes `features` from the same `hostFeatures`, so it refuses the fragment and the enum value below whatever threshold the adapter has. A wrong adapter threshold cannot fail a test. PMK-335 kept the other schema facts apart from `hostFeatures` (`repositoryIssueFields`, `!ghes`) for that reason; Status events were left on `hostFeatures`.

## Goals, non-goals, anti-goals

- Goal: GHES 3.20 and later read Status change events; history and flow metrics use them, with no warning.
- Goal: GHES 3.19 still gets no Status event document and the warning, and the fake refuses the document there on its own schema fact.
- Non-goal (issue): issue fields on GHES (stay 3.22); GHES 3.19 Status events (its schema has none).
- Anti-goal: a document pmkit sends to GHES 3.20 that the published 3.20 schema rejects.

## Approaches

1. **Change the threshold to 3.20, and give the fake its own schema fact (chosen).** `hostFeatures` reads `'3.20'`. The fake gets `statusEventsSchema = !ghes || version unknown || version >= 3.20`, used by `schemaError` for the fragment and the enum value and by the Status move that records the event, in place of `features.statusEvents`. A test pins that the fake on 3.19 refuses both, and on 3.20 accepts both, whatever `hostFeatures` says.
2. **Change only the threshold.** One line, but the fake keeps following the adapter, so the 3.19 acceptance criterion would be tested against the adapter's own belief. Rejected.

## Design

- `scripts/lib/github/documents.mjs`: threshold `'3.20'`; the doc comment says "Status events from 3.20".
- `scripts/lib/github/history-ops.mjs`: `STATUS_WARNING` says "before 3.20". The two tests that copy the string (`history-ops.test.mjs`, `cli-issues-github.test.mjs`) and the issues runbook line (`docs/runbooks/issues-github.md`, step on history) follow.
- `scripts/fake-github-issues.mjs`: `statusEventsSchema` as above, beside `repositoryIssueFields`, with the comment naming the published schemas.
- ADR 0007: a dated amendment (2026-11-21, PMK-350): Status change events from GHES 3.20, with the schema evidence.
- Schema validation (one-off, outside the repository, as PMK-335 did): the GHES 3.19 and 3.20 schemas from `github/docs` and graphql-js in a scratch folder. Every document the history and flow-metrics reads send on 3.20 (collected from the fake) validates against 3.20, and the 3.19 documents against 3.19. The result goes in this doc under "Validation".

## Tests

- `documents.test.mjs`: `hostFeatures` on 3.19.x has `statusEvents: false`, on 3.20.0 `true`.
- `fake-github-issues.test.mjs`: a GHES 3.19 fake refuses the fragment and the enum value; 3.20 accepts both.
- `history-ops.test.mjs` / `cli-issues-github.test.mjs`: a GHES 3.20 tracker reads a Status move in the history with no warning; 3.19 keeps the warning and sends no event type.
- E2E: the issues runbook's history step text (3.20). The existing runbook test runs on github.com; no new runbook step unless the runbook already has a GHES history step.

## Left to the builder

Names; which existing GHES test gains the 3.20 case.

## Interview

Pending.
