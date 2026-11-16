# GitHub Issues reuses the gh login and needs GHES 3.19

The GitHub tab of the planning doc left four questions open for the GitHub Issues tracker adapter (EPC-8): a `gh` token, a fine-grained PAT or a GitHub App; the `project` scope; "GHES 3.17+ for types and sub-issues, 3.19+ for dependencies"; org issue fields against project fields. The Unified model's Q1 decision D says to reuse existing tokens, and Q5 decision A says tokens come from the OS keychain, env vars or existing CLI logins, never from the repository file. The facts below were checked on 2026-11-16 against docs.github.com, `gh help environment` and the GraphQL schemas GitHub publishes per release (`github/docs`, `src/graphql/data/`). The spec is `docs/specs/2026-11-16-pmk-84-github-issues-auth-design.md`.

The adapter reuses the `gh` login. It runs `gh api graphql` as a subprocess, as the GitHub git host already runs `gh` (`scripts/lib/github/host.mjs`), and pmkit holds no token. It never reads, prints or stores one. A user who prefers a token sets `GH_TOKEN` (github.com and GHE.com) or `GH_ENTERPRISE_TOKEN` (GitHub Enterprise Server, GHES), and `gh` uses it before its stored login. A fine-grained PAT or a classic PAT therefore works through `gh`, and pmkit has no code for either.

The adapter needs the `project` scope only when the repository uses a Project. `gh auth login` grants `repo`, `read:org` and `gist`. Projects need `read:project` to read and `project` to write, and the adapter writes the Project's Status field, so it asks for `project`. pmkit does not parse scopes ahead of time. `discover` reads the configured Project once, and a GraphQL error of type `INSUFFICIENT_SCOPES`, or a fine-grained PAT's "not accessible" error, becomes `AUTH` with the next step `gh auth refresh -s project`, plus `-h <host>` on GHES. A repository without a Project needs only the default scopes.

The minimum GHES version is 3.19, for issue types, sub-issues and dependencies alike. The 3.19 schema is the oldest published one with `Issue.issueType`, `Issue.subIssues`, `Issue.blockedBy`, `addSubIssue`, `addBlockedBy` and `projectsV2`, and the REST issue dependencies page first appears in the 3.19 docs. The tab's "3.17+" does not hold. The 3.17 docs have no issue types or sub-issues pages, which first appear in 3.18. On GHES, `discover` reads `installed_version` from `gh api meta` and fails with `NOT_SUPPORTED` below 3.19, naming the version found and the minimum. github.com and GHE.com get no version check. GitHub ends support for 3.19 on 2026-12-09. 3.17 closed on 2026-09-24 and 3.18 on 2026-10-16.

Each field role reads from one source that setup picks: an org issue field first, then a Project field, then `none`. Issue fields live on the issue, need no Project and no `project` scope, and are generally available on github.com and GHE.com, and every organization starts with Priority, Effort, Start date and Target date. GHES has them from 3.21, so on 3.19 and 3.20 only Project fields exist. The status always comes from the Project's single-select Status field plus the issue's open or closed state. GitHub's own issue status (`setIssueStatus`) is a preview for enrolled accounts only and no GHES schema has it, so the adapter does not use it.

## Considered options

- The `gh` login through `gh api graphql`. Chosen. It adds no stored secret, the core design and CONTEXT.md already say pmkit reaches GitHub through `gh` and holds no token, and PMK-85's criterion reads "reusing the gh login".
- A fine-grained PAT that pmkit reads from its own variable, as ADR 0005 does for Linear. Rejected. GitHub's docs list "Using fine-grained personal access token to access Projects owned by a user account" as a known limitation, so a user-owned Project would not work. A user can still give `gh` a fine-grained PAT through `GH_TOKEN`.
- A GitHub App. Rejected for EPC-8. It needs an app that pmkit's maintainer registers, an install per organization and a stored private key or a user token with refresh. It matters only for pmkit acting as an app, which no EPC-8 issue needs.
- Always require the `project` scope. Rejected. It asks users without a Project for a scope they never use.
- Ask only for `read:project`. Rejected. Every status move writes the Project's Status field.
- Minimum GHES 3.18, with dependencies `absent` below 3.19. Rejected. It adds a code path for a release that GitHub stopped supporting on 2026-10-16.
- Minimum GHES 3.20. Rejected. It refuses 3.19 users who have every feature the adapter needs.
- Project fields only. Rejected. Every field would need a Project, and the issue fields GitHub creates in every organization would go unused.
- Issue fields only. Rejected. GHES 3.19 and 3.20 would have no fields, and teams that keep values on a board would lose them.

## Consequences

- Security. pmkit never reads `GH_TOKEN`, never passes a token as an argument and never puts one in output, an error, a cache file or the transcript. `/pmkit:setup` never asks for a token.
- Authorship. Every write appears in GitHub as the user of the `gh` login or of the token `gh` uses.
- Cost. One `gh` process per call.
- PMK-85 builds the client on `gh api graphql` through an injected runner, as `host.mjs` does, so `npm test` starts no `gh` and opens no socket. It maps `INSUFFICIENT_SCOPES` and a fine-grained PAT's "not accessible" error to `AUTH` with `gh auth refresh -s project` (plus `-h <host>` on GHES), and a missing `gh` or login to the git host's `NOT_CONFIGURED` and `AUTH` messages.
- PMK-86 makes `discover` read `gh api meta` on GHES and fail with `NOT_SUPPORTED` below 3.19. It lists the org's issue fields (github.com, GHE.com, GHES 3.21 and later) and the Project's fields, and reads the Project once so a missing scope fails at setup. Setup proposes issue fields first, then Project fields, then `none`. PMK-86 picks how a mapping records its source.
- PMK-87 reads and writes issue types, sub-issues and dependencies with no version branch. The status comes from the Project's Status field plus open or closed.
- PMK-89 asks for no `project` scope when the repository has no Project.
- `/pmkit:setup` runs `discover`. On `AUTH` it shows the next step (`gh auth login`, or `gh auth refresh -s project`) and asks the user to run setup again. On `NOT_SUPPORTED` it names the GHES version found and 3.19.
- When GitHub ends support for 3.19 on 2026-12-09, the minimum may move to 3.20 with a new ADR that supersedes this one.
- Left open: which GHES host the config names (`gh` takes it from the remote or `GH_HOST`), for PMK-85 and PMK-86; GitHub's issue status as the status source once it leaves preview.
