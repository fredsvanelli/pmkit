# pmkit core and Local tracker Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Create the `pmkit` plugin folder with its core (model, errors, IDs, config, actor), the Local tracker that keeps issues, comments, events, sprints and epics as files under `.issues/`, metrics, the capability manifest, a validator, and the `pmkit.mjs` CLI over all of it. No commands, no routing skill and no GitHub yet: those are the next plan.

**Architecture:** `scripts/lib/` holds pure modules. `scripts/lib/local/tracker.mjs` exports `createLocalTracker(root, options)`, an object with the contract operations of the spec, built on small modules for the issue file, the event log, queries, sprints and epics. `scripts/pmkit.mjs` parses arguments, loads the config, resolves the actor, calls one operation and prints a table or JSON. Every write goes through one path: load, check drift, validate, atomic write, append event.

**Tech Stack:** Node 18+ ES modules with no dependencies, `node:test`, `node:crypto` for IDs, `node:child_process` only for `git config` and `git` in `auto_commit`.

**Spec:** `docs/superpowers/specs/2026-10-23-pmkit-design.md`

## Global Constraints

- Node 18+, no dependencies. No Node 20 APIs (`Array.prototype.toSorted`, `toSpliced`, `Object.groupBy`). Imports use `node:` prefixes.
- Every reader replaces `\r\n` with `\n` and strips a leading BOM. Every writer writes `\n`.
- Paths are built with `path.join`. No file name contains `:`.
- Time and randomness are injected: `createLocalTracker(root, { now, random })`, where `now()` returns a `Date` and `random(n)` returns an integer in `[0, n)`. Defaults: `() => new Date()` and `crypto.randomInt`. Tests always pass both.
- Timestamps are ISO 8601 UTC with seconds and no milliseconds (`2026-10-23T21:12:00Z`). Dates are `YYYY-MM-DD`.
- Status categories, in this order: `triage`, `backlog`, `todo`, `in_progress`, `in_review`, `done`, `canceled`.
- Event ops: `create`, `update`, `move`, `assign`, `link`, `unlink`, `comment`, `log_time`, `archive`.
- Error codes: `NOT_CONFIGURED`, `NOT_FOUND`, `NOT_SUPPORTED`, `INVALID_INPUT`, `CONFLICT`, `AUTH`, `RATE_LIMITED`, `UPSTREAM`.
- Every YAML shape fits the YAML subset copied from `runbooks/scripts/lib/yaml.mjs`. No list of maps.
- CLI exit codes: 0 on success, 2 on a `PmkitError` or a usage error.
- Plugin version `0.1.0`.
- Run tests from `pmkit/`: `node --test "scripts/**/*.test.mjs"` (the `npm test` script). Every task ends with the whole suite green.
- Commits follow the repository style (`feat(pmkit): ...`, `test(pmkit): ...`, `docs(pmkit): ...`, `chore(pmkit): ...`) and end with the line `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Work on the branch `feat/pmkit-core`, not `main`.

## Review Focus

1. An `issue.md` with CRLF line endings and a BOM parses to the same issue as its LF copy, and the next write saves it with LF. Pinned in Task 7.
2. An `events.jsonl` produced by a union merge (lines out of order, one exact duplicate, one half-written line): replay gives the same state as the clean log, the duplicate counts once, and the broken line is reported, not thrown. Pinned in Task 8.
3. A frontmatter edited by hand (status changed from `todo` to `done` in an editor): the next write appends exactly one synthetic `move` event, dated with the file's mtime, and a second write appends none. Pinned in Task 8 and Task 9.
4. An issue file with git conflict markers: `searchIssues` returns every other issue and reports that one as a `CONFLICT` problem; `getIssue` on it throws `CONFLICT` with the next step `/pmkit:local:doctor`. Pinned in Task 12.
5. Five ID collisions in a row: the sixth attempt uses 5 characters and succeeds. Pinned in Task 4.
6. `--dry-run` on every write leaves every file byte-identical, including `events.jsonl`. Pinned in Task 9 and Task 18.

---

### Task 1: The plugin folder

**Files:**
- Create: `pmkit/.claude-plugin/plugin.json`
- Create: `pmkit/package.json`
- Create: `pmkit/README.md` (stub: title, one sentence, "Work in progress")
- Create: `pmkit/scripts/plugin.test.mjs`

**Interfaces:**
- Produces: `pmkit/` with a manifest the marketplace can read later. The marketplace entry and the root README row are added in the next plan, when the commands exist.

- [ ] **Step 1: Write the failing test**

```js
// pmkit/scripts/plugin.test.mjs
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

test('the plugin manifest names pmkit and its version', () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, '.claude-plugin/plugin.json'), 'utf8'))
  assert.equal(manifest.name, 'pmkit')
  assert.match(manifest.version, /^\d+\.\d+\.\d+$/)
  assert.equal(typeof manifest.description, 'string')
})

test('package.json has no dependencies', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'))
  assert.equal(pkg.dependencies, undefined)
  assert.equal(pkg.devDependencies, undefined)
})
```

- [ ] **Step 2: Run it and see it fail**

Run: `node --test scripts/plugin.test.mjs` from `pmkit/`.
Expected: FAIL, `plugin.json` missing.

- [ ] **Step 3: Write the files**

`plugin.json`: `name: pmkit`, `version: 0.1.0`, `description: "Project management for development agents: issues, sprints and epics in one command set across trackers, starting with a local tracker kept in the repository."`, `author: { name: "Fred Vanelli" }`, `repository: "https://github.com/fredsvanelli/skills"`. `package.json`: `name: pmkit`, `private: true`, `type: module`, `scripts.test: node --test "scripts/**/*.test.mjs"`.

- [ ] **Step 4: Run the suite**

Run: `node --test "scripts/**/*.test.mjs"`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add pmkit
git commit -m "chore(pmkit): add the plugin folder"
```

---

### Task 2: The YAML subset

**Files:**
- Create: `pmkit/scripts/lib/yaml.mjs` (copy of `runbooks/scripts/lib/yaml.mjs`, plus `stringifyYaml`)
- Create: `pmkit/scripts/yaml.test.mjs`

**Interfaces:**
- Produces: `splitFrontmatter(text) -> { yaml, body } | null`, `parseYaml(text) -> object` (throws `FrontmatterError`), `stringifyYaml(object, { order }) -> string`, `joinFrontmatter(object, body, { order }) -> string`.
- `stringifyYaml` writes top-level keys in `order` first, then the rest alphabetically; skips `undefined`, `null`, `''` and empty arrays; writes arrays of scalars as flow lists (`[a, b]`), plain objects of scalars as flow maps (`{ a: 1 }`) and nested objects of objects as block maps; quotes a scalar when it is empty, starts or ends with a space, contains `: `, ` #`, `[`, `]`, `{`, `}`, `,`, starts with a YAML indicator (`-?:&*!|>'"%@` or backtick), or would parse as a number, boolean or null but is a string.

- [ ] **Step 1: Copy the parser and its tests' shapes**

Copy `runbooks/scripts/lib/yaml.mjs` as is. Do not import from `runbooks/`: plugins install independently.

- [ ] **Step 2: Write the failing tests**

Cases, each a `test`:
- the issue frontmatter of the spec parses to the expected object (ids, flow list of labels, dates as strings);
- `.issues/config.yaml` of the spec parses: `statuses.triage.category === 'triage'`, `members.fred.availability === 1`, `estimate.scale` is `[1, 2, 3, 5, 8, 13]`;
- the sprint file of the spec parses, including `days_off.ana` as a list;
- `stringifyYaml` then `parseYaml` round-trips the three objects above;
- `stringifyYaml({ title: 'a: b', note: '#x', n: '12', yes: 'true' })` quotes all four values;
- `joinFrontmatter` writes `---\n<yaml>---\n\n<body>` and `splitFrontmatter` reads it back;
- `splitFrontmatter` accepts CRLF and a BOM.

- [ ] **Step 3: Run and see the stringify tests fail**

Run: `node --test scripts/yaml.test.mjs`
Expected: parse cases PASS (copied parser), stringify cases FAIL.

- [ ] **Step 4: Implement `stringifyYaml` and `joinFrontmatter`**

- [ ] **Step 5: Run the suite and commit**

```bash
git add pmkit/scripts
git commit -m "feat(pmkit): YAML subset with a writer"
```

---

### Task 3: Errors and the model

**Files:**
- Create: `pmkit/scripts/lib/errors.mjs`
- Create: `pmkit/scripts/lib/model.mjs`
- Create: `pmkit/scripts/model.test.mjs`

**Interfaces:**
- Produces: `class PmkitError extends Error { code, nextStep, details }`, `ERROR_CODES`, `isPmkitError(e)`.
- Produces: `CATEGORIES` (the seven, in order), `isCategory(s)`, `TERMINAL = ['done', 'canceled']`, `EVENT_OPS`, `LINK_KINDS = ['blocks', 'related', 'duplicate']`, `isBlocked(issue, byId) -> boolean` (true when some id in `issue.blockedBy` maps to an issue whose `status.category` is not terminal; an id missing from `byId` counts as blocking), `JSDoc` typedefs for Issue, Comment, Event, Sprint, Epic, StatusUpdate, Member.

- [ ] **Step 1: Write the failing tests**

- `new PmkitError('NOT_FOUND', 'no ISS-1', 'Run pmkit issues list')` has `code`, `message`, `nextStep`, and `instanceof Error`;
- an unknown code throws `TypeError`;
- `CATEGORIES` equals the seven in order;
- `isBlocked` is false with no blockers, true with a blocker in `todo`, false when every blocker is `done` or `canceled`, true for a blocker id that is not in `byId`.

- [ ] **Step 2: Run, implement, run the suite**

- [ ] **Step 3: Commit**

```bash
git commit -am "feat(pmkit): errors and the common model"
```

---

### Task 4: IDs

**Files:**
- Create: `pmkit/scripts/lib/ids.mjs`
- Create: `pmkit/scripts/ids.test.mjs`

**Interfaces:**
- Produces: `ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'`, `newId(prefix, { random, exists }) -> string`, `normalizeId(input) -> string` (trims, upper-cases, maps `I` and `L` to `1` and `O` to `0` in the code part, as Crockford decoding does), `isId(s, prefix) -> boolean` (`^<prefix>-[ALPHABET]{4,6}$`), `branchName(id, title) -> string`.
- `newId` draws 4 characters with `random(32)`; when `exists(id)` is true it draws again; after 5 collisions it draws 5 characters; after 5 more, 6; after that it throws `PmkitError('CONFLICT', ...)`.
- `branchName('ISS-7K3Q', 'Retry failed webhook deliveries!')` is `iss-7k3q-retry-failed-webhook-deliveries`: lower-case ID, then the title lower-cased, accents removed (`normalize('NFD')`), non-alphanumerics collapsed to `-`, trimmed of `-`, cut at 40 characters on a `-` boundary.

- [ ] **Step 1: Write the failing tests**

```js
test('newId uses 5 characters after 5 collisions', () => {
  const seq = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 2, 3, 4, 5]
  let i = 0
  const random = () => seq[i++]
  const taken = new Set(['ISS-0000'])
  const id = newId('ISS', { random, exists: (x) => taken.has(x) })
  assert.equal(id, 'ISS-12345')
})
```

Plus: a fresh id matches `isId`; `normalizeId(' iss-7k3o ')` is `ISS-7K30`; `isId('ISS-7K3U', 'ISS')` is false (U is not in the alphabet); the `branchName` example above; a title of only symbols gives `iss-7k3q`.

- [ ] **Step 2: Run, implement, run the suite, commit**

```bash
git commit -am "feat(pmkit): issue and epic ids"
```

---

### Task 5: Templates and config

**Files:**
- Create: `pmkit/templates/pmkit.config.yaml`
- Create: `pmkit/templates/issues.config.yaml`
- Create: `pmkit/templates/issues.gitattributes` (`events.jsonl merge=union`)
- Create: `pmkit/templates/issues.gitignore` (`.cache/`)
- Create: `pmkit/scripts/lib/config.mjs`
- Create: `pmkit/scripts/config.test.mjs`
- Create: `pmkit/scripts/__fixtures__/basic/` (a repository with `.pmkit/config.yaml`, `.issues/config.yaml` and no issues yet)

**Interfaces:**
- Produces: `loadConfig(root) -> { pmkit, local, root, issuesDir }`. Reads `<root>/.pmkit/config.yaml`; throws `NOT_CONFIGURED` (next step `/pmkit:setup`) when missing; throws `NOT_SUPPORTED` when `tracker.system` is not `local`; reads `<root>/<tracker.path>/config.yaml` and applies defaults.
- Produces: `validatePmkitConfig(obj) -> string[]` and `validateLocalConfig(obj) -> string[]`, each a list of problems (empty when valid), and `withLocalDefaults(obj) -> object`.
- Produces: `findRoot(start) -> string`: the nearest folder upward that holds `.pmkit/config.yaml`, else the nearest with `.git`, else `start`.
- Local config rules, one problem string each: `version` is 1; `id_prefix` and `epic_prefix` match `^[A-Z]{2,5}$` and differ; every status has a `category` from `CATEGORIES`; every category has at least one status; `default_status` is a status; `types` and `priorities` are non-empty lists of strings; `estimate.unit` is `points`, `hours` or `sizes`; member ids match `^[a-z0-9][a-z0-9-]*$` or `^agent:[a-z0-9-]+$`; `availability` is a number from 0 to 1; every `defaults` value is a positive integer except `sprint_start_weekday`, one of `mon` to `sun`.
- Defaults: the values of the spec for `types`, `priorities`, `estimate`, `defaults`, `default_status: backlog`, `epic_prefix: EPC`, `auto_commit: false`, `labels: []`, `members: {}`.

- [ ] **Step 1: Write the failing tests**

- the fixture loads, `config.issuesDir` is `<fixture>/.issues`, defaults applied;
- a folder without `.pmkit/config.yaml` throws `NOT_CONFIGURED` with next step `/pmkit:setup`;
- `tracker.system: jira` throws `NOT_SUPPORTED`;
- a local config whose `done` status is missing gives the problem `category done has no status`;
- a status with `category: blocked` gives `status x: unknown category blocked`;
- both templates parse and validate with no problem;
- `findRoot` from a subfolder of the fixture returns the fixture root.

- [ ] **Step 2: Run, implement, run the suite, commit**

```bash
git commit -am "feat(pmkit): config files and their templates"
```

---

### Task 6: The actor

**Files:**
- Create: `pmkit/scripts/lib/actor.mjs`
- Create: `pmkit/scripts/actor.test.mjs`

**Interfaces:**
- Produces: `resolveActor(localConfig, { email, env }) -> { id, member } | null`. `email` defaults to the output of `git config user.email` (empty on failure), `env` to `process.env`. Matches the member whose `email` equals it, case-insensitive; else `env.PMKIT_USER` when it is a member id; else null.
- Produces: `requireActor(...)` which throws `NOT_CONFIGURED` with next step `Add yourself to members in .issues/config.yaml or set PMKIT_USER` when `resolveActor` is null.
- Produces: `gitUserEmail(cwd) -> string`, the only function here that spawns a process.

- [ ] **Step 1: Tests** for email match, case-insensitive match, `PMKIT_USER` fallback, `PMKIT_USER` naming a non-member (null), and `requireActor` throwing.

- [ ] **Step 2: Run, implement, run the suite, commit**

```bash
git commit -am "feat(pmkit): resolve the current member"
```

---

### Task 7: The issue file

**Files:**
- Create: `pmkit/scripts/lib/local/issue-file.mjs`
- Create: `pmkit/scripts/issue-file.test.mjs`

**Interfaces:**
- Produces: `ISSUE_KEYS`, the frontmatter key order: `id, title, type, status, priority, estimate, assignee, labels, parent, blocked_by, related, duplicate_of, sprint, milestone, due, branch, archived, created, updated`.
- Produces: `parseIssueFile(text, { statuses }) -> Issue`. Normalizes CRLF and BOM. Maps frontmatter to the model (`blocked_by` → `blockedBy`, `duplicate_of` → `duplicateOf`), sets `status` to `{ name, category }` from `statuses` (an unknown status gets `category: null`, reported by `validate` later), reads the body: the text under `## Description` up to the next `## ` heading is `description` (trimmed), and the task items under `## Acceptance criteria` are `acceptanceCriteria` (`- [ ] text` → `{ text, done: false }`, `- [x]` or `- [X]` → `done: true`). Keeps the full body as `body` so other sections survive.
- Produces: `serializeIssue(issue) -> string`. Writes frontmatter in `ISSUE_KEYS` order, then the body: when the issue's `description` or `acceptanceCriteria` changed from what `body` holds, it replaces only those two sections and keeps every other section in place; a missing section is appended in the order Description, Acceptance criteria.
- Throws `PmkitError('CONFLICT', ..., '/pmkit:local:doctor')` when the text contains a line starting with `<<<<<<< `, `=======` on its own line between markers, or `>>>>>>> `.
- Throws `PmkitError('INVALID_INPUT', ...)` when the frontmatter is missing or does not parse.

- [ ] **Step 1: Write the failing tests**

- the spec's issue file parses to the expected Issue, including two criteria not done;
- the same file with CRLF and a BOM parses to a deep-equal Issue;
- `serializeIssue(parseIssueFile(x))` equals `x` for the spec's file (LF);
- changing `acceptanceCriteria[0].done` and serializing changes only that line;
- a body with a `## Notes` section between the two known ones keeps it, in place, after a description change;
- a file with conflict markers throws `CONFLICT`;
- a file without frontmatter throws `INVALID_INPUT`.

- [ ] **Step 2: Run, implement, run the suite, commit**

```bash
git commit -am "feat(pmkit): read and write issue files"
```

---

### Task 8: The event log and drift

**Files:**
- Create: `pmkit/scripts/lib/local/events.mjs`
- Create: `pmkit/scripts/events.test.mjs`

**Interfaces:**
- Produces: `readEvents(file) -> { events, problems }`. Missing file → `{ events: [], problems: [] }`. Splits lines, skips empty ones, parses each with `JSON.parse`; a line that does not parse or misses `at`, `by` or `op` becomes a problem `line <n>: <reason>`; removes exact duplicate lines (same JSON text after parse and `JSON.stringify` with sorted keys); sorts by `at`, stable for ties.
- Produces: `appendEvents(file, events)`: appends one line per event with `fs.appendFileSync`, keys in the order `at, by, op, field, from, to, minutes, synthetic`, omitting `undefined`.
- Produces: `replay(events) -> object`: the field values the events lead to. `create` sets every field in `to`; `update`, `move` and `assign` set `field` to `to`; `link` and `unlink` add or remove `to` in the list named by `field` (`blocked_by`, `related`, `duplicate_of`); `archive` sets `archived: true`; `comment` and `log_time` change no field.
- Produces: `driftEvents(frontmatter, events, { at, by }) -> Event[]`: compares `replay(events)` with the frontmatter for every key in `ISSUE_KEYS` except `id`, `created`, `updated`; returns one synthetic event per differing key: `move` for `status`, `assign` for `assignee`, `update` otherwise, with `from` the replayed value and `to` the frontmatter value, `synthetic: true`. No events at all (a file created by hand) gives one synthetic `create` with the whole frontmatter.

- [ ] **Step 1: Write the failing tests**

```js
test('a union-merged log replays like the clean one', () => {
  const clean = [
    { at: '2026-10-01T10:00:00Z', by: 'fred', op: 'create', to: { title: 'A', status: 'todo' } },
    { at: '2026-10-02T10:00:00Z', by: 'fred', op: 'move', field: 'status', from: 'todo', to: 'in_progress' },
    { at: '2026-10-03T10:00:00Z', by: 'ana', op: 'assign', field: 'assignee', to: 'ana' },
  ]
  const merged = [clean[2], clean[0], clean[1], clean[1]].map((e) => JSON.stringify(e)).join('\n') + '\n{"at":"2026-10-04'
  const file = write(tmp(), 'events.jsonl', merged)
  const { events, problems } = readEvents(file)
  assert.deepEqual(events, clean)
  assert.equal(problems.length, 1)
  assert.deepEqual(replay(events), { title: 'A', status: 'in_progress', assignee: 'ana' })
})
```

Plus: a hand edit of `status` gives exactly one synthetic `move`; applying it and calling `driftEvents` again gives none; a frontmatter with no events gives one synthetic `create`; link and unlink of `blocked_by` replay to the right list; `appendEvents` writes LF lines with keys in order.

- [ ] **Step 2: Run, implement, run the suite, commit**

```bash
git commit -am "feat(pmkit): event log with replay and drift"
```

---

### Task 9: Local tracker, issue writes

**Files:**
- Create: `pmkit/scripts/lib/local/store.mjs`
- Create: `pmkit/scripts/lib/local/tracker.mjs`
- Create: `pmkit/scripts/tracker-issues.test.mjs`
- Create: `pmkit/scripts/test-helpers.mjs` (temp repo from a fixture, fixed `now`, scripted `random`)

**Interfaces:**
- Produces in `store.mjs`: `issuePaths(issuesDir, id) -> { dir, file, events, comments }`, `listIssueIds(issuesDir) -> string[]` (folder names that pass `isId`), `writeFileAtomic(file, text)` (writes `<file>.tmp-<pid>-<n>` in the same folder, then `fs.renameSync`), `fileMtimeIso(file)`.
- Produces in `tracker.mjs`: `createLocalTracker(root, { config, now, random, gitEmail, env })`. When `config` is omitted it calls `loadConfig(root)`. Returns an object with, for this task:
  - `getIssue(id)`: normalizes the id, throws `NOT_FOUND` (next step `pmkit issues list`) when the folder is missing, returns the parsed Issue plus `blocks` (empty here; Task 10 fills it).
  - `createIssue(input, actor, { dryRun })`: requires `title`; `type` defaults to the first type, `status` to `default_status`; validates `type`, `priority`, `estimate` (in `scale` when the unit is `points` or `sizes`, a positive number when `hours`), `assignee` (a member), `labels` (each in `labels` when that list is not empty), `parent` (an existing issue or epic), `sprint` (an existing sprint file), `due` (a date); writes `issue.md` with `created` and `updated` set to `now()`, appends a `create` event whose `to` holds every field written. Returns `{ before: null, after }`.
  - `updateIssue(id, patch, actor, { dryRun })`: same validations; refuses `id`, `created`, `status` (use `moveToCategory`) and `assignee` (use `assign`) with `INVALID_INPUT`; writes one `update` event per changed field; a patch that changes nothing writes nothing and returns `before` equal to `after`.
  - `moveToCategory(id, category, actor, { status, dryRun })`: picks the first status of the category in config order, or `status` when given (must belong to the category); one `move` event.
  - `assign(id, memberOrNull, actor, { dryRun })`: one `assign` event; `null` unassigns.
  - `archive(id, actor, { dryRun })`: sets `archived: true`, one `archive` event.
  - Every write, before validating: reads the events, calls `driftEvents` with `at: fileMtimeIso(file)` and `by: actor`, appends them when not a dry run. Then sets `updated: now()`.
  - Every write with `dryRun: true` returns `{ before, after }` and writes nothing, synthetic events included.
  - `actor` must be a member id; otherwise `INVALID_INPUT`.

- [ ] **Step 1: Write the failing tests**

- create with scripted random writes `issues/ISS-1234/issue.md`, its frontmatter has the defaults, `events.jsonl` has one `create`;
- create with `type: epic` (not in config) throws `INVALID_INPUT` naming the allowed types;
- update `priority` writes one `update` event with `from` and `to`;
- update `status` throws `INVALID_INPUT` with next step `pmkit issues move`;
- move to `in_review` sets status `in_review`; move to `done` with `status: shipped` when `shipped` is not a `done` status throws;
- hand-edit `status: done` in the file, then `assign`: the log ends with a synthetic `move` (at the file mtime) then the `assign`;
- every write with `dryRun: true` leaves the issue folder byte-identical (compare a hash of every file before and after);
- `getIssue('iss-1234')` finds `ISS-1234`.

- [ ] **Step 2: Run, implement, run the suite, commit**

```bash
git commit -am "feat(pmkit): local tracker issue writes"
```

---

### Task 10: Relations and parents

**Files:**
- Modify: `pmkit/scripts/lib/local/tracker.mjs`
- Create: `pmkit/scripts/tracker-relations.test.mjs`

**Interfaces:**
- Produces: `link(from, to, kind, actor, { dryRun })` and `unlink(...)`. `blocks`: `from` blocks `to`, so `from` is added to `to`'s `blocked_by`, and the event is written on `to`. `related`: added to both issues' `related`, one event on each. `duplicate`: `from` is a duplicate of `to`, so `to` goes in `from`'s `duplicate_of`. Linking an issue to itself, or a `blocks` link that closes a cycle, throws `INVALID_INPUT` naming the cycle path. Linking twice is a no-op.
- Produces: `setParent(id, parentOrNull, actor, { dryRun })`. The parent is an issue or an epic; a parent chain that loops throws `INVALID_INPUT`.
- `getIssue` and `searchIssues` fill `blocks` (the ids whose `blocked_by` holds this issue) and `children` (the ids whose `parent` is this issue).

- [ ] **Step 1: Tests** for each kind, the cycle check (`A blocks B`, `B blocks C`, then `C blocks A` fails with `C → A → B → C`), the self link, the idempotent second link, `blocks` and `children` on read, and `unlink` restoring the previous lists.

- [ ] **Step 2: Run, implement, run the suite, commit**

```bash
git commit -am "feat(pmkit): links and parents"
```

---

### Task 11: Comments, history and time

**Files:**
- Modify: `pmkit/scripts/lib/local/tracker.mjs`
- Create: `pmkit/scripts/tracker-comments.test.mjs`

**Interfaces:**
- Produces: `comment(id, body, actor, { dryRun })`: writes `comments/<at with : replaced by ->-<actor>.md` with frontmatter `author`, `created` and the body; when the file exists (two comments in the same second), appends `-2`, `-3`; one `comment` event with `to` the comment file name. Returns the Comment.
- Produces: `listComments(id) -> Comment[]`, sorted by `created`, then by file name.
- Produces: `getHistory(id, { since }) -> Event[]` from `readEvents`, filtered by `at >= since`.
- Produces: `logTime(id, minutes, actor, { dryRun })`: `minutes` a positive integer; one `log_time` event.

- [ ] **Step 1: Tests** for the comment file name (no `:`), two comments in the same second, list order, history filtered by `since`, `logTime` rejecting `0` and `1.5`.

- [ ] **Step 2: Run, implement, run the suite, commit**

```bash
git commit -am "feat(pmkit): comments, history and time"
```

---

### Task 12: Search

**Files:**
- Create: `pmkit/scripts/lib/local/query.mjs`
- Modify: `pmkit/scripts/lib/local/tracker.mjs`
- Create: `pmkit/scripts/query.test.mjs`
- Create: `pmkit/scripts/__fixtures__/team/` (about 12 issues across every category, two members, one sprint, one epic, one archived issue, one issue with conflict markers)

**Interfaces:**
- Produces: `searchIssues(filter) -> { issues, problems }`. Reads every issue folder; an issue that throws (`CONFLICT`, `INVALID_INPUT`) becomes a problem `{ id, code, message }` and the search goes on. Filter keys of the spec: `text` (case-insensitive, in title and description), `categories`, `types`, `assignee` (`me` resolves through the actor, `none` means unassigned), `labels` (all of them), `sprint` (`current` resolves through `currentCycle`, `none` means no sprint), `parent`, `blocked` (`true` or `false`, through `isBlocked`), `updatedBefore`, `updatedAfter`, `archived` (default false), `sort`, `limit`.
- Sort: `priority` by the config order of priorities (missing last), then `updated` descending; `updated` descending; `created` ascending; `due` ascending (missing last). Default `priority`.
- `getIssue` on the conflicted issue throws `CONFLICT` with next step `/pmkit:local:doctor`.

- [ ] **Step 1: Tests** against the `team` fixture: one per filter key, `me` resolution (`sprint: current` needs `currentCycle` and is tested in Task 13), the conflicted issue reported in `problems` while the rest return, archived hidden by default, each sort order, `limit`.

- [ ] **Step 2: Run, implement, run the suite, commit**

```bash
git commit -am "feat(pmkit): search local issues"
```

---

### Task 13: Sprints and capacity

**Files:**
- Create: `pmkit/scripts/lib/local/sprints.mjs`
- Modify: `pmkit/scripts/lib/local/tracker.mjs`
- Create: `pmkit/scripts/sprints.test.mjs`

**Interfaces:**
- Produces: `listCycles({ state })`, sorted by `start`; `currentCycle()` (the `active` sprint or null); `cycleIssues(id)` (issues whose `sprint` is the id, archived excluded); `openCycle({ start, end, goal, name }, actor, { dryRun })`; `closeCycle(id, actor, { dryRun }) -> { sprint, unfinished }`; `moveToCycle(ids, sprintOrNull, actor, { dryRun })` (one `update` event per issue on field `sprint`); `getCapacity(id)`; `setCapacity(id, map, actor, { dryRun })` (keys must be members, values non-negative numbers).
- `openCycle`: `end` defaults to `start + sprint_length_days - 1`; `name` to `Sprint <start>`; refuses an overlap with a planned or active sprint; refuses `start` after `end`; state is `active` when `start <= today` and no sprint is active, else `planned`. `capacity` starts empty; `/pmkit:cycle:plan` proposes it from velocity and availability and sets it with `setCapacity`.
- `closeCycle`: refuses a sprint that is not active; sets `closed`; returns the issues not in a terminal category.
- Sprint writes go through `writeFileAtomic` and the YAML writer with key order `name, start, end, goal, state, capacity, days_off`. Sprints have no event log; the issues' `sprint` events record membership.

- [ ] **Step 1: Tests** for the default end, the overlap refusal, active versus planned on open, `searchIssues({ sprint: 'current' })` on the `team` fixture, close returning unfinished issues, closing a planned sprint refused, `moveToCycle` to `null`, capacity validation.

- [ ] **Step 2: Run, implement, run the suite, commit**

```bash
git commit -am "feat(pmkit): sprints and capacity"
```

---

### Task 14: Epics and status updates

**Files:**
- Create: `pmkit/scripts/lib/local/epics.mjs`
- Modify: `pmkit/scripts/lib/local/tracker.mjs`
- Create: `pmkit/scripts/epics.test.mjs`

**Interfaces:**
- Produces: `listDeliverables()`, `getDeliverable(id)`, `createDeliverable({ title, start, target, milestone, description }, actor, { dryRun })` (id with `epic_prefix`, status `default_status`, `events.jsonl` with a `create`), `deliverableProgress(id) -> { total, done, canceled, points, pointsDone, byCategory }` (issues whose parent chain reaches the epic, archived excluded; canceled issues count in `canceled` and not in `total`), `publishStatusUpdate({ epic, health, body }, actor, { dryRun })` (file `updates/<date>-<actor>.md`, `-2` on a second update the same day), `listStatusUpdates(epic)`, newest first.
- `health` must be `on_track`, `at_risk` or `off_track`.

- [ ] **Step 1: Tests** for create, a two-level parent chain counted in progress, canceled excluded from `total`, points summed only from numeric estimates, two updates the same day, invalid health.

- [ ] **Step 2: Run, implement, run the suite, commit**

```bash
git commit -am "feat(pmkit): epics and status updates"
```

---

### Task 15: Metrics and the event range

**Files:**
- Create: `pmkit/scripts/lib/metrics.mjs`
- Modify: `pmkit/scripts/lib/local/tracker.mjs`
- Create: `pmkit/scripts/metrics.test.mjs`

**Interfaces:**
- Produces in the tracker: `metricEvents({ since, until }) -> Array<Event & { issue }>`: every issue's events in the range, each tagged with its issue id, sorted by `at`.
- Produces in `metrics.mjs` (pure, no file access):
  - `velocity(sprints, issuesBySprint, { window, categoryOf }) -> { perSprint: [{ id, points, count }], average, unit }`: the last `window` closed sprints; points from numeric estimates of issues done by the sprint's end; `average` of points, or of counts when no issue has a numeric estimate (then `unit: 'issues'`).
  - `cycleTimes(eventsByIssue, { categoryOf }) -> [{ issue, days }]`: from the first move into `in_progress` to the last move into `done`, in calendar days with one decimal; issues never started or not done are skipped.
  - `summary(values) -> { count, median, p85 }`.
  - `businessDaysBetween(a, b)`: Monday to Friday, for the "stuck" threshold.
- `categoryOf(statusName)` comes from the config and is passed in, so these functions stay pure.

- [ ] **Step 1: Tests** with hand-built events: velocity over 3 of 4 closed sprints, the fallback to counts, cycle time for an issue that went back from `in_review` to `in_progress` (first start, last done), median and p85 of `[1, 2, 3, 4, 10]` (3 and 7.6 with linear interpolation), business days across a weekend.

- [ ] **Step 2: Run, implement, run the suite, commit**

```bash
git commit -am "feat(pmkit): velocity and cycle time"
```

---

### Task 16: Discovery and the capability manifest

**Files:**
- Create: `pmkit/scripts/lib/capabilities.mjs`
- Modify: `pmkit/scripts/lib/local/tracker.mjs`
- Create: `pmkit/scripts/capabilities.test.mjs`

**Interfaces:**
- Produces: `CAPABILITIES`, the 20 ids in the spec's order.
- Produces in the tracker: `discover() -> { statuses: [{ name, category }], types, priorities, labels, members: [{ id, name, email, availability }], estimate }` and `capabilities() -> { tracker: 'local', gitHost, generatedAt, capabilities }`.
- Local paths: `native` for 15, `derived` for `native_metrics` (`detail: { source: 'events' }`), `linked_code` (`detail: { source: 'git' }`, and `enableHint: 'Set git_host in .pmkit/config.yaml'` when `git_host.system` is `none`), `agent_delegation` (`detail: { assignee: 'agent:<name>' }`), `security_alerts` (`detail: { source: 'local scanners' }`), `user_inbox` (`detail: { source: 'mentions and assignments since the last check' }`). `estimation.detail` is `{ unit, scale }`.
- Every capability is listed, so a consumer never has to treat a missing key.

- [ ] **Step 1: Tests**: 20 entries, the derived ones as listed, the hint with `git_host: none`, `estimation.detail` from the config, `discover` statuses in config order with categories.

- [ ] **Step 2: Run, implement, run the suite, commit**

```bash
git commit -am "feat(pmkit): discovery and the capability manifest"
```

---

### Task 17: Validate

**Files:**
- Create: `pmkit/scripts/lib/validate.mjs`
- Create: `pmkit/scripts/validate.test.mjs`
- Create: `pmkit/scripts/__fixtures__/broken/` (one problem of each kind below)

**Interfaces:**
- Produces: `validateRepo(root, { config }) -> { checked: { issues, epics, sprints, comments }, problems: [{ path, code, message }] }`. Read-only.
- Problems, each with a `code`:
  - `config`: every message of `validateLocalConfig`;
  - `conflict`: conflict markers in any `.md` or `.yaml` file;
  - `frontmatter`: missing or unparseable frontmatter;
  - `id`: folder name and `id` differ, an id that fails `isId`, two folders with the same normalized id;
  - `value`: a `status`, `type`, `priority`, `assignee`, `label` or `estimate` not allowed by the config;
  - `reference`: a `parent`, `blocked_by`, `related`, `duplicate_of`, `sprint` or `milestone` that does not exist;
  - `cycle`: a `blocked_by` or `parent` cycle, with its path;
  - `events`: every problem of `readEvents`;
  - `drift`: frontmatter that differs from the replayed events (informational; the next write fixes it);
  - `sprint`: overlapping sprints, more than one active, `start` after `end`.

- [ ] **Step 1: Tests**: the `broken` fixture returns exactly one problem per kind, with the right path; the `team` fixture minus its conflicted issue returns none; `validateRepo` writes nothing.

- [ ] **Step 2: Run, implement, run the suite, commit**

```bash
git commit -am "feat(pmkit): validate a local tracker"
```

---

### Task 18: The CLI

**Files:**
- Create: `pmkit/scripts/lib/args.mjs` (like `runbooks/scripts/lib/args.mjs`, plus support for two-word commands and repeated `--set`)
- Create: `pmkit/scripts/lib/format.mjs` (tables and plain-text output)
- Create: `pmkit/scripts/pmkit.mjs`
- Create: `pmkit/scripts/cli.test.mjs`

**Interfaces:**
- Produces: `pmkit.mjs`, executable with `node`, with every command of the spec's CLI table except `pr open`, `pr status` and `pr sync` (next plan). `--help` and an unknown command print `USAGE` and exit 2.
- Root: `--root <dir>` or `findRoot(process.cwd())`.
- `init`: writes `.pmkit/config.yaml` from the template (`tracker.system: local`, `git_host.system` from `--git-host`, default `none`; `git_host.repo` from `git remote get-url origin` when it is a GitHub URL), scaffolds `.issues/` (config from the template with `--prefix`, one member from `--member`, `--name`, `--email`, `.gitattributes`, `.gitignore`, empty `issues/`, `epics/`, `sprints/`, `docs/` with a `.gitkeep` each). Refuses with `CONFLICT` when `.pmkit/config.yaml` or `.issues/config.yaml` exists. `--dry-run` prints the files it would write.
- Writes resolve the actor with `requireActor`, unless `--as <member>` is passed **(builder's call: for tests and agents acting for a teammate)**.
- Output: without `--json`, lists are tables (`ID | Title | Status | Assignee | Estimate`, and `Sprint` when not filtered by sprint) and records are `key: value` lines plus the body; writes print `before → after` for each changed field. With `--json`, one JSON value on stdout: the operation's return value, plus `problems` when the operation has them.
- Errors: `PmkitError` prints `error: <message>` and `next: <nextStep>` on stderr, or `{ "error": {...} }` on stdout with `--json`; exit 2. Any other exception prints `error: unexpected: <message>` and exits 2.
- Bodies: `--description-file`, `--criteria-file` (one criterion per line, `- [ ]` prefixes optional) and `--body-file` read a file, or stdin when the value is `-`.
- `issues update --check n` and `--uncheck n` tick or untick the n-th acceptance criterion (1-based).

- [ ] **Step 1: Write the failing tests**

Run the CLI as a child process (`spawnSync(process.execPath, [CLI, ...args], { cwd, env })`) on a temp copy of a fixture, with `PMKIT_USER=fred`, a fixed time through `PMKIT_NOW=2026-10-23T12:00:00Z` and a fixed seed through `PMKIT_SEED=1` **(builder's call: env overrides read only by the CLI, never by the library)**:
- `init --tracker local --member fred --name Fred --email f@x.dev` in an empty git repo creates every file; a second `init` exits 2 with `CONFLICT`;
- `issues create --title "First" --json` prints an issue with an id; `issues list --json` returns it;
- `issues move <id> in_progress` prints `status: backlog → in_progress`;
- `issues update <id> --priority high --dry-run` prints the change and leaves the folder byte-identical;
- `issues get NOPE-1234` exits 2 with `error:` and `next:` on stderr;
- with `--json`, the same error is a JSON object on stdout;
- `cycle open --start 2026-10-19` then `cycle add <id> --to 2026-10-19` then `cycle current --json`;
- `epic create --title E`, `issues parent <id> <epic>`, `epic progress <epic> --json` returns `total: 1`;
- `metrics velocity --json` on the `team` fixture returns its known numbers;
- `validate` on the `broken` fixture exits 0 and lists every problem (validation findings are output, not errors);
- `capabilities --json` lists 20 capabilities;
- `--help` lists every command.

- [ ] **Step 2: Run, implement, run the suite, commit**

```bash
git commit -am "feat(pmkit): the pmkit CLI"
```

---

### Task 19: The contract suite

**Files:**
- Create: `pmkit/scripts/lib/contract.mjs`
- Create: `pmkit/scripts/contract-suite.mjs`
- Create: `pmkit/scripts/contract.test.mjs`

**Interfaces:**
- Produces in `contract.mjs`: `TRACKER_OPERATIONS`, the list of the spec's tracker operation names, and `assertTracker(obj)`, which throws listing the missing ones.
- Produces in `contract-suite.mjs`: `runTrackerContract({ name, setup })`, where `setup()` returns `{ tracker, actor, teardown }` on a tracker with at least two statuses per category path, one member and no issues. It registers `node:test` tests that use only contract operations: create → get → update → move through every category → assign → link blocks and see `blocked` change → comment → history in order → open a cycle, add, close and get the unfinished list → create an epic, parent an issue, read progress → log time → archive and see search skip it → every dry run changes nothing that a following `getIssue` or `getHistory` can see.
- `contract.test.mjs` runs the suite on `createLocalTracker` with a temp repo from `basic`. Future adapters run the same suite against their sandboxes.

- [ ] **Step 1: Write the suite and the Local run**

- [ ] **Step 2: Run the whole suite**

Expected: PASS. Fix the tracker, not the suite, when a contract test fails.

- [ ] **Step 3: Commit**

```bash
git commit -am "test(pmkit): contract suite for tracker adapters"
```

---

### Task 20: Glossary, ADRs and README

**Files:**
- Create: `pmkit/CONTEXT.md`
- Create: `pmkit/docs/adr/0001-local-tracker-is-the-reference-implementation.md`
- Create: `pmkit/docs/adr/0002-commands-are-the-source-for-every-agent.md`
- Create: `pmkit/docs/adr/0003-no-dependencies.md`
- Modify: `pmkit/README.md`
- Modify: `pmkit/scripts/plugin.test.mjs`

**Interfaces:**
- `CONTEXT.md`, in the shape of `runbooks/CONTEXT.md` (term, definition, `_Avoid_:` line): Tracker, Git host, Adapter, Issue, Sub-issue, Epic, Sprint, Status, Category, Blocked, Event, Synthetic event, Drift, Capability, Capability manifest, Member, Actor, Local tracker, Write policy, Dry run.
- ADRs in the shape of `runbooks/docs/adr/`: context, decision, consequences. 0001 from the Local adapter tab (L6); 0002 from MQ1, MQ3 and the 2026-10-23 decision to follow the `runbooks` command layout; 0003 from the 2026-10-23 decision to follow the repository's zero-dependency rule, with its cost (a YAML subset, a hand-written MCP server, `gh` instead of an API client).
- README: what pmkit is, the status (core and Local tracker only), the CLI table, `npm test`, and "Local development" with `claude --plugin-dir pmkit`.
- `plugin.test.mjs`: every `${CLAUDE_PLUGIN_ROOT}/...` path in the plugin's Markdown exists (the `runbooks` test, copied), and `CONTEXT.md` defines every term listed above.

- [ ] **Step 1: Write the files and the tests, run the suite, commit**

```bash
git add pmkit
git commit -m "docs(pmkit): glossary, ADRs and README"
```

---

## After this plan

The next plan, `docs/superpowers/plans/<date>-pmkit-commands-github.md`, covers build-order step 2: the GitHub git host through `gh` (`pr open`, `pr status`, `pr sync`), the routing skill `skills/pmkit/SKILL.md` with its references, the 23 command files from the planning doc's MVP skills tab, the marketplace entry and the root README row.
