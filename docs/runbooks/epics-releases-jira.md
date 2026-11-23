# Runbook: epic, status update and release flows on Jira

The epic, status update and release commands on a repository whose tracker is Jira Cloud (PMK-79): an epic is a work item of the space's epic-level work type, a status update is a comment on the epic that pmkit marks as one, and a release is a version of the space, named by the version name. `scripts/runbook-epics-releases-jira.test.mjs` runs every step below with the real CLI and a stateful fake Jira in place of `fetch`, with the fake's state saved to a file between runs and the clock fixed at 2026-11-22 12:00 UTC (`PMKIT_NOW`), so `npm test` checks this runbook.

Live check: skipped. No Jira credentials exist, so no step has run against a real site; PMK-373 in EPC-14 lists what a follow-up settles: epics on company-managed and team-managed spaces, comment properties, the version calls and `fixVersions`, and how JQL reads a quoted version id. Publishing status updates to Atlassian Home is PMK-372.

## Before you start

- The setup of `docs/runbooks/discover-jira.md` and `docs/runbooks/issues-jira.md`: a Jira Cloud site, `JIRA_EMAIL` and `JIRA_API_TOKEN` exported, and `tracker.system: jira` with a site and a space. The space has an Epic work type and a Start date field.
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

- Titles and bodies go through files in `tmp/`, written with the file tool:
  - `tmp/epic.txt`: `Launch billing`
  - `tmp/epic-2.txt`: `Launch billing v2`
  - `tmp/epic.md`: `Bill every customer monthly.`
  - `tmp/title-1.txt`: `Send the first invoice`
  - `tmp/update.md`: `The payment provider is late.`

## Capabilities

1. Read what the site offers:

   ```
   node scripts/pmkit.mjs capabilities --json
   ```

   Expect `deliverables` native with `{ entity: 'epic' }`, `releases` native with `{ entity: 'version' }` and `status_update` derived with `{ source: 'comment' }`.

## Epics

2. Preview the epic, then create it:

   ```
   node scripts/pmkit.mjs epic create --title-file tmp/epic.txt --start 2026-11-23 --target 2026-12-31 --description-file tmp/epic.md --dry-run --json
   node scripts/pmkit.mjs epic create --title-file tmp/epic.txt --start 2026-11-23 --target 2026-12-31 --description-file tmp/epic.md --json
   ```

   Expect the dry run to show `after` with `id: null` and to create nothing (`epic list` is `[]`). The real run gives `ENG-1`, status `To Do` (category `todo`), `start` `2026-11-23` (the Start date field), `target` `2026-12-31` (the due date), the description and `url` `https://acme.atlassian.net/browse/ENG-1`.

3. Create a work item, put it under the epic, and list:

   ```
   node scripts/pmkit.mjs issues create --title-file tmp/title-1.txt --type feature --json
   node scripts/pmkit.mjs issues parent ENG-2 ENG-1 --json
   node scripts/pmkit.mjs issues list --json
   node scripts/pmkit.mjs epic list --json
   node scripts/pmkit.mjs epic get ENG-1 --json
   node scripts/pmkit.mjs epic progress ENG-1 --json
   ```

   Expect `ENG-2` with `parent` `ENG-1`. `issues list` lists `ENG-2` only: an epic is never an issue in a search (ADR 0017). `epic list` lists `ENG-1`, and `epic progress` counts `total` 1, `done` 0 and `open` `["ENG-2"]`.

4. Rename the epic:

   ```
   node scripts/pmkit.mjs epic update ENG-1 --title-file tmp/epic-2.txt --json
   ```

   Expect `after.title` `Launch billing v2`.

## Status updates

5. Publish a status update and read it back:

   ```
   node scripts/pmkit.mjs epic update-status ENG-1 --health at_risk --body-file tmp/update.md --json
   node scripts/pmkit.mjs epic updates ENG-1 --json
   ```

   Expect `after` with `health` `at_risk`, the body and `author` the token's owner. In Jira it is a comment on `ENG-1` that starts with `Status update: At risk` and carries the `pmkit.statusUpdate` property; a comment without the property is not an update. `epic updates` lists it, newest first, and `epic get ENG-1` now shows `health` `at_risk`.

6. Move the epic:

   ```
   node scripts/pmkit.mjs epic move ENG-1 in_progress --json
   ```

   Expect `before.status.category` `todo` and `after.status.name` `In Progress`. A move whose transition asks for a field (such as Resolution on Done) is refused with `INVALID_INPUT`; move the epic in Jira.

## Releases

7. Preview a release, create it, and list:

   ```
   node scripts/pmkit.mjs release create 2.0 --target 2026-12-15 --dry-run --json
   node scripts/pmkit.mjs release create 2.0 --target 2026-12-15 --json
   node scripts/pmkit.mjs release list --json
   ```

   Expect the dry run to create nothing (`release list` is `[]`). The real run creates version `2.0` in the space: `{ id: '2.0', name: '2.0', target: '2026-12-15', state: 'planned', description: '' }`.

8. Put the work item in the release and list the release's issues:

   ```
   node scripts/pmkit.mjs issues update ENG-2 --release 2.0 --json
   node scripts/pmkit.mjs release issues 2.0 --json
   ```

   Expect `after.release` `2.0` (Jira's fix version), and `ENG-2` in the release.

9. Mark the release released:

   ```
   node scripts/pmkit.mjs release mark-released 2.0 --dry-run --json
   node scripts/pmkit.mjs release mark-released 2.0 --json
   ```

   Expect the dry run to change nothing (`release list` still shows `planned`). The real run gives `after.state` `released`, `released` `2026-11-22T12:00:00Z` (Jira keeps the release date, read at 12:00 UTC) and `unfinished` with `ENG-2`.

## What Jira does not have

10. A git tag and a milestone:

    ```
    node scripts/pmkit.mjs release create 3.0 --tag v3.0 --json
    node scripts/pmkit.mjs milestone create m1 --json
    ```

    Expect exit 2 for both: `INVALID_INPUT` with next step `Drop --tag on Jira`, and `NOT_SUPPORTED` with `Jira has no milestones`.

11. In a space without an Epic work type (the test serves a space with Story, Bug and Sub-task only), `node scripts/pmkit.mjs epic list --json` exits 2 with `NOT_SUPPORTED`, `Space ENG has no epic work type`, next step `/pmkit:setup`.

## Failures

| Case | Code | Next step |
|---|---|---|
| An epic command in a space without an epic work type (step 11) | `NOT_SUPPORTED` | `/pmkit:setup` |
| `epic get` of a work item that is not an epic | `NOT_FOUND` | `pmkit epic list` |
| `epic create --start` in a space without a Start date field | `NOT_SUPPORTED` | `/pmkit:setup` |
| `epic create --goal`, `epic goal` | `NOT_SUPPORTED` | Jira goals live in Atlassian Home, which pmkit does not read |
| `release create --tag`, `release mark-released --tag` (step 10) | `INVALID_INPUT` | `Drop --tag on Jira` |
| `release create` with a name the space already has | `CONFLICT` | `pmkit release list` |
| `issues update --release` with an unknown version | `INVALID_INPUT` | `pmkit release list` |
| `milestone create`, `issues update --milestone` (step 10) | `NOT_SUPPORTED` | `Use a release (version) or an epic` |
