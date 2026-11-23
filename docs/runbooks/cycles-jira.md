# Runbook: sprint flows on Jira

The sprint commands on a repository whose tracker is Jira Cloud: open (with a dry run), list, add work items, capacity, close, and the `sprint` of a work item and the `--sprint` filter (PMK-78). The commands serve the space's first Scrum board. `scripts/runbook-cycles-jira.test.mjs` runs every step below with the real CLI and a stateful fake Jira in place of `fetch`, with the fake's state saved to a file between runs and the clock fixed at 2026-11-22 12:00 UTC (`PMKIT_NOW`), so `npm test` checks this runbook.

Live check: skipped. No Jira credentials exist, so no step has run against a real site; PMK-370 in EPC-14 lists what a follow-up settles: start and close on a real board, what Jira does with unfinished items after a REST close, the 12:00 UTC dates in the Jira UI, sprints of other boards, and the Agile move endpoints on an item the board filter hides.

## Before you start

- The setup of `docs/runbooks/discover-jira.md` and `docs/runbooks/issues-jira.md`: a Jira Cloud site, `JIRA_EMAIL` and `JIRA_API_TOKEN` exported, and `tracker.system: jira` with a site and a space. The space has a Scrum board.
- The config maps the `feature` type and the sprint field (setup writes the field id, ADR 0014):

  ```yaml
  tracker:
    system: jira
    scope:
      site: acme.atlassian.net
      space: ENG
  mappings:
    types:
      feature: Story
    fields:
      sprint: customfield_10020
  ```

- Titles go through files in `tmp/`, written with the file tool:
  - `tmp/title-1.txt`: `Plan the sprint`
  - `tmp/title-2.txt`: `Ship the sprint`
- A sprint is read from the Scrum board with the lowest id; a space with only a Kanban board has no sprints.

## Capabilities

1. Read what the site offers:

   ```
   node scripts/pmkit.mjs capabilities --json
   ```

   Expect `cycles` with path `native` and `capacity` with path `derived`: Jira has no capacity, so pmkit keeps it in `.pmkit/capacity.yaml` under `jira:acme.atlassian.net/1` (the site and the board id).

## Open and list

2. Preview the sprint, then open it. The start is today, so Jira starts it (no other sprint is active):

   ```
   node scripts/pmkit.mjs cycle open --start 2026-11-22 --goal "Ship sprints" --dry-run --json
   node scripts/pmkit.mjs cycle open --start 2026-11-22 --goal "Ship sprints" --json
   ```

   Expect the dry run to show `after` with `id: null`, state `active`, and to create nothing (`cycle list` is `[]`). The real run gives `before: null` and `after` with `id: "1"`, name `Sprint 2026-11-22` (the default name), `start` `2026-11-22`, `end` `2026-12-05` (the default, start plus 13 days), the goal and state `active`.

3. Open a sprint that starts later. Another sprint is active, so this one stays planned:

   ```
   node scripts/pmkit.mjs cycle open --start 2026-12-07 --json
   ```

   Expect `id: "2"`, state `planned`, `end` `2026-12-20`.

4. List the sprints:

   ```
   node scripts/pmkit.mjs cycle list --json
   ```

   Expect sprints `1` (`active`) and `2` (`planned`), each with `capacity` and `daysOff` (empty).

## Add work items

5. Create two work items and add them to the active sprint:

   ```
   node scripts/pmkit.mjs issues create --title-file tmp/title-1.txt --type feature --json
   node scripts/pmkit.mjs issues create --title-file tmp/title-2.txt --type feature --json
   node scripts/pmkit.mjs cycle add ENG-1 ENG-2 --to 1 --json
   ```

   Expect keys `ENG-1` and `ENG-2`, then one `before` and `after` per work item, with `after.sprint` `"1"`.

6. List the active sprint's work items:

   ```
   node scripts/pmkit.mjs issues list --sprint current --json
   ```

   Expect `ENG-1` and `ENG-2`, each with `sprint: "1"`.

## Capacity

7. Set a member's capacity in the sprint:

   ```
   node scripts/pmkit.mjs cycle capacity 1 --set acc-1=8 --json
   ```

   Expect `after.capacity` `{ "acc-1": 8 }`. Jira is not called: pmkit writes `.pmkit/capacity.yaml`, and `cycle list` shows the capacity from then on.

## Close

8. Finish `ENG-2` (Jira's Done screen needs a Resolution, as in `issues-jira.md`), then preview the close and close the sprint:

   ```
   node scripts/pmkit.mjs issues move ENG-2 done --field resolution=Done --json
   node scripts/pmkit.mjs cycle close 1 --dry-run --json
   node scripts/pmkit.mjs cycle close 1 --json
   ```

   Expect the move to give `after.status.category` `done`. The dry run shows `sprint` in state `closed` and `unfinished` with `ENG-1` only, and changes nothing (`cycle list` still shows sprint `1` `active`). The real run completes the sprint and returns `sprint` (state `closed`, capacity kept), `unfinished` with `ENG-1`, and `problems: []`.

9. Read the work items after the close:

   ```
   node scripts/pmkit.mjs issues list --sprint none --json
   node scripts/pmkit.mjs issues get ENG-2 --json
   ```

   Expect `--sprint none` to list `ENG-1` only: its sprint is closed and it is not done, so it is back in the backlog. `ENG-2` is done, so it keeps the closed sprint: `sprint: "1"` (ADR 0016).

## A Kanban-only space

10. In a space whose only board is Kanban (the test serves one board of type `kanban`), `cycle list` fails with exit 2 and `NOT_SUPPORTED`.

## Failures

| Case | Code | Next step |
|---|---|---|
| Any `cycle` command in a space without a Scrum board | `NOT_SUPPORTED` | Create a Scrum board for the space in Jira |
| No sprint field in `mappings.fields` | `NOT_SUPPORTED` | Run `/pmkit:setup` |
| A move to done without `--field` for a required screen field | `INVALID_INPUT` | Run with `--dry-run`, then pass `--field <id>=<value>` |
| `issues list --sprint none` or `current` with no sprint field | `NOT_SUPPORTED` | Run `/pmkit:setup` |
