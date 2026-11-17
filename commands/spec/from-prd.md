---
description: Turn a one-page PRD into a refined PRD, ADRs for the decisions that are hard to reverse, an epic with estimated issues, and blocker links
argument-hint: "<prd file or pasted text> [epic-id]"
disable-model-invocation: true
---

# Spec from a PRD

Arguments: `$ARGUMENTS`

## Parameters

- `prd` (required): the one-page PRD. A path under the tracker's `docs/` folder (read with `docs read`), such as `.issues/docs/specs/<name>.md` or the docs-relative `specs/<slug>-prd.md`, any other local file, or pasted text. A refined PRD that an earlier run stored, such as `specs/<slug>-prd.md`, resumes the flow (see the Resume step).
- `epic-id` (optional): an existing epic (`EPC-` by default) to add the issues to. Without it, the flow proposes a new epic.

## Steps

Read `${CLAUDE_PLUGIN_ROOT}/skills/pmkit/references/conventions.md` first.

The flow runs in stages, and each stage that writes has its own approval. Stages 0 to 2 write nothing to the tracker. Subagents, when the agent has them, do the reading. No subagent writes to the tracker or asks the PM anything. Every question and every write runs in the main agent.

When the PM declines a stage, or a write fails, the flow stops there. A declined ADR is the only exception: Stage 3 goes on to the next ADR. The stop lists what it already wrote, with every path and full ID, and names the command that continues. Once Stage 3b stored the refined PRD, that command is `/pmkit:spec:from-prd specs/<slug>-prd.md`, which resumes from the stored refined PRD. Before Stage 3b, it is `/pmkit:spec:from-prd <prd>` with the original PRD. Then remove the temporary files.

1. **Stage 0: recon.** Learn what the PRD says and what exists before asking anything. Hand the reading to a recon subagent. It reads, writes nothing and asks nothing, and returns a brief. Without subagents, the main agent does the same reading in sequence. The reading covers:
   - The PRD, read the way `/pmkit:spec:import` step 1 reads it. For a path under `.issues/docs/`, or a path relative to the `docs/` folder, such as `specs/<slug>-prd.md`, run `node "${CLAUDE_PLUGIN_ROOT}/scripts/pmkit.mjs" docs read <path> --json` with the path relative to the `docs/` folder, and use `body`. For any other local file, read it with the Read tool. For pasted text, use it as given. When `docs read` answers `NOT_FOUND`, read the repository file `docs/<path>`, where Stage 3b writes the refined PRD when the tracker cannot create documents, then try the path as given as a local file. Ask for a corrected path when none of them exists.
   - The README and `CONTEXT.md`, when they exist.
   - `node "${CLAUDE_PLUGIN_ROOT}/scripts/pmkit.mjs" discover --json`, `node "${CLAUDE_PLUGIN_ROOT}/scripts/pmkit.mjs" epic list --json`, `node "${CLAUDE_PLUGIN_ROOT}/scripts/pmkit.mjs" milestone list --json` and `node "${CLAUDE_PLUGIN_ROOT}/scripts/pmkit.mjs" docs list --json`.
   - `node "${CLAUDE_PLUGIN_ROOT}/scripts/pmkit.mjs" issues list --text '<word>' --json` once for each of the 3 most specific words of the PRD. The CLI matches `--text` as one phrase, so pass a single word each time. The word comes from the PRD, so put it between single quotes and write each `'` in it as `'\''`, as the conventions say for text from data.
   - When an `epic-id` was given, `node "${CLAUDE_PLUGIN_ROOT}/scripts/pmkit.mjs" epic get <epic-id> --json`. When it answers `NOT_FOUND`, the main agent asks for a corrected ID before the first question.
   - The code areas the PRD touches, to learn what the product does there today.

   The brief is short. It says what the product already does in that area, lists the likely duplicate issues and epics, names the existing ADRs that bear on the PRD, and lists the gaps of the PRD grouped by scope, use cases and acceptance criteria.

   When the brief lists likely duplicates, show them before the first question of the interview. Show the issues as an issue table and the epics with their ID and title. Ask with `AskUserQuestion` whether to go on, use an existing epic, or stop. An existing epic becomes the `epic-id`. When the PM stops, end the flow and say that it wrote nothing. When the brief lists no duplicates, say so in one line and go on. When the PRD is a stored refined PRD (see the Resume step), skip this question, because the epic and the issues of the earlier run show up as duplicates. The Resume step asks about the epic instead.
2. **Resume:** Run this step only when the PRD is a refined PRD that an earlier run stored. It is one when its name ends in `-prd.md` and it has a Decisions section that marks each decision `ADR` or `PRD only`. Otherwise go on to Stage 1. A resume skips Stages 1 and 2, because the refined PRD is already approved, and Stage 3b, because it is already stored: its path is the stored path for every later stage. Then:
   - Find the ADRs that cite the PRD path, in both places an ADR can live. For the tracker, run `node "${CLAUDE_PLUGIN_ROOT}/scripts/pmkit.mjs" docs list --json`, then `node "${CLAUDE_PLUGIN_ROOT}/scripts/pmkit.mjs" docs read <path> --json` for each document under `adr/`, and keep the ones whose `body` names the PRD path. For the repository, search the files of `docs/adr/` for the PRD path with the file tools.
   - Match each decision marked `ADR` to the ADR found for it, by its title and its text. Stage 3 skips the decisions that already have one and records only the rest. Say which decisions already have an ADR, with its number. A decision whose ADR the PM declined in the earlier run is already `PRD only` in the stored PRD, so Stage 3 never offers it again.
   - When no `epic-id` was given, look in the `epic list` of Stage 0 for an epic whose title matches the title of the PRD. When one matches, show its ID and title and ask with `AskUserQuestion` whether it is the epic of this PRD. When it is, it becomes the `epic-id`, Stage 4 is skipped, and Stage 5 drops the issues the epic already holds. When no epic matches, or the PM says it is not the one, Stage 4 runs as usual.
3. **Stage 1: interview.** The main agent runs the interview, because a subagent cannot ask the user a question. The PM knows the product, not the code, so the interview never asks about technology, architecture or storage. Ask one question per message, built on the last answer or on a gap from the brief, and wait for the answer before the next one. Rules:
   - Skip any question the PRD, the brief or an earlier answer already answers. Questions about what exists today go to the code, not to the PM.
   - Ask in the PM's words and language. When the answer has choices you can name, ask with `AskUserQuestion`, offer the choices and mark one as recommended, with the reason in one line. Otherwise ask an open question in a plain message.
   - Cover three areas, in this order: the scope (what is in and what is out of the first version), the use cases (who does what), and the acceptance criteria (each one a result a person can check without reading the code).
   - For each use case, ask about the error and edge cases the PRD leaves out, such as an empty state, a limit reached or a missing permission.
   - When an area is clear, play it back in a short summary and ask what is wrong or missing before you move to the next area.
   - A criterion you propose counts only after the PM confirms it. Never keep a criterion the PM did not give or approve.
   - Mark each decision when it comes up, and say the mark so the PM can change it. `ADR` marks a product decision that is hard to reverse, such as the billing model, a limit, or what stays out of v1. Every other decision is `PRD only`.
   - Stop when every requirement has its scope and at least one acceptance criterion, not after a fixed number of questions.
   - The soft limit is 15 questions. Past it, say how many requirements still lack criteria, and ask with `AskUserQuestion` whether to go on or stop.
   - When the PM says to stop early, the requirements without criteria go into the refined PRD under Open questions. The import of the issue tree marks them "needs criteria", as `/pmkit:spec:import` step 3 does.
4. **Stage 2: refined PRD.** Draft the refined PRD from the PRD, the brief and the PM's answers, in the language of the PRD. It has these sections, in this order: Problem, Users, Scope (in), Out of scope, Use cases, Requirements (each with its acceptance criteria), Decisions (each marked `ADR` or `PRD only`), Phases (only when the PRD has phases), Open questions. A requirement with no criteria also appears under Open questions, marked "needs criteria".

   Take the slug from the PRD title: lowercase words joined by `-`, with only letters, digits and `-`. Write the draft to a temporary file outside `.issues/` with the file tool, as the conventions say for files with text from data. Run `node "${CLAUDE_PLUGIN_ROOT}/scripts/pmkit.mjs" docs create specs/<slug>-prd.md --body-file <file> --dry-run --json` to check that the path is free. The dry run writes nothing.
   - `CONFLICT`: the path exists. Ask for another name and run the dry run again. Never overwrite.
   - `NOT_SUPPORTED`: the tracker cannot create documents (Linear). The refined PRD goes to the repository file `docs/specs/<slug>-prd.md` instead. Check with the file tools that the file does not exist yet, and ask for another name when it does.

   Show the full draft and the path. Ask with `AskUserQuestion` whether to approve it, edit it, change the mark of a decision, or stop. Always ask, whatever `write_policy.confirm` says, because the draft is Claude's writing. After an edit or a changed mark, change the draft, write the file again, run the dry run again and ask again. When the PM stops, end the flow, say that it wrote nothing, and name `/pmkit:spec:from-prd <prd>` with the original PRD as the way to start again.

   The approval fixes the content and the path, not the file, so do not write the file here. Stage 3b writes it after the ADRs, so the stored PRD carries the final mark of each decision. The CLI has no `docs update`, so this order is the only way the stored PRD can reflect a declined ADR. Keep the temporary file and the approved path for Stage 3b.
5. **Stage 3: ADRs.** Record each decision marked `ADR` in the refined PRD, except on a resume the ones that already have an ADR, one at a time, in the order of the Decisions section. For each one, follow the procedure of `${CLAUDE_PLUGIN_ROOT}/commands/spec/record-decision.md`, read in full, with the decision, its context and the rejected alternatives taken from the interview. Do not ask the PM again for what the interview already answered. That procedure asks for approval once per ADR, whatever `write_policy.confirm` says, so each ADR has its own approval.
   - Keep the temporary file of the refined PRD. The last step of that procedure removes its own temporary files, never this one, because Stage 3b writes it.
   - The context paragraph of each ADR names the refined PRD path approved in Stage 2, or the stored path on a resume, so a later run can find the PRD from the ADR.
   - The related issues are `none`, because the issues do not exist yet. Skip the issue check of its step 2, and its steps 6 and 8, which comment on and link issues. Stage 6 links them.
   - When the PM declines one ADR, that decision becomes `PRD only` in the draft, and the flow goes on to the next ADR. A declined ADR never stops the flow. On a resume the stored PRD cannot change, because the CLI has no `docs update`, so the output lists the declined decision as `PRD only` and a later resume offers it again.
   - An error from the CLI during the write of an ADR stops the flow, unlike a declined ADR. Before the stop, Stage 3b stores the refined PRD, unless a resume found it stored, with each decision that has no ADR yet still marked `ADR`, so a resume records them. The stop lists what it already wrote, with the error, and names `/pmkit:spec:from-prd specs/<slug>-prd.md` as the way to continue.
   - Keep the list of decisions whose mark changed. Stage 3b and the output report it.
   - When no decision is marked `ADR`, say so in one line and go on to Stage 3b.
6. **Stage 3b: store the refined PRD.** Write the refined PRD after the ADRs, so it carries the final mark of each decision. Change the mark in the temporary file for every ADR the PM declined, and say which marks changed. The content differs from the approved draft only in those marks, so the approval of Stage 2 covers this write and the step asks for no new approval.
   - Run `node "${CLAUDE_PLUGIN_ROOT}/scripts/pmkit.mjs" docs create specs/<slug>-prd.md --body-file <file> --json` with the approved path. A tracker document gets a commit from `auto_commit`.
   - `CONFLICT`: the path appeared since the dry run. Ask for another name and write nothing until the PM answers. Run the dry run again with the new name before the write, and ask again when it answers `CONFLICT` too. The ADRs already written cite the old path, so tell the PM both paths and that those ADRs keep the old one.
   - `NOT_SUPPORTED`: the tracker cannot create documents. Write the repository file `docs/specs/<slug>-prd.md` with the file tools, with the same content. When that file exists, ask for another name, as `CONFLICT` does. Say that the file has no commit yet, so it exists only in this working tree until the PM commits it.
   - Keep the stored path for the next stages. Remove the temporary file with the other temporary files at the end of the flow.
7. **Stage 4: epic and milestones.** Propose the epic and its milestones before any issue. A new epic has a title from the refined PRD, and a start and a target date only when the PRD gives them. The milestones are one per phase of the Phases section, each with an id that follows the id rule of `/pmkit:spec:import` step 3, a name, and a due date when the PRD gives one. Mark each milestone existing or new against the `milestone list` of Stage 0. With no Phases section there is no milestone. With an `epic-id`, show the existing epic from `epic get` and only the new milestones.

   Show the proposal and ask with `AskUserQuestion` whether to create it, edit it, or stop, whatever `write_policy.confirm` says, because it opens a bulk create. After an edit, show it again and ask again. When the PM stops, the flow stops as the rule above the steps says.

   After approval, follow steps 6 and 7 of `${CLAUDE_PLUGIN_ROOT}/commands/spec/import.md`, read in full, for the epic and the new milestones only: the dry runs of the epic and the milestones in step 6, then the writes of step 7 in its order. The dry runs of the issues wait for Stage 5. When a dry run fails, show the error, ask for a corrected value as step 6 says, and ask again when the change alters the proposal. When a write fails, stop as step 7 says, then as the rule above the steps says. Keep the epic ID and the milestone ids for Stage 5.
8. **Stage 5: issue tree.** Draft the issues of every requirement of the refined PRD. Hand the drafting to subagents, one per milestone, or one per group of about 5 requirements when the PRD has no phases. Each drafting subagent gets the refined PRD, its slice of requirements and the `discover` result of Stage 0. It writes nothing, asks nothing, and returns draft rows. Without subagents, the main agent drafts each slice in turn. Each row has:
   - a title, a type from `discover`, a milestone, a parent (the epic or another row), and a description in the template of `${CLAUDE_PLUGIN_ROOT}/commands/issues/create.md`;
   - the acceptance criteria copied from the refined PRD, never new ones. A requirement with no criteria gets none and its row is marked "needs criteria", as `/pmkit:spec:import` step 3 does, with the label only when the tracker has it;
   - an estimate from the scale of `discover`. `issues similar` needs an existing issue ID, so it cannot rate a draft row. The evidence is the code the requirement touches and the completed issues found with `node "${CLAUDE_PLUGIN_ROOT}/scripts/pmkit.mjs" issues list --category done --text '<word>' --json`, once for each of the 2 or 3 most specific words of the row, quoted as in Stage 0. Keep the hits that have an estimate. When there is no such hit, the row says that its estimate rests on the code alone;
   - the rows that block it.

   The main agent merges the drafts, removes the overlaps between slices, and checks that every criterion of every row appears in the refined PRD. With an `epic-id`, run `node "${CLAUDE_PLUGIN_ROOT}/scripts/pmkit.mjs" issues list --parent <epic-id> --json` and drop the rows the epic already holds, as `/pmkit:spec:import` step 2 does. Show the full tree as the table of `/pmkit:spec:import` step 4, with the new milestones above the rows, the total estimate per milestone, and the basis of each estimate. The PM edits, merges, removes or adds rows. Show the tree again after each change.

   Ask with `AskUserQuestion` whether to create the tree, whatever `write_policy.confirm` says, because it is a bulk create, as `/pmkit:spec:import` step 5 says. When the PM stops, the flow stops as the rule above the steps says. After approval, follow steps 6, 8 and 9 of `${CLAUDE_PLUGIN_ROOT}/commands/spec/import.md` with the epic and the milestones of Stage 4: the dry runs of the top-level issues, the creates, parents before their sub-issues, and the blocker links with `issues link`. On a resume that skipped Stage 4, a milestone the tree marks as new is created first, with step 7.2. The approval covers the issues and their links, because the tree showed them. When a write fails, stop as step 8 says, then as the rule above the steps says. Keep the new IDs for Stage 6.
9. **Stage 6: final check.** Check what the flow created against the refined PRD. Hand the check to a checking subagent, given the refined PRD, the epic ID, the new issue IDs and the ADRs of Stage 3. It runs `node "${CLAUDE_PLUGIN_ROOT}/scripts/pmkit.mjs" issues get <id> --json` for each new issue and `node "${CLAUDE_PLUGIN_ROOT}/scripts/pmkit.mjs" issues dependencies <epic-id> --json`, writes nothing, asks nothing, and returns findings. Without subagents, the main agent runs the same checklist. The findings:
   - each requirement of the refined PRD with no issue;
   - each issue with no criteria or no estimate;
   - each blocker link that the text of the issues implies and the tree lacks, and each cycle in `problems`;
   - each ADR not yet linked to the issues it affects.

   The main agent reports the findings and fixes only what the PM approves. Show the extra links together as one bulk preview: run `node "${CLAUDE_PLUGIN_ROOT}/scripts/pmkit.mjs" issues link <blocking id> <blocked id> --kind blocks --dry-run --json` for each, show them all, and ask once with `AskUserQuestion`, whatever `write_policy.confirm` says. After approval, run each without `--dry-run`. Link each ADR to its issues with step 6 of `${CLAUDE_PLUGIN_ROOT}/commands/spec/record-decision.md`, which shows its own preview and asks its own question. A requirement with no issue goes back to the PM as a question, never as an issue created without approval. When the PM wants an issue for it, draft the row as Stage 5 does, show it and ask before the create. For a cycle, offer `/pmkit:local:doctor`. An issue with no criteria stays on the "needs criteria" list of the output. When the check finds nothing, say so in one line and ask nothing.

## Confirmation points

- Stage 0: whether to go on, use an existing epic, or stop, when the brief lists likely duplicates. It writes nothing.
- Resume: whether the epic whose title matches the stored refined PRD is the epic of this PRD.
- Stage 2: the refined PRD, its content and its path, always asked because the draft is Claude's writing. It covers the write of Stage 3b. Declining writes nothing.
- Stage 3: each ADR, one approval per ADR, through step 5 of `record-decision.md`. `write_policy.confirm: none` does not skip it. Declining one turns its decision into `PRD only` and the flow goes on.
- Stage 4: the epic with its milestones, always asked, and a corrected value after a failed dry run. With an `epic-id`, only the new milestones.
- Stage 5: the full issue tree with estimates and blocker links, always asked because it is a bulk create. It covers the issues and the links.
- Stage 6: the extra links of the final check, as one bulk preview, always asked, only when the check finds missing links. The ADR links ask through step 6 of `record-decision.md`. The row of a requirement with no issue, when the PM wants an issue for it, asks before the create.

## Output

The refined PRD path, and whether it has a commit: a tracker document gets one from `auto_commit`, and the repository file `docs/specs/<slug>-prd.md` has no commit yet, so it exists only in this working tree until the PM commits it. When Stage 3b took a new name, both paths and the ADRs that cite the old one. The ADR numbers, titles and paths, then the decisions that changed mark in Stage 3, now `PRD only`. The epic ID and the ids of the milestones it created. The created tree with full IDs and the totals per milestone (issues and estimate), as `/pmkit:spec:import` shows it. The findings of Stage 6 and what was fixed. The open questions of the refined PRD, and the issues that still need criteria, labeled or not. The critical path from `issues dependencies` of Stage 6, run again when Stage 6 added links, shown as `/pmkit:issues:dependencies` step 2 shows it. Then remove the temporary files, and end with `/pmkit:cycle:plan` as the next step.

When the flow stopped early, the output is the stop of the rule above the steps: what it already wrote and the command that continues.

## If something is missing

- No PRD and no pasted text: ask for one.
- A path that neither `docs read`, the repository file `docs/<path>` nor the local file finds: ask for a corrected path.
- An `epic-id` that does not exist (`NOT_FOUND`): the main agent asks for a corrected ID before the first question.
- A PRD too thin to name a requirement: the interview starts from the problem and the users, and asks for the first requirement.
- `NOT_SUPPORTED` from `docs create`: the refined PRD goes to the repository file `docs/specs/<slug>-prd.md`, and each ADR goes where `record-decision.md` says.
- `NOT_CONFIGURED`, or no `.pmkit/config.yaml`: offer `/pmkit:setup`.
- An error from the CLI: apply the rules for reading errors in the conventions, then stop as the rule above the steps says, except where a stage says otherwise.
