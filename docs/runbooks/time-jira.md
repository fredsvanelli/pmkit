# Runbook: time tracking on Jira

Logging time and listing the time entries on a repository whose tracker is Jira Cloud (PMK-80): `issues log-time` adds a worklog to the work item, and `issues time-entries` reads its worklogs, each dated by its start and rounded to the nearest minute. Every worklog is also a `log_time` event in the issue's history and in the flow metrics. `scripts/runbook-time-jira.test.mjs` runs every step below with the real CLI and a stateful fake Jira in place of `fetch`, with the fake's state saved to a file between runs and the clock fixed at 2026-11-22 12:00 UTC (`PMKIT_NOW`), so `npm test` checks this runbook.

Live check: skipped. No Jira credentials exist, so no step has run against a real site; PMK-378 in EPC-14 lists what a follow-up settles: the worklog calls and the `started` format, the 20 worklogs a search carries, the changelog items a worklog writes, and how a site with time tracking off reports it.

## Before you start

- The setup of `docs/runbooks/discover-jira.md` and `docs/runbooks/issues-jira.md`: a Jira Cloud site with time tracking on, `JIRA_EMAIL` and `JIRA_API_TOKEN` exported, and `tracker.system: jira` with a site and a space.
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

- The title goes through a file in `tmp/`, written with the file tool: `tmp/title-1.txt`: `Send the first invoice`.

## Capabilities

1. Read what the site offers:

   ```
   node scripts/pmkit.mjs capabilities --json
   ```

   Expect `time_tracking` with `path: native`.

## Log time

2. Create a work item to log time on:

   ```
   node scripts/pmkit.mjs issues create --title-file tmp/title-1.txt --type feature --json
   ```

   Expect `ENG-1`.

3. Preview an entry, then log it and a second one:

   ```
   node scripts/pmkit.mjs issues log-time ENG-1 1h30 --dry-run --json
   node scripts/pmkit.mjs issues log-time ENG-1 1h30 --json
   node scripts/pmkit.mjs issues log-time ENG-1 45m --json
   ```

   Expect `minutes: 90` from the dry run, and no worklog on the work item after it. The real runs add a worklog of 5400 seconds, then one of 2700 seconds, each started at the current time and by the token's owner.

## Time entries

4. List what was logged:

   ```
   node scripts/pmkit.mjs issues time-entries ENG-1 --json
   ```

   Expect two entries (90 and 45 minutes, `at` `2026-11-22T12:00:00.000Z`, `by` the token owner's account id), `total: 135`, `totalTime: 2h15`, one `byPerson` row, and one `bySprint` row with `sprint: null` (the space has no sprint over that date). A worklog that is not a whole number of minutes rounds to the nearest minute; one under 30 seconds counts in `ignored`.

## History

5. Read the work item's history:

   ```
   node scripts/pmkit.mjs issues get ENG-1 --history --json
   ```

   Expect two `log_time` events with `minutes` 90 and 45, and no `jira:timespent` event: the time each worklog adds is not counted twice.

## Errors

6. A time of zero:

   ```
   node scripts/pmkit.mjs issues log-time ENG-1 0 --json
   ```

   Expect exit 2 with `INVALID_INPUT`.

7. On a site with time tracking off (the test serves global settings with `timeTrackingEnabled: false`), read the site again, since pmkit keeps what it read for an hour:

   ```
   node scripts/pmkit.mjs discover --json
   ```

   Then the same `issues log-time ENG-1 1h30 --json` and `issues time-entries ENG-1 --json` exit 2 with `NOT_SUPPORTED`, `Turn on time tracking in Jira's global settings`, and `capabilities` shows `time_tracking` absent with that hint. `issues get ENG-1 --history --json` still works, with no `log_time` event: Jira refuses the worklog calls while time tracking is off, so pmkit does not read them. A site that turns time tracking on is read again on the next `issues log-time` or `issues time-entries`, so they work at once.

## Failures

| Case | Code | Next step |
|---|---|---|
| A time that is not a positive number of minutes (step 6) | `INVALID_INPUT` | Use minutes (90 or 45m) or hours (1h30, 1h30m, 1.5h, 2h) |
| Time tracking off on the site (step 7) | `NOT_SUPPORTED` | Turn on time tracking in Jira's global settings |
| `--as` someone other than the token's owner | `INVALID_INPUT` | Drop --as, or use a token created by that member |
| An unknown work item | `NOT_FOUND` | `pmkit issues list` |
