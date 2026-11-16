# PMK-84 design: GitHub Issues authentication and the minimum GHES version

Issue PMK-84, epic EPC-8 (GitHub Issues tracker adapter), milestone `github-issues`. Status: approved by the user on 2026-11-16, with the four answers below applied. Calls marked **(builder's call)** were made while writing this spec and change no acceptance criterion.

## Problem

The GitHub Issues adapter needs a credential, a scope rule, a minimum GitHub Enterprise Server (GHES) version and a rule for where issue fields come from before PMK-85 can build its client. The GitHub tab of the planning doc "pmkit - Project Management Kit for Agents" leaves these open: a `gh` token, a fine-grained PAT or a GitHub App; the `project` scope; "GHES 3.17+ for types and sub-issues, 3.19+ for dependencies"; org issue fields against project fields. The planning doc is not in the repository, so this spec works from the issue's list of those questions and from GitHub's docs.

PMK-85 (the client) is blocked on this decision. PMK-86 (discovery and setup), PMK-87 (issues, sub-issues and dependencies) and PMK-89 (repositories without a project) depend on it too.

Acceptance criteria:

1. An ADR in `docs/adr/` records the choices.

## Goals

- One credential rule for EPC-8, recorded in `docs/adr/0007-github-issues-reuses-the-gh-login-and-needs-ghes-3-19.md`.
- A rule for when pmkit needs the `project` scope and what it says when the scope is missing.
- One minimum GHES version and what happens below it.
- A rule for which source each field role reads from: an org issue field or a Project field.
- What PMK-85, PMK-86, PMK-87, PMK-89 and `/pmkit:setup` must do, so their specs start from this one.

## Non-goals

- Code. PMK-84 delivers the ADR, one glossary term and a check for both. PMK-85 writes the client.
- The format of a field mapping that names its source. PMK-86 owns discovery and the setup questions, so it picks the format.
- GitHub's own issue status (`setIssueStatus`, `PlanningStatus`). It is a preview "only available to accounts enrolled in the preview" and no GHES schema has it.
- A GitHub App, which pmkit would need only to act as an app rather than as the `gh` user.

## Anti-goals

- pmkit must never read, hold, print or store a GitHub token. `gh` holds it.
- pmkit must never ask the user to paste a token into the chat.
- pmkit must never ask for the `project` scope from a user whose repository has no Project.

## Facts checked against GitHub

Checked on 2026-11-16 against docs.github.com, cli.github.com and the GraphQL schemas GitHub publishes per release in `github/docs` (`src/graphql/data/<version>/`).

| Check | Result |
|---|---|
| `gh auth login` default scopes | `repo`, `read:org`, `gist`. `gh auth refresh -s <scope>` adds one. Neither `read:project` nor `project` is a default. |
| The user's own `gh` token | Scopes `admin:public_key`, `gist`, `read:org`, `repo`, `workflow`. It cannot read a Project today. |
| Fine-grained PAT and Projects | The "Fine-grained personal access tokens limitations" section of GitHub's PAT docs lists "Using fine-grained personal access token to access Projects owned by a user account". An org-owned Project needs the org's "Projects" permission. |
| `gh` and tokens from the environment | `gh help environment`: `GH_TOKEN` serves github.com and GHE.com and "takes precedence over previously stored credentials". `GH_ENTERPRISE_TOKEN` serves a GHES host. `GH_HOST` names the host when the repository's remote does not. |
| GHES 3.17 docs | No issue types page and no sub-issues page. The 3.17 GA post names neither feature. |
| GHES 3.18 docs | Issue types and sub-issues pages exist. The 3.18 GA post names both. The 3.18 schema is no longer published. |
| GHES 3.19, 3.20, 3.21 and 3.22 GraphQL schemas | Each has `Issue.issueType`, `Issue.subIssues`, `Issue.blockedBy`, `addSubIssue`, `addBlockedBy` and `projectsV2`. The REST issue dependencies page exists from 3.19. |
| Issue fields in GHES | `Issue.issueFieldValues` and `setIssueFieldValue` are in the 3.21 and 3.22 schemas, not in 3.19 or 3.20. |
| Issue fields on github.com | Generally available since 2026-07-02 for organizations, and since 2026-11-11 for repositories of personal accounts. Each organization starts with Priority, Effort, Start date and Target date. Types are single select, text, number and date. |
| Supported GHES releases on 2026-11-16 | 3.19 (closes 2026-12-09), 3.20 (2027-03-17), 3.21 (2027-06-11), 3.22 (2027-09-08). 3.17 closed on 2026-09-24 and 3.18 on 2026-10-16. |

The issue's "GHES 3.17+ for types and sub-issues" does not match these facts. Sub-issues and issue types first appear in the 3.18 docs.

## Decisions from the user

### Question 1: the credential

Options: reuse the `gh` login; a fine-grained PAT that pmkit reads from its own variable (the ADR 0005 pattern); a GitHub App.

Answer: reuse the `gh` login. pmkit runs `gh api graphql` as a subprocess, as the GitHub git host already runs `gh` (`scripts/lib/github/host.mjs`). A user who prefers a token sets `GH_TOKEN` or `GH_ENTERPRISE_TOKEN`, and `gh` uses it, so fine-grained and classic PATs work with no pmkit code for them. No GitHub App in EPC-8.

Why: the Unified model's Q1 decision D says to reuse existing tokens, and Q5 decision A forbids a stored secret outside the keychain, env vars or existing CLI logins. The core design spec says "GitHub access goes through the gh login", and PMK-85's criterion reads "Calls the GitHub GraphQL API, reusing the gh login". A pmkit-read fine-grained PAT cannot reach a user-owned Project. A GitHub App needs an app that pmkit's maintainer registers, an install per organization and a stored key or a refresh flow.

Cost: one `gh` process per call, and every write appears in GitHub as the `gh` account's user.

### Question 2: the `project` scope

Options: require `project` only when the repository uses a Project; always require it; ask only for `read:project`.

Answer: require `project` (read and write) only when the repository uses a Project. A repository without one (PMK-89) needs only the default scopes. pmkit does not parse scopes ahead of time. `discover` reads the configured Project once, and a GraphQL error of type `INSUFFICIENT_SCOPES`, or a fine-grained PAT's "not accessible" error, becomes `AUTH` with the next step `gh auth refresh -s project`, plus `-h <host>` on GHES.

Why: the adapter writes the Project's Status field (PMK-87), so `read:project` alone would leave every move refused. Asking every user for `project` would ask some for a scope they never use. A fine-grained PAT has no scopes to parse, so the error from the first read is the one check that works for both token kinds.

### Question 3: the minimum GHES version

Options: 3.19 for every feature; 3.18 with dependencies `absent` below 3.19; 3.20.

Answer: GHES 3.19 is the minimum for issue types, sub-issues and dependencies. On GHES, `discover` reads `installed_version` from `gh api meta` and fails with `NOT_SUPPORTED` below 3.19, naming the version found and the minimum. github.com and GHE.com get no version check. The ADR notes that GitHub ends support for 3.19 on 2026-12-09.

Why: 3.19 is the oldest release whose schema has all three features, and the oldest still supported. A 3.18 path would add code for a release GitHub stopped supporting a month ago. A 3.20 floor would refuse 3.19 users who have every feature the adapter needs.

### Question 4: issue fields against Project fields

Options: both sources, chosen per field role at setup; Project fields only; issue fields only.

Answer: both sources, chosen per role at setup. `discover` lists the organization's issue fields and the Project's fields. Setup proposes the issue field when one matches the role (Priority for `priority`, Effort for `estimate`, Start date for `start_date`, Target date for `target_date`), else the Project field, else `none`. On GHES 3.19 and 3.20 only Project fields exist. The mapping records which source each role reads. The status always comes from the Project's single-select Status field plus the issue's open or closed state, as PMK-87 says. GitHub's issue status preview stays out of scope until it is generally available. PMK-86 picks the mapping format.

Why: GitHub now creates four issue fields in every organization, and they live on the issue, so they need no Project and no `project` scope. Project fields stay the only source on GHES 3.19 and 3.20 and for teams that keep values on a board.

## Design

### The ADR

`docs/adr/0007-github-issues-reuses-the-gh-login-and-needs-ghes-3-19.md` follows ADR 0001 to ADR 0006: a title that states the decision, a prose context and choice, then `## Considered options` and `## Consequences`. It records the four answers, each rejected option with its reason, and the consequences below. It corrects the issue's "GHES 3.17+" with the facts above.

### Consequences for the dependent issues

| Issue | What it must do |
|---|---|
| PMK-85 | Build the client on `gh api graphql` through an injected runner, as `host.mjs` does, so `npm test` starts no `gh` and opens no socket. Map `INSUFFICIENT_SCOPES` and a fine-grained PAT's "not accessible" error to `AUTH` with `gh auth refresh -s project` (plus `-h <host>` on GHES). Map a missing `gh` or login to `NOT_CONFIGURED` or `AUTH` with the same messages as the git host. Read no token and no `GH_TOKEN` itself. |
| PMK-86 | `discover` reads `gh api meta` on GHES and fails with `NOT_SUPPORTED` below 3.19. It lists the org's issue fields (github.com, GHE.com, GHES 3.21 and later) and the Project's fields, and reads the Project once so a missing scope fails at setup. Setup proposes issue fields first, then Project fields, then `none`, and PMK-86 picks how the mapping records the source. |
| PMK-87 | Reads and writes issue types, sub-issues and dependencies with no version branch, since 3.19 has all three. The status comes from the Project's Status field plus open or closed. |
| PMK-89 | A repository without a Project needs no `project` scope and asks for none. |
| `/pmkit:setup` | Runs `discover`. On `AUTH`, shows the next step (`gh auth login`, or `gh auth refresh -s project`) and asks the user to run setup again. On `NOT_SUPPORTED`, names the GHES version found and 3.19. Never asks for a token. |

### Glossary

`CONTEXT.md` gains one term, **Issue field**, after **Mapping**: a field that a GitHub organization defines on its issues, such as Priority or Effort, as opposed to a Project field, which exists only on a Projects v2 board. A field role's mapping reads one or the other. _Avoid_: custom field **(builder's call)**.

### Check

A `node:test` file, `scripts/adr-github-auth.test.mjs`, checks the ADR and the glossary term, as `scripts/adr-linear-auth.test.mjs` does for ADR 0005: the file exists; it has a title, `## Considered options` and `## Consequences`; it names `gh api graphql`, `GH_TOKEN`, `GH_ENTERPRISE_TOKEN`, the `project` scope with `gh auth refresh -s project`, `INSUFFICIENT_SCOPES`, `3.19`, `gh api meta`, `NOT_SUPPORTED` and `2026-12-09`; it names each rejected option (fine-grained PAT, GitHub App, 3.18, 3.20, Project fields only, issue fields only); Consequences names PMK-85, PMK-86, PMK-87, PMK-89 and `/pmkit:setup`; no ADR and no line of `CONTEXT.md` holds a string shaped like a GitHub token (`gh[pousr]_` followed by 36 characters, or `github_pat_`); `CONTEXT.md` defines **Issue field**.

## Testing and verification

- `node --test scripts/adr-github-auth.test.mjs` fails before the ADR and the term exist, and passes after.
- `npm test` passes in full.
- No runbook applies: the change adds an ADR, a glossary term and a doc check, and changes no user flow.

## Open for later issues

- Which GHES host the adapter targets, and where the config names it. `gh` picks the host from `GH_HOST` or from the repository's remote; PMK-85 and PMK-86 decide whether `tracker.scope` names it.
- GitHub's issue status, once it leaves preview, may replace the Project's Status field as the status source.
