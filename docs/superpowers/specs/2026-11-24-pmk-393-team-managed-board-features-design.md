# PMK-393: read team-managed board features in the Jira manifest

Issue PMK-393 (EPC-14, bug), found live in PMK-366, blocks PMK-370. Written on 2026-11-24 by a dispatched worker; the owner's answers come through the coordinator.

## Intent

A team-managed Jira space turns sprints, estimation and releases on per board feature, and its one board stays `type: simple` whatever is on. pmkit reads only the board type, so on every team-managed space `cycles` is `absent` (hint "Sprints need a Scrum board"), the sprint filter and sprint reads have no board, and `releases` is `native` even with the Releases feature off. Make the manifest, and the board pmkit reads sprints from, follow the board features on a team-managed space, so PMK-370 can check sprints live on Kudos.

## Acceptance criteria (from the issue)

1. On a team-managed space, `releases`, `cycles` and `estimation` follow the board features (an optional read that warns when refused).
2. The `cycles` hint on a team-managed space names the Sprints feature, not a Scrum board.
3. Checked live with sprints on in a team-managed space, and `CONTEXT.md` "Scrum board" matches what was seen.

## Root cause

Live probe of Kudos on 2026-11-24 (read-only): `GET /rest/agile/1.0/board?projectKeyOrId=KAN` gives one board, `type: simple`. `GET /rest/agile/1.0/board/1/features` gives 21 entries `{ feature, state: ENABLED|DISABLED, localisedName, ... }`, among them `jsw.agility.sprints ENABLED`, `jsw.agility.estimation ENABLED`, `jsw.agility.releases DISABLED`, `jsw.agility.backlog ENABLED`. `GET /board/1/configuration` has `estimation.field.fieldId: customfield_10016` (`Story point estimate`, global, `jsw-story-points`); the global `Sprint` field (`gh-sprint`) exists. The board has no sprints.

Three places decide "this space has sprints" from `board.type === 'scrum'` alone:

- `manifest.mjs` `cycles()`: absent unless `raw.board.type === 'scrum'`.
- `issues.mjs` `makeContext`: `boardId` is null unless the board is `scrum`; `filter.mjs` `sprintUnsupported`, `tracker.mjs` `sprints()` and the cycle operations then see no board.
- `filter.mjs` repeats the "Scrum board" hint.

`releases` is `native` unconditionally, and the `estimate` role takes the board's estimation field or any `jsw-story-points` field, which on a team-managed site exists globally once any space turned estimation on, whatever this space's feature says.

## Approaches

- **A. Read the features on a team-managed space, and route every "has sprints" question through one predicate (chosen).** Discovery reads `/board/{id}/features` as an optional read only when the space is team-managed and has a board, and keeps three booleans on `raw.board.features`. One exported predicate, `sprintsOn(raw)`, answers "the board serves sprints": the Sprints feature when features were read, else `type === 'scrum'`. `cycles()`, `makeContext` (`boardId`) and the filter hint use it. Company-managed spaces keep today's rules exactly.
- B. Read the features on every space. A company-managed board answers `/features` too, but what its toggles mean there is unchecked and no company-managed space is available live (owner decision). Changes behaviour we cannot verify; rejected.
- C. Treat any team-managed board with the global Sprint field as having sprints. Wrong: the field is global, so a space with Sprints off would claim sprints. Rejected.

## Design (approach A)

- `discovery.mjs`: after `readBoard`, when `space.style === 'team-managed'` and a board was read, `optional(() => readFeatures(client, board.id), 'board features', unread)` sets `board.features = { sprints, estimation, releases }` (each `state === 'ENABLED'`). Refused or failed: `features` stays absent and discover warns "Jira refused to read the board features (CODE); sprints, estimation and releases are judged without them". A missing feature key in the answer reads as off.
- `sprintsOn(raw)`, exported from `discovery.mjs`: `raw.board?.features ? raw.board.features.sprints : raw.board?.type === 'scrum'`.
- `manifest.mjs`:
  - `cycles`: `!sprintsOn(raw)` gives absent with `Turn on Sprints in space KEY's features` on a team-managed space and today's Scrum board hint otherwise.
  - `releases`: absent with `Turn on Releases in space KEY's features` when `raw.board?.features?.releases === false`, else `native` as today.
  - `estimation`: follows the `estimate` role, which already decides it.
- `discovery.mjs` `ROLE_RULES.estimate`: no inferred field when `raw.board?.features?.estimation === false`. A mapped field (ADR 0014) still wins, as for every role. So `discover`'s `fields.estimate`, the manifest's `estimation`, and the issue reads and writes all follow the feature from one place.
- `issues.mjs` `makeContext`: `boardId: sprintsOn(raw) ? raw.board.id : null`.
- `filter.mjs` `sprintUnsupported`: same hint as the manifest for a team-managed space (it reads `context.raw.space.style`).
- The discovery cache: `raw.board.features` is part of the raw discovery, so it is cached with it, and `capability(..., { refreshIfAbsent })` re-reads once, as for other settings.
- `CONTEXT.md`: "Scrum board" becomes "Sprint board" (a company-managed space's first Scrum board, or a team-managed space's one board with its Sprints feature on; the board stays `simple`), and "Board feature" is a new term. Approved in the interview (Q5).
- Comments naming "the space's Scrum board" in `cycle-ops.mjs` and `tracker.mjs` say "the space's sprint board" instead.
- Fakes: `scripts/fake-jira-api.mjs` `jiraSiteRoutes` gains a `features` option that serves `/board/{id}/features` for the team-managed variant.

## Tests (test-first)

- `discovery.test.mjs`: a team-managed space reads the features (three booleans); a company-managed space does not call `/features`; a refused features read (403) warns and leaves `features` out; estimation off leaves `estimate` null even with a `jsw-story-points` field; a mapped estimate still wins.
- `manifest.test.mjs`: team-managed `simple` board with Sprints on and a Sprint field is `cycles native`; Sprints off is absent with the Sprints-feature hint; Releases off is `releases absent` with its hint; company-managed unchanged.
- `issues.test.mjs` or `filter.test.mjs`: `boardId` is the `simple` board's id with Sprints on, null with Sprints off; the filter hint names the Sprints feature.
- E2E (C Check): the Jira runbook flows that touch capabilities and cycles (`docs/runbooks/discover-jira.md`, the cycles runbook if any) get a team-managed step on the fake.

## Live check

`scripts/lib/jira/client-live.mjs`, PMKIT_LIVE pattern, on Kudos (read-only):

- New test "a team-managed space's capabilities follow its board features": reads `/board/{id}/features` directly and checks `raw.board.features` matches, `cycles` is native iff Sprints is on (and the Sprint field exists), `releases` absent iff Releases is off, `estimation` absent iff Estimation is off. Skips with a reason on a company-managed space.
- The real CLI's `cycle list` in a `liveRepo` set up on the space answers without NOT_SUPPORTED when Sprints is on. No sprint is written (PMK-370 owns the sprint flows).
- One-off probe, recorded in this doc, not in the test: turn Releases on and off again, and Estimation off and on again, on Kudos's board (`PUT /rest/agile/1.0/board/1/features`), and read the manifest in each state, so both directions of each feature are seen. Kudos ends as found: Backlog, Sprints and Estimation on, Releases off.

## Non-goals

- Company-managed spaces and a token without admin rights: not checked live (owner decision), open in the PR.
- Gating Jira release writes (`release create`, `mark-released`) on the manifest. The CLI's release-notes and readiness flows already read the `releases` entry; the writes are not gated on any tracker but Linear. Left out; a follow-up in EPC-14 if the owner wants it.
- Sprint writes on a team-managed board (PMK-370).

## Interview

Questions put to the owner through the coordinator on 2026-11-24. The owner approved the design and answered yes to all five; on Q2, Kudos is restored exactly and any leftover site fields are reported; the Q3 follow-up goes in EPC-14.

- Q1. Approach A (features read on team-managed spaces only, one `sprintsOn` predicate). Recommended: yes.
- Q2. The one-off toggle probe on Kudos (Releases on then off, Estimation off then on, restored). Recommended: yes.
- Q3. Gating Jira release writes on the manifest: out of scope, follow-up in EPC-14. Recommended: file the follow-up.
- Q4. Features read refused on a team-managed space: fall back to the board type (so `cycles` absent, `releases` native, estimate by field) and warn. Recommended: yes.
- Q5. Rename the CONTEXT term "Scrum board" to "Sprint board" and add "Board feature". Recommended: yes; no ADR (easy to reverse).

## Left to the builder

- Exact wording of the UNREAD entry and of the hints, within the patterns above.
- Whether `sprintsOn` lives in `discovery.mjs` or `manifest.mjs` (discovery, since `issues.mjs` and `manifest.mjs` both import from it).
