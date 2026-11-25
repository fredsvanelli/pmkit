# PMK-368: check the Jira setup against a live site

Issue PMK-368 (EPC-14, chore), follow-up of PMK-365. Written on 2026-11-24 by a dispatched worker; the owner's answers come through the coordinator.

## Intent

PMK-365 built `init --tracker jira` and the `/pmkit:setup` Jira sections and checked them only against the fake site (`scripts/fake-jira-api.mjs`). Run setup on the owner's Jira Cloud site, record what holds, fix the proposal rules or the fake where the site answers differently, and leave a check that reruns in one line (PMK-366's opt-in harness, `scripts/lib/jira/client-live.mjs`).

## Acceptance criteria (from the issue)

1. `init --tracker jira --site <host> --dry-run --json` lists the spaces the token's owner can browse, and a held space the site lacks is asked again.
2. The estimate candidates (custom number fields plus `timeoriginalestimate`) and the acceptance-criteria candidates (custom string fields) match what a company-managed and a team-managed space offer, and the recommended estimate is the board's estimation field.
3. The recommended statuses and work types match a default Jira Software space (Story, Bug, Task, Epic), and accepting every recommendation writes a config that `validate` and `discover` accept.

## What a live probe found (2026-11-24)

Site: the owner's (host, email and token kept out of the repository, the PR and the issue). Space Kudos (team-managed, site and token owner's language Portuguese, `pt_BR`; Backlog, Sprints and Estimation on, Releases off). The setup runs went to a scratch git repository; nothing was written to Jira.

| Check | AC | Live answer | Holds? |
|---|---|---|---|
| `init --site <host> --dry-run` without a space | 1 | one question `tracker.scope.space`, candidates `KAN`, title `Kudos`, recommended `KAN` | yes |
| held space the site lacks (`NOPE`), `init --update --dry-run` | 1 | the space question again, with `broken.was: NOPE` and the "does not have or cannot browse" problem; `--space NOPE` is `INVALID_INPUT` naming `KAN` | yes |
| estimate candidates | 2 | `customfield_10016` (Story point estimate, `jsw-story-points`) and `timeoriginalestimate`; recommended `customfield_10016`, the board's `estimation.field` | yes |
| acceptance-criteria candidates | 2 | `customfield_10017` (`Cor do item`, Jira Software's issue colour, `jsw-issue-color`, type string); recommended `none` | yes by the rule (a custom string field); see Q2 |
| sprint | — | applied `customfield_10020` ("the site offers only this field") | yes |
| company-managed space | 2 | skipped: the site has none (owner's decision, open in the PR) | skipped |
| recommended statuses | 3 | `backlog`, `in_review`, `canceled` all `none`. The space has `Em análise` (untranslated `In Review`) | **bug**: `in_review` should recommend `Em análise` |
| recommended work types | 3 | `feature` → `Feature`, `bug` → `Bug`, `task` → `none`, `chore` → `none`. The space has `História` (Story) and `Tarefa` (Task) | **bug**: `feature` should be `História` (Story first), `task` should be `Tarefa` |
| accept every recommendation, then `validate` and `discover` | 3 | config written; `validate` no problems; `discover` no warnings, roles found | yes (with today's recommendations; rerun after the fix) |

## Root cause

Jira shows status and work type names in the viewer's language. PMK-366 kept a field's English name (`untranslatedName`) in the raw discovery and matched it first; statuses and work types were left out. So `fetchDiscovery` (`scripts/lib/jira/discovery.mjs`) keeps only the shown name, and `setup.mjs`'s `matchOf` compares English names (`in review`, `story`, `task`) with Portuguese ones. The same holds for `defaultWorkType` in `issues.mjs` (`type.name === 'Task'`), which only works on Kudos because `Tarefa` happens to be the first standard type.

Where the English name is on the live site:

- Statuses: `GET /project/{key}/statuses` gives each status `untranslatedName` (`Em análise` / `In Review`). Already read.
- Work types: `GET /project/{key}` gives `issueTypes[].untranslatedName: null`. The same statuses read names each work type in English (`Tarefa` id 10003 is `Task` there, `História` 10004 is `Story`). `GET /issuetype/project?projectId=` gives `untranslatedName` explicitly, but is one more call.

## Approaches

- **A. Keep the English name of statuses and work types in the raw discovery and match it first (recommended).** `fetchDiscovery` adds `untranslated` to each status (`untranslatedName`) and work type (`untranslatedName`, else the statuses list's name for that id). `setup.mjs` matches `untranslated ?? name` first and recommends the shown name (mappings hold names as the site shows them); `defaultWorkType` matches `Task` the same way. No new call. Same fix shape as PMK-366.
- **A'. Same, but read `GET /issuetype/project?projectId=` for work types.** Documented `untranslatedName`, one more sequential call per discovery. Only worth it if the statuses list's English names prove unreliable.
- **B. Add the Portuguese names to the match lists.** Fixes one language. Rejected.

A.

## Design (approach A)

### Fix (test-first)

- `discovery.mjs` `fetchDiscovery`: each status gets `untranslated: status.untranslatedName ?? null`; each work type gets `untranslated: type.untranslatedName ?? listName ?? null`, where `listName` is the statuses list item's `name` when it differs from `type.name`. `discoveryView` output does not change.
- `setup.mjs`: `matchOf` takes `{ name, untranslated }` items: the first wanted name that an item's `untranslated` matches, else its `name`, without case; returns the shown `name`. Used for statuses and types.
- `issues.mjs` `defaultWorkType`: `(type.untranslated ?? type.name) === 'Task'`.
- Unit tests first: `setup.test.mjs` on a Portuguese fake (statuses and work types localized): `in_review` → `Em análise`, `feature` → `História`, `task` → `Tarefa`; `discovery.test.mjs` keeps `untranslated` on statuses and work types; `issues.test.mjs` (or its existing default-type test) creates with `Tarefa` when it is not first.

### Fake

`jiraSiteRoutes({ locale: 'pt' })` also localizes the space's work types the way the live site does: `GET /project/ENG` `issueTypes` names `História`, `Tarefa`, with `untranslatedName: null`, and the statuses list keeps the English names. `Bug` and `Epic` stay. Defaults unchanged.

### Live check added to `client-live.mjs`

One test, `setup on the throwaway space`, needs `PMKIT_LIVE_JIRA_SPACE`. It runs the real CLI (`scripts/pmkit.mjs`) in a temporary git repository with `--git-host none`, so Jira is only read:

1. `init --tracker jira --site <host> --dry-run --json`: the space question lists `PMKIT_LIVE_JIRA_SPACE` among the spaces `project/search` returns.
2. A config holding a random space key: `init --update --dry-run` asks the space again with `broken`.
3. `init --space <key> --dry-run`: the estimate candidates are the space's custom number fields plus `timeoriginalestimate` and the recommended one is the board's estimation field when the board has one; the acceptance-criteria candidates are its custom string fields; each status and type recommendation is the one whose English name the rules name, when the space has it.
4. `init` with every recommendation as a flag, then `validate` and `discover`: no problem, no error.

Output prints counts and ids, never the host, the email or the token (the harness's `scrub` and `assertNoSecret`).

### Docs

`docs/runbooks/setup-jira.md`: the live-check line records the run and what stayed skipped; a step for a site in another language (recommendations follow the English names, the config holds the shown ones), verified by `scripts/runbook-setup-jira.test.mjs` with `locale: 'pt'`.

## Goals, non-goals, anti-goals

- Goals: each AC checked live or skipped with its reason; the localized-name bug fixed test-first for setup and the default work type; the fake matching the shapes seen; the result recorded on PMK-368.
- Non-goals: company-managed space and non-admin token checks (owner's decision, open in the PR); team-managed board features (PMK-393).
- Anti-goals: any write to Jira outside Kudos; anything left in Kudos; the host, email, token or account in the repository, the PR or the issue.

## Check (SPEC-SS C)

`scripts/runbook-setup-jira.test.mjs` with the new step, the Jira runbook tests, then `client-live.mjs` against the live site.

## Open questions for the owner

- **Q1. Work type English name source.** Statuses list name (A, no new call, seen live) or `GET /issuetype/project` (A', documented, one more call). Recommend A, with `untranslatedName` winning when Jira sends it.
- **Q2. Acceptance-criteria candidates include Jira Software's issue colour field (`jsw-issue-color`).** It is a custom string field, so the rule offers it; it is never recommended. (a) Leave it; (b) leave out `com.pyxis.greenhopper.jira:*` types. Recommend (a): one odd candidate, not worth a rule.

- **Q3. Mappings hold names in the viewer's language.** `mappings.status` and `mappings.types` hold the shown name (`Em análise`, `Tarefa`), and Jira shows names in the token owner's language (`Accept-Language` does not change it). A teammate whose Jira is in English sees `In Review` and `Task`, so a config one of them writes breaks for the other. (a) A follow-up in EPC-14: resolve a status or type mapping against the shown and the English name (or hold ids, an ADR); this PR keeps writing the shown name; (b) fix it here. Recommend (a): it changes how every Jira command reads mappings, outside setup.

## Left to the builder

Assertion wording, the fake's Portuguese strings, the live test's temp-dir handling.

## Interview

Answered on 2026-11-24 by the coordinator on the owner's behalf; the design is approved.

- Q1: yes, a work type's English name comes from the statuses list already read (`untranslatedName` wins when Jira sends it); no new call.
- Q2: yes, the issue colour field stays an acceptance-criteria candidate.
- Q3: yes, a follow-up in EPC-14: PMK-394 "Resolve Jira status and type mappings in any viewer language". Setup keeps writing the shown name.
- No new `CONTEXT.md` term and no ADR: matching English names first is the inference fallback ADR 0014 already allows; the mapping-holds-ids question is PMK-394's.

## Result

Run on 2026-11-24 against the owner's Jira Cloud site (host kept out of the repository, the PR and the issue), space Kudos: `PMKIT_LIVE=1 PMKIT_LIVE_JIRA_SITE=<host> PMKIT_LIVE_JIRA_SPACE=<key> node --test scripts/lib/jira/client-live.mjs`, exit 0, 11 pass, 3 skip. No output held the token, the email or the host. The new setup test failed on the code before the fix (`mappings.status.in_review`: expected `Em análise`, got `none`) and passes after it. Kudos after the run: no work item (approximate count 0), no sprint, board features unchanged (Backlog, Sprints, Estimation on; Releases off).

| Check | AC | Result |
|---|---|---|
| `init --dry-run` lists the spaces the token's owner can browse | 1 | pass: 1 space, the throwaway one |
| a held space the site lacks is asked again | 1 | pass: the space question with `broken.was` the missing key |
| estimate and acceptance-criteria candidates, team-managed space | 2 | pass: estimate `customfield_10016` and `timeoriginalestimate`, recommended `customfield_10016` (the board's estimation field); acceptance criteria the custom string fields (issue colour, Q2), recommended `none` |
| the same on a company-managed space | 2 | skip: owner's decision, the site has none |
| recommended statuses and work types | 3 | pass after the fix: `in_review` `Em análise` (In Review), `feature` `História` (Story), `bug` `Bug`, `task` `Tarefa` (Task), `backlog`, `canceled` and `chore` `none` (no such status; Task taken by `task`); `sprint` applied `customfield_10020` |
| a work type's English name from the statuses list matches Jira's `untranslatedName` | Q1 | pass for every work type of the space |
| every recommendation accepted, then `validate` and `discover` | 3 | pass: no question left, no problem, `discover` without warnings |
| PMK-364 and PMK-366 checks, rerun | — | pass (scoped token, company-managed space and limited token skipped, as before) |
