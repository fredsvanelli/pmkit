# Linear uses a personal API key from the environment

Linear has no official CLI whose login pmkit could reuse. The "reuse existing tokens" half of the Unified model's Q1 decision D therefore has nothing to reuse for Linear. Q5 decision A says tokens come from the OS keychain, env vars or existing CLI logins, and never from the repository file.

The user creates a personal API key in Linear (Settings, Security & access) and exports it as `LINEAR_API_KEY`. The client reads it from the `env` that `run(argv, { env })` passes in and sends it as `Authorization: <key>`, with no `Bearer` prefix. Linear answers HTTP 400 to a key sent as a Bearer token, and HTTP 401 to a key it does not know. Linear's keys start with `lin_api_`, and pmkit does not check the prefix. pmkit stores no credential anywhere. One module, `scripts/lib/linear/credential.mjs` (PMK-30), is the only reader of the variable. One variable serves every workspace, and a workspace pin catches a wrong key.

pmkit is not a Linear agent in EPC-5. The user chose to leave that for a follow-up.

## Considered options

- Personal API key from the environment. Chosen. It adds no stored secret, no refresh and no server, and it works the same in a terminal, in CI and in scheduled runs.
- OAuth app with PKCE. Rejected for EPC-5. It adds a stored secret, a 24-hour token refresh, a callback port, a registered app and an admin install. It is the only way for pmkit to become a Linear agent (`actor=app` with the `app:assignable` scope), so it stays a later option, tracked as a follow-up issue.
- Token of Linear's official MCP. Rejected. pmkit would read a file it does not own, and its place and shape change with each MCP client. Q1 keeps official MCPs out of the critical path.
- OS keychain storage. Rejected by the user. It needs `security` on macOS and `secret-tool` on Linux, Windows has no built-in reader, and WSL often lacks `secret-tool`.
- Key file in the user store. Rejected by the user. It puts a secret in a file, which Q5 rules out.

## Consequences

- Security rules. The key never appears in output, in a command-line argument, in an error message or its `details`, in a cache file or in the transcript. `/pmkit:setup` never asks for it, and pmkit reads no `.env` file because Q5 forbids a secret in a repository file.
- Workspace pin. `tracker.scope.workspace` holds the workspace's URL key. PMK-31 adds it to the config schema and the loader, required when `tracker.system` is `linear`. On the first request of each run, PMK-30 asks for `viewer` and `organization { urlKey previousUrlKeys }` and fails with `AUTH` when the configured key matches neither. A match on `previousUrlKeys` only gives a warning that names the new URL key.
- Error mapping. A missing key, HTTP 401, a foreign workspace and `FORBIDDEN` are `AUTH`. Rate limits are `RATE_LIMITED`. Network failures and HTTP 5xx are `UPSTREAM`.
- Authorship. Every write appears in Linear as the key's owner. The adapter resolves `me` and the actor from `viewer`, not from `git config user.email`.
- Agent delegation. A key can delegate an issue to an agent that the workspace installed. pmkit cannot be that agent without an OAuth app. PMK-33 reports `agent_delegation` as `conditional` for Linear.
- PMK-30 adds `scripts/lib/linear/credential.mjs` and builds `createLinearClient({ env, fetch })`, so `npm test` injects a fake `fetch` and opens no socket. It sends the header from `linearCredential(env)`, runs the workspace check, applies the error mapping, and tests that a fake key appears in no output. It also refuses secret-like config keys such as `token` and `api_key`, with `INVALID_INPUT`. No other module reads `LINEAR_API_KEY`.
- PMK-31 adds `tracker.scope.workspace` to the schema and the loader, required for `linear`. It does not police secret-like config keys, because PMK-30 owns that refusal.
- PMK-32 holds no credential. The user store has no credential field and no writer for one. The Linear cache holds API responses only, keyed by workspace URL key and repository hash. A test checks that no file under the store contains a fake key set in `env`.
- PMK-33 makes `discover --json` return `auth: { source, viewer, workspace }` before teams and states, and fails with `AUTH` when no key is set.
- `/pmkit:setup` runs `discover --json`. On `AUTH`, it tells the user to create a key with read and write access and to export `LINEAR_API_KEY` in the shell profile or in `~/.claude/settings.json`, never in a file inside the repository. It then asks the user to run setup again. On success, it writes `tracker.scope.workspace`.
- PMK-39 reads the same `LINEAR_API_KEY`. It runs only when an opt-in variable is set, and only against a dedicated sandbox team, never a team that holds real work. It checks the team key before its first write.
- Cost. A key has the full rights of its owner, and a key in the shell profile reaches every process the user runs, as a `gh` login does.
