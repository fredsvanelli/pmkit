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

   Expect `host` and `repo` from the origin remote, a note that says so, `project: null`, and one question, `tracker.scope.project`, whose `candidates` are the linked Projects as `owner/number` with their `titles`. Nothing is written. On GHES below 3.19 the command fails with `NOT_SUPPORTED` and names the version found and 3.19. When the token lacks the `project` scope, the question has no candidates, recommends `none` and carries a `note` with `gh auth refresh -s project`.

2. Pick the Project and read it:

   ```
   node scripts/pmkit.mjs init --tracker github --git-host github --project acme/7 --dry-run --json
   ```

   Expect `project: { id: "acme/7", title }` and one question per Status category: `backlog`, `todo`, `in_progress`, `in_review`, `done`, `canceled` and `blocked`. `todo`, `in_progress` and `done` have `required: true`. Each recommends the option whose name matches. Then a question for each field role that has more than one candidate, and one per pmkit type, each recommending the issue type with the same name.

3. Answer every question and preview the file:

   ```
   node scripts/pmkit.mjs init --tracker github --git-host github --project acme/7 \
     --status backlog=Backlog --status todo=Todo --status "in_progress=In Progress" --status "in_review=In Review" \
     --status done=Done --status canceled=none --status blocked=none \
     --field priority=issue:Priority --field estimate=issue:Effort --field "start_date=issue:Start date" --field "target_date=issue:Target date" \
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

   `validate` finds no problem in `.pmkit/config.yaml`. `discover` returns `issueTypes`, `issueFields`, `projectFields`, `statusOptions` and `statuses` with the mapped categories. `capabilities` returns `tracker: github`, with `estimation` `native` because `mappings.fields.estimate` names a field, `multilevel_hierarchy` (sub-issues) and `dependencies` `native`, `native_metrics` and `linked_code` `derived`, and every other capability `absent`. Without an estimate field, `estimation` is `absent` too.

## Existing config

6. Run `node scripts/pmkit.mjs init --update --dry-run --json`. With nothing changed on GitHub, expect `questions: []` and the file `keep`.

7. When a Status option was renamed on GitHub, the same command lists the old mapping in `broken` and asks that category again, with the renamed option recommended when its name matches. Answer it with `init --update --status <category>=<option>`, which changes only that line.

## Without a Project

A repository with no Project reads its statuses from labels, and a repository with no enabled issue type reads its types from labels. ADR 0009 records the rules.

8. Pick no Project and read the questions:

   ```
   node scripts/pmkit.mjs init --tracker github --git-host github --project none --dry-run --json
   ```

   Expect `project: null`, no `PmkitProject` read, and one label question for each of `triage`, `backlog`, `in_progress` and `in_review`. Each offers the repository labels and recommends the label whose name matches, such as `In progress` for `in_progress`, or `none`. `todo`, `done` and `canceled` get no question: an open issue with no status label is `todo`, and a closed one is `done` or `canceled`. A repository with no enabled issue type also gets one label question per pmkit type.

9. Answer with label names and write the file:

   ```
   node scripts/pmkit.mjs init --tracker github --git-host github --project none \
     --status triage=none --status backlog=Backlog --status "in_progress=In progress" --status "in_review=In review" \
     --field priority=issue:Priority --field estimate=issue:Effort --field "start_date=issue:Start date" --field "target_date=issue:Target date" \
     --type-label feature=none --type-label bug=bug --type-label task=none --type-label chore=none --json
   ```

   `.pmkit/config.yaml` holds `tracker.scope.project: none`, `mappings.status.in_progress: label:In progress` and the other labels in the same form, and `mappings.types.bug: label:bug`. `statuses` lists each status label with its category, then `Open`, `Closed` and `Closed as not planned`.

10. Check the capabilities:

    ```
    node scripts/pmkit.mjs capabilities --json
    ```

    Expect `cycles`, `capacity`, `deliverables` and `status_update` absent with the hint `Needs a GitHub Project: set tracker.scope.project with /pmkit:setup`, and the warning `tracker.scope.project is none, so cycles, capacity, deliverables and status_update are absent`.

## What the fake `gh` checks

The test records every `gh` call and fails when an argument or the standard input holds the token in `GH_TOKEN`. Every call carries `--hostname <host>`.
