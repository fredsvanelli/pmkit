# Runbook: Jira Product Discovery on Jira Cloud

Reading Jira Product Discovery ideas and connecting one to an epic on a repository whose tracker is Jira Cloud (PMK-83): `jira ideas list` reads the ideas of a Jira Product Discovery project with their votes and delivery work, and `jira ideas connect <idea> <epic>` links an idea to an epic of the space with the delivery link type. The command `/pmkit:jira:product-discovery` walks this flow with the user. `scripts/runbook-product-discovery-jira.test.mjs` runs every step below with the real CLI and a stateful fake Jira in place of `fetch`, with the clock fixed at 2026-11-23 12:00 UTC (`PMKIT_NOW`), so `npm test` checks this runbook.

Live check: skipped (no Jira credentials), see EPC-14. No step has run against a real site. A follow-up in EPC-14 settles the real shapes of the votes field and the delivery link type, and whether insights can be read at all (Jira's REST API does not return them).

## Before you start

- The setup of `docs/runbooks/discover-jira.md` and `docs/runbooks/issues-jira.md`: a Jira Cloud site with a Jira Product Discovery project, `JIRA_EMAIL` and `JIRA_API_TOKEN` exported (the token's owner can browse the project), and `tracker.system: jira` with a site and a space.
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

- The site has one Jira Product Discovery project, `IDEA`, with a `Votes` field and two ideas: `IDEA-1` "Bulk export" with 7 votes, and the newer `IDEA-2` "Dark mode", whose votes Jira does not return.

## Capabilities

1. Read what the site offers:

   ```
   node scripts/pmkit.mjs capabilities --json
   ```

   Expect `tracker: jira`.

## Ideas

2. List the ideas:

   ```
   node scripts/pmkit.mjs jira ideas list
   node scripts/pmkit.mjs jira ideas list --json
   ```

   Expect two lines, newest first:

   ```
   IDEA-2  Dark mode  (Discovery)  votes unread  insights unread  delivery none
   IDEA-1  Bulk export  (Discovery)  votes 7  insights unread  delivery none
   ```

   The JSON has `available: true`, `project` `{ key: "IDEA", name: "Ideas" }`, `IDEA-1` with `votes` `[{ field: "Votes", value: 7 }]`, `IDEA-2` with `value: null`, `insights: null` and `epics: []` on both, and `hasMore: false`. The warnings are `Jira's REST API does not return Jira Product Discovery insights, so insights are unread` and `Jira did not return the votes of 1 ideas`.

3. Name the project, in any case, and cut the list:

   ```
   node scripts/pmkit.mjs jira ideas list --project IDEA --json
   node scripts/pmkit.mjs jira ideas list --project idea --json
   node scripts/pmkit.mjs jira ideas list --limit 1 --json
   ```

   Expect the same two ideas for both project keys. With `--limit 1`, expect `IDEA-2` alone and `hasMore: true`. On a site with several Jira Product Discovery projects and no `--project`, the list fails with `INVALID_INPUT` and lists the keys.

## Connect an idea to an epic

4. Create an epic in the space:

   ```
   printf 'Exports\n' > tmp/epic.txt
   node scripts/pmkit.mjs epic create --title-file tmp/epic.txt --json
   ```

   Expect the epic `ENG-1`.

5. Preview the connection:

   ```
   node scripts/pmkit.mjs jira ideas connect IDEA-1 ENG-1 --dry-run --json
   ```

   Expect `idea: IDEA-1`, `epic: ENG-1`, `linkType: Polaris work item link`, `before` `{ epics: [] }` and `after` `{ epics: ["ENG-1"] }`. Nothing is written: the list still shows `delivery none` for `IDEA-1`.

6. Connect them:

   ```
   node scripts/pmkit.mjs jira ideas connect IDEA-1 ENG-1
   node scripts/pmkit.mjs jira ideas list
   ```

   Expect `connected IDEA-1 to ENG-1`, then `IDEA-1  Bulk export  (Discovery)  votes 7  insights unread  delivery ENG-1` in the list.

7. Connect them again:

   ```
   node scripts/pmkit.mjs jira ideas connect IDEA-1 ENG-1 --json
   ```

   Expect exit 0 with `before` and `after` both `{ epics: ["ENG-1"] }`, and no new link. The text output is `IDEA-1 is already connected to ENG-1`.

## Errors

8. The arguments swapped:

   ```
   node scripts/pmkit.mjs jira ideas connect ENG-1 IDEA-1 --json
   ```

   Expect exit 2 with `NOT_FOUND`: `ENG-1 is not an idea of a Jira Product Discovery project on acme.atlassian.net`. The idea comes first, the epic second.

9. A limit that is not a number:

   ```
   node scripts/pmkit.mjs jira ideas list --limit abc --json
   ```

   Expect exit 2 with `INVALID_INPUT`: `--limit must be a whole number`.

10. On a site without a Jira Product Discovery project, or one the token's owner cannot browse, the list exits 0 with `available: false`:

    ```
    node scripts/pmkit.mjs jira ideas list --json
    ```

    Expect `available: false`, `reason: no_discovery_project`, `ideas: []` and `enableHint`: `Create a Jira Product Discovery project on acme.atlassian.net, or check that the token's owner can browse one`. The text output is one line, `Jira Product Discovery is not available on acme.atlassian.net:` and that hint.

## Failures

| Case | Code | Next step |
|---|---|---|
| The idea and the epic swapped (step 8), or a key that is not an idea or not an epic of the space | `NOT_FOUND` | Pass an idea key from `pmkit jira ideas list` first, then an epic of `tracker.scope.space` |
| A `--limit` that is not a whole number from 1 up (step 9) | `INVALID_INPUT` | Use a whole number from 1 up |
| Several Jira Product Discovery projects and no `--project` | `INVALID_INPUT` | Pass `--project KEY` with one of the keys listed |
| A `--project` that is not a Jira Product Discovery project | `NOT_FOUND` | Pass one of the keys the error lists |
| No delivery link type on the site | `NOT_SUPPORTED` | Check that Jira Product Discovery is installed and its `Polaris work item link` type exists |
| No Jira Product Discovery project (step 10) | none: `available: false`, exit 0 | Create a Jira Product Discovery project, or use a token whose owner can browse one |
