# PMK-119 validate unsupported tracker Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `pmkit validate` lists `tracker.system: linear` (any known tracker other than `local`) as a problem of `.pmkit/config.yaml`, alone or with other bad keys, instead of failing with `NOT_SUPPORTED`.

**Architecture:** `config.mjs` exports the rule `unsupportedTracker(system)`, and `loadConfig` builds its error from it. `pmkitConfigProblems` in `validate.mjs` appends one more problem from the same rule. `validateRepo`, `brokenConfigProblem` and `validatePmkitConfig` do not change.

**Tech Stack:** Node 18+ ES modules, no dependencies (ADR 0003), `node:test`. Run tests with `npm test`.

**Spec:** `docs/superpowers/specs/2026-10-26-pmk-119-validate-unsupported-tracker-design.md`

## Global Constraints

- Export in `scripts/lib/config.mjs`: `unsupportedTracker(system)` with the signature `(system: string) => { message: string, nextStep: string } | null`. It returns `null` for `local`. For any other string it returns `{ message: 'tracker.system "<system>" is not supported yet', nextStep: 'Set tracker.system to local in .pmkit/config.yaml' }`.
- The `loadConfig` error must not change: code `NOT_SUPPORTED`, message `tracker.system "linear" is not supported yet`, next step `Set tracker.system to local in .pmkit/config.yaml`.
- Problem record, exactly: `{ path: '.pmkit/config.yaml', code: 'config', message: 'tracker.system "linear" is not supported yet, set it to local' }`. The message is `${rule.message}, set it to local`. It is added after the `validatePmkitConfig` messages.
- The problem is added only when `parsed` and `parsed.tracker` are plain maps and `parsed.tracker.system` is in `TRACKERS` and is not `local`. An empty file, a `tracker: linear` string and `tracker.system: trello` get no extra problem and no throw.
- `validateRepo` returns `checked` all zeros (`{ issues: 0, epics: 0, sprints: 0, milestones: 0, comments: 0 }`) and does not read `.issues/`. Exit code 0, the same output shape as any other problem.
- Other commands keep failing with `NOT_SUPPORTED` and exit 2 (`issues list` with `linear`).
- Files that may change: `scripts/lib/config.mjs`, `scripts/lib/validate.mjs`, `scripts/config.test.mjs`, `scripts/validate.test.mjs`, `scripts/cli.test.mjs`, and this plan plus the state file. Nothing else: not `commands/`, `CHANGELOG.md`, `scripts/pmkit.mjs`, fixtures, scenarios or goldens.
- Goldens must not change. Run `npm test` without `UPDATE_GOLDENS=1`. If a golden differs, stop and read the diff line by line. Regenerate only with `UPDATE_GOLDENS=1`, and only if the diff is explained by this issue (the spec expects none).
- Commit messages end with `(PMK-119)` in the subject and the trailer `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`. Every task ends with the whole suite green.
- No new dependency. Straight quotes, no em dashes in prose.

## Review Focus

1. Empty `.pmkit/config.yaml` does not throw and gets no tracker problem. Pinned in Task 2.
2. `tracker: linear` as a string does not throw and gets no tracker problem. Pinned in Task 2.
3. `tracker.system: local` with another bad key lists no tracker problem. Pinned in Task 2.
4. `linear` plus a broken `.issues/config.yaml` lists only the tracker problem. Pinned in Task 2.
5. `issues list` with `linear` still exits 2 with `NOT_SUPPORTED`. Pinned in Task 2.

---

### Task 1: Share the unsupported-tracker rule

**Files:**
- Modify: `scripts/lib/config.mjs` (export beside `TRACKERS`; `loadConfig` around line 182)
- Test: `scripts/config.test.mjs` (add `unsupportedTracker` to the import from `./lib/config.mjs`; extend the `jira` test at line 53)

**Interfaces:**
- Produces: `unsupportedTracker(system: string): { message: string, nextStep: string } | null`, exported from `scripts/lib/config.mjs`. Task 2 imports it.

- [ ] **Step 1: Write the failing tests** in `scripts/config.test.mjs`.
  - New test `unsupportedTracker is null for local and a message and next step for any other tracker`:
    ```js
    assert.equal(unsupportedTracker('local'), null)
    assert.deepEqual(unsupportedTracker('linear'), {
      message: 'tracker.system "linear" is not supported yet',
      nextStep: 'Set tracker.system to local in .pmkit/config.yaml',
    })
    ```
  - In `tracker.system jira throws NOT_SUPPORTED`, extend the predicate so it also checks `error.message === 'tracker.system "jira" is not supported yet'` and `error.nextStep === 'Set tracker.system to local in .pmkit/config.yaml'`. This guard passes before the change and must still pass after it.

- [ ] **Step 2: Run to verify the new test fails**

Run: `node --test scripts/config.test.mjs`
Expected: FAIL because `unsupportedTracker` is not exported (SyntaxError on the import or `unsupportedTracker is not a function`). The extended `jira` test would pass on its own.

- [ ] **Step 3: Implement** in `scripts/lib/config.mjs`.

  ```js
  export function unsupportedTracker(system) {
    if (system === 'local') return null
    return { message: `tracker.system "${system}" is not supported yet`, nextStep: 'Set tracker.system to local in .pmkit/config.yaml' }
  }
  ```
  In `loadConfig`, replace the `if (system !== 'local') { throw ... }` block with `const unsupported = unsupportedTracker(system)` and `if (unsupported) throw new PmkitError('NOT_SUPPORTED', unsupported.message, unsupported.nextStep)`.

- [ ] **Step 4: Run to verify it passes**

Run: `node --test scripts/config.test.mjs`
Expected: PASS.

- [ ] **Step 5: Run the whole suite**

Run: `npm test`
Expected: PASS, no golden differs.

- [ ] **Step 6: Commit**

```bash
git add scripts/lib/config.mjs scripts/config.test.mjs
git commit -m "refactor: share the unsupported tracker rule (PMK-119)" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

Complexidade: baixa

---

### Task 2: List the unsupported tracker in validate

**Files:**
- Modify: `scripts/lib/validate.mjs` (import at line 5, `pmkitConfigProblems` at line 99, comment above `brokenConfigProblem` at line 69)
- Test: `scripts/validate.test.mjs` (replace the test at line 273), `scripts/cli.test.mjs` (add after the test at line 239)

**Interfaces:**
- Consumes: `TRACKERS` and `unsupportedTracker(system)` from `./config.mjs` (Task 1).
- Produces: nothing for later tasks. `validateRepo(root)` now returns the tracker problem.

- [ ] **Step 1: Write the failing tests.**

  In `scripts/validate.test.mjs`, import `TRACKERS` and `unsupportedTracker` from `./lib/config.mjs`. Replace `tracker.system linear alone still throws NOT_SUPPORTED` with the tests below. All use `makeRepo('basic')`, `editPmkit`, `setPmkit`, `breakPmkit` and `brief`. Let `MSG = 'tracker.system "linear" is not supported yet, set it to local'`.
  - `tracker.system linear alone is one config problem, not a throw`: after `editPmkit(root, 'system: local', 'system: linear')`, `validateRepo(root)` does not throw, `brief(result)` equals `['config .pmkit/config.yaml']`, the message equals `MSG`, `result.checked` equals all zeros, and `MSG.startsWith(unsupportedTracker('linear').message)`.
  - `every known tracker except local is listed`: loop over `TRACKERS.filter((name) => name !== 'local')`, expect the message `tracker.system "<name>" is not supported yet, set it to local`.
  - `linear and git_host.system gitlab list both problems`: messages in order `['git_host.system must be github or none', MSG]`.
  - `linear and breakPmkit list three problems`: all at `.pmkit/config.yaml` with code `config`; messages in order `git_host.system must be github or none`, `write_policy.confirm must be one of all_writes, single_writes, none`, `MSG`. Check the real order of the first two by running once and keep the order the code produces, since the sort is stable and insertion order is the `validatePmkitConfig` order.
  - `linear with a broken .issues/config.yaml lists only the tracker problem`: write `.issues/config.yaml` as `version: 1\nthis line has no colon\n`; `brief(result)` equals `['config .pmkit/config.yaml']`.
  - `tracker.system local with another bad key lists no tracker problem`: `editPmkit(root, 'system: none', 'system: gitlab')`; the messages equal `['git_host.system must be github or none']`.
  - `an empty .pmkit/config.yaml gets no tracker problem`: `setPmkit(root, '')`; messages equal exactly `['version must be 1', 'tracker.system must be one of local, linear, jira, github, gitlab, azure-devops', 'git_host.system must be github or none', 'write_policy.confirm must be one of all_writes, single_writes, none']`, no throw.
  - `tracker as a string gets no tracker problem`: take the file text, replace the `tracker:` block so it holds `tracker: linear` and nothing else under it (read the `basic` file first and edit accordingly); messages equal `['tracker.system must be one of local, linear, jira, github, gitlab, azure-devops']`, no throw.
  - Extend `validateRepo writes nothing`: add a `basic` repo edited to `system: linear`, with `hashTree` equal before and after.

  In `scripts/cli.test.mjs`, add (using `makeRepo('basic')` and the file-edit style of the test at line 239):
  - `validate lists tracker.system linear as a problem and exits 0`: `run(root, ['validate'])` has status 0, its first line is `checked: 0 issues, 0 epics, 0 sprints, 0 milestones, 0 comments`, and it matches `/^\.pmkit\/config\.yaml {2}config {2}tracker\.system "linear" is not supported yet, set it to local$/m`. `json(root, ['validate']).problems[0]` has exactly the keys `code`, `message`, `path` (`Object.keys(...).sort()`), and the same values.
  - `validate with linear and a bad git_host lists both and exits 0`: status 0 and both lines match.
  - `issues list with linear still exits 2 with NOT_SUPPORTED`: `run(root, ['issues', 'list', '--json'])` has status 2; `JSON.parse(stdout).error` has `code` `NOT_SUPPORTED` and `message` `tracker.system "linear" is not supported yet`. Do not use `json()`, it asserts exit 0.

- [ ] **Step 2: Run to verify they fail for the stated reason**

Run: `node --test scripts/validate.test.mjs scripts/cli.test.mjs`
Expected: the new `linear` tests FAIL. `linear alone` fails because `validateRepo` throws `NOT_SUPPORTED`. The `linear` plus another key tests fail because the tracker problem is missing from the list. The CLI `validate` test fails on exit code 2. The empty-file, string-tracker, `local` plus bad key, `.issues/` broken, trello and `issues list` tests already pass, because they pin behavior that must stay.

- [ ] **Step 3: Implement** in `scripts/lib/validate.mjs`.
  - Change the import to `import { TRACKERS, loadConfig, unsupportedTracker, validateLocalConfig, validatePmkitConfig } from './config.mjs'`.
  - Add `function unsupportedTrackerMessage(parsed): string | null`. It uses a local `isMap = (x) => typeof x === 'object' && x !== null && !Array.isArray(x)`. When `isMap(parsed)`, `isMap(parsed.tracker)` and `TRACKERS.includes(parsed.tracker.system)` hold, it calls `unsupportedTracker(parsed.tracker.system)` and returns `` `${rule.message}, set it to local` `` for a non-null result. Every other case returns `null`.
  - In `pmkitConfigProblems`, build `const messages = validatePmkitConfig(parsed)`, push `unsupportedTrackerMessage(parsed)` when it is not `null`, and map the list to problems with path `at` and code `config`.
  - Update the comment above `brokenConfigProblem`: the rethrown `.pmkit/config.yaml` errors include the unsupported tracker, which `pmkitConfigProblems` now lists.

- [ ] **Step 4: Run to verify they pass**

Run: `node --test scripts/validate.test.mjs scripts/cli.test.mjs`
Expected: PASS.

- [ ] **Step 5: Run the whole suite**

Run: `npm test`
Expected: PASS, no golden differs. If one differs, follow the golden rule in Global Constraints.

- [ ] **Step 6: Commit**

```bash
git add scripts/lib/validate.mjs scripts/validate.test.mjs scripts/cli.test.mjs
git commit -m "fix: list an unsupported tracker.system as a validate problem (PMK-119)" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

Complexidade: média

---

## Self-review

- Spec coverage: criterion 1 and 2 in Task 2 (alone, both, three problems); criterion 3 in the CLI tests; criterion 4 in both tasks' `npm test`. The shared export, the `loadConfig` guard, the odd shapes, the `trello` guard (existing test, unchanged), the `issues list` guard and the writes-nothing check each have a test.
- Types: `unsupportedTracker` and `unsupportedTrackerMessage` are named the same in both tasks.
- Goldens, scenarios, `commands/` and `CHANGELOG.md` are untouched.
