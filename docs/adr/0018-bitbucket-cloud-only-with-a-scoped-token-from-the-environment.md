# Bitbucket is Cloud only, with a scoped token from BITBUCKET_TOKEN sent as Bearer

ADR 0013 decided the Jira credential and left the Bitbucket Cloud credential to PMK-81. The Unified model's Q5 decision A says tokens come from the OS keychain, env vars or existing CLI logins, never from the repository file. Bitbucket has no CLI like `gh` whose login pmkit could reuse, so the git host calls the REST API itself. The facts below were checked on 2026-11-23 against Atlassian's docs and the published OpenAPI spec. No Bitbucket account exists, so nothing was checked against a live repository. The spec is `docs/superpowers/specs/2026-11-23-pmk-81-bitbucket-cloud-git-host-design.md`, and the owner chose the options on 2026-11-23.

pmkit supports Bitbucket Cloud only, at `api.bitbucket.org/2.0`. `git_host.system` is `bitbucket` and `git_host.repo` is `<workspace>/<repo_slug>`. Requests go only to that repository on `api.bitbucket.org`, which pins it.

The credential is one environment variable, `BITBUCKET_TOKEN`, sent as `Authorization: Bearer <token>`. It holds an Atlassian API token with scopes or a repository or workspace access token. App passwords are retired (no new ones since 2025-09-09, disabled in 2026), and Bitbucket refuses the unscoped token of ADR 0013, so the Jira token cannot be reused. The token needs `read:repository:bitbucket`, `read:pullrequest:bitbucket`, `write:pullrequest:bitbucket` and `read:pipeline:bitbucket`. One module, `scripts/lib/bitbucket/credential.mjs`, is the only reader of the variable. pmkit stores no credential anywhere. `git push` keeps using the user's own git credentials.

## Status

Accepted

## Considered options

- One `BITBUCKET_TOKEN` sent as Bearer. Chosen. One variable, no email, and it accepts a user API token and the repository and workspace access tokens CI uses.
- `BITBUCKET_EMAIL` (or `JIRA_EMAIL`) and a token sent as Basic `email:token`. Rejected. Two variables, and access tokens do not work that way.
- Reuse `JIRA_API_TOKEN`. Rejected. Bitbucket needs a token with scopes, and ADR 0013 uses an unscoped one.
- App passwords. Rejected. Atlassian has retired them.
- OAuth 2.0 consumer. Rejected, as in ADR 0013 for Jira: a secret a local CLI cannot keep, refresh tokens pmkit would have to store.
- Bitbucket Data Center. Rejected. Atlassian ends Data Center on 2029-03-28, and it has another API and auth.

## Consequences

- Security. The token never appears in output, a command-line argument, an error message or its `details`, a file or the transcript. `/pmkit:setup` never asks for it and pmkit reads no `.env` file. A config key that looks like a secret is refused, as for Jira.
- Error mapping. A missing or malformed `BITBUCKET_TOKEN` and HTTP 401 are `AUTH`; the 401 message says the token may have expired or lack a scope. HTTP 429 is `RATE_LIMITED`. Network failures and HTTP 5xx are `UPSTREAM`. A 404 on the repository is `NOT_CONFIGURED`.
- Expiry. Atlassian API tokens expire after 1 to 365 days, so users renew them at least once a year.
- Cost. A user token has its owner's rights in the scopes it holds, and a token in the shell profile reaches every process the user runs.
- Left open: a live check that Bearer works with a user API token, in EPC-14. If it fails, a new ADR decides the fallback.
