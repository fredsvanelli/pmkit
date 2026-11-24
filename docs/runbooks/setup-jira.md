# Runbook: set up pmkit on a Jira site

The flow of `/pmkit:setup` when the user picks Jira: "Jira first run" and "Existing Jira config" in `commands/setup.md` (PMK-365). `scripts/runbook-setup-jira.test.mjs` runs every step below with the real CLI and a fake Jira site in place of `fetch`, so `npm test` checks this runbook. It also checks that no output holds the token, the email or the `Authorization` header.

Live check: run on 2026-11-24 (PMK-368) on a team-managed space of a Jira Cloud site in Portuguese, through `scripts/lib/jira/client-live.mjs` (its header has the command): steps 1 to 5 and the held-space case of step 7. A company-managed space was not available, so its candidates are unchecked live.

## Before you start

- A Jira Cloud site (Server and Data Center are not supported, ADR 0013).
- An API token from id.atlassian.com, exported with its owner's email in the shell profile or in `~/.claude/settings.json` under `env`, never in a file inside the repository:

  ```
  export JIRA_EMAIL=you@example.com
  export JIRA_API_TOKEN=<token>
  ```

- There is no `.pmkit/config.yaml` yet.

## First run

1. Read the site and list the spaces. `--site` takes the bare host: strip `https://` and any path from a URL, or the command fails with `INVALID_INPUT`. The host is written in lowercase.

   ```
   node scripts/pmkit.mjs init --tracker jira --git-host none --site acme.atlassian.net --dry-run --json
   ```

   Expect `tracker: jira`, `site`, `viewer` (the token's owner), `space: null` and one question, `tracker.scope.space`, whose `candidates` are the space keys the token's owner can browse, with their names in `titles`. `recommended` is set only when the site has one space. Nothing is written.

2. Pick the space and read it. `--space` takes a space key in capitals, such as `ENG`: any other value fails with `INVALID_INPUT` before any request.

   ```
   node scripts/pmkit.mjs init --tracker jira --git-host none --site acme.atlassian.net --space ENG --dry-run --json
   ```

   Expect `space: { key: "ENG", name, style }` and these questions, in order:
   - `mappings.status.backlog`, `mappings.status.in_review` and `mappings.status.canceled`, each offering every status of the space and recommending the one whose name matches (`Review` for `in_review`), or `none`. `todo`, `in_progress` and `done` come from Jira's status categories and are never asked; neither is `blocked`, which on Jira comes from Blocks links.
   - `mappings.fields.estimate`, `mappings.fields.acceptance_criteria` and `mappings.fields.sprint`, each offering field ids with their names in `titles`, such as `customfield_10016` (Story Points). A role with one field is applied without a question (on the fake site, `sprint` is `customfield_10020`); a role with none gets a note, such as `the site has no field for the acceptance criteria`.
   - `mappings.types.feature`, `bug`, `task` and `chore`, each offering the space's standard work types and recommending the one whose name matches (`Story` for `feature`, `Bug` for `bug`), or `none`. A work type already recommended for an earlier type is not recommended again: on a space with `Task`, `task` gets `Task` and `chore` gets `none`.

   `statuses` lists each status with its category. Nothing is written.

3. Answer every question and preview the file:

   ```
   node scripts/pmkit.mjs init --tracker jira --git-host none --site acme.atlassian.net --space ENG \
     --status backlog=none --status in_review=Review --status canceled=none \
     --field estimate=customfield_10016 \
     --type-label feature=Story --type-label bug=Bug --type-label task=none --type-label chore=none --dry-run --json
   ```

   Expect `questions: []`, `files: [{ path: ".pmkit/config.yaml", action: "create" }]` and `Review` now in the `in_review` category in `statuses`. A field is answered with its id, never its name (ADR 0014). One status or work type cannot answer two keys: that is `INVALID_INPUT`, whose next step lists the values no key took.

4. Run the same command without `--dry-run`. `.pmkit/config.yaml` now holds `tracker.system: jira`, `tracker.scope.site: acme.atlassian.net`, `tracker.scope.space: ENG` and the mappings.

5. Check the result:

   ```
   node scripts/pmkit.mjs validate --json
   node scripts/pmkit.mjs discover --json
   ```

   `validate` exits 0. `discover` returns `space.key: ENG` and `fields.estimate: { id: "customfield_10016", name: "Story Points" }`. `docs/runbooks/discover-jira.md` covers `discover` and `capabilities` in full.

## Existing config

6. Run `node scripts/pmkit.mjs init --update --dry-run --json`. With nothing changed in Jira, expect `questions: []` and the file `keep`.

7. When a mapped status is renamed in Jira (`Review` to `Code Review`), the same command lists `mappings.status.in_review` in `broken` and asks it again, with `broken.was: Review` and `Code Review` recommended. Answer it with `node scripts/pmkit.mjs init --update --status "in_review=Code Review" --json`, which changes only that line. A held space the site lacks is asked again the same way, as the space question of step 1.

## Errors

8. Without `JIRA_EMAIL` or `JIRA_API_TOKEN`, or with a token Jira rejects, step 1 fails with `AUTH` and the next step `/pmkit:setup`, before any request when a variable is missing. Create a token at id.atlassian.com, export both variables as in "Before you start" and run setup again. Setup never asks for the token.

9. On a Server or Data Center site, step 1 fails with `NOT_SUPPORTED`: pmkit supports Jira Cloud only (ADR 0013). Nothing is written.

10. On a `--site` where no Jira site answers, such as a typo in the host, step 1 fails with `NOT_CONFIGURED`, `No Jira site answers at <site>`, and the next step says to check the site host. Nothing is written.

11. A `--space` the token's owner cannot browse, on a site where it can browse no space, fails with `NOT_CONFIGURED`. Nothing is written.
