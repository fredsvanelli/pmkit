# PMK-22 releases in the Local tracker Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task by task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The Local tracker stores releases as `releases/<version>.md`, an issue names its release in a `release` field, the CLI lists releases, lists the issues of a release and marks a release released, and `pmkit capabilities` reports `releases` as `native`.

**Architecture:** A new module `scripts/lib/local/releases.mjs` holds the id and tag rules, parsing, serializing and version order, as `milestones.mjs` does for milestones. The tracker gets five contract operations and a `release` issue field that reuses the `update` event path of `milestone`. The CLI adds a `release` command group, `--release` on `issues create` and `issues update`, and a tag check that only reads git. The format stays 2.

**Tech Stack:** Node ESM, `node:test`, no dependencies (ADR-0003).

**Spec:** `docs/superpowers/specs/2026-10-26-pmk-22-local-releases-design.md`

## Global Constraints

### Repo rules

- Every commit message carries `(PMK-22)` in its subject and ends with the trailer `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Code, specs, plans and commits in English. Prose follows `/home/fred/.claude/skills/unslop/SKILL.md`: no em dashes, plain words, active voice.
- No new dependency. Do not edit this repo's `.issues/`, do not push, do not switch branch, do not merge.
- `FORMAT_VERSION` and `MIGRATIONS` do not change. The format stays 2.
- No edit to `CHANGELOG.md` (spec decision: the release adds the line). No edit to `skills/pmkit/SKILL.md` or `commands/help.md`, because no slash command is added.
- Never edit a golden by hand. Regenerate with `UPDATE_GOLDENS=1 node --test scripts/goldens.test.mjs` and read `git diff scripts/__goldens__/` line by line before the commit.
- Baseline: `npm test` at `b69e63b` reports `# pass 1093`, `# fail 0`. The count only goes up.

### The release file

- Path: `<tracker>/releases/<id>.md`. The file stem is the id. No `id` key in the frontmatter.
- Frontmatter keys in this order: `name`, `tag`, `target`, `released`. Unknown keys follow, sorted (that is what `stringifyYaml` with `order` does). The body after the frontmatter is the description.
- `name`: one line, non-empty after trim. A file without `name` reads with the id as its name.
- `tag`: optional, checked by `validTag`.
- `target`: optional, `YYYY-MM-DD`, checked by `validDate` from `sprints.mjs`.
- `released`: optional, checked by the same rule as a sprint's `closed`. Export it from `scripts/lib/local/sprints.mjs` as `validTimestamp(value)` and use it there for `closed` too.
- `state` is computed on read: `released` when the file has `released`, otherwise `planned`. Never written.
- Model, key order fixed: `{ id, name, tag?, target?, released?, state, description, extra? }`. `extra` holds unknown frontmatter keys and is present only when there is one.
- `scripts/lib/model.mjs` gains a `Release` typedef after `Milestone`, with those properties, and `@property {string} [release]` on `Issue` after `milestone`.

### Rules in `releases.mjs`

- `validReleaseId` is `validMilestoneId`, re-exported under the new name: `export { validMilestoneId as validReleaseId } from './milestones.mjs'`. `releaseStems` is `milestoneStems` re-exported the same way. No behavior change to milestones.
- `validTag(tag)`, exactly:

```js
export const validTag = (tag) => typeof tag === 'string' && tag !== ''
  && !/[\s~^:?*[\\\x00-\x1f\x7f]/.test(tag) && !tag.includes('..') && !/^[-/]/.test(tag) && !/(\/|\.|\.lock)$/.test(tag)
```

- `compareReleaseIds(a, b)`: drop one leading `v` or `V` from each id. Split each at its first `-` into a core and a suffix (no `-` means no suffix). Compare cores with `naturalCompare`. When the cores are equal, an id with a suffix comes first, and two suffixes compare with `naturalCompare`. Any remaining tie compares the raw ids with `<`.
- `naturalCompare(a, b)`: split both strings into runs of digits and runs of non-digits. Compare run by run: two digit runs compare as numbers (`BigInt` or `Number`, both fine for these sizes), any other pair compares as strings with `<`. When every compared run is equal, the string with fewer runs comes first.

### Exact errors

| Where | Code | Message | Next step |
|---|---|---|---|
| bad id on create | `INVALID_INPUT` | `release id "<id>" must start and end with a letter or digit and hold only letters, digits, ".", "_" and "-"` | `Use an id like 1.2.0 or v1.2.0` |
| id clash on create, ignoring case | `CONFLICT` | `release <existing stem> already exists` | `pmkit release list` |
| unknown id on read | `NOT_FOUND` | `release <id> does not exist` | `pmkit release list` |
| bad `tag` on create or mark | `INVALID_INPUT` | `tag "<tag>" is not a valid git tag name` | `Use a tag like v1.2.0` |
| bad `target` on create | `INVALID_INPUT` | `target must be a date as YYYY-MM-DD` | none |
| bad `name` on create | `INVALID_INPUT` | `name must be a non-empty string` (and `oneLine` for a line break) | none |
| bad `state` in `listReleases` | `INVALID_INPUT` | `state must be planned or released` | `pmkit release list` |
| second mark | `CONFLICT` | `release <id> was released at <released>` | `pmkit release get <id>` |
| issue names a missing release | `INVALID_INPUT` | `release <value> does not exist` | `pmkit release create <value>` |
| parse: name with line break | `INVALID_INPUT` | `release file <id>.md has a name with a line break` | `/pmkit:local:doctor` |
| parse: bad tag | `INVALID_INPUT` | `release file <id>.md has tag "<tag>", expected a git tag name` | `/pmkit:local:doctor` |
| parse: bad target | `INVALID_INPUT` | `release file <id>.md has target "<target>", expected a date as YYYY-MM-DD` | `/pmkit:local:doctor` |
| parse: bad released | `INVALID_INPUT` | `release file <id>.md has released "<value>", expected a timestamp with a date, a time and a zone` | `/pmkit:local:doctor` |
| parse: conflict markers, no frontmatter | as `parseFile(text, 'release <id>')` in `epics.mjs` | | `/pmkit:local:doctor` |

### Exact CLI warnings (stderr, through the `warnings` list)

- `release <id> is already released`, after `issues create` or `issues update` sets `release` to a release with `released`, dry runs included.
- `release <id> has <n> unfinished issue: <ID>` when n is 1, `release <id> has <n> unfinished issues: <ID>, <ID>, ...` otherwise, in the order of `unfinished`.
- One `problemLine(problem)` per entry of `problems`, as `cycle close` does.
- `tag <tag> is not in this repository; create and push it, or run git fetch --tags` when `git rev-parse` exits 1.
- `cannot check tag <tag>: <reason>`. `<reason>` is `git is not installed or not on PATH` when the spawn fails with `ENOENT`, the spawn error's `message` for any other spawn error, and otherwise the first line of git's stderr with a leading `fatal: ` removed (outside a repository: `not a git repository (or any of the parent directories): .git`), or `git exited with <status>` when stderr is empty.

### Files

- Create: `scripts/lib/local/releases.mjs`, `scripts/releases.test.mjs`, `scripts/tracker-releases.test.mjs`, `scripts/__fixtures__/no-sprints/.issues/releases/1.0.0.md`, the new `release-*.txt` goldens.
- Modify: `scripts/lib/model.mjs`, `scripts/lib/contract.mjs`, `scripts/lib/capabilities.mjs`, `scripts/lib/format.mjs`, `scripts/lib/validate.mjs`, `scripts/lib/local/sprints.mjs`, `scripts/lib/local/issue-file.mjs`, `scripts/lib/local/query.mjs`, `scripts/lib/local/tracker.mjs`, `scripts/pmkit.mjs`, `scripts/contract-suite.mjs`, `scripts/goldens.test.mjs`, the `no-sprints` fixture issues `ISS-9B2X` and `ISS-6R3N`, tests in `scripts/issue-file.test.mjs`, `scripts/query.test.mjs`, `scripts/validate.test.mjs`, `scripts/cli.test.mjs`, `scripts/capabilities.test.mjs`, `scripts/fixtures.test.mjs` (only if its no-sprints assertions need the new count).
- Docs: `commands/local/doctor.md`, `commands/issues/create.md`, `commands/issues/update.md`, `commands/backlog/groom.md`, `docs/adr/0001-local-tracker-is-the-reference-implementation.md`, `docs/superpowers/specs/2026-10-23-pmkit-design.md`, `CONTEXT.md`, `README.md`.
- Must not change: `CHANGELOG.md`, `skills/`, `commands/help.md`, `schemas/`, `templates/`, `scripts/lib/local/migrations.mjs`, `scripts/__scenarios__/`, `.issues/`.

## Review Focus

- An issue file written by the previous plugin, with `release: 1.0.0` after `updated` among the unknown keys: the new CLI reads it as `issue.release`, with no `extra.release`, and the next write puts it before `due` (Task 3).
- `updateIssue` of `priority` on an issue whose release file was deleted: succeeds with no release check (Task 3).
- `createRelease({ id: 'V1.2.0' })` when `releases/v1.2.0.md` exists: `CONFLICT` naming `v1.2.0`, nothing written (Task 2).
- `markReleased` on a release file with a hand-added key (`owner: ana`) and a description: both are in the file after the mark (Task 4).
- `release mark-released` in a folder that is not a git repository, or with no `git` on `PATH`: the release is marked, exit 0, and stderr has `cannot check tag ...` (Task 6).

---

### Task 1: Release file module

Covers: criterion 1, `releases/<version>.md` holds a release, optionally tied to a git tag.

**Files:**
- Create: `scripts/lib/local/releases.mjs`, `scripts/releases.test.mjs`
- Modify: `scripts/lib/local/sprints.mjs` (export `validTimestamp`), `scripts/lib/model.mjs` (typedefs)

**Interfaces:**
- Produces in `releases.mjs`: `validReleaseId(id): boolean`, `releaseStems(dir): Set<string>`, `validTag(tag): boolean`, `compareReleaseIds(a: string, b: string): number`, `parseRelease(text: string, id: string): Release`, `serializeRelease(release: { name, tag?, target?, released?, description?, extra? }): string`, `sortReleases(list: Release[]): Release[]` (a sorted copy by `compareReleaseIds` on `id`).
- Produces in `sprints.mjs`: `validTimestamp(value): boolean`.
- `serializeRelease` writes `---\n<yaml>---\n`, and when `description` is non-empty, `\n<description>\n` after it. The YAML is `stringifyYaml({ ...extra, name, tag, target, released }, { order: ['name', 'tag', 'target', 'released'] })`.

- [ ] **Step 1: Write the failing tests** in `scripts/releases.test.mjs`:
  - `validReleaseId` accepts `1.2.0`, `v1.2.0`, `2026.10`, `1.0.0-rc.1`, `mobile-3.4` and rejects `1.0.0+build.5`, `v1.`, `-1`, `''`, `1 0`.
  - `validTag` accepts `v1.2.0`, `release/1.2.0`, `1.0.0-rc.1` and rejects `''`, `v1..2`, `v1 2`, `v1\nv2`, `-v1`, `/v1`, `v1/`, `v1.`, `v1.lock`, `v1~1`, `v1^`, `a:b`, `a?`, `a*`, `a[b`, `a\\b`.
  - `parseRelease('---\nname: Webhooks\ntag: v1.2.0\ntarget: 2026-11-30\nreleased: 2026-11-28T14:05:00Z\n---\n\nWebhook retries.\n', '1.2.0')` deep-equals `{ id: '1.2.0', name: 'Webhooks', tag: 'v1.2.0', target: '2026-11-30', released: '2026-11-28T14:05:00Z', state: 'released', description: 'Webhook retries.' }`.
  - Without `name` and `released`: `name` is the id and `state` is `planned`, with no `tag`, `target` or `released` key.
  - `target: 2026-13-40`, `released: 2026-11-28`, `tag: v1..2` and a `name` with a line break each throw `INVALID_INPUT` with the messages in Global Constraints and next step `/pmkit:local:doctor`.
  - Text with `<<<<<<<` throws `CONFLICT`.
  - `---\nname: Webhooks\nowner: ana\n---\n` parses with `extra: { owner: 'ana' }`, and `serializeRelease` of that parsed release returns the same text.
  - `serializeRelease({ name: '1.2.0', tag: 'v1.2.0', target: '2026-11-30' })` equals `---\nname: 1.2.0\ntag: v1.2.0\ntarget: 2026-11-30\n---\n`. With `description: 'Notes.'` the text ends `---\n\nNotes.\n`. `parseRelease(serializeRelease(x), id)` round-trips `name: '2026.10'` as the string `'2026.10'`.
  - `sortReleases` by id gives: `['1.10.0', '1.9.0', '1.2.0']` to `['1.2.0', '1.9.0', '1.10.0']`; `['1.0.0', '1.0.0-rc.1']` to `['1.0.0-rc.1', '1.0.0']`; `['1.0.0-rc.10', '1.0.0-rc.2']` to `['1.0.0-rc.2', '1.0.0-rc.10']`; `['1.3.0', 'v1.2.0', '1.1.0']` to `['1.1.0', 'v1.2.0', '1.3.0']`; `['v1.2.0', '1.2.0']` to `['1.2.0', 'v1.2.0']`; `['2026.10', '2026.9']` to `['2026.9', '2026.10']`.
- [ ] **Step 2: Run** `node --test scripts/releases.test.mjs`. Expected: FAIL, module not found.
- [ ] **Step 3: Implement** `releases.mjs`, `validTimestamp` in `sprints.mjs` (replace the private `validClosed` with it), and the `Release` typedef. `parseRelease` uses `parseFile(text, \`release ${id}\`)`, reads `tag` and `target` with `String(...)` before the check, and keeps unknown keys in `extra` as `parseSprint` does.
- [ ] **Step 4: Run** `npm test`. Expected: PASS.
- [ ] **Step 5: Commit**

```bash
git add scripts/lib/local/releases.mjs scripts/releases.test.mjs scripts/lib/local/sprints.mjs scripts/lib/model.mjs
git commit -m "feat: add the release file module (PMK-22)" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task 2: List, get and create releases in the tracker

Covers: criterion 1 (a release file is written and read through the contract), and the `release list` part of criterion 2.

**Files:**
- Modify: `scripts/lib/local/tracker.mjs` (next to the milestone operations), `scripts/lib/contract.mjs`, `scripts/contract-suite.mjs`
- Create: `scripts/tracker-releases.test.mjs` (setup copied from `scripts/tracker-milestones.test.mjs`, with a `releasesDir` and the fixed clock `2026-10-23T12:00:00Z`)

**Interfaces:**
- Consumes: everything Task 1 produces.
- Produces on the tracker: `listReleases({ state } = {}): Release[]`, `getRelease(id): Release`, `createRelease({ id, name, tag, target }, actor, { dryRun }): { before: null, after: Release }`. `TRACKER_OPERATIONS` gains `'listReleases', 'getRelease', 'createRelease'` on a new line after the milestones line. `releasesDir` is `path.join(issuesDir, 'releases')`, with the tracker's `issuesDir` (already `readDir ?? issuesDir`).

- [ ] **Step 1: Write the failing tracker tests** in `scripts/tracker-releases.test.mjs`:
  - `createRelease({ id: '1.2.0', name: 'Webhooks', tag: 'v1.2.0', target: '2026-11-30' }, 'fred')` writes `releases/1.2.0.md` with the exact text from Task 1, returns `{ before: null, after }` with `state: 'planned'`, and `listReleases()` and `getRelease('1.2.0')` deep-equal `[after]` and `after`.
  - `name` defaults to the id, and `'  Webhooks  '` is trimmed.
  - A dry run returns `after`, leaves `hashTree(root)` unchanged and makes no `releases/` folder.
  - `createRelease({ id: 'V1.2.0' })` after `v1.2.0` exists throws `CONFLICT` `release v1.2.0 already exists`, next step `pmkit release list`, and writes nothing.
  - Bad id `1.0.0+build.5`, bad tag `v1..2`, bad target `2026-13-40`, unknown key `{ id: 'a', released: '...' }` each throw `INVALID_INPUT` and write nothing. A non-writer actor is refused before any of these.
  - `listReleases` orders `1.10.0`, `1.9.0`, `1.0.0-rc.1` created in that order as `1.0.0-rc.1`, `1.9.0`, `1.10.0`.
  - `listReleases({ state: 'released' })` returns only a hand-written file with `released`, `{ state: 'planned' }` only the others, and `{ state: 'open' }` throws `INVALID_INPUT` `state must be planned or released`.
  - A hand-written file with a bad `target`, and one named `bad+id.md`, are missing from `listReleases`. A missing folder lists `[]`.
  - `getRelease('nope')` and `getRelease('bad+id')` throw `NOT_FOUND` `release <id> does not exist` with next step `pmkit release list`.
- [ ] **Step 2: Add contract-suite cases** in `scripts/contract-suite.mjs` with the `it(...)` helper and `await` on every call: `listReleases` is empty at the start; `createRelease({ id: 'contract-1.0', name: 'Contract one', tag: 'v-contract-1.0', target: '2099-01-31' })` then `listReleases` and `getRelease` agree with `after`; `getRelease('no-such-release')` rejects `NOT_FOUND`; a dry run returns `after` and leaves `listReleases` empty.
- [ ] **Step 3: Run** `node --test scripts/tracker-releases.test.mjs scripts/contract.test.mjs`. Expected: FAIL, operations missing.
- [ ] **Step 4: Implement** the three operations after `createMilestone`, following `listMilestones`, `getMilestone` and `createMilestone`. `createRelease` allows the keys `id`, `name`, `tag`, `target`, serializes, runs `readBack('release file', ...)`, and unless `dryRun` makes the folder and calls `writeFile`. Add the names to the returned object.
- [ ] **Step 5: Run** `npm test`. Expected: PASS.
- [ ] **Step 6: Commit**

```bash
git add scripts/lib/local/tracker.mjs scripts/lib/contract.mjs scripts/contract-suite.mjs scripts/tracker-releases.test.mjs
git commit -m "feat: list, get and create releases in the Local tracker (PMK-22)" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task 3: The issue's `release` field

Covers: criterion 2 (membership that `release issues` reads).

**Files:**
- Modify: `scripts/lib/local/issue-file.mjs`, `scripts/lib/local/tracker.mjs` (`CREATE_KEYS`, `UPDATE_KEYS`, `NORMALIZE`), `scripts/lib/format.mjs` (`issueRecord`)
- Test: `scripts/issue-file.test.mjs`, `scripts/tracker-releases.test.mjs`

**Interfaces:**
- Consumes: `releaseStems`, `createRelease` (Tasks 1 and 2).
- Produces: `ISSUE_KEYS` with `'release'` between `'milestone'` and `'due'`; `issue.release` on parsed issues; `toFrontmatter(issue).release`; `NORMALIZE.release(value): string`.

- [ ] **Step 1: Write the failing issue-file tests**: the `ISSUE_KEYS fixes the frontmatter order` test lists `'sprint', 'milestone', 'release', 'due'`; a file with `release: 1.2.0` parses to `issue.release === '1.2.0'` and serializes it on the line after `milestone`; a file whose `release: 1.0.0` sits after `updated` parses to `issue.release === '1.0.0'` with no `extra`, and `serializeIssue` writes it before `due`.
- [ ] **Step 2: Write the failing tracker tests** in `scripts/tracker-releases.test.mjs`:
  - With no `releases/` folder, `createIssue({ title: 'T', release: '1.2.0' })` throws `INVALID_INPUT` `release 1.2.0 does not exist`, next step `pmkit release create 1.2.0`.
  - After `createRelease({ id: '1.2.0' })`: `createIssue` with `release: '1.2.0'` succeeds and its `create` event holds `release: '1.2.0'` in `to`; `release: 'V1.2.0'` fails (case-sensitive); `updateIssue(id, { release: '1.2.0' })` writes an `update` event `{ field: 'release', from: null, to: '1.2.0' }`; `updateIssue(id, { release: null })` clears it with no check and an event `to: null`.
  - After deleting `releases/1.2.0.md`, `updateIssue(id, { priority: 'high' })` on an issue with `release: 1.2.0` succeeds.
  - A hand edit that adds `release: 1.2.0` to an issue file gives a synthetic `update` event for `release` on the next write, read through `getHistory`.
  - `getIssue` and `issueRecord` show `release: 1.2.0` on the line after `milestone`.
- [ ] **Step 3: Run** `node --test scripts/issue-file.test.mjs scripts/tracker-releases.test.mjs`. Expected: FAIL.
- [ ] **Step 4: Implement**: `release` in `ISSUE_KEYS`, the optional-key loop of `parseIssueFile`, `toFrontmatter` (after `milestone`) and the `Issue` typedef; `release` after `milestone` in `CREATE_KEYS` and `UPDATE_KEYS`; `NORMALIZE.release` runs `oneLine('release', text('release')(value))`, then throws the error above unless `releaseStems(releasesDir).has(value)` (move `releasesDir` above `NORMALIZE` if needed); `['release', issue.release]` after `milestone` in `issueRecord`.
- [ ] **Step 5: Run** `npm test`, then `UPDATE_GOLDENS=1 node --test scripts/goldens.test.mjs` and `git status scripts/__goldens__`. Expected: PASS and no golden change, because no fixture has `release` yet. A golden diff here is a bug.
- [ ] **Step 6: Commit**

```bash
git add scripts/lib/local/issue-file.mjs scripts/lib/local/tracker.mjs scripts/lib/format.mjs scripts/lib/model.mjs scripts/issue-file.test.mjs scripts/tracker-releases.test.mjs
git commit -m "feat: add the release field to issues (PMK-22)" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task 4: The issues of a release, and marking it released

Covers: criterion 2, the contract half of "lists the issues of a release and marks a release released".

**Files:**
- Modify: `scripts/lib/local/query.mjs`, `scripts/lib/local/tracker.mjs`, `scripts/lib/contract.mjs`, `scripts/contract-suite.mjs`
- Test: `scripts/query.test.mjs`, `scripts/tracker-releases.test.mjs`

**Interfaces:**
- Consumes: Tasks 1 to 3.
- Produces: filter key `release` (a string; matches `issue.release === filter.release`, no `none` or `current` forms); `releaseIssues(id): Issue[]`; `markReleased(id, actor, { tag, dryRun } = {}): { before: Release, after: Release, unfinished: Issue[], problems: Array<{ id, code, message }> }`. `TRACKER_OPERATIONS` gains `'releaseIssues', 'markReleased'` on the releases line.

- [ ] **Step 1: Write the failing query tests**: `FILTER_KEYS` includes `release`; `checkFilter({ release: 1 })` throws `INVALID_INPUT` `release must be a string`; `runQuery` with `{ release: '1.2.0' }` keeps only issues whose `release` is `1.2.0`, and leaves out archived ones unless `archived: true`.
- [ ] **Step 2: Write the failing tracker tests**:
  - `releaseIssues('1.2.0')` returns the member issues in creation order with computed fields, leaves out an archived member and a sub-issue whose own `release` is unset, and `releaseIssues('nope')` throws `NOT_FOUND` `release nope does not exist`.
  - `markReleased('1.2.0', 'fred')` sets `released: '2026-10-23T12:00:00Z'` and `state: 'released'`, keeps the file's `name`, `tag`, `target`, a hand-added `owner: ana` and a description, and returns `unfinished` with the member in `todo` and not the members in `done` or `canceled`.
  - `{ tag: 'v1.2.1' }` replaces the stored tag; `{ tag: 'v1..2' }` throws `INVALID_INPUT` and writes nothing.
  - A second `markReleased` throws `CONFLICT` `release 1.2.0 was released at 2026-10-23T12:00:00Z`, next step `pmkit release get 1.2.0`.
  - A dry run returns the same `after` and `unfinished` and leaves `hashTree(root)` unchanged.
  - An issue file with conflict markers yields one entry in `problems`.
  - A non-writer actor is refused first.
- [ ] **Step 3: Add contract-suite cases**: create a release and two issues with `release` set through `updateIssue`, move one to the `done` category; `releaseIssues` returns both; `markReleased` returns `after.state === 'released'` and `unfinished` holding only the other issue; `releaseIssues` of an unknown id rejects `NOT_FOUND`; a dry-run mark leaves `getRelease(id).state === 'planned'`.
- [ ] **Step 4: Run** `node --test scripts/query.test.mjs scripts/tracker-releases.test.mjs scripts/contract.test.mjs`. Expected: FAIL.
- [ ] **Step 5: Implement** the filter key in `FILTER_KEYS`, `checkFilter` and `runQuery`. `releaseIssues(id)` is `searchIssues({ release: getRelease(id).id }).issues`. `markReleased` runs `requireWriter`, `getRelease`, the `CONFLICT` check, the tag check, then `search({ release: id }, { save: !dryRun })` for `issues` and `problems`, builds `after` with `released: stamp()` and `state: 'released'` in model order, writes through `serializeRelease` and `readBack` as `createRelease` does, and returns `unfinished` as the issues whose category is not in `TERMINAL`.
- [ ] **Step 6: Run** `npm test`. Expected: PASS.
- [ ] **Step 7: Commit**

```bash
git add scripts/lib/local/query.mjs scripts/lib/local/tracker.mjs scripts/lib/contract.mjs scripts/contract-suite.mjs scripts/query.test.mjs scripts/tracker-releases.test.mjs
git commit -m "feat: list the issues of a release and mark it released (PMK-22)" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task 5: `validate` checks release files and references, and doctor fixes them

Covers: criterion 1 (a broken release file or reference is reported).

**Files:**
- Modify: `scripts/lib/validate.mjs`, `scripts/pmkit.mjs` (the `validate` text head), `commands/local/doctor.md`
- Test: `scripts/validate.test.mjs`, `scripts/cli.test.mjs`
- Regenerated: the four `validate.txt` goldens

**Interfaces:**
- Consumes: `releaseStems`, `validReleaseId`, `parseRelease`.
- Produces: problem code `release`; `checked.releases`; text head `checked: N issues, N epics, N sprints, N milestones, N releases, N comments`.

- [ ] **Step 1: Write the failing validate tests**:
  - `releases/1.2.0.md` with a bad `target` gives one problem with code `release` and the parse message; `releases/bad+id.md` gives code `release` with the id-rule message (`release id "bad+id" must start ...`); a release file with conflict markers gives one `conflict` problem and no `release` problem; a `.yaml` file and a subfolder in `releases/` are not counted.
  - An issue, and an archived issue, with `release: 9.9.9` and no file each give `reference` `release 9.9.9 does not exist`, even when `releases/` does not exist.
  - `checked.releases` counts the `.md` files, and `noneChecked()` has `releases: 0`.
- [ ] **Step 2: Update the failing CLI tests** in `scripts/cli.test.mjs` that assert the `validate` head (around lines 270 and 297) to the new head with `N releases` before `N comments`.
- [ ] **Step 3: Run** `node --test scripts/validate.test.mjs scripts/cli.test.mjs`. Expected: FAIL.
- [ ] **Step 4: Implement** a `// Releases` block after `// Milestones` that mirrors it with the `release` code, and a release reference check in the issue loop of `// References` with no "folder has files" condition. Change the head in `pmkit.mjs`.
- [ ] **Step 5: Update `commands/local/doctor.md`**:
  - Step 4, `reference`: change the parenthesis to "(a parent, blocker, milestone, release or sprint that does not exist)". After the milestone sentences, add: "For a release, group the problems by the release name and propose one `node "${CLAUDE_PLUGIN_ROOT}/scripts/pmkit.mjs" release create <name> --dry-run --json` per name, or `node "${CLAUDE_PLUGIN_ROOT}/scripts/pmkit.mjs" issues update <id> --release none --dry-run --json` for each issue. A name that breaks the id rule gets the same steps as a milestone name: ask for a valid id, propose `release create <new id> --name "<old name>"` first, then `issues update <id> --release <new id>` for each issue."
  - Step 5: "`frontmatter`, `events`, `sprint`, `milestone` and `release`: ...".
- [ ] **Step 6: Run** `npm test`. Expected: the four `validate.txt` goldens fail on the head and the `checked` JSON. Run `UPDATE_GOLDENS=1 node --test scripts/goldens.test.mjs` and check that `git diff scripts/__goldens__` shows only `, 0 releases` in each head and `"releases": 0` in each `checked` object. Run `npm test` again. Expected: PASS.
- [ ] **Step 7: Commit**

```bash
git add scripts/lib/validate.mjs scripts/pmkit.mjs scripts/validate.test.mjs scripts/cli.test.mjs commands/local/doctor.md scripts/__goldens__
git commit -m "feat: validate release files and release references (PMK-22)" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task 6: The `release` commands and `--release` on issues

Covers: criterion 2, "The CLI lists releases, lists the issues of a release and marks a release released".

**Files:**
- Modify: `scripts/pmkit.mjs` (`COMMANDS` after the milestone entries, `issuePatch`, the `issues create` and `issues update` entries, a tag check helper next to `gitIn`), `scripts/lib/format.mjs` (`releaseRecord`), `scripts/goldens.test.mjs`
- Modify fixture: `scripts/__fixtures__/no-sprints/.issues/` (see Step 5)
- Test: `scripts/cli.test.mjs`
- Regenerated: new `release-*.txt` goldens, and the `no-sprints` goldens that show the two issues

**Interfaces:**
- Consumes: the five tracker operations.
- Produces: `releaseRecord(release): string` in `format.mjs`, `fields` of `id`, `name`, `state`, `tag`, `target`, `released`, then a blank line and the description when there is one. `tagWarning(root: string, tag: string, env): string | null` in `pmkit.mjs`, which runs `spawnSync('git', ['rev-parse', '--verify', '--quiet', \`refs/tags/${tag}\`], { cwd: root, env, encoding: 'utf8' })` and returns one of the two tag warnings or `null` on exit 0. Passing `env` lets a test hide `git`.

| Command | `usage` | `flags` | Text | JSON | `commit` |
|---|---|---|---|---|---|
| `release list` | `[--state planned\|released]` | `state` | `table(['ID', 'Name', 'State', 'Tag', 'Target', 'Released'], ...)` with `''` for missing values, or `no releases` | the array | |
| `release get` | `<id>` | none | `releaseRecord` | the release | |
| `release issues` | `<id>` | none | `issueTable(issues)` | the array | |
| `release create` | `<id> [--name n] [--tag t] [--target YYYY-MM-DD]` | `name`, `tag`, `target` | `writeText(result, { ...ctx, record: releaseRecord })` | `{ before: null, after }` | `after.id` |
| `release mark-released` | `<id> [--tag t]` | `tag` | `writeText(null, { dryRun, header })`, with `header` = `writeText(result, { dryRun: false, record: releaseRecord })`, then `unfinished issues:`, then `issueTable(unfinished)`, joined by `\n` | `{ before, after, unfinished, problems }` | `after.id` |

Summaries: `lists releases, oldest version first`, `one release`, `lists the issues of a release`, `creates a release`, `marks a release released and lists its unfinished issues`. `release create` and `release mark-released` have `write: true`. `issues create` and `issues update` add `release` after `milestone` in `flags` and `[--release r]` after `[--milestone ...]` in `usage`. `issuePatch` sets `release` from `opt('release')` on create and `orNull(opt('release'))` on update. Both commands add the `already released` warning when `patch.release` is a string and `getRelease(patch.release).released` is set.

- [ ] **Step 1: Write the failing CLI tests** in `scripts/cli.test.mjs` (with the file's `run`, `json` and `git` helpers):
  - `release list` prints `no releases` and `[]` on an empty tracker, and after `release create 1.2.0 --name Webhooks --tag v1.2.0 --target 2026-11-30` prints a table whose second line has `1.2.0`, `Webhooks`, `planned`, `v1.2.0`, `2026-11-30`. `--state released` lists none, `--state open` exits 2 with `INVALID_INPUT`.
  - `release get 1.2.0` prints `id: 1.2.0`, `name: Webhooks`, `state: planned`, `tag: v1.2.0`, `target: 2026-11-30`; `release get nope --json` exits 2 with `{ code: 'NOT_FOUND', message: 'release nope does not exist', nextStep: 'pmkit release list' }`.
  - `release create 1.2.0 --dry-run` writes nothing; `release create 'bad+id' --json` is `INVALID_INPUT`; with `auto_commit: true` in a git repo, the commit subject is `pmkit: release create 1.2.0`, and after `release mark-released 1.2.0` it is `pmkit: release mark-released 1.2.0` (follow `scripts/cli-autocommit.test.mjs` if that file is the better home).
  - `issues create --title T --release 1.2.0` sets `after.release`; `issues update <id> --release none` clears it; `--release 9.9.9` exits 2 with `nextStep: 'pmkit release create 9.9.9'`.
  - `release issues 1.2.0` prints the issue table with both member issues, and `--json` returns their ids.
  - `release mark-released 1.2.0` with one member in `todo`: exit 0, the text has a line starting `released:`, then `unfinished issues:` and the table, stderr has `warning: release 1.2.0 has 1 unfinished issue: <ID>`. With `--dry-run`, the last line is `dry run: nothing was written` and `release get` still says `planned`.
  - After the mark, `issues update <other> --release 1.2.0` succeeds and stderr has `warning: release 1.2.0 is already released`.
  - Tag check, each on a fresh repo:
    - `git init`, an empty commit, `git tag v1.2.0`, then `mark-released`: no `tag` warning.
    - The same repo without the tag: stderr has `warning: tag v1.2.0 is not in this repository; create and push it, or run git fetch --tags`.
    - No `git init`, with `GIT_CEILING_DIRECTORIES` set to the parent of the root: stderr has `warning: cannot check tag v1.2.0: not a git repository`, and the release is marked.
    - `PATH` set to an empty temp folder and the CLI run as `process.execPath`: stderr has `warning: cannot check tag v1.2.0: git is not installed or not on PATH`, and the release is marked.
  - A release with no tag runs no git and prints no tag warning.
- [ ] **Step 2: Run** `node --test scripts/cli.test.mjs`. Expected: FAIL, unknown command.
- [ ] **Step 3: Implement** the five `COMMANDS` entries, `releaseRecord`, `tagWarning`, the `issuePatch` lines, the flags and the warnings. `release mark-released` calls `tagWarning(ctx.root, result.after.tag, ctx.env)` only when `result.after.tag` is set, after the write or dry run.
- [ ] **Step 4: Add the golden cases** in `scripts/goldens.test.mjs`: anchor `release: '1.0.0'` in all four `FIXTURES` entries, the `no-sprints` `about` becomes `'a team without sprints: 6 issues, an epic with children, a comment, a document, a milestone and a release'`, and `CASES` gains:

```js
  'release list': () => [[], ['--state', 'released']],
  'release get': (a) => [[a.release], ['missing-release']],
  'release issues': (a) => [[a.release]],
  // A new id, and the anchor again, which is a CONFLICT where the release exists.
  'release create': (a) => [['2.0.0', '--name', 'Golden release', '--tag', 'v2.0.0', '--target', '2026-12-01'], [a.release]],
  'release mark-released': (a) => [[a.release]],
```

- [ ] **Step 5: Extend the `no-sprints` fixture** (fixture files are test data, not this repo's `.issues/`):
  - Create `releases/1.0.0.md` as `---\nname: Webhooks GA\ntarget: 2026-11-13\n---\n\nPublic webhooks with retries and a dead-letter queue.\n`. No `tag`, so the golden runs no git.
  - In `issues/ISS-9B2X/issue.md` (in_review) and `issues/ISS-6R3N/issue.md` (done), add `release: 1.0.0` where `ISSUE_KEYS` puts it (after `milestone`, before `due`) and set `updated: 2026-10-22T10:00:00Z` when that is later than the current value.
  - Append to each issue's `events.jsonl` one line: `{"at":"2026-10-22T10:00:00Z","by":"fred","op":"update","field":"release","from":null,"to":"1.0.0"}`.
  - `node scripts/pmkit.mjs validate --json --root scripts/__fixtures__/no-sprints` lists no problem (no `drift` in particular), so `scripts/fixtures.test.mjs` keeps passing.
- [ ] **Step 6: Regenerate** with `UPDATE_GOLDENS=1 node --test scripts/goldens.test.mjs` and read the diff. Expected changes, and no others: five new `release-*.txt` files in each of the four fixtures; in `no-sprints`, `"release": "1.0.0"` in the JSON of `ISS-9B2X` and `ISS-6R3N`, a `release: 1.0.0` line in the text record of `ISS-9B2X`, the new `updated` values, the two `update` events in `events.txt` and in `issues-get` history, and `1 releases` in `validate.txt`. The mark golden shows `unfinished` holding `ISS-9B2X` only. `capabilities.txt` does not change in this task.
- [ ] **Step 7: Run** `npm test`. Expected: PASS, including the test that checks every `pmkit ...` next step against `COMMANDS`.
- [ ] **Step 8: Commit**

```bash
git add scripts/pmkit.mjs scripts/lib/format.mjs scripts/cli.test.mjs scripts/goldens.test.mjs scripts/__fixtures__/no-sprints scripts/__goldens__
git commit -m "feat: add the release commands and --release on issues (PMK-22)" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task 7: `capabilities` reports `releases` as native

Covers: criterion 3, "`capabilities` reports `releases` as native".

**Files:**
- Modify: `scripts/lib/capabilities.mjs`, `scripts/capabilities.test.mjs`, `docs/adr/0001-local-tracker-is-the-reference-implementation.md`
- Regenerated: the four `capabilities.txt` goldens

**Interfaces:**
- Consumes: the five command names from Task 6.
- Produces: `SERVED_BY.releases = ['release list', 'release get', 'release issues', 'release create', 'release mark-released']`.

- [ ] **Step 1: Update the failing test** in `scripts/capabilities.test.mjs`: `releases` moves from the `absent` list to the `native` list (in `CAPABILITIES` order, after `status_update`), and the assertion on `byId.releases` becomes `{ id: 'releases', path: 'native' }`. Pick another absent capability, such as `saved_views`, for the absent-hint assertion so that case keeps a test.
- [ ] **Step 2: Run** `node --test scripts/capabilities.test.mjs`. Expected: FAIL.
- [ ] **Step 3: Implement** the `SERVED_BY` change.
- [ ] **Step 4: Regenerate** with `UPDATE_GOLDENS=1 node --test scripts/goldens.test.mjs`. Expected diff, in each of the four `capabilities.txt` files only: the text row becomes `releases | native` with no hint, and the JSON entry becomes `{ "id": "releases", "path": "native" }`.
- [ ] **Step 5: Update ADR-0001**: "The Local tracker serves 13 of the 20 capabilities of the manifest. Eleven are native: `cycles`, `estimation`, `multilevel_hierarchy`, `dependencies`, `native_triage`, `deliverables`, `status_update`, `releases`, `capacity`, `documents` and `time_tracking`." and "The manifest reports the other seven as `absent`: `strategic_goals`, `saved_views`, `demand_signals`, `request_queue`, `agent_delegation`, `security_alerts` and `user_inbox`." In Consequences, "Its eight `absent` capabilities" becomes "Its seven `absent` capabilities".
- [ ] **Step 6: Run** `npm test`. Expected: PASS.
- [ ] **Step 7: Commit**

```bash
git add scripts/lib/capabilities.mjs scripts/capabilities.test.mjs docs/adr/0001-local-tracker-is-the-reference-implementation.md scripts/__goldens__
git commit -m "feat: report releases as native in the capability manifest (PMK-22)" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task 8: Docs and command files

Covers: criteria 1 to 3 (the documented model, layout, contract and commands).

**Files:**
- Modify: `docs/superpowers/specs/2026-10-23-pmkit-design.md`, `CONTEXT.md`, `README.md`, `commands/issues/create.md`, `commands/issues/update.md`, `commands/backlog/groom.md`

- [ ] **Step 1: Design spec** `docs/superpowers/specs/2026-10-23-pmkit-design.md`:
  - Common model: `release` after `milestone` in the Issue row, and a row after Milestone: `| Release | \`id\`, \`name\`, \`tag\`, \`target\`, \`released\`, \`state\` (\`planned\`, \`released\`; computed from \`released\`), \`description\` |`.
  - Contract table, after Milestones: `| Releases | \`listReleases({ state })\`, \`getRelease(id)\`, \`releaseIssues(id)\`, \`createRelease(input, actor)\`, \`markReleased(id, actor, { tag })\` |`.
  - Layout: `├── releases/` after `├── milestones/`. The issue file's key list in "Issue file" gains `release` after `milestone`.
  - A `### Releases` subsection after `### Milestones`: "`releases/<id>.md`: frontmatter `name`, an optional `tag`, `target` and `released`, then a Markdown description. The file name is the release id and the version. An issue joins a release through `release`. The id rule, the order, the tag check and the commands are in `2026-10-26-pmk-22-local-releases-design.md`."
  - CLI table: `[--release r]` in the `issues create` and `issues update` rows, and rows `| \`release list [--state planned\|released]\`, \`release get <id>\`, \`release issues <id>\` | reads releases |` and `| \`release create <id> [--name n] [--tag t] [--target YYYY-MM-DD]\`, \`release mark-released <id> [--tag t]\` | creates a release, marks it released |`.
  - The `/pmkit:local:doctor` row of the command table gains `release create` after `milestone create`.
- [ ] **Step 2: `CONTEXT.md`**: a **Release** entry after **Milestone**:

```markdown
**Release**:
A version of the product, kept as `releases/<version>.md`, that issues point to through `release`. It may name a git tag, and it is `planned` until `release mark-released` records when it shipped.
_Avoid_: milestone (a milestone is a target, not a version), version (outside the file name), deploy
```

  The Milestone `_Avoid_` line drops `(PMK-22)`: `_Avoid_: release, phase, version`. The Issue entry's field list gains "a release" after "a sprint".
- [ ] **Step 3: `README.md`**: the `issues create` row reads `creates an issue; takes \`--milestone\` and \`--release\``; the `issues update` row reads `edits fields and acceptance criteria; \`--milestone\`, \`--release\` and \`--branch\` take \`none\` to clear`; after the milestone rows add `| \`release list\` | lists releases, oldest version first; \`--state planned\|released\` |`, `| \`release get <id>\` | shows one release |`, `| \`release issues <id>\` | lists the issues of a release |`, `| \`release create <id>\` | creates a release; takes \`--name\`, \`--tag\` and \`--target\` |`, `| \`release mark-released <id>\` | marks a release released, lists its unfinished issues and warns when its tag is not in the repository; takes \`--tag\` |`.
- [ ] **Step 4: Command files**: `commands/issues/create.md` adds "release" after "milestone" in the optional fields and `--release` after `--milestone` in the step 4 flag list. `commands/issues/update.md` adds "release" after "milestone" in its field list. `commands/backlog/groom.md` reads "a parent, blocker, sprint, milestone or release".
- [ ] **Step 5: Run** `npm test` (the plugin and scenario tests parse command files and the README). Expected: PASS, with no change under `scripts/__scenarios__/`.
- [ ] **Step 6: Commit**

```bash
git add docs/superpowers/specs/2026-10-23-pmkit-design.md CONTEXT.md README.md commands/issues/create.md commands/issues/update.md commands/backlog/groom.md
git commit -m "docs: document releases in the Local tracker (PMK-22)" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

## Acceptance criteria map

| Criterion | Tasks |
|---|---|
| `releases/<version>.md` holds a release, optionally tied to a git tag | Task 1 (file format, `tag` rule), Task 2 (create, list, get), Task 5 (`validate` and doctor), Task 8 (docs) |
| The CLI lists releases, lists the issues of a release and marks a release released | Task 3 (`release` field), Task 4 (`releaseIssues`, `markReleased`), Task 6 (`release list`, `release issues`, `release mark-released`, plus `get`, `create` and `--release`) |
| `capabilities` reports `releases` as native | Task 7 (`SERVED_BY`, test, goldens, ADR-0001) |

## Final check

- [ ] `npm test` passes with more than 1093 tests.
- [ ] `git diff --stat main -- CHANGELOG.md skills commands/help.md schemas templates scripts/lib/local/migrations.mjs scripts/__scenarios__ .issues` prints nothing.
- [ ] `node scripts/pmkit.mjs capabilities --json` in this worktree shows `releases` with `"path": "native"`.

## Decisions made in this plan

| Decision | Reason |
|---|---|
| `validReleaseId` and `releaseStems` re-export the milestone functions | The spec leaves the shared name to the builder. A re-export changes no behavior and touches no milestone code. |
| `validTag` as written in Global Constraints | It covers the spec's list of ref name rules plus control characters. |
| `tagWarning` takes `env` | A test can hide `git` through `PATH`, which the spec's "git is missing" case needs. |
| The `no-sprints` fixture gets the release | It already holds the milestone and has issues in `in_review` and `done`, so `release issues` and `mark-released` goldens show real output. |
| The release in the fixture has no tag | The golden then runs no git and stays the same on every machine. The CLI tests cover the tag check. |
| `commands/issues/create.md`, `update.md` and `groom.md` mention the field | They list every issue field and reference kind. Leaving `release` out would hide the new flag from the slash commands. |

## Self-review

- Spec coverage: release file and model (Task 1), id rule and order (Task 1), issue field and events (Task 3), five operations (Tasks 2 and 4), CLI and warnings and tag check (Task 6), manifest and ADR (Task 7), validation and doctor (Task 5), format stays 2 (Global Constraints), docs (Task 8), tests and goldens (each task). PMK-23 and PMK-69 need no work here.
- Names: `listReleases`, `getRelease`, `releaseIssues`, `createRelease`, `markReleased`, `parseRelease`, `serializeRelease`, `sortReleases`, `compareReleaseIds`, `validTag`, `validReleaseId`, `releaseStems`, `validTimestamp`, `releaseRecord`, `tagWarning` are used the same way in every task.
- Counts: 11 native, 2 derived, 7 absent in Task 7 and ADR-0001.
