# Runbook: set up pmkit on GitHub Issues

The flow of `/pmkit:setup` when the user picks GitHub Issues: "GitHub first run" and "Existing GitHub config" in `commands/setup.md`. `scripts/runbook-setup-github.test.mjs` runs every step below with the real CLI and a fake `gh` first on `PATH`, so `npm test` checks this runbook.

## Before you start

- `gh` is installed and logged in to the host of the repository (`gh auth status`).
- The repository's `origin` remote points to GitHub: github.com, a GHE.com host (`*.ghe.com`) or a GitHub Enterprise Server host at version 3.19 or later.
- To read a Project, the `gh` token needs the `project` scope: `gh auth refresh -s project`, plus `-h <host>` for any host but github.com. A repository without a Project needs only the default scopes.
- There is no `.pmkit/config.yaml` yet.

## First run

1. Read the repository and list the Projects:

   ```
   node scripts/pmkit.mjs init --tracker github --git-host github --dry-run --json
   ```

   Expect `host` and `repo` from the origin remote, a note that says so, `project: null`, and one question, `tracker.scope.project`, whose `candidates` are the linked Projects as `owner/number` with their `titles`. pmkit pages through every linked Project, so a repository with more than 20 lists them all. Nothing is written. On GHES below 3.19 the command fails with `NOT_SUPPORTED` and names the version found and 3.19. When the token lacks the `project` scope, the question has no candidates, recommends `none` and carries a `note` with `gh auth refresh -s project`.

2. Pick the Project and read it:

   ```
   node scripts/pmkit.mjs init --tracker github --git-host github --project acme/7 --dry-run --json
   ```

   Expect `project: { id: "acme/7", title }` and one question per Status category: `backlog`, `todo`, `in_progress`, `in_review`, `done`, `canceled` and `blocked`. `todo`, `in_progress` and `done` have `required: true`. Each recommends the option whose name matches. Then a question for each field role that has more than one candidate, and one per pmkit type, each recommending the issue type with the same name. The `sprint` role is a field role too: setup offers only the Project's iteration fields as `project:<name>`, recommends `Sprint` or `iteration` by name, applies the one that matches when it is the only one, and applies `none` when the Project has no iteration field. With `tracker.scope.project: none`, `sprint` is `none` and setup asks nothing.

3. Answer every question and preview the file:

   ```
   node scripts/pmkit.mjs init --tracker github --git-host github --project acme/7 \
     --status backlog=Backlog --status todo=Todo --status "in_progress=In Progress" --status "in_review=In Review" \
     --status done=Done --status canceled=none --status blocked=none \
     --field priority=issue:Priority --field estimate=issue:Effort --field "start_date=issue:Start date" --field "target_date=issue:Target date" --field sprint=project:Sprint \
     --type-label feature=Feature --type-label bug=Bug --type-label task=Task --type-label chore=none --dry-run --json
   ```

   Expect `questions: []`, `files: [{ path: ".pmkit/config.yaml", action: "create" }]` and `statuses` with each option and its category.

4. Run the same command without `--dry-run`. `.pmkit/config.yaml` now holds `tracker.system: github`, `tracker.scope.host`, `tracker.scope.repo`, `tracker.scope.project` and the mappings.

5. Check the result:

   ```
   node scripts/pmkit.mjs validate --json
   node scripts/pmkit.mjs discover --json
   node scripts/pmkit.mjs capabilities --json
   ```

   `validate` finds no problem in `.pmkit/config.yaml`, which now holds `mappings.fields.sprint: project:Sprint`. `discover` returns `issueTypes`, `issueFields`, `projectFields`, `statusOptions` and `statuses` with the mapped categories. `capabilities` returns `tracker: github`, with `estimation` `native` because `mappings.fields.estimate` names a field, `multilevel_hierarchy` (sub-issues) and `dependencies` `native`, `deliverables` and `status_update` `native` (the Project is set), `cycles` `native` (`sprint=project:Sprint` is mapped), and `capacity`, `native_metrics` and `linked_code` `derived`. Every other capability is `absent`. Without an estimate field, `estimation` is `absent` too.

## Existing config

6. Run `node scripts/pmkit.mjs init --update --dry-run --json`. With nothing changed on GitHub, expect `questions: []` and the file `keep`.

7. When the Project loses its iteration field, or `mappings.fields.sprint` names an issue field, the same command lists `mappings.fields.sprint` in `broken` (`mappings.fields.sprint must name a Project iteration field` for an issue field) and asks it again. Answer it with `init --update --field sprint=project:<name>` or `--field sprint=none`.

8. When a Status option was renamed on GitHub, the same command lists the old mapping in `broken` and asks that category again, with the renamed option recommended when its name matches. Answer it with `init --update --status <category>=<option>`, which changes only that line.

## Without a Project

A repository with no Project reads its statuses from labels, and a repository with no enabled issue type reads its types from labels. ADR 0009 records the rules.

9. Pick no Project and read the questions:

   ```
   node scripts/pmkit.mjs init --tracker github --git-host github --project none --dry-run --json
   ```

   Expect `project: null`, no `PmkitProject` read, and one label question for each of `triage`, `backlog`, `in_progress` and `in_review`. Each offers the repository labels and recommends the label whose name matches, such as `In progress` for `in_progress`, or `none`. `todo`, `done` and `canceled` get no question: an open issue with no status label is `todo`, and a closed one is `done` or `canceled`. A repository with no enabled issue type also gets one label question per pmkit type.

10. Answer with label names and write the file:

   ```
   node scripts/pmkit.mjs init --tracker github --git-host github --project none \
     --status triage=none --status backlog=Backlog --status "in_progress=In progress" --status "in_review=In review" \
     --field priority=issue:Priority --field estimate=issue:Effort --field "start_date=issue:Start date" --field "target_date=issue:Target date" \
     --type-label feature=none --type-label bug=bug --type-label task=none --type-label chore=none --json
   ```

   `.pmkit/config.yaml` holds `tracker.scope.project: none`, `mappings.status.in_progress: label:In progress` and the other labels in the same form, and `mappings.types.bug: label:bug`. `statuses` lists each status label with its category, then `Open`, `Closed` and `Closed as not planned`.

11. Check the capabilities:

    ```
    node scripts/pmkit.mjs capabilities --json
    ```

    Expect `cycles`, `capacity`, `deliverables` and `status_update` absent with the hint `Needs a GitHub Project: set tracker.scope.project with /pmkit:setup`, and the warning `tracker.scope.project is none, so cycles, capacity, deliverables and status_update are absent`.

12. On a repository with no Project and no issue field, map the priority and the estimate to labels. Answer every field role `none`, then read the questions:

    ```
    node scripts/pmkit.mjs init --tracker github --git-host github --project none --field priority=none --field estimate=none \
      --field start_date=none --field target_date=none <the status and type answers of step 10> --dry-run --json
    ```

    Expect one label question per priority level, `mappings.priority.urgent` to `mappings.priority.low`, each recommending the label whose name matches (`P0` or `urgent`, `P1` or `high`, `P2` or `medium`, `P3` or `low`, with or without a `priority:` prefix), or `none`. Estimate labels get no question, because their names vary too much to guess. Answer both with flags:

    ```
    node scripts/pmkit.mjs init ... --priority-label urgent=P0 --priority-label high=P1 --priority-label medium=none --priority-label low=none \
      --estimate-label "3=size: 3" --json
    ```

    `.pmkit/config.yaml` holds `mappings.priority.high: label:P1` and `mappings.estimate.3: label:size: 3`, and `discover` reports the estimate as points with the scale `[3]`. The dates stay `none`: a label cannot hold a date. ADR 0012 records the rules. With a Project, `--priority-label` and `--estimate-label` fail with `INVALID_INPUT`.

## On GitHub Enterprise Server

13. On a GHES host, from 3.19, with a Project, read the questions:

    ```
    node scripts/pmkit.mjs init --tracker github --git-host github --project acme/7 --dry-run --json
    ```

    Expect `host` set to the GHES host and the Project's fields read: pmkit leaves out `isIssueField` and multi-select fields, which no GHES schema has. Before 3.22, GHES lists no issue fields on a repository, so each field question offers Project fields only, such as `candidates: ["project:Due"]` for `mappings.fields.target_date`. From 3.22 the issue fields come first, as on github.com: `["issue:Target date", "issue:Start date", "project:Due"]`.

## What the fake `gh` checks

The test records every `gh` call and fails when an argument or the standard input holds the token in `GH_TOKEN`. Every call carries `--hostname <host>`.
