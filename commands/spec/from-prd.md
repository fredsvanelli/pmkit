---
description: Turn a one-page PRD into a refined PRD, ADRs for the decisions that are hard to reverse, an epic with estimated issues, and blocker links
argument-hint: "<prd file or pasted text> [epic-id]"
disable-model-invocation: true
---

# Spec from a PRD

Arguments: `$ARGUMENTS`

## Parameters

- `prd` (required): the one-page PRD. A path under the tracker's `docs/` folder (read with `docs read`), any other local file, or pasted text.
- `epic-id` (optional): an existing epic (`EPC-` by default) to add the issues to. Without it, the flow proposes a new epic.

## Steps

Read `${CLAUDE_PLUGIN_ROOT}/skills/pmkit/references/conventions.md` first.

The flow runs in stages, and each stage that writes has its own approval. Stages 0 to 2 write nothing to the tracker. Subagents, when the agent has them, do the reading. No subagent writes to the tracker or asks the PM anything. Every question and every write runs in the main agent.

1. **Stage 0: recon.** Learn what the PRD says and what exists before asking anything. Hand the reading to a recon subagent. It reads, writes nothing and asks nothing, and returns a brief. Without subagents, the main agent does the same reading in sequence. The reading covers:
   - The PRD, read the way `/pmkit:spec:import` step 1 reads it. For a path under `.issues/docs/`, run `node "${CLAUDE_PLUGIN_ROOT}/scripts/pmkit.mjs" docs read <path> --json` (the path is relative to the `docs/` folder) and use `body`. For any other local file, read it with the Read tool. For pasted text, use it as given. When `docs read` answers `NOT_FOUND`, try the path as a local file.
   - The README and `CONTEXT.md`, when they exist.
   - `node "${CLAUDE_PLUGIN_ROOT}/scripts/pmkit.mjs" discover --json`, `node "${CLAUDE_PLUGIN_ROOT}/scripts/pmkit.mjs" epic list --json`, `node "${CLAUDE_PLUGIN_ROOT}/scripts/pmkit.mjs" milestone list --json` and `node "${CLAUDE_PLUGIN_ROOT}/scripts/pmkit.mjs" docs list --json`.
   - `node "${CLAUDE_PLUGIN_ROOT}/scripts/pmkit.mjs" issues list --text '<word>' --json` once for each of the 3 most specific words of the PRD. The CLI matches `--text` as one phrase, so pass a single word each time. The word comes from the PRD, so put it between single quotes and write each `'` in it as `'\''`, as the conventions say for text from data.
   - When an `epic-id` was given, `node "${CLAUDE_PLUGIN_ROOT}/scripts/pmkit.mjs" epic get <epic-id> --json`. When it answers `NOT_FOUND`, the main agent asks for a corrected ID before the first question.
   - The code areas the PRD touches, to learn what the product does there today.

   The brief is short. It says what the product already does in that area, lists the likely duplicate issues and epics, names the existing ADRs that bear on the PRD, and lists the gaps of the PRD grouped by scope, use cases and acceptance criteria.

   When the brief lists likely duplicates, show them before the first question of the interview. Show the issues as an issue table and the epics with their ID and title. Ask with `AskUserQuestion` whether to go on, use an existing epic, or stop. An existing epic becomes the `epic-id`. When the PM stops, end the flow and say that it wrote nothing. When the brief lists no duplicates, say so in one line and go on.
2. **Stage 1: interview.** The main agent runs the interview, because a subagent cannot ask the user a question. The PM knows the product, not the code, so the interview never asks about technology, architecture or storage. Ask one question per message, built on the last answer or on a gap from the brief, and wait for the answer before the next one. Rules:
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
3. **Stage 2: refined PRD.** Draft the refined PRD from the PRD, the brief and the PM's answers, in the language of the PRD. It has these sections, in this order: Problem, Users, Scope (in), Out of scope, Use cases, Requirements (each with its acceptance criteria), Decisions (each marked `ADR` or `PRD only`), Phases (only when the PRD has phases), Open questions. A requirement with no criteria also appears under Open questions, marked "needs criteria".

   Take the slug from the PRD title: lowercase words joined by `-`, with only letters, digits and `-`. Write the draft to a temporary file outside `.issues/` with the file tool, as the conventions say for files with text from data. Run `node "${CLAUDE_PLUGIN_ROOT}/scripts/pmkit.mjs" docs create specs/<slug>-prd.md --body-file <file> --dry-run --json` to check that the path is free. The dry run writes nothing.
   - `CONFLICT`: the path exists. Ask for another name and run the dry run again. Never overwrite.
   - `NOT_SUPPORTED`: the tracker cannot create documents (Linear). The refined PRD goes to the repository file `docs/specs/<slug>-prd.md` instead. Check with the file tools that the file does not exist yet, and ask for another name when it does.

   Show the full draft and the path. Ask with `AskUserQuestion` whether to approve it, edit it, change the mark of a decision, or stop. Always ask, whatever `write_policy.confirm` says, because the draft is Claude's writing. After an edit or a changed mark, change the draft, write the file again, run the dry run again and ask again. When the PM stops, end the flow, say that it wrote nothing, and name `/pmkit:spec:from-prd <prd>` with the original PRD as the way to start again.

   The approval fixes the content and the path, not the file, so do not write the file here. Stage 3b writes it after the ADRs, so the stored PRD carries the final mark of each decision. The CLI has no `docs update`, so this order is the only way the stored PRD can reflect a declined ADR. Keep the temporary file and the approved path for Stage 3b.
4. **Stage 3: ADRs.** Record each decision marked `ADR` in the refined PRD, one at a time, in the order of the Decisions section. For each one, follow the procedure of `${CLAUDE_PLUGIN_ROOT}/commands/spec/record-decision.md`, read in full, with the decision, its context and the rejected alternatives taken from the interview. Do not ask the PM again for what the interview already answered. That procedure asks for approval once per ADR, whatever `write_policy.confirm` says, so each ADR has its own approval.
   - The context paragraph of each ADR names the refined PRD path approved in Stage 2, so a later run can find the PRD from the ADR.
   - The related issues are `none`, because the issues do not exist yet. Skip the issue check of its step 2, and its steps 6 and 8, which comment on and link issues. Stage 6 links them.
   - When the PM declines one ADR, that decision becomes `PRD only` in the draft, and the flow goes on to the next ADR. A declined ADR never stops the flow.
   - Keep the list of decisions whose mark changed. Stage 3b and the output report it.
   - When no decision is marked `ADR`, say so in one line and go on to Stage 3b.
5. **Stage 3b: store the refined PRD.** Write the refined PRD after the ADRs, so it carries the final mark of each decision. Change the mark in the temporary file for every ADR the PM declined, and say which marks changed. The content differs from the approved draft only in those marks, so the approval of Stage 2 covers this write and the step asks for no new approval.
   - Run `node "${CLAUDE_PLUGIN_ROOT}/scripts/pmkit.mjs" docs create specs/<slug>-prd.md --body-file <file> --json` with the approved path. A tracker document gets a commit from `auto_commit`.
   - `CONFLICT`: the path appeared since the dry run. Ask for another name and write nothing until the PM answers. The ADRs already written cite the old path, so tell the PM both paths and that those ADRs keep the old one.
   - `NOT_SUPPORTED`: the tracker cannot create documents. Write the repository file `docs/specs/<slug>-prd.md` with the file tools, with the same content. When that file exists, ask for another name, as `CONFLICT` does. Say that the file has no commit yet, so it exists only in this working tree until the PM commits it.
   - Keep the stored path for the next stages. Remove the temporary file with the other temporary files at the end of the flow.

## Confirmation points

None yet.

## Output

None yet.

## If something is missing

None yet.
