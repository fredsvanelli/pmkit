# PMK-368 Check the Jira setup against a live site: implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Setup recommends statuses and work types by their English name on a site in any language, and a live check of setup reruns in one line.

**Architecture:** The raw discovery keeps each status's and work type's English name (`untranslated`), as PMK-366 did for fields. `setup.mjs` and `issues.mjs` match it first and still use the shown name. `client-live.mjs` gains one test that runs the real CLI against the throwaway space.

**Tech Stack:** Node 18 ES modules, `node:test`, no dependencies.

**Spec:** `docs/superpowers/specs/2026-11-24-pmk-368-check-jira-setup-live-design.md`

## Global Constraints

- No dependency (ADR 0003). `npm test` and `npm run lint` pass.
- The site host, the email, the token and account names never reach the repository, test output, the PR or the issue.
- Jira is only read by the new live test; writes go to a temporary local repository.
- Mappings keep holding the shown name (`Em análise`, `Tarefa`); only matching changes (PMK-394 owns the rest).
- Commit messages carry `(PMK-368)`.

## Review Focus

1. An old discovery cache without `untranslated` on statuses or work types: matching falls back to the shown name, no crash (Task 2 test feeds `untranslated` absent).
2. A work type whose `untranslatedName` Jira does send: it wins over the statuses-list name (Task 1 test).
3. Two statuses whose English names both match one key (`Review`, `In Review`): the wanted-name order still decides, as today (unchanged `matchOf` order; Task 2 keeps the existing English test passing).
4. A space on an English site: recommendations unchanged (existing `setup.test.mjs` tests stay green).
5. The live test failing mid-way: its temp repository holds the host in `.pmkit/config.yaml`; it is removed in a `finally`, and failure messages pass through `scrub`.

---

### Task 1: The raw discovery keeps the English name of statuses and work types

**Files:**
- Modify: `scripts/fake-jira-api.mjs` (`jiraSiteRoutes`, locale `pt`)
- Modify: `scripts/lib/jira/discovery.mjs` (`fetchDiscovery`)
- Test: `scripts/lib/jira/discovery.test.mjs`

**Interfaces:**
- Produces: `raw.statuses[]` is `{ id, name, untranslated, categoryKey }`; `raw.workTypes[]` is `{ id, name, untranslated, level, statuses }`. `untranslated` is a string or `null`.

- [ ] **Step 1: Failing test** `statuses and work types keep their English name on a site in another language`: `discover({ locale: 'pt', taskType })` (add `taskType` to the helper's options) and assert `raw.statuses.find(id '4')` is `{ name: 'Em análise', untranslated: 'Review' }` (by those keys), and `raw.workTypes` maps to `[['Epic','Epic'],['História','Story'],['Bug','Bug'],['Sub-task','Sub-task'],['Tarefa','Task']]` as `[name, untranslated]`. Second test `a work type's untranslatedName wins over the statuses list name`: route override giving `issueTypes[1].untranslatedName: 'User story'` → `untranslated: 'User story'`.
- [ ] **Step 2: Run** `node --test scripts/lib/jira/discovery.test.mjs`: the new tests fail (`untranslated` undefined, names English).
- [ ] **Step 3: Fake.** With `locale: 'pt'`, the `GET /rest/api/3/project/ENG` `issueTypes` show `Story` as `História` and `Task` as `Tarefa` with `untranslatedName: null` (the live shape); the statuses list keeps the English type names. Add both to `PT`-like mapping for work types only.
- [ ] **Step 4: Code.** In `fetchDiscovery`, a status gets `untranslated: status.untranslatedName ?? null`; a work type gets `untranslated: type.untranslatedName ?? listName ?? null`, where `listName` is the statuses list item's `name` for that id. Update any existing `deepEqual` on raw statuses or work types to include `untranslated`.
- [ ] **Step 5: Run** `node --test scripts/lib/jira/*.test.mjs`: pass.
- [ ] **Step 6: Commit** `fix: keep the English name of Jira statuses and work types (PMK-368)`.

### Task 2: Setup and the default work type match the English name first

**Files:**
- Modify: `scripts/lib/jira/setup.mjs` (`matchOf`, `statusNames`, `statusValue`, `typesOf`, `typeValue`)
- Modify: `scripts/lib/jira/issues.mjs:160-164` (`defaultWorkType`)
- Test: `scripts/lib/jira/setup.test.mjs`, `scripts/lib/jira/issues.test.mjs`

**Interfaces:**
- Consumes: Task 1's `untranslated` on `raw.statuses[]` and `raw.workTypes[]`.
- Produces: `matchOf(wanted: string[], items: { name, untranslated? }[]) -> string | undefined`, the shown `name` of the first wanted English name matched on `untranslated`, else on `name`, without case.

- [ ] **Step 1: Failing tests.** `setup.test.mjs`: `rawOf` takes `locale`; test `a site in another language recommends by the English name`: `proposeJiraSetup(await rawOf({ locale: 'pt', taskType: true }), {}, {}, TYPES)` recommends `in_review` `Em análise`, `feature` `História`, `bug` `Bug`, `task` `Tarefa`, `chore` `none`; accepting every recommendation leaves no question and `values.types` is `{ feature: 'História', bug: 'Bug', task: 'Tarefa' }`. Test `a raw discovery without untranslated still matches the shown name`: delete `untranslated` from every status and work type of an English raw; recommendations equal the English test's. `issues.test.mjs`: in the default-type test, push `{ id: '10010', name: 'Tarefa', untranslated: 'Task', level: 'standard', statuses: ['1','5'] }` → create uses `10010`.
- [ ] **Step 2: Run** the two files: new tests fail.
- [ ] **Step 3: Code.** `matchOf` as in Interfaces; statuses and types pass objects (`raw.statuses`, standard `raw.workTypes`) while candidates, `taken` and `refuseShared` keep using shown names. `defaultWorkType`: `(type.untranslated ?? type.name) === 'Task'`.
- [ ] **Step 4: Run** `node --test scripts/lib/jira/*.test.mjs`: pass.
- [ ] **Step 5: Commit** `fix: recommend Jira statuses and work types by their English name (PMK-368)`.

### Task 3 (SPEC-SS Check): the runbook step on a site in another language

**Files:**
- Modify: `docs/runbooks/setup-jira.md` (a step after step 7, in "Existing config" or a new "Another language" section; live-check line updated in Task 4)
- Test: `scripts/runbook-setup-jira.test.mjs`

- [ ] **Step 1: Failing test** `a site in another language: recommendations follow the English names, the file holds the shown ones`: `pmkit(repository(), [...INIT, '--space', 'ENG', '--dry-run', '--json'], { routes: jiraSiteRoutes({ locale: 'pt', taskType: true }) })`; the `in_review` question recommends `Em análise`, `feature` `História`, `task` `Tarefa`; running with every recommendation writes `in_review: Em análise` and `task: Tarefa` to the config. The runbook-coverage check of the file asserts the step's text is there.
- [ ] **Step 2: Run** `node --test scripts/runbook-setup-jira.test.mjs`: fails until the runbook step exists (if the code of Tasks 1-2 is in, only the runbook text fails).
- [ ] **Step 3: Write the runbook step.**
- [ ] **Step 4: Run** `node --test scripts/runbook-*jira*.test.mjs`: pass.
- [ ] **Step 5: Commit** `docs: the setup-jira runbook on a site in another language (PMK-368)`.

### Task 4: The live setup check, run and recorded

**Files:**
- Modify: `scripts/lib/jira/client-live.mjs` (header comment; one test)
- Modify: `docs/runbooks/setup-jira.md:5` (live-check line), the design doc's "Result"

- [ ] **Step 1: Test** `setup on the throwaway space` (skip: `NEEDS_SPACE`). In a `fs.mkdtempSync` repository (`git init`), spawn `node scripts/pmkit.mjs` with `env` and assert, in order: (a) `init --tracker jira --site SITE --git-host none --dry-run --json` asks `tracker.scope.space` with `SPACE` among `candidates`; (b) `init --space SPACE` with every recommended answer as a flag, `--json`, exits 0 with `questions: []`; then `validate --json` has `problems: []` and `discover --json` exits 0; (c) with `tracker.scope.space` set to a random `PMKITX…` key in the file, `init --update --dry-run --json` asks the space again with `broken.was` the random key; (d) on step (b)'s dry run: estimate candidates are exactly the raw custom number fields plus `timeoriginalestimate`, the recommended estimate is `raw.board.estimationField` when set, acceptance-criteria candidates are exactly the raw custom string fields, and each status/type recommendation is the item whose `untranslated ?? name` is the first wanted English name, when one exists. Remove the directory in `finally`. Diagnostics print counts and recommended values only; stdout passes `assertNoSecret` and is never printed whole.
- [ ] **Step 2: Run live** `PMKIT_LIVE=1 PMKIT_LIVE_JIRA_SITE=<host> PMKIT_LIVE_JIRA_SPACE=KAN node --test scripts/lib/jira/client-live.mjs` with the credential loaded at run time: every non-skipped test passes; Kudos holds no new work item.
- [ ] **Step 3: Record** the result table in the design doc ("Result") and the live-check line of `docs/runbooks/setup-jira.md`.
- [ ] **Step 4: Run** `npm test` and `npm run lint`: pass.
- [ ] **Step 5: Commit** `test: a live check of Jira setup (PMK-368)`.
