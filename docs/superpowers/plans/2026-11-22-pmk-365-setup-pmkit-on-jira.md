# Set up pmkit on a Jira site Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `init --tracker jira` writes a Jira `.pmkit/config.yaml` after returning the questions setup must ask, and `/pmkit:setup` walks it.

**Architecture:** A pure proposal module, `scripts/lib/jira/setup.mjs`, decides what setup applies and asks from the raw discovery (same question shape as `scripts/lib/mappings.mjs`). `runInitJira` in `scripts/pmkit.mjs` reuses the hosted-init helpers of the Linear and GitHub branches (`hostedInitFile`, `hostedDraft`, `putMappings`, `writeHostedInit`, `hostedInitLines`). `commands/setup.md` gains two Jira sections; a runbook and its E2E test run on the fake Jira fetch.

**Tech Stack:** Node 18+ ES modules, no dependencies, `node:test`.

**Spec:** `docs/superpowers/specs/2026-11-22-pmk-365-setup-pmkit-on-jira-design.md`

## Global Constraints

- No dependencies (ADR 0003). Scripts run on Node 18.
- Jira is reached only through `createJiraClient` (ADR 0013). No module but `scripts/lib/jira/credential.mjs` reads `JIRA_EMAIL` / `JIRA_API_TOKEN`.
- No output (stdout, stderr, JSON, error message or details) ever carries the token, the email or the `Authorization` header.
- `mappings.fields.<role>` holds the Jira field id (ADR 0014).
- Setup asks statuses `backlog`, `in_review`, `canceled` only; never `blocked` on Jira. Field roles asked: `estimate`, `acceptance_criteria` only.
- Every commit message carries `(PMK-365)`.
- `npm test` and `npm run lint` pass after each task.

## Review Focus

1. `--site https://acme.atlassian.net/` (a URL, not a host) → `INVALID_INPUT` with next step `Pass --site <host>, such as --site acme.atlassian.net`, before any request. Test in Task 2.
2. A held `tracker.scope.space` the site no longer has (discovery `NOT_CONFIGURED`) → the space question with `broken`, not a raw `NOT_CONFIGURED`. Test in Task 2.
3. Two `--type-label` answers naming the same work type → `INVALID_INPUT`. Test in Task 1.
4. `init --update` on a complete, valid Jira config → `questions: []`, file `keep`, nothing written. Test in Task 2.
5. A real run (no `--dry-run`) with questions left → `INVALID_INPUT` "setup has unanswered questions", file not created (existing `writeHostedInit` behavior). Test in Task 2.

---

### Task 1: The Jira setup proposal

**Files:**
- Create: `scripts/lib/jira/setup.mjs`
- Create: `scripts/lib/jira/setup.test.mjs`
- Modify: `scripts/lib/jira/discovery.mjs` (raw field gains `type: field.schema?.type ?? null`)
- Modify: `scripts/lib/jira/discovery.test.mjs` (assert the new key)

**Interfaces:**
- Consumes: `NONE` from `scripts/lib/mappings.mjs`; `brokenJiraMappings(raw, pmkit)` from `./mappings.mjs`; `fieldRoles(raw, pmkit)` from `./discovery.mjs` for the recommended estimate and acceptance-criteria picks.
- Produces:
  - `export const SPACE_PATH = 'tracker.scope.space'`
  - `export function proposeSpace({ answer, held, heldMissing = false, spaces = [] }) → { value } | { question, broken }` — `spaces` is `[{ key, name }]`. Question: `{ path: SPACE_PATH, flag: '--space <KEY>', candidates: keys, titles: { key: name }, recommended: spaces.length === 1 ? key : null, none: null }`; with `heldMissing`, `broken: { was, problem: 'tracker.scope.space names <KEY>, which <site> does not have or the token\'s owner cannot browse' }` and the same item in the returned `broken` list. An `answer` not in `spaces` (when `spaces` is non-empty) throws `INVALID_INPUT` `--space <X> is not a space of this site`, next step `Pass one of: <keys>`.
  - `export function proposeJiraSetup(raw, current = {}, answers = {}, types = []) → { applied, questions, broken, notes, values }` — `current` and `answers` are `{ status, fields, types }` maps as in `hostedDraft` / `parseMappingFlags`; `values = { status, fields, types? }`, `types` omitted while a type is a question.

- [ ] **Step 1: Write the failing tests** in `scripts/lib/jira/setup.test.mjs`, over `raw` built from `fetchDiscovery` on `fakeJiraFetch(jiraSiteRoutes({ ... }))` with a client from `createJiraClient({ env: FAKE_ENV, tracker: { scope: { site: 'acme.atlassian.net', space: 'ENG' } }, fetch })` (as `discovery.test.mjs` does):
  - `first run asks backlog, in_review and canceled, never blocked`: question paths for status are exactly `['mappings.status.backlog','mappings.status.in_review','mappings.status.canceled']`; with `extraStatuses: true`, recommended are `Backlog`, `Review`, `Canceled`; without, `backlog` and `canceled` recommend `none` and `in_review` recommends `Review`. Candidates hold every space status name, recommended first.
  - `--status blocked is refused`: `answers.status = { blocked: 'Review' }` throws `INVALID_INPUT` with message `--status blocked is not something setup maps`.
  - `a held blocked is kept`: `current.status = { blocked: 'Review' }` → no blocked question, `values.status.blocked` undefined, nothing broken.
  - `one status cannot answer two keys`: `answers.status = { in_review: 'Review', canceled: 'Review' }` throws `INVALID_INPUT`.
  - `an unknown status answer lists the candidates`: `{ in_review: 'Nope' }` throws `INVALID_INPUT` whose `nextStep` starts `Pass one of: To Do, In Progress, Review, Done` and ends `none`.
  - `estimate on a company-managed space`: the board names `customfield_10016` → question `mappings.fields.estimate` with `recommended: 'customfield_10016'`, candidates `['customfield_10016', 'timeoriginalestimate']`, `titles['customfield_10016'] === 'Story Points'`.
  - `acceptance criteria with no candidate is a note`: no question for `mappings.fields.acceptance_criteria`, `notes` contains `the site has no field for the acceptance criteria`. With a route adding a custom string field `{ id: 'customfield_10050', name: 'Acceptance criteria', custom: true, schema: { type: 'string', custom: 'com.atlassian.jira.plugin.system.customfieldtypes:textarea' } }` and it the only string field, it is `applied` with reason `the site offers only this field`.
  - `no other field role is asked`: no question path for `priority`, `assignee`, `target_date`, `start_date`, `time_spent`, `sprint`; `answers.fields = { priority: 'priority' }` throws `INVALID_INPUT`.
  - `types offer the standard work types`: questions for `feature`,`bug`,`task`,`chore` each with candidates `Story` and `Bug` only (no `Epic`, no `Sub-task`); `feature` recommends `Story`, `bug` recommends `Bug`, `task` and `chore` recommend `none`; `none` label `No work type stands for this type`; `values.types` undefined.
  - `two types cannot share a work type`: `answers.types = { feature: 'Story', task: 'Story', bug: 'Bug', chore: 'none' }` throws `INVALID_INPUT`.
  - `all answered`: answers for every status, `estimate=customfield_10016`, all types → `questions: []`, `values.types` equals `{ feature: 'Story', bug: 'Bug' }` (none answers left out).
  - `a held mapping that broke is asked again`: `current.status = { in_review: 'Gone' }` → the in_review question has `broken.was === 'Gone'`, and `broken` has one item.
  - `proposeSpace`: no answer, no held → question with candidates `['ENG','OPS']`, `titles.ENG === 'Engineering'`, `recommended: null`; one space → recommended that key; held missing → `broken.was`; unknown answer → `INVALID_INPUT`.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test scripts/lib/jira/setup.test.mjs`
Expected: FAIL, cannot find module `./setup.mjs`.

- [ ] **Step 3: Implement `scripts/lib/jira/setup.mjs`** and add `type` to each raw field in `fetchDiscovery`.
  Estimate candidates: fields with `type === 'number'` and `customType !== null`, plus `timeoriginalestimate` when present. Acceptance-criteria candidates: fields with `type === 'string'` and `customType !== null`. Recommended: `fieldRoles(raw, {}).fields[role]?.id` when it is a candidate, else `none`. Status name matches, compared lowercased: backlog `['backlog']`; in_review `['in review','review','code review']`; canceled `['canceled','cancelled',"won't do",'declined']`. Type matches: feature `['story','feature']`; bug `['bug']`; task `['task']`; chore `['chore','task']`. Rule order per key: answer, held when not broken, question (broken when it broke); types asked only while `current.types` is undefined or a type broke, as `proposeMappings` does. An empty candidate list for a type still yields a question (setup offers `none` and "Stop setup").

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test scripts/lib/jira/setup.test.mjs scripts/lib/jira/discovery.test.mjs`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add scripts/lib/jira/setup.mjs scripts/lib/jira/setup.test.mjs scripts/lib/jira/discovery.mjs scripts/lib/jira/discovery.test.mjs
git commit -m "feat: propose the Jira setup answers and questions (PMK-365)"
```

### Task 2: `init --tracker jira`

**Files:**
- Modify: `scripts/lib/jira/adapter.mjs` (descriptor gains `connect`)
- Modify: `scripts/pmkit.mjs` (`init` flags/usage/summary, `HOSTED_INIT`, `runInit` dispatch, new `runInitJira`, the "not supported yet" path)
- Create: `scripts/cli-jira-init.test.mjs`

**Interfaces:**
- Consumes: `proposeSpace`, `proposeJiraSetup`, `SPACE_PATH` (Task 1); `hostedInitFile(ctx, 'jira', 'Jira')`, `hostedDraft`, `putMappings`, `writeHostedInit`, `hostedInitLines`, `withGithubRepo`, `parseMappingFlags`, `withLocalDefaults` (existing in `scripts/pmkit.mjs`).
- Produces:
  - `jiraDescriptor().connect({ env, site }) → Promise<client>` — `createJiraClient({ env, tracker: { scope: { site } }, fetch })` with the descriptor's fetch.
  - `async function runInitJira(ctx) → { data, text }`, `data = { dryRun, tracker: 'jira', site, space: { key, name, style } | null, viewer: { id, name } | null, applied, questions, broken, statuses, notes, files }`. Text header lines: `site: <host>[, viewer <name>]` and `space: <KEY> <name> (<style>)` or `space: (not chosen yet)`.

- [ ] **Step 1: Write the failing tests** in `scripts/cli-jira-init.test.mjs`, driving `run(args, { cwd, env, adapters: { ...ADAPTERS, jira: jiraDescriptor({ fetch }) } })` on a `makeRepo('basic')` whose `.pmkit/config.yaml` is deleted (first run), with `globalThis.fetch` set to throw as in `cli-jira.test.mjs`:
  - `without --site it asks for the site`: `INVALID_INPUT`, `nextStep === 'Pass --site <host>, such as --site acme.atlassian.net'`.
  - `a URL as --site is refused before any request` (Review Focus 1): `--site https://acme.atlassian.net/` → same error; the fake fetch saw no request.
  - `without --space it returns the space question`: `questions` is one item, `path: 'tracker.scope.space'`, candidates `['ENG','OPS']`, `space: null`, `files[0].action === 'create'`, nothing on disk.
  - `with --space it returns the status, field and type questions`: question paths are the three statuses, `mappings.fields.estimate`, then the four types; `space.key === 'ENG'`, `viewer.name === 'Test User'`; `statuses` lists each space status with its category.
  - `every answer, then the real run, writes the config`: dry run gives `questions: []`; the real run writes `.pmkit/config.yaml` with `system: jira`, `site: acme.atlassian.net`, `space: ENG`, `in_review: Review`, `estimate: customfield_10016`, `feature: Story`; then `run(['validate','--json'])` exits 0.
  - `a real run with questions left writes nothing` (Review Focus 5): `INVALID_INPUT` naming `setup has unanswered questions`, no file.
  - `--update on a complete config keeps the file` (Review Focus 4): `questions: []`, `files[0].action === 'keep'`.
  - `--update asks a mapping that broke`: config with `in_review: Gone` → the in_review question with `broken`.
  - `a held space the site lacks is asked again` (Review Focus 2): config `space: NOPE`, `init --update --dry-run` → one `tracker.scope.space` question with `broken.was === 'NOPE'`.
  - `--space the site lacks is INVALID_INPUT naming the keys`.
  - `--team, --project and --prefix are refused with --tracker jira`.
  - `without JIRA_EMAIL it is AUTH`: env without the two variables → `error.code === 'AUTH'`, `nextStep === '/pmkit:setup'`.
  - `a Server site is NOT_SUPPORTED`: route `GET /rest/api/3/serverInfo` with `deploymentType: 'Server'`.
  - Every test asserts stdout + stderr hold none of `FAKE_TOKEN`, `FAKE_EMAIL`, `FAKE_HEADER`.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test scripts/cli-jira-init.test.mjs`
Expected: FAIL, `tracker "jira" is not supported yet` / unknown option `--site`.

- [ ] **Step 3: Implement.** Add `site` and `space` to the `init` flags, `--tracker local|linear|github|jira`, `--site h`, `--space KEY` in usage, and "--tracker linear, github or jira" in the summary. `HOSTED_INIT = ['linear', 'github', 'jira']`; `runInit` sends `jira` to `runInitJira`; `--site`/`--space` with another tracker are refused (`applies only with --tracker jira`). `runInitJira` follows the design's "The CLI" steps 1-6: validate the site against `HOST` before connecting; spaces from `client.paginate('/rest/api/3/project/search')` only when no space is known or discovery threw `NOT_CONFIGURED`; discovery through `adapter.create({ root, system: 'jira', pmkit: { tracker: { system: 'jira', scope: { site, space } } } }, { now: ctx.now, env: ctx.env })` then `discover({ refresh: true })`; `types` = defaults plus hand-mapped types; write `tracker.scope.site`, `tracker.scope.space` and `putMappings` only for lines that change.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test scripts/cli-jira-init.test.mjs scripts/cli-init.test.mjs scripts/cli-github-init.test.mjs scripts/cli-linear.test.mjs`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add scripts/pmkit.mjs scripts/lib/jira/adapter.mjs scripts/cli-jira-init.test.mjs
git commit -m "feat: init --tracker jira returns the setup questions and writes the config (PMK-365)"
```

### Task 3: `/pmkit:setup` for Jira, the runbook and its E2E test

**Files:**
- Modify: `commands/setup.md` (Parameters, step 1, new "Jira first run" and "Existing Jira config", Confirmation points, If something is missing)
- Modify: `docs/adr/0013-jira-cloud-only-with-an-api-token-from-the-environment.md` (the `/pmkit:setup` consequence names `init --tracker jira`)
- Create: `docs/runbooks/setup-jira.md`
- Create: `scripts/runbook-setup-jira.test.mjs`
- Modify: `CHANGELOG.md` (Unreleased: setup offers Jira)

**Interfaces:**
- Consumes: the CLI of Task 2; the launcher pattern of `scripts/runbook-discover-jira.test.mjs` (fake fetch installed before `pmkit.mjs` loads, subprocess, secret check).

- [ ] **Step 1: Write the failing test** `scripts/runbook-setup-jira.test.mjs`:
  - `the runbook names every command the test runs`: `docs/runbooks/setup-jira.md` contains `pmkit.mjs init --tracker jira --git-host none --site acme.atlassian.net --dry-run --json`, `--space ENG --dry-run --json`, `pmkit.mjs init --update --dry-run --json`, `pmkit.mjs validate --json`, `pmkit.mjs discover --json`.
  - `first run`: steps 1 (space question), 2 (questions), 3 (all answered, dry run), 4 (real run, file exists), 5 (`validate` exit 0, `discover --json` `space.key === 'ENG'`), each through the subprocess.
  - `existing config`: step 6 `init --update --dry-run --json` → `keep`; step 7 a broken mapping asked again.
  - `errors`: step 8 no variables → `AUTH`; step 9 a Server site → `NOT_SUPPORTED`.
  - `setup.md offers Jira`: `commands/setup.md` contains `### Jira first run`, `### Existing Jira config`, `id.atlassian.com`, `JIRA_EMAIL`, `JIRA_API_TOKEN`, `Jira Cloud only`, and the step 1 option `"Jira"`.

- [ ] **Step 2: Run it to verify it fails**

Run: `node --test scripts/runbook-setup-jira.test.mjs`
Expected: FAIL, the runbook file does not exist.

- [ ] **Step 3: Write `docs/runbooks/setup-jira.md`** in the shape of `docs/runbooks/setup-github.md` (Before you start; First run steps 1-5; Existing config steps 6-7; Errors steps 8-9; a "Live checks" line saying a live run is skipped without credentials and tracked in EPC-14), and the `commands/setup.md` sections per the design's "`commands/setup.md`" part. Step 1's four options: Local (Recommended), Linear, GitHub Issues, Jira. Add the ADR 0013 clause and the CHANGELOG line.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test && npm run lint`
Expected: all pass, lint clean (the ADR test in `scripts/adr.test.mjs` still passes on the edited ADR).

- [ ] **Step 5: Commit**

```bash
git add commands/setup.md docs/runbooks/setup-jira.md scripts/runbook-setup-jira.test.mjs docs/adr/0013-jira-cloud-only-with-an-api-token-from-the-environment.md CHANGELOG.md
git commit -m "feat: /pmkit:setup offers Jira, with its runbook and E2E test (PMK-365)"
```
