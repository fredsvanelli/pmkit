# Runbook: discover a Jira site and read its capabilities

The flow of `pmkit discover` and `pmkit capabilities` on a repository whose tracker is Jira Cloud (PMK-76). `scripts/runbook-discover-jira.test.mjs` runs every step below with the real CLI and a fake Jira site in place of `fetch`, so `npm test` checks this runbook. Setup for Jira (`init --tracker jira` and `/pmkit:setup`) comes with PMK-365; until then the config is written by hand.

Live check: skipped. No Jira credentials exist, so no step has run against a real site; PMK-366 in EPC-14 holds it.

## Before you start

- A Jira Cloud site (Server and Data Center are not supported, ADR 0013).
- An API token from id.atlassian.com, exported with its owner's email in the shell profile or in `~/.claude/settings.json` under `env`, never in a file inside the repository:

  ```
  export JIRA_EMAIL=you@example.com
  export JIRA_API_TOKEN=<token>
  ```

- `.pmkit/config.yaml` names the site and the space:

  ```yaml
  tracker:
    system: jira
    scope:
      site: acme.atlassian.net
      space: ENG
  ```

## Steps

1. Check the config:

   ```
   node scripts/pmkit.mjs validate --json
   ```

   Expect no problem. Without `tracker.scope.space` it lists `tracker.scope.space is required for jira`; a site written as a URL lists `tracker.scope.site must be a host such as acme.atlassian.net`.

2. Read the site:

   ```
   node scripts/pmkit.mjs discover --json
   ```

   Expect `auth` first, with `source: JIRA_API_TOKEN`, the token owner's `accountId` and `displayName` and the `site`. Then `space` with its `style` (`company-managed` or `team-managed`) and `type`, every `spaces` entry, `workTypes` with their level (`epic`, `standard`, `subtask`) and statuses, `statuses` with their category, and `fields` with the Jira field (`id` and `name`) each field role reads, or `null`. A team-managed space shows only its own fields, never another space's field of the same name. `mappings.fields.<role>` in `.pmkit/config.yaml` holds a field id (ADR 0014) and wins over the inferred field. A read the token's owner may not make (labels, license, global settings, boards) gives a warning instead of a failure.

   `node scripts/pmkit.mjs discover` prints the same as text: the site and viewer, the space, the spaces, the work types and the field of each role.

3. Read the capabilities:

   ```
   node scripts/pmkit.mjs capabilities --json
   ```

   Expect `tracker: jira`, the `site`, `space` and `plan`, and 20 entries. `linked_code`, `estimation`, `multilevel_hierarchy`, `dependencies` and `native_metrics` are served (PMK-77), and `cycles` (`native`) and `capacity` (`derived` from `.pmkit/capacity.yaml`) are served (PMK-78), and `deliverables` (`native`, epics), `releases` (`native`, versions) and `status_update` (`derived` from epic comments) are served (PMK-79), and `time_tracking` (`native`, worklogs) is served (PMK-80): each takes the site's answer, such as the estimate field in `detail`. Every remaining entry is `absent`: one Jira offers on this site keeps the site's path in `detail.site` and says the Jira adapter does not serve it yet. A capability the site lacks is `absent` and names what to change (for example `Sprints need a Scrum board in space ENG` or `No sprint field in space ENG`).

## Failures

| Case | Code | Next step |
|---|---|---|
| `JIRA_EMAIL` or `JIRA_API_TOKEN` not set | `AUTH` | `/pmkit:setup` |
| The site runs Server or Data Center | `NOT_SUPPORTED` | Use a Jira Cloud site (ADR 0013) |
| `tracker.scope.site` names a host with no Jira site, such as a typo | `NOT_CONFIGURED` | Check the site host in tracker.scope.site, or --site in /pmkit:setup |
| `tracker.scope.space` names a space the site lacks or the token's owner cannot browse | `NOT_CONFIGURED` | `/pmkit:setup` |
