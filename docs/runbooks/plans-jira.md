# Runbook: Jira plans on Jira Cloud

Reading Jira Plans (Advanced Roadmaps) on a repository whose tracker is Jira Cloud (PMK-82): `jira plans list` lists the plans, and `jira plans get <id>` reads one plan's dependency mode, default scenario, releases and teams with their capacity. The commands only read; the command `/pmkit:jira:plans-scenarios` walks this flow with the user. `scripts/runbook-plans-jira.test.mjs` runs every step below with the real CLI and a stateful fake Jira in place of `fetch`, with the clock fixed at 2026-11-22 12:00 UTC (`PMKIT_NOW`), so `npm test` checks this runbook.

Live check: skipped. No Jira credentials exist, so no step has run against a real site; EPC-14 lists what a follow-up settles: the real shapes of the Plans calls, the cursor paging of the plan list, the 403 wording for a site without Premium against a token whose owner lacks Administer Jira, the capacity unit Jira shows for Scrum and for Kanban teams, and whether Jira has a scenarios API at all.

## Before you start

- The setup of `docs/runbooks/discover-jira.md` and `docs/runbooks/issues-jira.md`: a Jira Cloud site on Premium or Enterprise, `JIRA_EMAIL` and `JIRA_API_TOKEN` exported (the token's owner has the Administer Jira global permission), and `tracker.system: jira` with a site and a space.
- The config maps the `feature` type:

  ```yaml
  tracker:
    system: jira
    scope:
      site: acme.atlassian.net
      space: ENG
  mappings:
    types:
      feature: Story
  ```

## Capabilities

1. Read what the site offers:

   ```
   node scripts/pmkit.mjs capabilities --json
   ```

   Expect `tracker: jira`.

## Plans

2. List the plans:

   ```
   node scripts/pmkit.mjs jira plans list
   node scripts/pmkit.mjs jira plans list --json
   ```

   Expect one line, `12  Q1 roadmap  (active)  scenario 34`. The JSON has `available: true`, the plan with `status: active` and `scenario` `{ id: "34", default: true }`, and `hasMore: false`. `--archived` and `--trashed` list the plans in those states, and `--limit <n>` caps the list.

3. Read the plan:

   ```
   node scripts/pmkit.mjs jira plans get 12
   node scripts/pmkit.mjs jira plans get 12 --json
   ```

   Expect these lines:

   ```
   dependencies: sequential
   scenario: 34 (default; other scenarios are not readable through Jira's public API)
   release: Spring launch  versions 10001
   team: Payments  scrum  capacity 30 story points per sprint
   ```

   The JSON has `plan.scheduling.dependencies: sequential`, the default scenario, the release `Spring launch` with `versionIds` `[10001]` (a release that spans projects), and the team `Payments` with `planningStyle: scrum`, `capacity: 30` and `capacityUnit: story points per sprint`.

## Errors

4. An unknown plan:

   ```
   node scripts/pmkit.mjs jira plans get 99 --json
   ```

   Expect exit 2 with `NOT_FOUND` and the next step to check the id and that the token's owner can see it.

5. A limit that is not a positive number:

   ```
   node scripts/pmkit.mjs jira plans list --limit 0 --json
   ```

   Expect exit 2 with `INVALID_INPUT`.

6. On a site without Jira Premium, or with a token whose owner lacks Administer Jira (the test serves 403 on every Plans route), the same list and get exit 0 with `available: false`:

   ```
   node scripts/pmkit.mjs jira plans list --json
   node scripts/pmkit.mjs jira plans get 12 --json
   ```

   Expect `available: false`, `reason: premium`, `plans: []` for the list, and `enableHint`: `Jira Plans need Jira Premium or Enterprise, and the token's owner needs the Administer Jira global permission`. The text output is one line, `Jira Plans are not available on acme.atlassian.net:` and that hint.

## Failures

| Case | Code | Next step |
|---|---|---|
| An unknown plan (step 4) | `NOT_FOUND` | `pmkit jira plans list`, and check the token's owner can see the plan |
| A `--limit` below 1 (step 5) | `INVALID_INPUT` | Use a whole number from 1 up |
| No Premium, or no Administer Jira (step 6) | none: `available: false`, exit 0 | Move to Jira Premium or Enterprise, or use a token from a member with Administer Jira |
