# Runbook: issue flows on Jira

The issue commands on a repository whose tracker is Jira Cloud: create, list, move (through a transition that needs a Resolution), link, parent, comment, history, branch and delete (PMK-77). `scripts/runbook-issues-jira.test.mjs` runs every step below with the real CLI and a stateful fake Jira in place of `fetch`, with the fake's state saved to a file between runs, so `npm test` checks this runbook.

Live check: skipped. No Jira credentials exist, so no step has run against a real site; PMK-367 in EPC-14 lists what a follow-up settles (link direction on create, `parent: null`, the ADF task list, `text ~`, the assignable-users read, the changelog in search, the property read in `search/jql`, one move through a Resolution screen, a lower-case key in the development panel).

## Before you start

- The setup of `docs/runbooks/discover-jira.md`: a Jira Cloud site, `JIRA_EMAIL` and `JIRA_API_TOKEN` exported, and `tracker.system: jira` with a site and a space in `.pmkit/config.yaml`.
- A git repository with a commit on `main`, and `git_host` in `.pmkit/config.yaml` set to `system: github`, `repo: acme/widgets`, `default_branch: main`. `issues branch` reads it; Jira itself needs no git host.
- The config maps the types pmkit uses to the space's work types:

  ```yaml
  tracker:
    system: jira
    scope:
      site: acme.atlassian.net
      space: ENG
  mappings:
    types:
      feature: Story
      bug: Bug
  ```

  Statuses need no mapping: pmkit reads each status's Jira category (`todo`, `in_progress`, `done`).
- Titles, criteria and comments go through files, as `skills/pmkit/references/conventions.md` requires. The steps write them in `tmp/` with the file tool:
  - `tmp/title-1.txt`: `Ship it`
  - `tmp/criteria-1.txt`: two lines, `- It ships` and `- A test covers it`
  - `tmp/title-2.txt`: `Prepare the release`
  - `tmp/title-3.txt`: `Scratch item`
  - `tmp/comment-1.txt`: `Waiting on the release notes.`

## Create and list

1. Create the feature with its criteria, then a bug:

   ```
   node scripts/pmkit.mjs issues create --title-file tmp/title-1.txt --type feature --criteria-file tmp/criteria-1.txt --json
   node scripts/pmkit.mjs issues create --title-file tmp/title-2.txt --type bug --json
   ```

   Expect `before: null` and the new work item in `after`, with keys `ENG-1` and `ENG-2`. `ENG-1` has `type: feature` and two `acceptanceCriteria`, none done, and its status is in category `todo`.

2. List with a filter that becomes JQL:

   ```
   node scripts/pmkit.mjs issues list --type feature --assignee none --json
   ```

   Expect only `ENG-1`: the type maps to Story, and `--assignee none` matches work items without an assignee.

## Move

3. Move `ENG-1` to in progress:

   ```
   node scripts/pmkit.mjs issues move ENG-1 in_progress --json
   ```

   Expect `after.status.category: in_progress`.

4. Preview the move to done:

   ```
   node scripts/pmkit.mjs issues move ENG-1 done --dry-run --json
   ```

   Expect `requiredFields` to list `Resolution` with its allowed values (`Done`, `Won't Do`), and nothing written.

5. Run the move without a value for it:

   ```
   node scripts/pmkit.mjs issues move ENG-1 done --json
   ```

   Expect exit 2 and `INVALID_INPUT` naming the Resolution field and the `--field` flag. Jira received no write; `ENG-1` stays `in_progress`.

## Link, parent, comment

6. Make `ENG-2` block `ENG-1`, then list the blocked work items:

   ```
   node scripts/pmkit.mjs issues link ENG-2 ENG-1 --kind blocks --json
   node scripts/pmkit.mjs issues list --blocked --json
   ```

   Expect `ENG-2` to list `ENG-1` in `after.blocks` and, in the list, `ENG-1` only: it has an open blocker.

7. Set the parent of `ENG-2`:

   ```
   node scripts/pmkit.mjs issues parent ENG-2 ENG-1 --json
   ```

   Expect `after.parent: ENG-1`.

8. Comment on `ENG-1`:

   ```
   node scripts/pmkit.mjs issues comment ENG-1 --body-file tmp/comment-1.txt --json
   ```

   Expect the comment with its author, the fake viewer.

## Branch

9. Create the branch and record it:

   ```
   node scripts/pmkit.mjs issues branch ENG-1 --json
   ```

   Expect `branch: ENG-1-ship-it`, created locally from `main` (`git branch --list ENG-1-ship-it` shows it), and `after.branch` with the same name. On Jira the key stays upper case, the form Jira's development panel links (ADR 0015); the other trackers name it `eng-1-ship-it`. pmkit writes it to the work-item property `pmkit.branch` (ADR 0015), so `issues get ENG-1 --json` reads it back. `issues branch` needs `git_host.system: github` in `.pmkit/config.yaml`; with `git_host: none` it answers `NOT_SUPPORTED`. `issues update <key> --branch <name>` records a branch made by hand.

## Finish the move

10. Now pass the value:

    ```
    node scripts/pmkit.mjs issues move ENG-1 done --field resolution=Done --json
    ```

    Expect `after.status` `Done`, category `done`. `--field <id>=<value>` repeats for each field the dry run lists.

## History

11. Read the history:

    ```
    node scripts/pmkit.mjs issues get ENG-1 --history --json
    ```

    Expect `history` in time order with the ops `create`, `move` (to In Progress), `link`, `comment` and `move` (to Done), each with its time and author.

## Delete

12. Delete a work item nothing references. `ENG-2` is a blocker and a child of `ENG-1`, so deleting it is refused (exit 2, `CONFLICT`) with the referencing keys named. Create and delete a scratch item:

    ```
    node scripts/pmkit.mjs issues delete ENG-2 --json
    node scripts/pmkit.mjs issues create --title-file tmp/title-3.txt --json
    node scripts/pmkit.mjs issues delete ENG-3 --json
    ```

    Expect the first to fail, then `ENG-3` created and deleted (`after: null`); `issues get ENG-3` is `NOT_FOUND`.

## Failures

| Case | Code | Next step |
|---|---|---|
| A move to done without `--field` for a required screen field | `INVALID_INPUT` | Run with `--dry-run`, then pass `--field <id>=<value>` |
| `--type` names a type absent from `mappings.types` | `INVALID_INPUT` | Add the type to `mappings.types` |
| `issues archive` | `NOT_SUPPORTED` | Archive in Jira (Premium only) |
| `issues branch` with `git_host: none` | `NOT_SUPPORTED` | Set `git_host.system` to `github` or run `/pmkit:setup` |
| `issues create --branch` | `INVALID_INPUT` | Create the work item, then `issues update <key> --branch <name>` |
| Delete of a linked or parent work item | `CONFLICT` | Remove the links and children first |
