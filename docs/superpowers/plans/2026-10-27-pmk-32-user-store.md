# PMK-32 the user store Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A library module resolves `~/.config/pmkit/` and reads and writes two kinds of file in it: cache entries with a TTL and a personal defaults file. A guard and a test keep any credential out of the repository.

**Architecture:** One module, `scripts/lib/user-store.mjs`, with no state. Every function takes an options object (`env`, `now`, `homedir`) so tests never read the process environment. No CLI command is added (ADR-0002 needs no entry for a library). The module uses `node:fs`, `node:os`, `node:path` and `node:crypto` only (ADR-0003).

**Tech Stack:** Node 18+ ES modules, no dependencies, `node:test`. Run the suite with `npm test`.

**Spec:** `docs/superpowers/specs/2026-10-27-pmk-32-user-store-design.md`. The spec is the authority. Where this plan and the spec differ, the spec wins, and the implementer reports the difference.

## Global Constraints

- Decided: `PMKIT_HOME` exists and wins over `XDG_CONFIG_HOME`. No `config` command. No `validate` check of repo configs (follow-up). The Local query index stays in `.issues/.cache/`. There is no `credentials/` folder and no credential writer. The Linear key lives in `$LINEAR_API_KEY` only.
- `package.json` gains nothing. `npm test` must not touch the network and must not write outside `tempDir` folders.
- Errors use `PmkitError('INVALID_INPUT', message, nextStep)` from `scripts/lib/errors.mjs`. An error message never contains a credential-shaped value.
- Folder mode 0700, file mode 0600. Mode assertions are skipped when `process.platform === 'win32'`.
- Names (scope, key, default key) match `^[a-z0-9][a-z0-9._-]*$`.
- Code, comments and commits are English and follow the unslop rules. Every commit message carries `(PMK-32)` and ends with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Test files use `tempDir` from `scripts/test-helpers.mjs`. A new test file is picked up by the glob `scripts/**/*.test.mjs`.

### Module surface

```js
// scripts/lib/user-store.mjs
export function userDir(options)                              // path, creates nothing
export function repoHash(root)                                // 12 hex chars of sha256(realpath(root))
export function assertOutsideRepo(target, options)            // throws INVALID_INPUT
export function cacheGet(scope, key, options)                 // { value, storedAt, expiresAt } | null
export function cachePut(scope, key, value, { ttlSeconds }, options)
export function cacheDelete(scope, key, options)
export function cacheClear(scope, options)                    // scope omitted: all of cache/
export function defaultsGet(options)                          // map or {}
export function defaultsSet(key, value, options)
export function defaultsUnset(key, options)
// options = { env = process.env, now = () => new Date(), homedir = os.homedir }
```

## File Map

- Create `scripts/lib/user-store.mjs`: the module.
- Create `scripts/user-store.test.mjs`: library tests.
- Create `scripts/user-store-repo.test.mjs`: the repository sentinel test over the CLI.
- Modify `scripts/test-helpers.mjs`: add `userStoreEnv()`.
- Modify `scripts/golden-helpers.mjs`: `childEnv()` points `HOME`, `USERPROFILE`, `XDG_CONFIG_HOME` and `PMKIT_HOME` at a per-run temp folder.
- Modify `scripts/golden-helpers.test.mjs`: a test for that change.
- Modify `CONTEXT.md`: one glossary entry, "user store" (only if the file has a glossary).

## Acceptance Criteria Map

| Criterion | Tasks |
| --- | --- |
| 1. `~/.config/pmkit/` holds a discovery cache with a TTL and personal defaults | 2, 3, 4, 5, 7 |
| 2. No command writes a credential to a file in the repository | 1, 3, 6, 8 |

---

### Task 1: Test isolation helpers

**Files:** modify `scripts/test-helpers.mjs`, `scripts/golden-helpers.mjs`, `scripts/golden-helpers.test.mjs`.

- [ ] **Step 1: Write the failing tests.** In `golden-helpers.test.mjs`, assert that `childEnv()` returns `HOME`, `USERPROFILE`, `XDG_CONFIG_HOME` and `PMKIT_HOME` set, that each is inside `os.tmpdir()`, that two calls return the same folders, and that none equals `process.env.HOME`. In `user-store.test.mjs` (new file, first test), assert `userStoreEnv()` returns `{ home, env }` with those four variables under `home`, and that `home` exists.
- [ ] **Step 2: Run** `node --test scripts/golden-helpers.test.mjs scripts/user-store.test.mjs`. Expect failures.
- [ ] **Step 3: Implement.** `userStoreEnv()` in `test-helpers.mjs`: `home = tempDir('pmkit-home-')`, `env = { HOME: home, USERPROFILE: home, XDG_CONFIG_HOME: path.join(home, '.config'), PMKIT_HOME: path.join(home, '.config', 'pmkit') }`. In `golden-helpers.mjs`, a lazy module-level `userStoreEnv()` call, spread into `childEnv()`. Import from `test-helpers.mjs` (check for an import cycle first).
- [ ] **Step 4: Run** the two files, then `npm test`. Expect pass and an empty private `TMPDIR`.
- [ ] **Step 5: Commit** `test: isolate the user store from tests (PMK-32)`.

### Task 2: Folder resolution

**Files:** create `scripts/lib/user-store.mjs`; modify `scripts/user-store.test.mjs`.

- [ ] **Step 1: Write the failing tests.** Cases: `PMKIT_HOME` wins over `XDG_CONFIG_HOME` and `homedir`. Empty `PMKIT_HOME` is ignored. An absolute `XDG_CONFIG_HOME` gives `<xdg>/pmkit`. A relative one is ignored. With neither, the result is `<homedir()>/.config/pmkit`. With `env: {}` and `homedir` injected, the process environment is not read. `userDir` creates no file or folder (check the temp parent is still empty). A `PMKIT_HOME` that is relative throws `INVALID_INPUT`.
- [ ] **Step 2: Run** `node --test scripts/user-store.test.mjs`. Expect failure (module missing).
- [ ] **Step 3: Implement** `userDir` and the shared `resolve(options)` that fills defaults for `env`, `now` and `homedir`. Add `checkName(kind, value)` for the name pattern, used by later tasks.
- [ ] **Step 4: Run** the test. Expect pass.
- [ ] **Step 5: Commit** `feat: resolve the user store folder (PMK-32)`.

### Task 3: Repository hash and the outside-repo check

**Files:** modify `scripts/lib/user-store.mjs`, `scripts/user-store.test.mjs`.

- [ ] **Step 1: Write the failing tests.** `repoHash` returns 12 lowercase hex characters, is the same for a path and a symlink to it, differs for two folders. `assertOutsideRepo(target, options)`: a target under a folder holding `.git` (a directory or a file) throws `INVALID_INPUT` with a next step that names `PMKIT_HOME`. A target whose existing ancestors hold no `.git` passes, even when its own folders do not exist yet. A `.git` exactly at `homedir()` is ignored. A `.git` in an ancestor above `homedir()` still throws only when the target is not under a home-level exemption (test: `.git` in the parent of the fake home blocks).
- [ ] **Step 2: Run.** Expect failure.
- [ ] **Step 3: Implement.** Walk up from `path.resolve(target)`, resolving the first existing parent with `fs.realpathSync`, checking `fs.existsSync(path.join(dir, '.git'))` at each level, skipping the level equal to the real path of `homedir()`. No process spawn.
- [ ] **Step 4: Run.** Expect pass.
- [ ] **Step 5: Commit** `feat: add repoHash and the outside-repo check (PMK-32)`.

### Task 4: Cache put and get with a TTL

**Files:** modify `scripts/lib/user-store.mjs`, `scripts/user-store.test.mjs`.

- [ ] **Step 1: Write the failing tests.** Put then get returns `{ value, storedAt, expiresAt }`. With injected `now`, get one second before expiry returns the value, at exactly `storedAt + ttl` returns `null`, after returns `null`. An expired file is still on disk after `cacheGet`. A missing file, an empty file, invalid JSON and `version: 2` all return `null`. `ttlSeconds` missing, zero, negative or fractional throws `INVALID_INPUT`. A value of `undefined` or a circular object throws `INVALID_INPUT`. A bad scope or key (`/`, `..`, uppercase, empty) throws. Folders are 0700 and the file is 0600. No `.tmp` file remains. A second put replaces the entry whole. The entry lands at `<userDir>/cache/<scope>/<key>.json` with the layout from the spec.
- [ ] **Step 2: Run.** Expect failure.
- [ ] **Step 3: Implement.** `cachePut` checks names, TTL and serializability, calls `assertOutsideRepo` on the target, creates folders with `mode: 0o700`, writes `<file>.<pid>.tmp` with mode 0600, then `fs.renameSync`. `cacheGet` catches every read and parse error and returns `null`. A guard hook (`assertNoCredentials(value)`) is called in `cachePut` and is a no-op until Task 6.
- [ ] **Step 4: Run.** Expect pass.
- [ ] **Step 5: Commit** `feat: store cache entries with a TTL (PMK-32)`.

### Task 5: Cache delete and clear

**Files:** modify `scripts/lib/user-store.mjs`, `scripts/user-store.test.mjs`.

- [ ] **Step 1: Write the failing tests.** `cacheDelete` removes one entry and ignores a missing one. `cacheClear('a')` removes scope `a` and leaves scope `b`. `cacheClear()` removes `cache/` and leaves `defaults.yaml` in place. Clearing when nothing exists does not throw and does not create folders. A bad scope throws.
- [ ] **Step 2: Run.** Expect failure.
- [ ] **Step 3: Implement** with `fs.rmSync(..., { recursive: true, force: true })` on paths built after name checks.
- [ ] **Step 4: Run.** Expect pass.
- [ ] **Step 5: Commit** `feat: delete and clear cache entries (PMK-32)`.

### Task 6: Credential guard

**Files:** modify `scripts/lib/user-store.mjs`, `scripts/user-store.test.mjs`.

- [ ] **Step 1: Write the failing tests.** `cachePut` rejects a nested value with a key named `apiKey`, `token`, `Authorization`, `client_secret` or `password`, at depth 3 and inside an array. It rejects a string starting `lin_api_` followed by 20 or more characters, and a string that starts with `Bearer ` and a token. Each throws `INVALID_INPUT`, the message names the key path (`value.a.b`), and the message does not contain the rejected value (assert with a sentinel). A value with `team`, `states` and `labels` passes. A rejected put leaves no file. The module creates no `credentials/` folder in any call (list the folder after a full run).
- [ ] **Step 2: Run.** Expect failure.
- [ ] **Step 3: Implement** `assertNoCredentials(value, label)` with the key pattern `/token|secret|password|passwd|api[_-]?key|credential|authorization/i` and the two string patterns. Export `isCredentialKey(key)` for Task 7. Add a code comment: a guard against accidents, not a security boundary.
- [ ] **Step 4: Run.** Expect pass.
- [ ] **Step 5: Commit** `feat: refuse credential-shaped cache values (PMK-32)`.

### Task 7: Personal defaults

**Files:** modify `scripts/lib/user-store.mjs`, `scripts/user-store.test.mjs`.

- [ ] **Step 1: Write the failing tests.** `defaultsGet` returns `{}` with no file. It returns the parsed map for `output: json\neditor: vim\n`. A file that is a list, or that does not parse, throws `INVALID_INPUT` with the file path in the message and a next step. `defaultsSet('output', 'json')` creates the file (mode 0600, folder 0700). A second `defaultsSet` keeps a `# note` comment and other keys, and replaces the changed value. `defaultsUnset` removes the key and keeps the rest, and is fine when the key or file is missing. A key outside the name pattern throws. A key such as `apiKey` or `token` throws (`isCredentialKey`), and a `lin_api_` value throws, without echoing the value. A store path inside a repository throws. A non-scalar value (object, array) throws `INVALID_INPUT`.
- [ ] **Step 2: Run.** Expect failure.
- [ ] **Step 3: Implement** with `parseYaml` for reads and `setScalar` from `scripts/lib/yaml-edit.mjs` for writes. Write through the same temp-and-rename helper as the cache. For unset, remove the line with a small helper in the module (or add `unsetKey` to `yaml-edit.mjs` with its own test if that file has a natural place).
- [ ] **Step 4: Run.** Expect pass.
- [ ] **Step 5: Commit** `feat: read and write personal defaults (PMK-32)`.

### Task 8: Repository sentinel test over the CLI

**Files:** create `scripts/user-store-repo.test.mjs`.

- [ ] **Step 1: Write the test.** Make a repo copy with `makeRepo('basic')`. Build `env` from `userStoreEnv()` plus `LINEAR_API_KEY`, `GITHUB_TOKEN` and `GH_TOKEN` set to `pmkit-test-sentinel-9f3a`. Run through `runPmkit` from `golden-helpers.mjs`: `init` in a bare temp repo, `issues create`, `issues update`, `epic create`, `cycle open`, `release create`, `milestone create`, `issues comment` (with a body file), `docs create`, `reindex`, plus `validate` and `discover` as reads. Every run must exit 0, so the test proves the commands ran. Then walk the repo copies (all files, `.git` included) and fail if any file contains the sentinel. Also assert that the store folder from `env` holds no file written by those commands (the CLI does not use the store yet), so a later command that does use it must show up here on purpose.
- [ ] **Step 2: Run** `node --test scripts/user-store-repo.test.mjs`. Expect pass (this test guards existing behavior). To prove it can fail, temporarily write the sentinel from a scratch command into the copy and see the walk catch it, then discard that change.
- [ ] **Step 3: Commit** `test: check that no command writes a credential into the repository (PMK-32)`.

### Task 9: Full verification and glossary

**Files:** modify `CONTEXT.md` if it has a glossary.

- [ ] **Step 1:** If `CONTEXT.md` has a glossary, add "user store: the per-user folder `~/.config/pmkit/` for the discovery cache and personal defaults. Outside the repository, holds no credential." Use the `domain-modeling` conventions of the file.
- [ ] **Step 2:** Run `npm test`. Expect all pass, `plugin.test.mjs` included (`package.json` unchanged), and an empty private `TMPDIR`.
- [ ] **Step 3:** Run `git status` and `git diff --stat main`. Expect only the files in the File Map. Confirm `ls ~/.config/pmkit` was not created by the run.
- [ ] **Step 4: Commit** `docs: add the user store to the glossary (PMK-32)`, or skip this commit when nothing changed.
