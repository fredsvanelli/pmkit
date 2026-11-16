# PMK-86 plan: GitHub discovery and the setup questions

Design: `docs/specs/2026-11-16-pmk-86-github-discovery-and-setup-design.md` (approved 2026-11-16). Every task starts with a failing `node:test` test, then the code that makes it pass, then a commit whose message names PMK-86. Tests inject `exec`, so no test starts the real `gh`.

## Task 1: discovery

Files: `scripts/lib/github/discovery.mjs`, `scripts/lib/github/discovery.test.mjs`.

1. Test `checkGhesVersion({ exec, host })`: no call for `github.com`, `GitHub.com` and `acme.ghe.com`; `gh api --hostname ghes.example meta` for any other host; 3.19.0 and 3.21.1 pass; 3.18.4 throws `NOT_SUPPORTED` naming 3.18.4 and 3.19; a reply without `installed_version` throws `UPSTREAM`; `ENOENT` throws `NOT_CONFIGURED`; stderr naming `gh auth login` throws `AUTH` with `gh auth login -h ghes.example`.
2. Test `fetchDiscovery` on a fake client: the repository query runs with owner and name; the Project query runs only for an `owner/number` project; `none` skips it; disabled issue types drop; `hasNextPage` on fields gives a truncated kind.
3. Test `discoveryView`: `issueTypes`, `issueFields` (options as names), `projectFields` (an issue-backed Project field is marked `issueField: true`), `statusOptions`, `statuses` with the mapped categories, the `in_progress` fallback and its warning, open and closed with `project: none`, `types` from `mappings.types`, warnings for a mapped option, field or type GitHub no longer has.
4. Write the module. Commit.

## Task 2: setup proposal

Files: `scripts/lib/github/mappings.mjs`, `scripts/lib/github/mappings.test.mjs`.

1. Test `parseFieldSource`: `issue:Priority`, `project:Story points`, `project:a:b` keeps `a:b`, `none`, and null for `Priority` or `issue:`.
2. Test `proposeGithubSetup(raw, current, answers)`:
   - Project question when no Project is given or held, with the linked Projects as candidates and the `AUTH` note when they could not be read; nothing else asked until it is answered.
   - With a Project: one question per category (backlog, todo, in_progress, in_review, done, canceled, blocked), recommended by name, `required` on todo, in_progress and done.
   - An answer outside the options, `none` on a required category, or one option for two categories throws `INVALID_INPUT`.
   - Field roles: candidates by type, issue fields first, an issue-backed Project field listed once, recommendation by name; one candidate with a name match is applied.
   - Types: one question per pmkit type, same-name recommendation, one issue type per pmkit type; no questions and a note when no type is enabled.
   - `project: none`: no Status question, only issue fields offered.
   - Update: held values kept, a held value GitHub lost asked again with `broken`.
3. Write the module. Commit.

## Task 3: tracker, descriptor, config check

Files: `scripts/lib/github/tracker.mjs`, `scripts/lib/github/adapter.mjs`, `scripts/lib/github/tracker.test.mjs`, `scripts/lib/adapters.mjs`, `scripts/adapters.test.mjs`.

1. Test the config check: host and repo required, project `owner/number` or `none`, field values with the prefixes.
2. Test the tracker on a fake `exec`: `discover()` returns the view; `capabilities()` returns every entry absent but `linked_code`; another operation throws `NOT_SUPPORTED`; a config without host or repo throws `NOT_CONFIGURED` before any call.
3. Register `github` in `ADAPTERS`; update `adapters.test.mjs`. Commit.

## Task 4: `init --tracker github` and `discover` text

Files: `scripts/pmkit.mjs`, `scripts/cli-github-init.test.mjs`.

1. Test through `run([...], { adapters })` with a fake `exec` in a temporary git repository: the first dry run asks the Project; with `--project` it asks the Status, field and type questions; a real run with questions left fails; a full answer writes `.pmkit/config.yaml` with host, repo, project and mappings; `--update` with nothing changed is `keep`; host and repo come from the origin remote and from flags; `--status` flags outside the options fail; `discover` prints the GitHub lines.
2. Write `runInitGithub` and the `discover` text. Commit.

## Task 5: docs

Files: `commands/setup.md`, `schemas/pmkit.config.schema.json`, `CONTEXT.md`, `docs/adr/0007-...md`.

1. setup.md: GitHub Issues in step 1, "GitHub first run" and "Existing GitHub config".
2. Schema descriptions; CONTEXT.md term **GitHub Project**; the dated ADR note. Run the doc checks. Commit.

## Task 6: runbook and E2E test

Files: `docs/runbooks/setup-github.md`, `scripts/runbook-setup-github.test.mjs`, `scripts/fixtures/fake-gh.mjs`.

1. A fake `gh` (Node script with a `gh` shell wrapper) that answers `api meta` and `api graphql` from a JSON fixture named by an environment variable and logs its argv and stdin.
2. The test runs `node scripts/pmkit.mjs` as a subprocess with the fake first on `PATH`, following the runbook steps, and checks the written config, `discover --json`, `capabilities --json` and that no call held a token.
3. Run it, then `npm test`. Commit.
