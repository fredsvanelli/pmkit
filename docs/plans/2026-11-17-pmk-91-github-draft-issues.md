# PMK-91 github-draft-issues implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task by task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** list the draft issues of a GitHub Project and convert the chosen ones into issues after a full preview, through `/pmkit:github:draft-issues`.

**Architecture:** two GitHub-only CLI calls, `github draft-issues list` and `github draft-issues convert`, built like PMK-90's discussions: one module `scripts/lib/github/draft-issues.mjs` with its GraphQL documents and operations over the existing client, returned by the GitHub tracker beside `discussions`, and one fake module for the stateful fake GitHub. A command file drives the review, the preview, the conversion and the optional `issues update` batch.

**Tech stack:** Node 20+, ES modules, `node:test`, no dependencies (ADR 0003).

**Spec:** `docs/specs/2026-11-17-pmk-91-github-draft-issues-design.md`.

## Global constraints

- Every commit message carries `PMK-91` and ends with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- No new dependency. Tests use `node:test` and start no `gh`.
- Text from a draft reaches GraphQL only through variables, never inside a document.
- Item ids match `^[A-Za-z0-9_=+/-]{1,200}$`; anything else is `INVALID_INPUT` before any call.
- `--project` is `owner/number` (`parseProject`), `--repo` is `owner/name` (`parseRepo`).
- Caps: 10 pages of 100 items read; `--limit` default 50, at most 200; 1 to 50 items per conversion.
- No change to `manifest.mjs` or `documents.mjs` (PMK-88 edits them). `fake-github-issues.mjs` and `tracker.mjs` get a few routing lines only.
- Prose follows the Unslop rules: no em dashes, sentence-case headings, active voice.

## Review focus

1. A Project's built-in Title field comes back as a text field value. Users expect `fields` without `Title`, since the title is already shown. Task 1 pins it.
2. A draft item, an issue item and an archived draft side by side, across a page boundary. Users expect only the unarchived drafts, in board order. Task 1 pins it.
3. The same item id given twice. Users expect one conversion, not a GitHub error on the second. Task 2 pins it.
4. A `--project` equal to `tracker.scope.project` but spelled in another case. Users expect no "not linked" refusal. Task 1 pins it.
5. A conversion that fails on the second of three drafts. Users expect to learn which one converted and which ones did not, with the ids to rerun. Task 2 pins it.

---

### Task 1: the fake drafts and the list call

**Files:**
- Create: `scripts/fake-github-drafts.mjs`
- Modify: `scripts/fake-github-issues.mjs` (import, `initDrafts(state, options)` in `fakeGithubIssues` and `build`, route lookup beside `discussions`, `PmkitLinkedProjects` includes linked extra Projects, `seedDraft` in the returned object)
- Create: `scripts/lib/github/draft-issues.mjs`
- Test: `scripts/lib/github/draft-issues.test.mjs`

**Interfaces:**
- Produces, in the fake: `initDrafts(state, { extraProjects = [] })` adds `state.extraProjects` (each `{ id, owner, number, title, linked = true }`) and leaves draft items in `state.items` with `issueId: null` and `draft: { id, title, body, assignees: [logins], creator, createdAt, updatedAt }`. `draftRoutes(state, helpers)` returns `{ queries, mutations, seedDraft }`. `seedDraft({ project, title, body, assignees, creator, archived, values, createdAt, updatedAt })` returns `{ item }`; `project` defaults to `state.project.id`, `values` is `{ <field name>: option name, number or date }` as `seed`'s item values are.
- Produces, in `draft-issues.mjs`: `DRAFT_DOCUMENTS` (`PROJECT` named `PmkitDraftProject`, `ITEMS` named `PmkitDraftItems`, `ITEM` named `PmkitDraftItem`, `TARGET` named `PmkitDraftTarget`, `CONVERT` named `PmkitConvertDraftItem`), `parseItemId(value) -> string`, `listText(result) -> string`, `draftIssueOperations({ client, scope }) -> { list({ project, limit }), convert(items, { project, repo, dryRun }) }`.

- [ ] **Step 1: Write the failing tests** in `draft-issues.test.mjs`, with a `setup(options)` like `discussions.test.mjs` (`fakeGithubIssues`, `createGithubClient({ exec: fake.exec, retries: 0, sleep })`, `SCOPE = { host: 'github.com', repo: 'acme/widgets', project: 'acme/7' }`):
  - `list returns the unarchived drafts in board order across pages`: seed 120 issues with items first (one page boundary), then drafts `Offline mode` (Status `Todo`, assignee `hubot`), an archived draft and `Dark theme`. Expect `drafts.map(title)` equal `['Offline mode', 'Dark theme']`, `project` equal `{ id: 'PVT_1', title: 'Roadmap', url: 'https://github.com/orgs/acme/projects/7' }`, `repo` `acme/widgets`, `hasMore` false, `warnings` `[]`, and the first draft deep-equal `{ item, title, body, assignees: ['hubot'], creator: 'octocat', created, updated, fields: { Status: 'Todo' } }` (no `Title` key).
  - `list caps the items read and the drafts returned`: with 1001 items, `warnings` equals `['acme/7 has more than 1000 items and pmkit read the first 1000']`; with 3 drafts and `limit: '2'`, two drafts and `hasMore: true`; `limit: '0'` and `limit: '201'` reject with `INVALID_INPUT` `--limit must be a whole number from 1 to 200`.
  - `list reads a linked --project and refuses one the repository does not link`: extra Projects `acme/9` (linked) and `acme/11` (`linked: false`); a draft seeded in `acme/9` lists with `project: 'acme/9'`; `project: 'ACME/7'` lists with no linked check; `project: 'acme/11'` rejects `INVALID_INPUT` with message `acme/11 is not linked to acme/widgets; its linked Projects are acme/7, acme/9`; `project: 'acme'` rejects `INVALID_INPUT` `--project must be owner/number, such as acme/7`.
  - `list without a Project is unavailable`: scope `project: 'none'`, no `--project`: deep-equal `{ available: false, reason: 'no_project', enableHint: 'Pass --project owner/number, or set tracker.scope.project with /pmkit:setup', repo: 'acme/widgets', drafts: [], hasMore: false, warnings: [] }`.
  - `parseItemId accepts node ids and refuses the rest`: `PVTI_lADOAB` and `MDExOlByb2plY3RWMkl0ZW0x==` pass; `'a b'`, `'$(x)'`, `''` and a 201-character id reject `INVALID_INPUT`.
  - `listText` of the first test's result matches `/^PVTI_\d+ {2}Offline mode {2}Todo/`.

- [ ] **Step 2: Run** `node --test scripts/lib/github/draft-issues.test.mjs`. Expected: FAIL, the module does not exist.

- [ ] **Step 3: Implement the fake.** `PmkitDraftProject({ owner, number })` resolves `state.project` or an extra Project, else `refuseWithData` with `repositoryOwner.projectV2: null`. `PmkitDraftItems({ project, first, after })` returns `{ node: { items: connection(items of that Project in insertion order, first, after) } }`, each item `{ id, type: 'DRAFT_ISSUE' | 'ISSUE', isArchived, content, fieldValues: { nodes } }`. `fieldValues` starts with `{ __typename: 'ProjectV2ItemFieldTextValue', text: <title>, field: { name: 'Title' } }`, then one node per set value of the main Project's fields (single select `name`, number `number`, date `date`), each with `field: { name }`. `PmkitDraftItem({ id })` returns `{ node: <same item> + project: { id } }`, or `unknownNode(id)`. `PmkitLinkedProjects` adds the linked extra Projects.

- [ ] **Step 4: Implement `parseItemId`, `parseProject` use, the list documents and `list`** in `draft-issues.mjs`. The `ITEMS` document reads `items(first: $first, after: $after)` with `id type isArchived`, `content { ... on DraftIssue { title body createdAt updatedAt creator { login } assignees(first: 10) { nodes { login } } } }` and `fieldValues(first: 20)` with the single select, text, number, date and iteration fragments, each reading `field { ... on ProjectV2FieldCommon { name } }`. `list` resolves the Project (option, else `scope.project`), runs the linked check only when the option differs from `scope.project` ignoring case (through `fetchLinkedProjects(client, scope.repo)`), pages at most 10 times, filters `type === 'DRAFT_ISSUE' && !isArchived`, drops the `Title` field, maps a missing login to `ghost`, and cuts at the limit.

- [ ] **Step 5: Run** `node --test scripts/lib/github/draft-issues.test.mjs scripts/fake-github-issues.test.mjs scripts/lib/github/discussions.test.mjs`. Expected: PASS.

- [ ] **Step 6: Commit** `feat: list the draft issues of a GitHub Project (PMK-91)`.

### Task 2: the convert call

**Files:**
- Modify: `scripts/fake-github-drafts.mjs`, `scripts/lib/github/draft-issues.mjs`
- Test: `scripts/lib/github/draft-issues.test.mjs`

**Interfaces:**
- Consumes: Task 1's documents, `parseItemId`, the Project resolution of `list`.
- Produces: `convert(items: string[], { project, repo, dryRun }) -> { dryRun?: true, project, target: { repo, tracked }, drafts | converted, warnings }` and `convertText(result, dryRun) -> string`.

- [ ] **Step 1: Write the failing tests**:
  - `convert previews every draft and writes nothing`: two drafts; dry run returns `{ dryRun: true, project, target: { repo: 'acme/widgets', tracked: true }, drafts: [{ item, title, body, assignees, fields }, ...], warnings: [] }` and `fake.mutations` is empty.
  - `convert turns the drafts into issues in the scope repository`: real run returns `converted` `[{ item, title, number: 1, id: '1', url: 'https://github.com/acme/widgets/issues/1' }, { ..., number: 2, id: '2' }]`; the fake's item keeps its Status value and now points to the issue; the issue has the draft's title, body and assignees.
  - `convert counts a repeated item once`: `[a, a]` converts once.
  - `convert refuses the whole batch when one id is wrong`: an issue item, an archived draft, an item of another Project and an unknown id each reject `INVALID_INPUT`, naming the id and `is an issue, not a draft`, `is archived`, `is not in acme/7`, `does not exist`; no mutation runs. 0 items and 51 items reject `INVALID_INPUT` `convert takes 1 to 50 item ids`.
  - `convert sends drafts to another repository with a warning`: `repo: 'acme/docs'` (registered in the fake) gives `target.tracked: false`, `id: null` and the warning `acme/docs is not tracker.scope.repo (acme/widgets), so pmkit will not track the new issues`; a missing repository rejects `NOT_FOUND` `GitHub has no repository acme/nope`; a repository with issues off rejects `INVALID_INPUT` `acme/docs has issues turned off`.
  - `convert stops on a failure partway and names what converted`: `fake.failNext('PmkitConvertDraftItem')` after the first succeeds (fail the second call) rejects `UPSTREAM` with message starting `GitHub converted 1 of 3 drafts, but <item2> failed:` and `error.converted` holding the first, `error.notConverted` the second and third ids. A failure on the first draft rejects with the client's own error.
  - `convertText` of a dry run is `would convert 2 drafts of acme/7 into issues in acme/widgets`.

- [ ] **Step 2: Run** the test file. Expected: FAIL on the new tests.

- [ ] **Step 3: Implement the fake target and mutation.** `PmkitDraftTarget({ owner, name })` returns `{ repository: { id, nameWithOwner, hasIssuesEnabled } }` (an entry's `hasIssuesEnabled !== false`), or `requireRepository`'s refusal. `PmkitConvertDraftItem(input, at)` refuses a non-draft with `unprocessable('The item is not a draft issue')`, creates the issue with `newIssue(repositoryById(input.repositoryId), { title, body, author: state.viewer })`, sets its assignees, sets `item.issueId` and deletes `item.draft`, and returns `{ convertProjectV2DraftIssueItemToIssue: { item: { id, content: { id, number, url, repository: { nameWithOwner } } } } }`. Pass `newIssue`, `repositoryById` and the user lookup through the helpers.

- [ ] **Step 4: Implement `convert`.** Dedupe in order, check the count, `parseItemId` each, resolve the Project, read the target (`TARGET`), read each item with `ITEM` (map the client's `NOT_FOUND` to the `does not exist` refusal), then return the dry run or convert one by one, wrapping a later failure as the `UPSTREAM` error above with `{ converted, notConverted }` as its data.

- [ ] **Step 5: Run** the test file. Expected: PASS.

- [ ] **Step 6: Commit** `feat: convert GitHub draft issues into issues (PMK-91)`.

### Task 3: the tracker and the CLI calls

**Files:**
- Modify: `scripts/lib/github/tracker.mjs` (return `draftIssues: scoped(draftIssueOperations({ client, scope: { ...scope, repo: scope.repo ?? '' } }))`)
- Modify: `scripts/pmkit.mjs` (import `listText` and `convertText`; two entries after the discussions ones)
- Test: `scripts/cli-draft-issues-github.test.mjs`, `scripts/lib/github/tracker.test.mjs` if it lists the tracker's keys

**Interfaces:**
- Consumes: `ctx.github('draftIssues')`.
- Produces: `github draft-issues list [--project owner/number] [--limit n]` (`github: true`, flags `project`, `limit`) and `github draft-issues convert <item...> [--project owner/number] [--repo owner/name]` (`write: true`, `dryRun: true`, `github: true`, `rest: 'item'`, flags `project`, `repo`).

- [ ] **Step 1: Write the failing CLI tests**, set up like `cli-discussions-github.test.mjs`: list in JSON and text; convert dry run then real run, with `fake.mutations` names `['PmkitConvertDraftItem']`; convert with no item fails with code 2; a broken config refuses convert and still lets list run; a Local tracker refuses both with `NOT_SUPPORTED` and the message ``\`github draft-issues list\` works only with the GitHub Issues tracker, and tracker.system is "local"``.
- [ ] **Step 2: Run** `node --test scripts/cli-draft-issues-github.test.mjs`. Expected: FAIL, unknown command.
- [ ] **Step 3: Wire the tracker and the two entries.** The convert entry passes `ctx.args` and `{ project: ctx.opt('project'), repo: ctx.opt('repo'), dryRun: ctx.dryRun }`; text output uses `convertText`.
- [ ] **Step 4: Run** the CLI test, `scripts/lib/github/tracker.test.mjs` and `scripts/cli.test.mjs`. Expected: PASS. If `--help` goldens list the commands, update them.
- [ ] **Step 5: Commit** `feat: add the github draft-issues CLI calls (PMK-91)`.

### Task 4: the command and its documentation

**Files:**
- Create: `commands/github/draft-issues.md`
- Modify: `scripts/plugin.test.mjs` (`github: ['discussions', 'draft-issues']` and one test for the new file), `commands/help.md`, `skills/pmkit/SKILL.md`, `README.md`, `CONTEXT.md` (term **Draft issue**), `CHANGELOG.md`

- [ ] **Step 1: Write the failing plugin test** `draft-issues.md stops on another tracker, previews the conversion and the field writes before them`: step 1 has `capabilities --json` and `works only with the GitHub Issues tracker`; step 2 calls `github draft-issues list`; step 3 has `AskUserQuestion`; step 4 calls `github draft-issues convert` with `--dry-run` only and has `AskUserQuestion`; step 5 calls it without `--dry-run`; step 6 calls `issues update` with `--dry-run` and later without it; the file has `never an instruction` and `never edits, archives or deletes a draft`.
- [ ] **Step 2: Run** `node --test scripts/plugin.test.mjs`. Expected: FAIL.
- [ ] **Step 3: Write the command file** from the spec's steps 1 to 7, in the shape of `commands/github/discussions.md` (front matter, parameters, steps, confirmation points, output, if something is missing). Then the README, help, SKILL, CONTEXT and CHANGELOG lines.
- [ ] **Step 4: Run** `node --test scripts/plugin.test.mjs scripts/changelog.test.mjs`. Expected: PASS.
- [ ] **Step 5: Commit** `feat: add /pmkit:github:draft-issues (PMK-91)`.

### Task 5: the runbook and its E2E test

**Files:**
- Create: `docs/runbooks/draft-issues-github.md`, `scripts/runbook-draft-issues-github.test.mjs`

- [ ] **Step 1: Write the E2E test** like `runbook-discussions-github.test.mjs`: setup with `--project acme/7`, two drafts and one archived draft seeded, a stateful fake `gh` on `PATH`. Steps: list (two drafts); convert dry run (nothing written); convert both (issues 1 and 2, the item keeps `Todo`); `issues update 1 --type feature --priority high --dry-run --json` then without `--dry-run`; `issues get 1` shows the type; a wrong id refuses the batch; `tracker.scope.project` removed gives `available: false`. Every call names `--hostname github.com` and none holds the token. A first test checks the runbook names each command.
- [ ] **Step 2: Run** it. Expected: FAIL, the runbook does not exist.
- [ ] **Step 3: Write the runbook** with the same steps and expected results.
- [ ] **Step 4: Run** `npm test`. Expected: PASS except the known PMK-333 failures (`github-host` default exec ENOENT, two `cli-pr` tests, the `validate-views` case clash).
- [ ] **Step 5: Commit** `test: add the draft-issues-github runbook (PMK-91)`.
