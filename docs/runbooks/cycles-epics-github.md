# Runbook: sprints, epics and milestones on GitHub Issues

The sprint, epic and milestone commands on a repository whose tracker is GitHub Issues: plan and fill a sprint, create an epic and put an issue in it, publish status updates, create a milestone and put an issue in it, and read the capabilities. `scripts/runbook-cycles-epics-github.test.mjs` runs every step below with the real CLI and a fake `gh` first on `PATH`. The fake keeps the state of GitHub in a file between runs, so `npm test` checks this runbook. The last section is a manual check that the test does not run.

## Before you start

- `/pmkit:setup` ran on this repository, as `docs/runbooks/setup-github.md` describes, with `sprint=project:Sprint` among the fields. `.pmkit/config.yaml` names the Project `acme/7` and maps the sprint role to its iteration field `Sprint`.
- The Project `acme/7` has the iteration field `Sprint` with one iteration, `2026-11-16`, which lasts 14 days. Today is 2026-11-17, so that sprint is active.
- The epic Project `acme/12` is linked to the repository, so the first epic that pmkit creates is `acme/13`.
- The repository has the issues `1`, `2` and `3`.
- `gh` is logged in to the host of the repository, with the `project` scope.
- The title of the epic and the bodies of its updates go through files, as `skills/pmkit/references/conventions.md` requires. The steps write them in `tmp/` with the file tool:
  - `tmp/title-epic.txt`: `Search`
  - `tmp/update-1.md`: `Indexing is two days behind.`
  - `tmp/update-2.md`: `Indexing caught up.`

## Plan a sprint

1. Read the sprints and the active one:

   ```
   node scripts/pmkit.mjs cycle list --json
   node scripts/pmkit.mjs cycle current --json
   ```

   Expect one sprint, `id` and `name` `2026-11-16`, from `2026-11-16` to `2026-11-29`, with `state: "active"`. A GitHub iteration has an id of its own, and pmkit shows its start date as the sprint id.

2. Open the next sprint:

   ```
   node scripts/pmkit.mjs cycle open --start 2026-11-30 --json
   ```

   Expect `before: null` and the new sprint in `after`, with `id` `2026-11-30`, `end` `2026-12-13` and `state: "planned"`. The end comes from the duration of the iteration field. The update that pmkit sends keeps the id of the existing iteration, so an issue already in `2026-11-16` stays in it. On GitHub Enterprise Server the command exits with code 2 and `NOT_SUPPORTED`, with the next step `Add the iteration in the Project settings on GitHub`, because that host cannot keep the ids of the iterations.

3. Try to give the sprint a goal:

   ```
   node scripts/pmkit.mjs cycle open --start 2026-12-14 --goal "Ship search" --json
   ```

   The command exits with code 2 and `NOT_SUPPORTED`, `a GitHub iteration has no goal`. No iteration is added.

## Move issues

4. Move issues 1 and 2 to the current sprint, then list the sprint:

   ```
   node scripts/pmkit.mjs cycle add 1 2 --to current --json
   node scripts/pmkit.mjs cycle issues 2026-11-16 --json
   ```

   Expect `after.sprint: "2026-11-16"` on both issues, and the sprint lists issues `1` and `2`. An issue with no item in the Project gets one first.

5. Move issue 2 to the next sprint and read the sprints:

   ```
   node scripts/pmkit.mjs cycle add 2 --to 2026-11-30 --json
   node scripts/pmkit.mjs cycle issues 2026-11-16 --json
   node scripts/pmkit.mjs cycle list --json
   ```

   Expect `after.sprint: "2026-11-30"`, the sprint `2026-11-16` listing issue `1` only, and the list showing `2026-11-16` as `active` and `2026-11-30` as `planned`.

6. Try to close the sprint:

   ```
   node scripts/pmkit.mjs cycle close 2026-11-16 --json
   ```

   The command exits with code 2 and `NOT_SUPPORTED`, `GitHub ends an iteration on its end date`. Move the unfinished issues with `cycle add`.

## Epics

An epic on GitHub is a Project linked to the repository. Its id is `owner/number`.

7. Create an epic with dates:

   ```
   node scripts/pmkit.mjs epic create --title-file tmp/title-epic.txt --start 2026-11-17 --target 2026-12-15 --json
   node scripts/pmkit.mjs epic list --json
   ```

   Expect `before: null` and the epic in `after`, with `id` `acme/13`, `title` `Search`, `start` `2026-11-17` and `target` `2026-12-15`. The Project has no date fields, so pmkit stores the dates in a first status update with the status `INACTIVE`. The list shows `acme/12` and `acme/13`. `--goal` answers `NOT_SUPPORTED`, because GitHub has no goals.

8. Put issue 3 in the epic and count the epic:

   ```
   node scripts/pmkit.mjs issues parent 3 acme/13 --json
   node scripts/pmkit.mjs epic progress acme/13 --json
   ```

   Expect `after.parent: "acme/13"`, then `total: 1` and `done: 0`. The issue becomes an item of the epic Project.

9. Publish two status updates and read them:

   ```
   node scripts/pmkit.mjs epic update-status acme/13 --health at_risk --body-file tmp/update-1.md --json
   node scripts/pmkit.mjs epic update-status acme/13 --health on_track --body-file tmp/update-2.md --json
   node scripts/pmkit.mjs epic updates acme/13 --json
   node scripts/pmkit.mjs epic get acme/13 --json
   ```

   Expect three updates, newest first. The newest says `Indexing caught up.` and the second says `Indexing is two days behind.` The third is the `INACTIVE` update that `epic create` wrote. Each new update repeats the start and the target, so `epic get` still shows `2026-11-17` and `2026-12-15`.

## Milestones

A GitHub milestone has one name, its title, and pmkit uses that title as the milestone id.

10. Create a milestone with a due date:

    ```
    node scripts/pmkit.mjs milestone create v2 --due 2026-12-31 --json
    ```

    Expect `after` to be `{ id: "v2", name: "v2", due: "2026-12-31", status: "open" }`. GitHub has no GraphQL mutation for a milestone, so pmkit calls `gh api --method POST repos/acme/widgets/milestones`.

11. Try a name that differs from the id:

    ```
    node scripts/pmkit.mjs milestone create v1.0 --name "Version one" --json
    ```

    The command exits with code 2 and `INVALID_INPUT`, `a GitHub milestone has one name, its title`. pmkit makes no REST call.

12. Put issue 3 in the milestone and read the milestone:

    ```
    node scripts/pmkit.mjs issues update 3 --milestone v2 --json
    node scripts/pmkit.mjs milestone get v2 --json
    ```

    Expect `after.milestone: "v2"` and `due: "2026-12-31"`.

## Capabilities

13. Read the capabilities:

    ```
    node scripts/pmkit.mjs capabilities --json
    ```

    Expect `cycles` with path `native` and the detail `field: "Sprint"`, `open: true` and `close: false`. `capacity`, `deliverables` and `status_update` are not `absent`.

## Capacity

14. Set the capacity of a member in the current sprint:

    ```
    node scripts/pmkit.mjs cycle capacity current --set octocat=5 --json
    ```

    Expect `after.id` `2026-11-16` and `after.capacity` `{ "octocat": 5 }`. GitHub has no capacity of its own, so pmkit makes no call that changes GitHub and writes `.pmkit/capacity.yaml` instead. That file holds the entry under `cycles`, then the key `github:acme/7` of the Project, then the sprint `2026-11-16`: `capacity: { octocat: 5 }`.

## Manual live check

The E2E test does not run this check, because it needs a real Project on github.com. It stays open as a follow-up for the `PMKIT_LIVE` checks of PMK-335.

1. Create a throwaway Project on github.com with an iteration field named `Sprint`, and add three consecutive iterations of 14 days. Add one issue to the Project in each of the first two iterations.
2. Run `/pmkit:setup` on a scratch repository that links the Project, with `sprint=project:Sprint`, then run `node scripts/pmkit.mjs cycle open --start <date after the last iteration> --json`.
3. Read the iteration of each item, for example `node scripts/pmkit.mjs issues get <id> --json` for the two issues. The `sprint` of each issue must be the same as before the call. If an item lost its iteration, `openCycle` sent the iterations without their ids, and that is a bug.
4. Create a milestone with a due date on the throwaway repository, for example `node scripts/pmkit.mjs milestone create v-live --due 2026-12-31 --json`, then read it back with `node scripts/pmkit.mjs milestone get v-live --json`. The `due` must be `2026-12-31`. GitHub stores a due date as a calendar date in US Pacific time, and pmkit sends noon UTC so the date does not move to the previous day.
5. Delete the Project, the milestone and the scratch repository.

## What the fake `gh` checks

The test records every `gh` call and fails when an argument or the standard input holds the token in `GH_TOKEN`. Every call carries `--hostname github.com`.
