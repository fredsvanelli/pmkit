# PMK-366: check Jira discovery and the manifest against a live site

Issue PMK-366 (EPC-14, chore), follow-up of PMK-76. Written on 2026-11-24 by a dispatched worker; the owner's answers come through the coordinator.

## Intent

PMK-76 built `discover` and `capabilities` for Jira from Atlassian's OpenAPI documents and checked them only against the fake site (`scripts/fake-jira-api.mjs`, `jiraSiteRoutes`). The owner now has a Jira Cloud site and a token (PMK-364). Run discovery and the manifest on that site, record what holds, fix the rules and the fake where the site answers differently, and leave a check that reruns in one line.

## Acceptance criteria (from the issue)

1. `discover` runs on a company-managed space and on a team-managed space; `style`, work type levels and status categories match the site.
2. The field-role rules (board estimation field, `jsw-story-points`, `gh-sprint`, `duedate`, `Start date`) find the right field on both styles, or the rules are corrected.
3. The license, `configuration` and board reads match the documented shapes, and a token without admin rights still discovers with warnings.

## What a read-only probe found (2026-11-24)

Site: the owner's Jira Cloud site (host kept out of the repository, the PR and the issue). Token: the owner's, loaded at run time, never printed. `pmkit discover --json` and `pmkit capabilities --json` ran without error on the Kudos space.

| Read | Live answer | Matches the code and the fake? |
|---|---|---|
| Spaces | One space only: Kudos, `projectTypeKey: software`, `style: next-gen`, `simplified: true` | yes: `team-managed`. **No company-managed space exists on the site.** |
| Work types | Epic (1), Subtask (-1), and four at 0 (Tarefa, História, Feature, Bug), each with `scope.project.id` of the space | yes: levels `epic`, `subtask`, `standard` |
| Statuses | 5 statuses, `statusCategory.key` `new`, `indeterminate`, `done`; each also carries `untranslatedName` and most carry `scope` | categories yes. Names are the site language's (`Tarefas pendentes`, untranslated `To Do`) |
| Fields | 51 fields. Every `name` is in the site's language (Portuguese); each custom field carries `untranslatedName` (`Data de início` / `Start date`). No `jsw-story-points` and no `gh-sprint` field exists on the site | **bug**: the `start_date` rule matches `name` only, so it finds nothing on a non-English site |
| License | `applications: [{ id: 'jira-software', plan: 'FREE' }]` | yes: `plan.software: free` |
| Configuration | `issueLinkingEnabled`, `subTasksEnabled`, `timeTrackingEnabled`, `timeTrackingConfiguration` | yes |
| Boards | One board, `type: simple` (the team-managed board); its configuration has no `estimation` key | the code reads it (`estimationField: null`); the fake has only `scrum`/`kanban` boards with estimation |
| Board features (`GET /rest/agile/1.0/board/{id}/features`, not read by discovery) | `jsw.agility.sprints`, `jsw.agility.estimation` and `jsw.agility.releases` all `DISABLED` | see "Team-managed features" below |
| Token rights | `mypermissions`: the owner's token has `ADMINISTER` | no non-admin token exists to check AC 3's second half |

Result of `discover` on Kudos: `style team-managed`, levels and categories right, fields `priority`, `target_date` (`duedate`), `assignee`, `time_spent` found; `estimate`, `sprint` and `acceptance_criteria` `null` (no such field on the site, which is right); `start_date` `null` (wrong: `customfield_10015`, `Data de início`, untranslated `Start date`, is on the space's create screen).

`capabilities` on Kudos: `cycles` absent with "Sprints need a Scrum board in space KAN", `estimation` absent, `releases` **native**, `time_tracking` native.

## Root cause of the bug

`named()` in `discovery.mjs` compares `field.name.toLowerCase()` with English names. Jira localizes `name` to the site's (or the token owner's) language and keeps the English one in `untranslatedName`. So on any non-English site the name rules (`start_date`, `acceptance_criteria`, the third `estimate` fallback) miss. Fix: keep `untranslatedName` in the raw field and match `untranslatedName ?? name`. The system-id and custom-type rules are language-free and held.

## Team-managed features (found live, outside the ACs)

A team-managed space switches sprints, estimation and releases per board feature. On Kudos all three are off, and:

- `releases` reports `native`, but the space's create screen has no `fixVersions` field, so setting a release would fail. The manifest claims a path the space does not allow.
- `cycles` is rightly `absent`, but its hint says "Sprints need a Scrum board"; a team-managed board is `simple` and the fix is "turn on Sprints in the space's features". Whether a team-managed board's `type` becomes `scrum` once sprints are on is unknown: if it stays `simple`, `cycles` is `absent` on every team-managed space even with sprints on.
- `estimation` is rightly `absent`.

Checking the sprints case needs turning sprints on in Kudos, which makes Jira create the site's `Sprint` field (global, `gh-sprint`) and a `Story point estimate` field scoped to Kudos. Turning sprints off again does not remove them. Open question Q3.

## Approaches

- **A. Extend the PMK-364 harness `scripts/lib/jira/client-live.mjs` with discovery checks, fix the name rule test-first, and make the fake match the shapes seen (recommended).** The coordinator asked to reuse that harness. New tests run discovery through the real tracker (`createJiraTracker`) on `PMKIT_LIVE_JIRA_SPACE` and compare it with the raw reads (style with `project.style`, each level with `hierarchyLevel`, each category with `statusCategory.key`, each found role field with its system id, custom type or untranslated name, and the license, configuration and board shapes). A second space (`PMKIT_LIVE_JIRA_COMPANY_SPACE`) and a limited token (`PMKIT_LIVE_JIRA_LIMITED_EMAIL`, `PMKIT_LIVE_JIRA_LIMITED_TOKEN`) are optional and skip with their reason. The fake gains `untranslatedName` and localized names as an option, and a `simple` team-managed board without estimation. About 120 lines.
- **B. Record only.** Run the scratch probe, record the table, fix the rule. Nothing reruns, which is how PMK-76's gap appeared.
- **C. A separate `discovery-live.mjs`.** Same checks, a second file with the same skip and secret helpers; duplicates PMK-364's harness for no gain.

A.

## Design (approach A)

### Fix

- `fetchDiscovery` keeps `untranslatedName` on each raw field (`untranslated`, null when Jira sends none).
- `named()` matches `(field.untranslated ?? field.name).toLowerCase()`, then `field.name` (a site that renames a field still matches on its English name or its shown one).
- Unit test first in `discovery.test.mjs`: a site whose fields are in Portuguese with `untranslatedName` finds `start_date`, `acceptance_criteria` and the named `estimate` fallback.

### Fake

`jiraSiteRoutes({ locale: 'pt' })` (builder's call on the option name): field and status names in Portuguese with `untranslatedName`, statuses with `scope` for a team-managed space. `jiraSiteRoutes({ style: 'team-managed', board: 'simple' })`: one `simple` board whose configuration has no `estimation`. Defaults unchanged, so no existing test moves.

### Live checks added to `client-live.mjs`

| Test | Needs | Asserts |
|---|---|---|
| discover the throwaway space | `PMKIT_LIVE_JIRA_SPACE` | `discover` returns `auth` first; `space.style` matches the project's `style`/`simplified`; each work type's level matches its `hierarchyLevel`; each status's category matches its `statusCategory.key` (no mapping); no warning but the ones the site explains |
| the field-role rules on the throwaway space | same | each role found is the field the rule names (system id, custom type, or untranslated name); a role is `null` only when no such field exists on the site |
| the license, configuration and board shapes | same | license `applications[]` with `jira-software` and a plan in `FREE`/`PAID`/`UNLICENSED`; configuration booleans; boards `type` in `scrum`/`kanban`/`simple` and the configuration's `estimation` present or absent |
| capabilities on the throwaway space | same | 20 entries, the `plan`, and each path the probe saw |
| discover a company-managed space | `PMKIT_LIVE_JIRA_COMPANY_SPACE` | same as the first test; skipped with its reason when unset |
| a token without admin rights discovers | `PMKIT_LIVE_JIRA_LIMITED_EMAIL`, `PMKIT_LIVE_JIRA_LIMITED_TOKEN` | `mypermissions` says no `ADMINISTER`; `discover` passes, warnings name what it could not read; skipped when unset |

All reads; no write. Output prints counts and ids, never the host, the email, the token or account names.

### Docs

`docs/runbooks/discover-jira.md`: the live-check line names the run and what stayed skipped, and a note that field and status names follow the site's language (`mappings.status` takes the names as the site shows them).

## Goals, non-goals, anti-goals

- Goals: each AC checked live or skipped with its reason; the name-rule bug fixed test-first; the fake matching the shapes seen; the result recorded on PMK-366.
- Non-goals: reading team-managed board features in the manifest (Q2); `issues.mjs` choosing the default work type by the English name `Task` (falls back to the first standard type, which is right on Kudos; a follow-up if Q2 says so).
- Anti-goals: a write outside Kudos without the owner's OK; anything left in Kudos; the token, the email, the site host or the account in the repository, the PR or the issue.

## Check (SPEC-SS C)

The fix changes what `discover` returns for `start_date` on a non-English site: a step in `docs/runbooks/discover-jira.md` and `scripts/runbook-discover-jira.test.mjs` with `locale: 'pt'`. Then the Jira runbook tests, and `client-live.mjs` against the live site.

## Open questions for the owner

- **Q1. Company-managed space (AC 1, AC 2).** The site has none. (a) The owner creates a throwaway company-managed software space (Scrum template), gives its key, and deletes it after; (b) I create and delete one through the API (a write outside Kudos); (c) skip, open in the PR. Recommend (a), else (c).
- **Q2. Team-managed features.** `releases` reports `native` on a space whose Releases feature is off. (a) Fix here: read the board's features (optional read) and make `releases`, `cycles` and `estimation` follow them on team-managed spaces; (b) a follow-up in EPC-14 with this evidence. Recommend (b): it touches PMK-78/PMK-79 behaviour and needs Q3's experiment to get `cycles` right.
- **Q3. Turn sprints and estimation on in Kudos.** The only way to check the `gh-sprint`, `jsw-story-points` and board-estimation rules live, and whether a team-managed board turns `scrum`. Jira then creates the global `Sprint` field and a Kudos-scoped `Story point estimate` field, which stay after turning the features off. (a) Do it and turn them off after, accepting the leftover fields; (b) skip, open in the PR. Recommend (a) if leftover fields are acceptable.
- **Q4. Token without admin rights (AC 3).** The owner's token is a site admin. (a) The owner provides a token of a non-admin user with access to Kudos; (b) skip, open in the PR (the unit tests already cover refused optional reads). Recommend (b) unless a second user exists.

## Left to the builder

The exact wording of assertions and diagnostics; the fake's Portuguese strings.

## Interview

Answered on 2026-11-24 by the coordinator on the owner's behalf; the design is approved.

- Q2: yes, a follow-up in EPC-14 holds the team-managed features (releases, cycles hint, the `simple` board), with this doc's evidence.
- Q4: yes, the limited-token check is skipped and open in the PR. The harness keeps the optional test, which skips with its reason.
- Q1 and Q3: with the owner. Everything else goes ahead; the company-managed check and the sprints/estimation experiment wait for the owner's answer. Until then the harness test for a company-managed space skips when `PMKIT_LIVE_JIRA_COMPANY_SPACE` is unset.
- No new `CONTEXT.md` term and no ADR: the fix follows ADR 0014 (roles map by id; names are only the inference fallback). The "Scrum board" entry's mismatch with team-managed boards goes to the Q2 follow-up.

## Result

Run on 2026-11-24 against the owner's Jira Cloud site (host and space key kept out of the repository, the PR and the issue), space Kudos (team-managed, site language Portuguese): `PMKIT_LIVE=1 PMKIT_LIVE_JIRA_SITE=<host> PMKIT_LIVE_JIRA_SPACE=<key> node --test scripts/lib/jira/client-live.mjs`, exit 0, 10 pass, 3 skip. No output held the token or the email. Kudos holds no work item after the run (approximate count 0).

| Check | AC | Result |
|---|---|---|
| discover the throwaway space: style, work type levels, status categories | 1 | pass: `team-managed`; levels epic, subtask, standard match `hierarchyLevel`; 5 statuses, categories match `statusCategory.key` |
| discover a company-managed space | 1, 2 | skip: the site has no company-managed space (Q1, with the owner) |
| the field-role rules find the site's fields | 2 | pass after the fix: `priority`, `duedate`, `assignee`, `timespent`, and `start_date` `customfield_10015` (shown as `Data de início`; `null` before the fix). `estimate`, `sprint`, `acceptance_criteria` are `null`, and the site has no field their rules name (sprints and estimation are off in Kudos; Q3, with the owner) |
| license, configuration and board shapes | 3 | pass: `jira-software` plan `FREE`; configuration booleans; one board of type `simple`, no `estimation` in its configuration |
| capabilities on the throwaway space | 3 | pass: 20 entries; `releases` reports `native` while the space's Releases feature is off (Q2 follow-up) |
| a token without admin rights discovers with warnings | 3 | skip: no non-admin token (Q4); unit tests cover refused optional reads |
| PMK-364's client checks, rerun | — | pass (scoped token skipped, as in PMK-364) |

### With sprints and estimation on (Q3)

The owner approved turning on Sprints and Estimation in Kudos (2026-11-24). Through the Agile API's board features call: Estimation on; Sprints needs the Backlog feature first, so Backlog and then Sprints on. Jira then created the site's `Sprint` field (`gh-sprint`) and `Story point estimate` (`jsw-story-points`), both unscoped, the board configuration's `estimation.field` names the latter, and Jira created one future sprint, which was deleted. The four live discovery checks rerun: pass.

| Role | Rule that matched | Field |
|---|---|---|
| `estimate` | the board's estimation field (also `jsw-story-points`) | `customfield_10016` |
| `sprint` | custom type `gh-sprint` | `customfield_10020` |

The board **stays `type: simple`** with Sprints on, so `cycles` stays `absent` ("Sprints need a Scrum board"): sprints on a team-managed space are unusable in pmkit until PMK-393 (raised to high priority, with this evidence) reads the Sprints feature. `estimation` turned `native`.

Final state of Kudos: no work item, no sprint; board features Backlog, Sprints and Estimation on (left on for PMK-370's sprint checks), Releases off; the two new fields stay on the site.

Q1 (company-managed space): skipped by the owner's decision, open in the PR.
