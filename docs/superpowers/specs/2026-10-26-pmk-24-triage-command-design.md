# PMK-24: add the triage command

## Problem

The `triage` status category holds issues nobody has looked at yet. Today the only way to clear it is to read each issue and run `issues update`, `issues link` and `issues move` by hand. `native_triage` is a native capability of the Local tracker, and its manifest entry points at `issues move`, but no command walks the user through the queue.

Acceptance criteria:

1. The command lists the issues in the triage category with a suggested priority, labels, duplicate or decline for each.
2. The command applies the accepted decisions, in bulk or one by one, after a preview.

Sources: the Unified model (EM catalog entry `triage`: "Processes untriaged issues with suggestions"), the Linear tab ("suggests team, priority, labels, duplicate or decline"; "Applies accepted decisions, in bulk or one by one") and the Local adapter (`native_triage`: statuses in the triage category).

## Findings

- ADR 0002 says commands never compute and never edit `.issues/` by hand. Every read and write goes through `pmkit.mjs`. A suggestion is a judgment, not a computation, and `/pmkit:backlog:groom` already makes such judgments (likely duplicates, a drafted estimate) from CLI output. The CLI needs no new command for triage.
- The CLI already has every call the command needs.
  - `issues list --category triage` returns the queue, oldest first, with a `problems` list for unreadable files.
  - `discover` returns the allowed priorities and labels. `issues update` rejects a value outside them.
  - `issues update <id> --priority p --label a,b` writes the priority and labels. `--label` replaces the whole list, so the command has to send the existing labels plus the accepted ones.
  - `issues link <dup> <kept> --kind duplicate` and `issues move <dup> canceled` are the duplicate path that groom step 7 already uses.
  - `issues move <id> backlog` takes an issue out of triage. `issues comment <id> --body-file f` records a reason.
  - All of them take `--dry-run`, so the preview needs no new code.
- The conventions already fix the write rules. Several records change in one run, so the command always shows the full preview and asks once, whatever `write_policy.confirm` says. `confirm: none` skips only the single-write question.
- `issues list --text` is the duplicate search that `issues:capture` step 4 uses. It matches words, so the command still has to judge the match from the titles and descriptions and say it is a guess.
- The repository's own tracker has no issue in triage and no labels in `discover`. The `team` fixture has one triage issue, `ISS-1V9Z` ("Investigate slow login"), which `backlog-groom` uses as a duplicate. The scenario for this command needs its own setup.
- `scripts/plugin.test.mjs` keeps a list of commands (`COMMANDS`) and checks that `SKILL.md` and `README.md` name each one. `scripts/scenarios.test.mjs` requires a scenario module and a snapshot for every command file.

## Goals

- One command, `/pmkit:backlog:triage`, that reads the triage queue, proposes one decision per issue and applies the accepted ones.
- A decision is one of three kinds.
  - Accept. Set a priority and labels, and move the issue to the backlog.
  - Duplicate. Link it to the issue it repeats and move it to `canceled`.
  - Decline. Move it to `canceled` with a comment that gives the reason.
- The user accepts all proposals, a group of them, or one at a time, and can edit a proposal before it is applied.
- Every write shows a preview first and needs one approval for the whole batch.

## Non-goals

- No change to the CLI, the schemas or the tracker format. No new capability.
- No suggestion of an assignee, an estimate, a sprint or a milestone. Estimates and parents belong to `/pmkit:backlog:groom`, and sprints to `/pmkit:cycle:plan`.
- No "team" suggestion from the Linear tab. The Local tracker has no teams.
- No new labels. The command suggests only labels that `discover` lists. When none fits, it suggests none.
- No automatic triage of new issues as they arrive. The user runs the command.

## Anti-goals

- A decision applied without a preview, or a partial write that the output hides.
- A suggestion presented as a fact. The command says the priority, the labels and the duplicate match are proposals.
- An issue moved out of triage with no decision the user accepted.

## Design

### Home and name

The file is `commands/backlog/triage.md`, so the command is `/pmkit:backlog:triage`. It sits beside `groom` because both work on the intake and hygiene of the backlog. The frontmatter has `disable-model-invocation: true` and `argument-hint: ""`. It has the five sections that `plugin.test.mjs` checks, and its first step reads the conventions.

### Parameters

None. Every issue in the `triage` category is in scope. An optional `--limit` is not offered. A long queue is read in one `issues list` call and shown in pages of 10 rows (see step 4).

### Steps

1. Run `issues list --category triage --json`. Show each entry of `problems` as a warning, because an unreadable issue is not in the queue. An empty queue ends the command (see "If something is missing").
2. Run `discover --json` to get the allowed priorities and labels.
3. For each issue, run `issues get <id> --comments --json` when the list entry lacks the description, then form a proposal from the title, type, description and comments.
   - Priority. One of the allowed values, with a one-line reason. Leave it empty when the text gives no basis, and say so.
   - Labels. Zero or more values from `discover`. Never a value outside it.
   - Duplicate. Run `issues list --text "<key words from the title>" --json`, over every category except the issue itself, and judge the matches. Name the likely original and say the match is a guess. When the original is `done` or `canceled`, the proposal is still duplicate, and the table shows the original's status, as decision 4 says.
   - Decline. Propose it only when the text shows a reason the issue should not be worked, for example it asks for something the project says it will not do. Write the reason in one sentence.
   - Not enough information. When the description cannot support any proposal, propose nothing and leave the issue in triage. Say what is missing.
4. Show the queue as an issue table (ID, title, status, assignee, estimate) with three extra columns after the five, in this order: proposal (`accept`, `duplicate of <id>`, `decline` or `needs info`), priority and labels. Show the reason for each proposal below the table in one line per issue. Page the table at 10 rows.
5. Ask with `AskUserQuestion` how to continue: apply all proposals, apply one group (accept, duplicate or decline), go through them one by one, or stop. In the one-by-one path, ask per issue to accept the proposal, change it (a different priority, labels, original or reason) or skip it. A skipped issue stays in triage. When the user accepts nothing, stop and change nothing.
6. Build the writes for every accepted decision and run each with `--dry-run --json`.
   - Accept. `issues update <id> --priority <p> --label <existing,new> --dry-run --json` when the priority or labels change, then `issues move <id> backlog --dry-run --json`.
   - Duplicate. `issues link <dup> <kept> --kind duplicate --dry-run --json`, then `issues move <dup> canceled --dry-run --json`.
   - Decline. `issues move <id> canceled --dry-run --json`, then `issues comment <id> --body-file <file> --dry-run --json`, with the reason written to a file outside `.issues/`.
   - Skip a write whose `before` equals `after` and say nothing would change.
7. Show the full preview of all accepted decisions, with before and after per issue and only the fields that change. This is a bulk change, so ask once with `AskUserQuestion`, whatever `write_policy.confirm` says. When the user declines, change nothing.
8. On approval, run the same commands without `--dry-run`, issue by issue, in the order of step 6. When a command fails, stop. List what was applied and what was not, and do not retry the failed call. Apply the error rules of the conventions.
9. Run step 1 again and compare the count. Remove the temporary files.

### Confirmation points

- Step 5: which decisions to apply, and the edits to them.
- Step 7: the full preview, always asked. Declining changes nothing.

### Output

A table of the applied decisions with the full ID, the decision, the new status, the priority and the labels. Then the count of issues left in triage and, for each, whether it was skipped or needs information. State that the priorities, labels and duplicate matches are proposals from the text of the issues.

### If something is missing

- An empty queue: say there is nothing to triage.
- `discover` lists no labels: propose priorities only and say so.
- A proposed original cannot be read: drop the duplicate proposal for that issue and say why.
- An error from the CLI: apply the rules for reading errors in the conventions.

### Supporting changes

- `skills/pmkit/SKILL.md` and `README.md` list `/pmkit:backlog:triage` with a one-line description.
- `scripts/plugin.test.mjs` adds `triage` to `COMMANDS.backlog`.
- `scripts/__scenarios__/backlog-triage.mjs` and its `.after.txt` snapshot cover the command (see Tests).
- `CHANGELOG.md` gets an entry under the next version. Tracker format and setup do not change, so those lines say so.
- `commands/help.md` reads the command files at run time, so it needs no edit. The `help` scenario snapshot (`scripts/__scenarios__/help.after.txt`) is regenerated if it lists the commands.

## Tests

- A scenario on a copy of the `team` fixture. Setup files three more triage issues, so the queue holds four: one to accept with a priority and a label, one that repeats an existing issue, one to decline, and the existing `ISS-1V9Z` left alone as "needs info" or skipped. The user applies all proposals once. The scenario checks the dry runs, the single confirmation, the writes in order, and the second `issues list` that ends the run.
- A second scenario path, or a second scenario file, for the one-by-one choice, if the scenario helpers allow a command with two paths. The builder decides.
- `expect` checks the tracker after the run: the accepted issue is in `backlog` with its priority and labels, the duplicate is `canceled` with a `duplicate` link, the declined issue is `canceled` with a comment, and the skipped issue is still in `triage`.
- The scenario helper compares flag names only, so one test parses `triage.md` and asserts that every `issues move`, `issues link`, `issues update` and `issues comment` call has a `--dry-run` form in step 6 and a write form in step 8, like the existing check for `cycle/close`.
- `npm test` passes, including `plugin.test.mjs` and `scenarios.test.mjs`.

## Design decisions

- No CLI change. Every call exists, and ADR 0002 keeps judgment in the command.
- The command lives under `backlog`, not `issues`. The `issues` group holds commands for one issue, and triage works on a queue.
- An accepted issue moves to `backlog`, not `todo`, as decision 2 says. The backlog is where `cycle:plan` and `backlog:groom` look next.
- Labels never invent a value. `issues update` would reject it, and the labels list is project config.
- Existing labels are kept. The command sends the union of old and accepted labels because `--label` replaces the list.
- A duplicate follows the groom path: a `duplicate` link, then `canceled`. The link keeps the pointer to the original after the move.
- An issue without enough information stays in triage. Moving it out would hide it from the queue.
- Declined issues get a comment, as decision 3 says, so the reason is in the issue history.
- The preview is always full and asked once, because several records change.

## Decisions on the open questions

The user accepted the recommendation for each question.

1. **Command name and home.** `/pmkit:backlog:triage`, `/pmkit:issues:triage` or a top-level `/pmkit:triage`.
   - Decision: option A, `/pmkit:backlog:triage`, next to `groom`.
2. **Where an accepted issue goes.**
   - Decision: option A, `backlog` for every accepted issue. `cycle:plan` already ranks by priority, so the command adds no rule for `urgent` or `high`.
3. **How a decline is recorded.**
   - Decision: option A, move to `canceled` and post a comment with the reason, shown in the preview. The agent drafts the reason and the user edits it in step 5.
4. **Duplicate of a finished issue.**
   - Decision: option A, propose duplicate for any match and show the original's status in the table. The user can change the decision in step 5.
