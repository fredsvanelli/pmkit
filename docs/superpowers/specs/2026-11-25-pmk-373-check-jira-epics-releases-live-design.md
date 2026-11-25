# PMK-373: check the Jira epic, release and status-update flows against a live site

Issue PMK-373 (EPC-14, chore), follow-up of PMK-79. Written on 2026-11-25 by a dispatched worker; the owner's answers come through the coordinator.

## Intent

PMK-79 built the epic, status-update and release operations (`epic-ops.mjs`, `epics.mjs`, `releases.mjs`, the release filter in `filter.mjs`, `fixVersions` in `issues.mjs`) from Atlassian's documents and checked them only on the stateful fake (`scripts/fake-jira-issues.mjs`). Run the `epics-releases-jira` runbook's flows on the owner's site, settle each point the fake assumed (PMK-79 design, "Facts" and "Risks"), fix what differs, and leave a check that reruns in one line (the opt-in harness of PR #391, `scripts/lib/jira/client-live.mjs`, `PMKIT_LIVE`).

## Acceptance criteria (from the issue)

1. `epic create`, `list`, `get`, `progress`, `move` and `update` work on a real space with an Epic work type (company-managed and team-managed).
2. A comment created with properties keeps them, and `GET comment?expand=properties` returns them, so `epic updates` lists the status updates.
3. Version paging, `POST version`, `PUT version` released and `fixVersions [{ id }]` behave as the design assumes.
4. `fixVersion = "<id>"` matches by id, not by a version named like the id (else send the id unquoted).
5. Creating a release whose name an archived version holds, or that differs only in case, is mapped to `CONFLICT` or recorded.
6. Setting a release on an issue keeps or drops its archived fix versions as recorded.

## What a live probe found (2026-11-25)

Site: the owner's (host, email and token kept out of the repository, the PR and the issue). Space Kudos (KAN, id 10000, team-managed, Portuguese), empty before the probe: no work item, no version. Board 1 features: Backlog, Sprints, Estimation on; Releases off. Work types: Epic (level 1), Subtask (-1), Tarefa, História, Feature, Bug (0). Start date is `customfield_10015` ("Data de início", untranslated "Start date"); the target is `duedate`. The probe went through the raw client, turned Releases on for its version steps and off again, and deleted everything; Kudos is as found (no work item, no version, Releases off).

| Probe | AC | Live answer | Holds? |
|---|---|---|---|
| `POST /issue` of the Epic type with `duedate` and `customfield_10015` | 1 | created in `Tarefas pendentes` (category `new`), both dates kept; the epic workflow has five statuses, none needs a field on a transition | yes |
| `POST /issue/{key}/comment` with `properties: [{ key: pmkit.statusUpdate, value: { health } }]` | 2 | the answer carries no `properties`; `GET .../comment?expand=properties` returns `[{ key, value }]`; without `expand` the comment has no `properties` key | yes: pmkit reads them only through `expand` |
| `POST /version` while the Releases feature is off | 3 | 201: Jira makes versions whatever the feature says | recorded (pmkit's release writes are not gated, as PMK-393 left them) |
| `GET /project/KAN/version?maxResults=1` with four versions | 3 | offset page `{ startAt, maxResults, total, isLast, nextPage, values }`, archived versions included with `archived: true`; `client.paginate` with page size 1 reads all four | yes |
| `PUT /version/{id} { released: true, releaseDate }` | 3 | 200, the version with `released: true` and the date | yes |
| `fixVersions: [{ id }]` on create and on `PUT /issue` | 3 | accepted; the read returns full version objects | yes |
| A version named `10001` next to version id `10001`; `fixVersion = "10001"` and `fixVersion = 10001` | 4 | **both forms match both items**: the item in version id 10001 and the item in the version named `10001`. `fixVersion = "<name>"` matched only by name | **no** (see Fixes) |
| `POST /version` with a taken name, or the same name in another case | 5 | 400 `errors.name` "Já existe uma versão com este nome neste projeto."; pmkit answers `INVALID_INPUT` "Jira rejected the request: ..." in the site's language | **no** (see Fixes) |
| `POST /version` with an archived version's name, or that name in another case | 5 | 400 `errors.name` "Não é possível adicionar uma versão que foi arquivada..." (unarchive it first); pmkit answers `INVALID_INPUT` as above | **no** (see Fixes) |
| An item with live version L and archived version A; `PUT fixVersions [{ id: A }, { id: L2 }]`, then `[{ id: L3 }]` without A, then `[{ id: A }, { id: L3 }]` | 6 | A stays in every case: **Jira keeps an archived fix version even when the write leaves it out**, and re-sending it adds no duplicate | recorded: pmkit's keep (PMK-79 follow-up fix) is harmless and stays |

## Approaches

- **A. One more live test in `client-live.mjs`, running the real CLI on Kudos (recommended).** The PMK-367 and PMK-370 pattern: `liveRepo`, `init` with every recommendation, then the runbook's commands, each answer checked against Jira's raw answers (`client().request`). Every work item and version the run makes is recorded and deleted in `finally`; the Releases feature, when off, is turned on for the run and off again in `finally` (task rule; see Q1). Opt-in, so `npm test` does not run it.
- **B. Drive `epicOperations` and `releaseOperations` directly.** Fewer moving parts, but the ACs name the CLI commands and the runbook documents them. Rejected.
- **C. A new live harness.** The task says reuse PR #391's. Rejected.

A.

## Design (approach A)

### Live test, in `client-live.mjs`

`test('epic, status update and release flows on the throwaway space', { skip: NEEDS_SPACE })` (PMK-373). It skips with a reason when the space has no epic-level work type. Steps:

1. **Before.** The space's version ids (raw paged read) and, on a team-managed space, the Releases feature state (raw `GET /board/{id}/features`). When Releases is off, `PUT /rest/agile/1.0/board/{id}/features { boardId, feature: 'jsw.agility.releases', enabling: true }` and remember to turn it off.
2. **Setup and capabilities.** `liveRepo`, `init` with every recommendation; `capabilities`: `deliverables` native, `releases` native, `status_update` derived from comments.
3. **Epic create.** `epic create --title ... --start <today> --target <today+30> --description-file ... --dry-run`: `after.id` null, `after.status` the Epic type's first status; no epic with the run's word exists (raw search). The real run: raw item of the epic-level type, Start date field and `duedate` as sent, `epic.url` ends in `/browse/<key>` (AC 1).
4. **Children and reads.** `issues create` X (feature), `issues parent X <epic>`; raw X's `parent` is the epic. `issues list` (retried: the index trails) lists X and not the epic (ADR 0017); `epic list` lists the epic; `epic get` matches the create; `epic progress`: `total` 1, `done` 0, `open` [X] (AC 1).
5. **Update.** `epic update --title-file`: `after.title`, raw `summary` (AC 1).
6. **Status updates.** `epic update-status <epic> --health at_risk --body-file`: `after.health` at_risk, `after.author` the viewer. Raw `GET comment?expand=properties`: one comment with `pmkit.statusUpdate` `{ health: 'at_risk' }`, text starting `Status update: At risk`. A plain comment posted through the raw client: `epic updates` lists only the update; `epic get` health at_risk (AC 2).
7. **Move.** `epic move <epic> in_progress`: raw status category `indeterminate`; `epic move <epic> done`: raw category `done`, `epic get` has no health (AC 1).
8. **Release create.** `release create R --target <date> --dry-run`: no new raw version; the real run: raw version named R, `releaseDate`, `released: false`; `release list` and `release get R` show it (AC 3).
9. **Name-alike.** A version named like R's Jira id (raw `POST /version`), and work item Y in it (raw `PUT fixVersions`). `issues update X --release R`: raw X `fixVersions` holds R's id. `issues list --release R` and `release issues R` list X only (retried) (AC 4: fails before the fix).
10. **Conflicts.** `release create` R in upper case: `CONFLICT`. An archived version (raw create, put on Y next to the name-alike, archive): `release create` with its name: `CONFLICT`; no version was added (AC 5).
11. **Archived fix version.** `issues get Y` shows `release` the name-alike only. `issues update Y --release none`: raw Y holds the archived version only; `issues update Y --release <the name-alike>`: raw Y holds both again (AC 6).
12. **Paging.** `client.paginate` of the space's versions with page size 1 reads as many as the full read, archived included; `release list` leaves the archived one out (AC 3).
13. **Mark released.** `release mark-released R --dry-run`: raw still `released: false`; the real run: `after.state` released, `released` `<today>T12:00:00Z`; raw `released: true`, `releaseDate` today (AC 3). `unfinished` lists X, which is open.
14. **Cleanup** (`finally`): delete the work items with `removeAll`, then every version not in step 1's list, then turn Releases off when step 1 turned it on, then check each is gone. Each key and version id is printed (`t.diagnostic`) as soon as it exists.

Output prints keys, ids and counts only; `scrub`, `hostless` and `assertNoSecret` cover every answer.

### Fixes

Test-first, in this PR.

- **The release filter is exact (AC 4).** Jira's `fixVersion = <id>` (quoted or not) also matches a version whose name is that id, so `issues list --release R` and `release issues R` can list another release's items. The JQL keeps the id clause as a superset, and a client step `release` keeps the issues whose `release`/`releases` hold the filter's name (names are unique per space). `filter.test.mjs` and `issue-ops.test.mjs` first; the fake's `fixVersion =` matches by id or by name, as the site does. This settles PMK-398 too: the quoted id does find the version's items.
- **A taken name is `CONFLICT` (AC 5).** `createRelease` checks every version of the space, archived ones included, case-insensitively, before the `POST`: a live version with the same name in another case is `CONFLICT` "release <id> is taken by version <name>, which differs only in case" (next step `pmkit release get <name>`); an archived version is `CONFLICT` "release <id> is taken by archived version <name>" (next step "Unarchive or rename version <name> in Jira"). The exact live match keeps today's message. `releases.test.mjs` first; the fake's `POST /version` refuses those names with 400 as the site does.
- Any other difference the live run finds, likewise.

### Docs

- `docs/runbooks/epics-releases-jira.md`: the live-check line records the run, what passed and what was skipped; failure rows for the two `CONFLICT` cases; a step for the name-alike release filter (verified by `scripts/runbook-epics-releases-jira.test.mjs` on the fake); notes that Jira makes versions with the Releases feature off and keeps archived fix versions on any write.
- PMK-79 design: no edit (history). No new ADR (the `CONFLICT` mapping and a client step are reversible). No new `CONTEXT.md` term; the Release entry says a Jira release name is unique in the space whatever its case, archived versions included (Interview Q4).

## Goals, non-goals, anti-goals

- Goals: each AC checked live or skipped with its reason; any difference fixed test-first; the result recorded on PMK-373 and in the runbook.
- Non-goals: company-managed space and non-admin token checks (owner's decision, open in the PR); Atlassian Home updates (PMK-372); gating release writes on the Releases feature (PMK-393 left it to the owner).
- Anti-goals: a write outside Kudos; anything left on Kudos, or Releases left on; the host, email, token or account in the repository, the PR or the issue.

## Check (SPEC-SS C)

`scripts/runbook-epics-releases-jira.test.mjs` (with the new step), the other Jira runbook tests, then `client-live.mjs` on the live site.

## Open questions for the owner

- **Q1. Releases on inside the test.** The rerunnable test turns Releases on when it finds it off and off again in `finally` (recommended: the run then sees `releases native` as a user with Releases on would, and leaves the board as found), or the test runs the release steps with the feature as found (Jira makes versions anyway) and the toggle stays a one-off by hand.
- **Q2. PMK-398.** This PR settles it (the quoted id finds the version's items; the real gap is the name-alike, fixed here). Close PMK-398 as a duplicate of PMK-373 once this PR merges (recommended), or leave it open.
- **Q3. Archived fix versions.** Jira keeps them on any write, so pmkit's re-sending of archived ids (`archivedVersionIds`) is redundant on this site. Keep it (recommended: company-managed is unchecked and the code is three lines), or delete it.

## Interview

Answered on 2026-11-25 by the coordinator; the design is approved.

- Q1: yes. The live test turns Releases on when it finds it off and off again in `finally`.
- Q2: yes. PMK-398 is linked as a duplicate of PMK-373 and closed (canceled) in this PR.
- Q3: yes. pmkit keeps re-sending archived fix version ids; recorded only.
- Q4: yes. `CONTEXT.md` Release gains the uniqueness rule; no new ADR. Release writes with Releases off stay ungated, recorded only.

## Left to the builder

Assertion wording, the retry interval, the names of versions and work items, and the error wording within the shapes above.

## Result

Run on 2026-11-25 against the owner's Jira Cloud site (host kept out of the repository, the PR and the issue), space Kudos: `PMKIT_LIVE=1 PMKIT_LIVE_JIRA_SITE=<host> PMKIT_LIVE_JIRA_SPACE=<key> node --test scripts/lib/jira/client-live.mjs`, exit 0, 15 pass, 3 skip (scoped token, company-managed space, limited token: as before). No output held the token, the email or the host. Kudos after the run: no work item, no version, no sprint added, Releases off again (Backlog, Sprints, Estimation on, as found).

| Check | AC | Result |
|---|---|---|
| `epic create` (dry run, real run with Start date and due date), `issues parent`, `issues list` without the epic, `epic list`, `get`, `progress`, `update`, `move` to in progress and done (health dropped) | 1 | **fail, then pass after the fix**: the dry run showed `Em análise` (an in-progress status) while Jira made the epic in `Tarefas pendentes`. Jira's statuses list is not in workflow order, and both `epic create` and `issues create` dry runs took its first entry; they now take the type's first To Do-category status (fake and runbook serve To Do last, as the site does). Team-managed only: company-managed skipped (owner's decision), open in the PR |
| `epic update-status` is a comment whose `pmkit.statusUpdate` property Jira keeps and returns with `expand=properties`; a plain comment is not listed by `epic updates`; `epic get` reads the health | 2 | pass |
| Version paging (page size 1, archived included), `release create` (dry run sends nothing), `release list` and `get`, `issues update --release` sends `fixVersions [{ id }]`, `release mark-released` (dry run sends nothing; real run `released: true`, today's date) | 3 | pass |
| A version named like the release's id: Jira's `fixVersion = "<id>"` returns both versions' items | 4 | **fail, then pass after the fix**: `release issues` listed the name-alike's item; a client step now keeps only the release's own. PMK-398 closed as a duplicate (the quoted id does find the version's items) |
| `release create` with the name in another case, or an archived version's name | 5 | **fail, then pass after the fix**: Jira's 400 came back as `INVALID_INPUT` in the site's language; now `CONFLICT` before any write |
| An archived fix version on an item through `issues update --release` and `--release none` | 6 | pass: Jira keeps it on every write, pmkit shows only the live one |
| PMK-364, PMK-366, PMK-367, PMK-368, PMK-370 and PMK-393 checks, rerun | — | pass |

Also recorded: Jira makes versions while the Releases feature is off (release writes stay ungated, Interview Q4).
