# PMK-28 design: how pmkit authenticates to Linear

Issue PMK-28, epic EPC-5 (Linear tracker adapter), milestone `linear`. Status: approved, with the user's answers applied. Calls marked **(builder's call)** were made while writing this spec and change no acceptance criterion.

## Problem

The Linear adapter needs a credential before it can make its first call, and nothing in pmkit holds one today. The GitHub git host reuses the `gh` login and holds no token (ADR-0003, `scripts/lib/github/host.mjs`). Linear has no official CLI whose login pmkit could reuse, so the "reuse existing tokens" half of the Unified model's Q1 decision D has nothing to reuse for Linear.

The Linear tab leaves the question open: "personal API key or OAuth app. OAuth is required if the plugin registers as an agent in Linear". The Unified model's Q5 decision A says where a secret may live: "Tokens come from the OS keychain, env vars or existing CLI logins, never from the repo file."

PMK-30 (the API client) is blocked on this decision. PMK-32 (the user store) and the Linear branch of `/pmkit:setup` depend on it too.

Sources: Linear tab, Open questions (Authentication) and Agents (domain 15); Unified model, Q1 decision D, Q5 decision A and the `agent_delegation` row of Capabilities by system; Technical spec, Errors (`AUTH`: "missing or expired credentials").

Acceptance criteria:

1. An ADR in `docs/adr/` records the choice and the options.

## Goals

- One credential for the whole Linear epic, chosen and recorded in `docs/adr/0005-linear-uses-a-personal-api-key-from-the-environment.md`.
- A rule for where the credential comes from, which PMK-30 implements and PMK-32 and setup respect.
- A rule that the key never appears in output, in an argument, in a file pmkit writes or in the agent's transcript.
- A check that the key belongs to the workspace the repository uses, before pmkit reads or writes.
- What each of PMK-30, PMK-32, PMK-33 and setup must do, so their specs start from this one.

## Non-goals

- Code. PMK-28 delivers the ADR and a glossary entry. PMK-30 writes the credential module and the client.
- An OAuth app, a callback server or token refresh. See "Decisions from the user", question 2.
- Jira, GitHub Issues, GitLab and Azure DevOps credentials. PMK-74, PMK-84, PMK-92 and PMK-100 decide those in their own epics.
- Storage in the OS keychain or in a file. See "Decisions from the user", question 1.

## Anti-goals

- pmkit must never ask the user to paste the key into the chat. The transcript goes to the model provider and to local logs.
- pmkit must never pass the key as a command-line argument, print it, or put it in an error message, an error's `details` or a cache file.
- pmkit must never write the key to a file, in the repository or in the user store.
- A key for one workspace must never read or write another workspace's data through a repository that names a different one.

## Facts checked against the Linear API

Read-only calls made on 2026-10-27 against the `acme` workspace, with the key from the environment:

| Check | Result |
|---|---|
| `Authorization: <key>` with no prefix | HTTP 200. The `viewer` and `organization { urlKey }` query returns `acme`. |
| `Authorization: Bearer <key>` | HTTP 400, `extensions.code: "INPUT_ERROR"`: "It looks like you're trying to use an API key as a Bearer token. Remove the Bearer prefix from the Authorization header." |
| A key that does not exist, or no header | HTTP 401, `extensions.code: "AUTHENTICATION_ERROR"`, `type: "authentication error"`. |
| Rate-limit headers on a personal key | `x-ratelimit-requests-limit: 2500` per hour and `x-ratelimit-complexity-limit: 3000000`, each with `-remaining` and `-reset` (epoch milliseconds). A small query costs `x-complexity: 3`. |
| `Organization.previousUrlKeys` | Exists. A workspace can be renamed, and the old URL keys stay listed. |
| `IssueUpdateInput.delegateId`, `Issue.delegate`, `User.app` | Exist. An issue can be delegated to an app user. |
| One connection timed out (`ETIMEDOUT`) and the retry passed | The client must map network failures to `UPSTREAM`. |

From Linear's developer docs (`linear.app/developers/oauth-2-0-authentication` and `/agents`), read the same day:

- OAuth access tokens last 24 hours and need a refresh. Since April 1, 2026, every OAuth app uses refresh tokens.
- OAuth supports PKCE, and the client secret is optional with PKCE.
- An app that acts as itself uses `actor=app`. To be a delegate on issues it requests `app:assignable`. An admin of the workspace installs it, and an `actor=app` install cannot request the `admin` scope.
- Personal API keys are created in Settings, Security & access. The docs call them "the easiest way to access the API" for personal scripts.

## Approaches

1. **Personal API key from the environment.** The user creates a key in Linear and exports `LINEAR_API_KEY` in the shell that runs the agent. The client reads it from the `env` that the CLI passes in and sends it as `Authorization: <key>`. pmkit stores nothing. It needs no registered app, no server and no refresh, and it works the same in a terminal, in CI and in the scheduled runs of Q7. Writes appear in Linear as the key's owner. pmkit cannot be a Linear agent with it.
2. **OAuth app with PKCE.** pmkit registers a public OAuth app. Setup opens the browser, runs a local callback server, trades the code for a token and stores the access and refresh tokens. That brings a stored secret (keychain or file), a refresh every 24 hours, a callback port, a registered app that pmkit's maintainer owns, and an admin install for `actor=app`. It is the only way pmkit itself becomes a delegate in Linear.
3. **Reuse the token of Linear's official MCP.** The MCP at `mcp.linear.app` runs its own OAuth flow, and MCP clients keep the token in their own store. pmkit would read a file it does not own, whose shape and place change with each client. Q1 keeps official MCPs out of the critical path.

Chosen: approach 1. It is the only one that adds no stored secret and no long-lived process, and every acceptance criterion of PMK-30 to PMK-43 works with it. The one feature it gives up is pmkit as a Linear agent, which no issue in EPC-5 needs (see "Decisions from the user", question 2). The client takes the header from one function, so an OAuth source can be added later without changing the client.

## Design

### The credential

- The credential is a Linear personal API key. Linear's keys start with `lin_api_`. pmkit does not check the prefix **(builder's call)**: a wrong key fails with HTTP 401, and the 401 already maps to `AUTH`.
- pmkit reads it from one environment variable, `LINEAR_API_KEY`. The pmkit maintainer's environment already uses that name.
- pmkit reads no `.env` file and no keychain in this epic. A `.env` file sits in the repository, and Q5 forbids a secret in a repository file.
- The variable comes from the `env` that `run(argv, { env })` in `scripts/pmkit.mjs` receives, never from `process.env` inside a library module, so tests pass a fake key without touching the process.

### One module owns the header

PMK-30 adds `scripts/lib/linear/credential.mjs`:

```js
/** Returns the Authorization header value and where it came from. Throws AUTH when no key is set. */
export function linearCredential(env) // => { authorization: string, source: 'LINEAR_API_KEY' }
```

- An empty or missing `LINEAR_API_KEY` throws `PmkitError('AUTH', 'LINEAR_API_KEY is not set', '/pmkit:setup')`.
- The value goes into the header as it is, with no `Bearer` prefix.
- No other module reads `LINEAR_API_KEY`. A test greps `scripts/lib` for the name and finds it only in this file **(builder's call)**.
- A later OAuth source returns `Bearer <token>` from the same function, and the client does not change.

### Keeping the key secret

- The client never puts the key or the request headers in a message, in `details`, or in anything it logs or caches.
- The key never reaches a command line. pmkit calls the API through `fetch` in its own process. Child processes such as `gh` and `git` inherit the environment as they do today, and pmkit adds nothing to their arguments.
- `/pmkit:setup` never asks for the key. It tells the user where to create it and where to export it, then runs the CLI again to check it.
- One PMK-30 test runs every failure path with a fake key such as `lin_api_TESTKEY` and checks that the string appears in no stdout, no stderr and no JSON output.

### Workspace pin

A personal key belongs to one user in one workspace. A user with two workspaces could run a repository on the wrong one. The live tests of this epic already check `organization.urlKey` before any write, and the design makes that check part of the product:

- `.pmkit/config.yaml` gains `tracker.scope.workspace`, the workspace's URL key, such as `acme`. Setup writes it from `organization.urlKey`. PMK-31 adds the key to the schema and requires it when `tracker.system` is `linear`.
- On its first request of each CLI run, the client asks `{ viewer { id name } organization { urlKey previousUrlKeys } }` and keeps the answer for the rest of the run. One query costs about 3 complexity points.
- When the configured key is neither `urlKey` nor one of `previousUrlKeys`, every operation fails with `AUTH`: `LINEAR_API_KEY belongs to workspace <urlKey>, and .pmkit/config.yaml names <workspace>`, next step `Export a LINEAR_API_KEY created in the <workspace> workspace`.
- When the configured key matches only `previousUrlKeys`, the run goes on and prints a warning that names the new URL key, so the user can update the config.

### Error mapping

This section fixes what the credential decision implies. PMK-30 owns the rest of the mapping.

| Case | Code | Next step |
|---|---|---|
| `LINEAR_API_KEY` missing or empty | `AUTH` | `/pmkit:setup` |
| HTTP 401 or `AUTHENTICATION_ERROR` (revoked, expired or wrong key) | `AUTH` | `Create a key in Linear, Settings, Security & access, and export it as LINEAR_API_KEY` |
| Key of another workspace | `AUTH` | as in "Workspace pin" |
| `FORBIDDEN` on an operation (the key or the user lacks a permission) | `AUTH` | `Check the key's permissions in Linear, Settings, Security & access` |
| Rate limit (`RATELIMITED`, or `x-ratelimit-requests-remaining: 0`) | `RATE_LIMITED` | `Wait until <reset time> and retry` |
| Network failure, HTTP 5xx | `UPSTREAM` | `Retry, and check status.linear.app if it keeps failing` |

### Who appears as the author

Every write made with the key appears in Linear as the key's owner. The Linear adapter resolves `me` and the actor from `viewer`, not from `git config user.email` **(builder's call, for PMK-35)**. An agent that runs a command on the user's behalf writes as the user, which matches how the GitHub git host writes through the user's `gh` login.

### Agent delegation

With a personal key pmkit can set `delegateId` on an issue to an agent app that the workspace already installed. pmkit itself cannot be that agent, because that needs an OAuth app with `actor=app` and `app:assignable`. PMK-33 reports `agent_delegation` as `conditional` for Linear, with a `detail` that says delegation targets the installed agents and an `enableHint` that says pmkit is not a Linear agent **(builder's call, consistent with question 2)**.

### What each dependent issue must do

| Issue | Must do |
|---|---|
| PMK-30, API client | Add `scripts/lib/linear/credential.mjs` as above. Build the client as `createLinearClient({ env, fetch = globalThis.fetch })`, like `createGithubHost({ root, env, exec })`, so `npm test` injects a fake `fetch` and opens no socket. Send `Authorization` from `linearCredential(env)` to `https://api.linear.app/graphql`. Run the workspace check on the first request. Apply the error table. Test that the fake key appears in no output. No dependency, no `process.env` read. |
| PMK-31, hosted tracker configs | Add `tracker.scope.workspace` to the `.pmkit/config.yaml` schema, required for `linear`. Refuse any key in the config whose name suggests a secret (`token`, `api_key`, `secret`, `password`) with `INVALID_INPUT` **(builder's call)**. |
| PMK-32, user store | Store no credential, and write no code that could: the user store has no credential field and no credential writer. The discovery cache holds API responses only, never the key or a header. Key the Linear cache by workspace URL key and repository hash, so two workspaces never share entries. A test writes the cache with a fake key in `env` and checks that no file under the store contains it. The criterion "No command writes a credential to a file in the repository" holds because no command writes a credential anywhere. |
| PMK-33, discover and capabilities | Make `discover --json` return `auth: { source: 'LINEAR_API_KEY', viewer: { id, name }, workspace: { urlKey, name } }` before teams and states. Without a key it fails with `AUTH`, which setup reads. Report `agent_delegation` as in "Agent delegation". |
| `/pmkit:setup`, Linear branch (PMK-34 adds the mapping questions) | Run `discover --json`. On `AUTH`, stop and tell the user to create a personal key in Linear, Settings, Security & access, with read and write access, and to export `LINEAR_API_KEY` in the shell profile or in `~/.claude/settings.json` under `env`, never in a file inside the repository. Then ask the user to run setup again. On success, show the viewer and the workspace in the summary and write `tracker.scope.workspace`. Never ask for the key in a question. |
| PMK-39, contract suite against a sandbox | Read the same `LINEAR_API_KEY`. Run only when an opt-in variable is set, like `PMKIT_LIVE` in `scripts/scenarios-live.mjs`, and only against a dedicated sandbox team, never a team that holds real work. The workspace pin guards the workspace. The suite also checks the team key before its first write. |

### Docs

- `docs/adr/0005-linear-uses-a-personal-api-key-from-the-environment.md`: the decision, the three options, and the consequences above. It follows the shape of ADR-0001 to ADR-0004: a title that states the decision, the context and the choice in prose, then "Considered options" and "Consequences".
- `CONTEXT.md`: one new term, **Workspace**: "The Linear organization that a personal API key belongs to, named by its URL key in `tracker.scope.workspace`." The **Git host** entry already says pmkit holds no token, and the new term says where the Linear key comes from.
- No `CHANGELOG.md` line on this branch. PMK-3 and PMK-20 set that pattern. The release that ships PMK-30 adds a `Setup:` line for `tracker.scope.workspace`.

## Criteria map

| Criterion | Design part | Check |
|---|---|---|
| 1. An ADR in `docs/adr/` records the choice and the options | "Approaches" gives the three options. "Design" gives the choice and its consequences. "Docs" names the file, `docs/adr/0005-linear-uses-a-personal-api-key-from-the-environment.md`. | The ADR exists, names the personal API key from `LINEAR_API_KEY` as the choice, lists the OAuth app and the MCP token as considered options, and lists the consequences for PMK-30, PMK-31, PMK-32, PMK-33, setup and PMK-39. `npm test` still passes, because PMK-28 changes no code. |

## Decisions

| Decision | Reason |
|---|---|
| A personal API key, not an OAuth app | No stored secret, no refresh every 24 hours, no callback server, no app to register. Every EPC-5 criterion works with it. |
| The key comes only from `LINEAR_API_KEY` | Q5 allows env vars. Linear has no CLI login to reuse. |
| No `.env` reading | A `.env` file lives in the repository, and Q5 forbids secrets in repository files. |
| `Authorization: <key>` with no prefix | Checked: `Bearer` returns HTTP 400 for an API key. |
| One module builds the header | One place to audit for leaks, and the seam for a later OAuth source. |
| Pin the workspace in `tracker.scope.workspace` and check it on each run | A wrong key would otherwise read and write another workspace. The check costs one small query per run. |
| A missing, invalid or foreign key is `AUTH` | The Technical spec defines `AUTH` as missing or expired credentials. |
| Setup never asks for the key | The transcript is not a safe place for a secret. |
| `agent_delegation` is `conditional` for Linear | Delegating to installed agents works with a key, and pmkit as the agent needs OAuth. |

## Decisions from the user

The user answered the three open questions on 2026-10-27.

1. **Where does the key live between sessions?** Only in the environment (`LINEAR_API_KEY`). There is no OS keychain and no file. pmkit stores no credential anywhere. The user store of PMK-32 holds no credential and needs no writer for one. The ADR records this and lists the keychain and the file as rejected options.
2. **Should pmkit become a Linear agent?** Not in EPC-5. It is a follow-up. The ADR mentions an OAuth app with PKCE, `actor=app` and `app:assignable` as a later option.
3. **How does a user with two workspaces switch keys?** One variable, `LINEAR_API_KEY`, for every workspace. The user sets it per shell or per directory, for example with direnv. The workspace pin catches a wrong key. There is no `LINEAR_API_KEY_<WORKSPACE>` lookup.

Also accepted: PMK-31 adds `tracker.scope.workspace` to the config schema and the loader. PMK-30 does the `urlKey` comparison. PMK-28 only writes the decision.

## Risks

- A personal key has the full rights of its owner unless the user limits it when creating it. Setup recommends read and write only. Whether the creation form also limits the key to teams was not checked through the API, so setup words it as advice.
- A key exported in the shell profile reaches every process the user runs, including the agent's tools. That is the same exposure as a `gh` login.
- A user who adds the key to `.claude/settings.json` inside the repository commits it. Setup says to use `~/.claude/settings.json`. PMK-31 could later warn when that file sets `LINEAR_API_KEY` and git tracks it.
- Linear may change the rate limits. The client reads the headers on each response instead of using constants.
- ADR numbers: this issue takes 0005. PMK-74, PMK-84, PMK-92 and PMK-100 each add an ADR later, in their own epics, and take the next free number then.

## Left to the builder

- The exact wording of the ADR and of the glossary entry, inside the rules above.
- Whether the ADR quotes the checked API facts or links to this spec for them.

## Self-review

- Placeholders: none. The user answered the three open questions, and "Decisions from the user" holds the answers.
- Consistency: `LINEAR_API_KEY`, `tracker.scope.workspace` and `AUTH` have the same names in every section and in the dependent-issue table.
- Scope: PMK-28 writes one ADR, one glossary term and this spec. Code belongs to PMK-30, PMK-31, PMK-32 and PMK-33.
- Builder check: read as the builder, no reviewer agent ran.
