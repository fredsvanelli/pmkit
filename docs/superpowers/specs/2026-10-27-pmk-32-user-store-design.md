# PMK-32 design: the user store for caches and personal defaults

Issue PMK-32, epic EPC-5 (Linear tracker adapter), milestone `linear`. Status: draft, with open questions at the end. Calls marked **(builder's call)** were made while writing this spec and change no acceptance criterion.

## Problem

pmkit keeps every file it writes inside the repository (`.pmkit/`, `.issues/`, `.issues/.cache/`). The Linear adapter needs two things that must not live there:

- A discovery cache (teams, states, labels, members, estimate scales) that expires. It differs per machine and per user, and it is not worth a commit.
- Personal defaults, such as a preferred output format, that one developer sets for themselves and the team does not inherit.

Unified model, Q5 decision A says: "The user store (e.g., `~/.config/pmkit/`) holds the discovery cache with a TTL and personal defaults. Tokens come from the OS keychain, env vars or existing CLI logins, never from the repo file." The Technical spec ("Capability manifest") already places the manifest at `~/.config/pmkit/cache/<repo-hash>/manifest.json`. The Linear tab lists "what to store locally and how to invalidate it" as open, which this issue answers for the cache.

PMK-33 and PMK-47 depend on this issue. PMK-28 (in parallel) decides how pmkit authenticates to Linear. This issue does not decide credential storage.

Acceptance criteria:

1. `~/.config/pmkit/` holds a discovery cache with a TTL and personal defaults.
2. No command writes a credential to a file in the repository.

## Current state

- No script reads `HOME`, `XDG_CONFIG_HOME` or `os.homedir()`. The only user-level input is `git config user.email` (in `actor.mjs`) and `PMKIT_USER`.
- `scripts/lib/config.mjs` loads `.pmkit/config.yaml` and `.issues/config.yaml`. Neither holds secrets (Technical spec, "Config schemas").
- `scripts/lib/local/query-index.mjs` writes the Local query index to `.issues/.cache/`, which is gitignored. It is repository-scoped and stays as is.
- Tests make temp folders through `tempDir` in `scripts/test-helpers.mjs` (PMK-111). It removes them when the file's tests end, and `npm test` runs under a private `TMPDIR` that must be empty afterwards.
- `scripts/golden-helpers.mjs` `childEnv()` builds the environment of spawned CLI runs, and `scenarios-live.mjs` forwards `HOME` and `XDG_*` on purpose.
- ADR-0003: no dependencies, Node 18+. The store uses `node:fs`, `node:os`, `node:path` and `node:crypto` only.

## Goals

- One module, `scripts/lib/user-store.mjs`, resolves the user folder and reads and writes two kinds of file in it: cache entries with a TTL and a personal defaults file.
- The resolution follows XDG, so tests and users can move the folder with environment variables.
- The folder has a reserved place for credentials-related data that this issue leaves empty and unused, so PMK-28 adds to it without moving anything.
- Nothing in the store, and no existing command, writes a credential into the repository.

## Non-goals

- Credential storage, token lookup, keychain access and the Linear authentication method (PMK-28, ADR-0005).
- Cache contents and the code that fills it (PMK-33 discovery, PMK-47). This issue stores opaque JSON values.
- The capability manifest move from `.issues/.cache/` or in-memory into the store. The Technical spec path is reserved by the layout below, and the manifest caller adopts it later.
- A `pmkit config` command to edit defaults. Open question 3.
- Which personal defaults exist. The store holds a map and validates the file shape, not the keys.

## Layout

The user folder is, in order of precedence:

1. `$PMKIT_HOME`, when set and non-empty. An explicit override for tests, CI and users who want another place. **(builder's call)**
2. `$XDG_CONFIG_HOME/pmkit`, when `XDG_CONFIG_HOME` is set and is an absolute path (the XDG rule: relative values are ignored).
3. `<os.homedir()>/.config/pmkit`. `os.homedir()` reads `HOME` on POSIX and `USERPROFILE` on Windows.

The path stays `~/.config/pmkit/` on every platform, as the sources say. A native Windows or macOS location is not used. **(builder's call)** The sources name one path, one rule keeps tests simple, and nothing here needs a platform convention.

```
<user folder>/
  defaults.yaml                          personal defaults (YAML, a flat map)
  cache/
    <scope>/<key>.json                   cache entries with a TTL
  credentials/                           reserved for PMK-28, created by nobody in this issue
```

`<scope>` is a short name the caller picks. `repoHash(root)` returns the first 12 hex characters of the SHA-256 of the repository's real path, so `cache/<repoHash>/manifest.json` matches the Technical spec. A global scope such as `linear-<orgUrlKey>` is also valid. `<key>` and `<scope>` must match `^[a-z0-9][a-z0-9._-]*$`. Anything else, including `/` and `..`, throws `INVALID_INPUT`, so a key cannot climb out of the folder.

The reserved `credentials/` name does not mean the store will hold tokens. It marks where PMK-28 may put something (for example a file reference or an OAuth refresh state) if its decision needs a file. The module exports nothing for that folder, and a test asserts the module creates no `credentials/` folder. If PMK-28 chooses keychain and env vars only, the name stays unused.

## Cache entries

File `cache/<scope>/<key>.json`:

```json
{ "version": 1, "storedAt": "2026-10-27T12:00:00.000Z", "ttlSeconds": 86400, "value": { } }
```

API (all take an options object with `env`, `now` and `homedir` for tests, defaulting to `process.env`, `() => new Date()` and `os.homedir`):

| Function | Behavior |
| --- | --- |
| `userDir(options)` | Returns the resolved folder path. Creates nothing. |
| `cacheGet(scope, key, options)` | Returns `{ value, storedAt, expiresAt }` when the entry exists and `now < storedAt + ttl`. Returns `null` when the file is missing, expired, unreadable, not valid JSON or has another `version`. It never throws on a bad file, because a cache can always be rebuilt. |
| `cachePut(scope, key, value, { ttlSeconds }, options)` | Writes the entry. `ttlSeconds` is a required positive integer. Creates the folders with mode 0700 and the file with mode 0600. |
| `cacheDelete(scope, key, options)` | Removes one entry. A missing entry is fine. |
| `cacheClear(scope, options)` | Removes every entry of a scope, or all scopes when `scope` is omitted. |

Decisions:

- The TTL is stored in the entry and set by the caller at write time. The store has no global default, because the right life differs by data (members change faster than states). **(builder's call)** PMK-33 picks the numbers.
- Expiry compares against the injected `now`, so tests need no sleeping.
- Writes go to a temp file in the same folder and then `renameSync` over the target, so two pmkit processes never leave a half-written file. A reader sees the old entry or the new one.
- An expired entry is not deleted on read. `cacheGet` stays a read. A stale file is overwritten by the next `cachePut`, and `cacheClear` removes it. **(builder's call)**
- Invalidation rules beyond the TTL (config changed, `setup --refresh`) belong to the callers. They call `cacheDelete` or `cacheClear`.
- Values must be JSON. `cachePut` calls `JSON.stringify` and throws `INVALID_INPUT` on `undefined` or a circular value.

## Personal defaults

File `defaults.yaml`, a flat map of scalar keys and values, read with the existing `parseYaml`.

| Function | Behavior |
| --- | --- |
| `defaultsGet(options)` | Returns the parsed map, or `{}` when the file does not exist. A file that does not parse or is not a map throws `INVALID_INPUT` with the path and a next step, because a human edits this file and a silent `{}` would hide the mistake. |
| `defaultsSet(key, value, options)` | Reads, sets one key and rewrites the file with the YAML edit helpers (`yaml-edit.mjs`), so comments survive. |
| `defaultsUnset(key, options)` | Removes one key. |

Precedence for a setting is the caller's: a command flag, then the repo config, then `defaults.yaml`, then the built-in default. The store only supplies the third layer. Personal defaults never override a team-confirmed repo mapping. **(builder's call)** This matches Q5: the repo file is shared truth and the user store holds personal preference.

The key names (for example `output`, `editor`) are not fixed here. `defaultsSet` accepts any key matching the cache key pattern, so the first consumer defines its own.

## Credential guard (criterion 2)

Four layers, from structural to checked:

1. **No API.** The store has no function that takes a token, and no command in this issue calls `defaultsSet` with one. `defaultsSet` and `cachePut` refuse a credential-shaped input, below.
2. **Outside the repository.** Every write checks that the resolved target path is not inside a git work tree. `assertOutsideRepo(path)` walks up from the target to its first existing parent and looks for a `.git` entry in any ancestor, with no process spawn. If one exists, the call throws `INVALID_INPUT` ("the user store resolves inside a repository") with the next step "Unset XDG_CONFIG_HOME or PMKIT_HOME". This stops a developer from pointing the store at the repo, and it stops a test with a wrong `HOME` from writing into the repo. The folder under a user's real home is not inside a repository unless the home itself is one. A dotfiles repo at `~` is common, so a `.git` found at `os.homedir()` itself is ignored. **(builder's call)**
3. **Credential-shaped input is rejected.** `defaultsSet` rejects a key that matches `/token|secret|password|passwd|api[_-]?key|credential|authorization/i`. `cachePut` rejects a value that contains a key matching the same pattern at any depth, or a string value that looks like a Linear key (`lin_api_` followed by 20 or more characters) or a bearer header. The error is `INVALID_INPUT` and the message names the key path, never the value. This is a guard against an accident, not a security boundary, and the spec says so in the code comment.
4. **A test that watches the repository.** A test runs a representative set of CLI commands (the write commands listed in the capability manifest's `servedBy` lists: `init`, `issues create`, `issues update`, `epic create`, `cycle create`, `release create`, `comment add`, plus `pmkit doctor` or `validate` as a read) in a copy of the fixture repository with `PMKIT_HOME` and `HOME` pointing at a temp folder and `LINEAR_API_KEY`, `GITHUB_TOKEN` and `GH_TOKEN` set to a sentinel string (`pmkit-test-sentinel-9f3a`). After the runs it walks the repository copy and fails if any file holds the sentinel. It uses the existing `hashTree` or a walk, and it needs no network. This turns criterion 2 into a regression check for every command that exists today. Later commands (PMK-28's authentication) add themselves to the list of commands the test runs.

The guard also covers `.pmkit/config.yaml`. See open question 2 for validating that file.

## Approaches compared

| Approach | Description | Verdict |
| --- | --- | --- |
| A. One library module with injected env | `user-store.mjs` as above. Tests pass `env` and `homedir`, or set `PMKIT_HOME`. | Chosen. It is the smallest piece that PMK-33 and PMK-47 import, needs no CLI surface, and has no global state to reset between tests. |
| B. A `pmkit store` CLI group (`get`, `set`, `clear`) with the library behind it | Gives commands and agents a way to read and write the store. | Rejected for now. ADR-0002 says commands are the source for every agent, so a store command would need a manifest entry, a scenario and a golden before anyone needs it. Open question 3 asks whether personal defaults need one. |
| C. Reuse `.issues/.cache/` with a gitignored `.pmkit/.local/` folder in the repo | No new location, no `HOME` access. | Rejected. It breaks Q5 (the sources want the folder outside the repo), the cache would not be shared across clones of the same repo, and a credential in the repo tree is exactly what criterion 2 forbids. |

## Testing

All tests use `node:test` and make folders with `tempDir` from `scripts/test-helpers.mjs`, so PMK-111's cleanup and the private-`TMPDIR` check cover them. No test writes to the real `~/.config`.

How the real folder stays untouched:

- Library tests never read the process environment. Each call passes `{ env: { PMKIT_HOME }, homedir: () => fakeHome }` or sets only `XDG_CONFIG_HOME`, where `fakeHome` and the XDG folder come from `tempDir('pmkit-home-')`.
- A helper in `test-helpers.mjs`, `userStoreEnv()`, makes one temp folder and returns `{ home, env }` with `HOME`, `USERPROFILE`, `XDG_CONFIG_HOME` and `PMKIT_HOME` set under it. CLI tests spawn the CLI with that `env`, merged over `childEnv()`.
- `golden-helpers.mjs` `childEnv()` gets `HOME`, `XDG_CONFIG_HOME` and `PMKIT_HOME` pointed at a per-run temp folder, so scenarios and goldens can never reach the developer's real folder even after a command starts using the store. Today it forwards none of them. The first scenario that touches the store would otherwise write to the real home. **(builder's call)**
- `scenarios-live.mjs` keeps forwarding `HOME` and `XDG_*` on purpose (a live run uses the real login), and is not part of `npm test`.
- A guard test: with `HOME` set to a temp folder, `userDir()` with no overrides returns `<temp>/.config/pmkit`. `XDG_CONFIG_HOME` relative is ignored. `PMKIT_HOME` wins over both. None of these creates a file.

Cases:

- Resolution order (the four above), and that `userDir` creates nothing.
- `cachePut` then `cacheGet` returns the value. Past the TTL it returns `null`. At exactly the expiry second it returns `null`.
- A corrupt file, a wrong `version` and an empty file return `null`.
- File and folder modes are 0600 and 0700 (skipped on Windows).
- A `.tmp` file does not remain after a write. A write over an existing entry replaces it whole.
- Scope or key with `/`, `..`, an uppercase letter or an empty string throws.
- `cacheClear(scope)` removes only that scope. `cacheClear()` removes the `cache/` folder and leaves `defaults.yaml` and `credentials/` alone.
- `defaultsGet` on a missing file gives `{}`. A malformed file throws with the path. `defaultsSet` keeps a comment in the file.
- The credential guard: a store path inside a folder with `.git` throws. A `.git` at the fake home is ignored. A key named `apiKey`, `token` or `Authorization` is rejected in `defaultsSet` and in a nested `cachePut` value. A `lin_api_` string is rejected. The error message does not contain the value.
- The repository sentinel test described under layer 4.
- `plugin.test.mjs` still passes: `package.json` gains no key.

## Acceptance criteria to design

| Criterion | Design part |
| --- | --- |
| 1. `~/.config/pmkit/` holds a discovery cache with a TTL and personal defaults | Layout (`userDir`, `cache/<scope>/<key>.json`, `defaults.yaml`), cache entries with `ttlSeconds` and `cacheGet` expiry, personal defaults functions, the resolution tests and the TTL tests |
| 2. No command writes a credential to a file in the repository | Credential guard layers 1 to 4: no credential API, `assertOutsideRepo`, rejection of credential-shaped keys and values, and the sentinel test over the existing commands |

## Risks and notes

- **PMK-28 overlap.** PMK-28 may want a credential file, a keychain wrapper or OAuth state in the user folder. The `credentials/` name is reserved and the credential guard rejects credential-shaped input in `defaults.yaml` and the cache. PMK-28 will need its own writer that bypasses the guard on purpose, and should say so in ADR-0005. If PMK-28 wants a different folder name, it is a one-line change.
- **Windows.** `~/.config/pmkit` on Windows is unusual but works. File modes are advisory there.
- **Shared machines.** The 0600 and 0700 modes keep other local users out of cached team data. The cache holds no secrets by design.
- **A home that is a git repository.** Handled by ignoring a `.git` found exactly at `os.homedir()`. A `.git` in any other ancestor of the user folder blocks the write.
- **Concurrency.** Atomic rename makes each write whole. Two processes that write the same entry last-writer-wins, which is fine for a cache.
- **PMK-111 interplay.** `npm test` runs under a private `TMPDIR`. Because tests put their fake home under `tempDir`, a store write that escapes to the real home would not be caught by the leak check. The `childEnv()` change and the real-`HOME` guard test are the protection.

## Open questions

1. **Should `PMKIT_HOME` exist beside `XDG_CONFIG_HOME`?**
   - A. Yes. Tests and CI set one variable, and users get an override that does not move their other XDG-aware tools.
   - B. No. Use `XDG_CONFIG_HOME` only, as the sources imply.
   - Recommendation: A. It costs one line, and `XDG_CONFIG_HOME` also moves `gh` and other tools in a test child process.
2. **Should `validate` and `loadConfig` reject credential-shaped keys in `.pmkit/config.yaml` and `.issues/config.yaml`?**
   - A. Yes, as a validation problem ("config must not hold a token; use an env var"). It turns Q5's "never from the repo file" into a check on the file people edit by hand.
   - B. No. Only the store guard and the sentinel test.
   - Recommendation: A, in a follow-up issue so this one stays about the store. The schema owner (PMK-8 area) changes the validator, and it needs PMK-28's key names.
3. **Does a developer need a command to read and write personal defaults?**
   - A. No. The store is a library for adapters now. Users edit `defaults.yaml` by hand.
   - B. Add `pmkit config get|set|unset` for the user store, with a manifest entry, a scenario and a golden.
   - Recommendation: A until a skill needs a default, then B in its own issue.
4. **Should the store move the Local query index too?**
   - A. No. `.issues/.cache/` is repository-scoped, gitignored and rebuilt from timestamps.
   - B. Move it to `cache/<repoHash>/` to keep the repo tree clean.
   - Recommendation: A. It works and nothing in the sources asks for the move.
