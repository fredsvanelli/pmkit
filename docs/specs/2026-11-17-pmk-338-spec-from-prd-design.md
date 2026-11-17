# Design: `/pmkit:spec:from-prd`, from a one-page PRD to a linked backlog

Issue PMK-338, epic EPC-6 (Remaining generic commands). Status: approved by the user on 2026-11-17. The builder check ran on 2026-11-17; its three questions are answered below. Calls marked **(builder's call)** were made while writing this spec.

## Problem

A PM with a one-page PRD has no single pmkit command that turns it into a backlog. Today the path is an external interview (the `grilling` or `brainstorming` skills, which pmkit does not ship), then `/pmkit:spec:record-decision` once per decision, then `/pmkit:spec:import`, then `/pmkit:issues:update`, `/pmkit:issues:breakdown` and `/pmkit:issues:link` to fill the gaps. `spec:import` does not invent acceptance criteria: a requirement the PRD leaves vague comes out marked "needs criteria", so a vague PRD produces a tree of half-written issues. The user has to know the sequence, and steps get skipped.

## Intent

One command, `/pmkit:spec:from-prd`, runs the whole sequence: a product interview built into pmkit, the ADRs for the decisions that are hard to reverse, the epic and its issues with estimates and full text, and the blocker links. Subagents do the reading, drafting and checking, so every step finishes and a final check proves it.

## Users

Mostly a PM with a one-page PRD. The interview pulls out scope, use cases and acceptance criteria. It never asks about technology, architecture or storage.

## Goals

- An interview that starts from what the PRD says and asks only what is missing, in three areas:
  - scope: what is in and what is out of the first version;
  - use cases: who does what, including the error and edge cases the PRD leaves out;
  - acceptance criteria: each one a result a person can check without reading the code.
- A refined PRD stored in the tracker's `docs/` folder.
- One ADR per product decision that is hard to reverse, such as the billing model, a limit, or what stays out of v1. Every other decision stays only in the refined PRD.
- An epic, milestones when the PRD has phases, and issues with sub-issues. Every issue has a description in the template of `/pmkit:issues:create`, acceptance criteria and an estimate from the tracker's scale.
- Blocker links between the issues.
- A final check that every requirement of the refined PRD maps to at least one issue, and that every issue has criteria, an estimate and its links.

## Non-goals

- Technical design. The issues name areas of the product, as `/pmkit:issues:create` step 5 already requires, never files or functions.
- Sprint planning or assignment. The output offers `/pmkit:cycle:plan` and `/pmkit:issues:assign`.
- A dependency on the `grilling`, `brainstorming` or any other skill outside pmkit.
- A CLI change. The command uses only CLI commands that exist today.

## Anti-goals

The work fails, even if every file gets written, when:

- the interview asks the PM a technical question, or asks something the PRD or the code already answers;
- an issue gets acceptance criteria the PM never saw or approved;
- the flow stops halfway and the PM cannot tell what was written and how to continue.

## Constraints

- ADR 0002: the behavior lives in one Markdown command, `commands/spec/from-prd.md`, and every write goes through `node "${CLAUDE_PLUGIN_ROOT}/scripts/pmkit.mjs"`. The packaging step turns commands into skills for Codex and OpenCode, so the command must work without subagents.
- ADR 0003: no dependencies. Tests use `node:test`.
- A subagent cannot ask the user a question. The interview and every approval run in the main agent.
- The CLI has `docs create` and no `docs update`, so the refined PRD is written once, after its approval.
- `scripts/plugin.test.mjs` requires the frontmatter keys, the six sections in order, a row in the routing table of `skills/pmkit/SKILL.md` and a line in the README.

## Approaches

1. **A command that runs the existing procedures (picked).** The interview is new and lives in `from-prd.md`. The ADR and import steps follow `commands/spec/record-decision.md` and `commands/spec/import.md`, so their validation, dry runs and confirmations stay in one place. Subagents run the reading, drafting, estimating and the final check; without subagents the same agent runs them in sequence. No CLI change.
2. **A command that copies every step.** It would not depend on the other commands, but three copies of the same procedure would drift apart. ADR 0002 rejects this.
3. **Approach 1 plus a session state in the CLI.** A `spec session` command would store the step the flow reached, so it could resume. It needs CLI and test changes. Every step already leaves a visible record (the refined PRD, the ADRs, the epic), so the command can find where it stopped by reading the tracker.

The user picked approach 1 on 2026-11-17. Approach 3 can come later without breaking it.

## Decisions made with the user

- The name is `/pmkit:spec:from-prd`.
- The interview targets a PM with a one-page PRD and covers scope, use cases and acceptance criteria, with no technical questions.
- Every stage has its own approval (option 2 of the conversation): the refined PRD, each ADR, the epic and milestones, the issue tree, and the extra links of the final check.
- An ADR records only a product decision that is hard to reverse: the billing model, limits, what stays out of v1. The rest stays in the refined PRD.
- A declined ADR turns its decision into `PRD only` and the flow goes on. The refined PRD is stored after the ADRs, so it carries the final marks and a resume never offers a declined ADR again (decided on 2026-11-17).

## The flow

`argument-hint: "<prd file or pasted text> [epic-id]"`. The input is read the way `spec:import` step 1 reads it: a path under the tracker's `docs/`, any local file, or pasted text.

### Stage 0: recon (subagent)

A recon subagent reads, and writes nothing:

- the PRD;
- the README and `CONTEXT.md` when they exist;
- `discover --json`, `epic list --json`, `milestone list --json`, `docs list --json`;
- `issues list --text <word>` once for each of the 3 most specific words of the PRD, as `issues:create` step 2 does;
- the code areas the PRD touches.

It returns a short brief: what the product already does in that area, the likely duplicate issues and epics, the existing ADRs that bear on the PRD, and a list of gaps in the PRD grouped by scope, use cases and criteria. Without subagents, the main agent does the same reading.

When the brief lists likely duplicates, the command shows them as an issue table and asks whether to go on, use an existing epic (it becomes the `epic-id`), or stop. This follows the project rule to warn about duplicates before the questions.

### Stage 1: interview (main agent)

The interview asks one question per message, built on the last answer or on a gap from the brief. Rules:

- Skip any question the PRD, the brief or an earlier answer already answers. Questions about what exists today go to the code, not to the PM.
- Ask in the PM's words. No technical questions. When the answer to a question has nameable choices, offer them with a recommendation; otherwise ask an open question.
- Cover the error and edge cases of each use case, such as an empty state, a limit reached, or a permission missing.
- Play back each area (scope, then use cases, then criteria) in a short summary once it is clear, and ask what is wrong or missing before the next area.
- Mark each decision as it comes up: `ADR` when it is a product decision that is hard to reverse, `PRD only` otherwise.
- Stop when every requirement has its scope and at least one acceptance criterion, not after a fixed number of questions. When the PM says to stop early, the requirements without criteria go into the refined PRD under "Open questions" and the import marks them "needs criteria".

**(builder's call)** A soft limit of about 15 questions. Past it, the command says how many requirements still lack criteria and asks whether to go on or stop.

### Stage 2: refined PRD (approval 1)

The main agent drafts the refined PRD with these sections: Problem, Users, Scope (in), Out of scope, Use cases, Requirements (each with its acceptance criteria), Decisions (each marked `ADR` or `PRD only`), Phases (when any), Open questions. The PM approves it, edits it, or changes the mark of a decision.

The approval fixes the content and the path, not the file. The command runs `docs create specs/<slug>-prd.md --body-file <file> --dry-run --json` to check the path is free and shows it with the draft. The file itself is written in stage 3b, after the ADRs, so it carries the final mark of each decision. The CLI has no `docs update`, so this order is the only way the stored PRD can reflect a declined ADR.

**(builder's call)** The slug comes from the PRD title. When `docs create` answers `CONFLICT`, the command asks for another name; it never overwrites. When it answers `NOT_SUPPORTED` (Linear cannot create documents), the refined PRD goes to the repository file `docs/specs/<slug>-prd.md` with the file tools, the same fallback `record-decision` uses for ADRs, and the output says the file has no commit yet.

### Stage 3: ADRs (one approval per ADR)

For each decision marked `ADR`, the command runs the procedure of `commands/spec/record-decision.md` with the decision text, its context and rejected alternatives from the interview. That procedure already asks once per ADR, whatever `write_policy.confirm` says. Each ADR names the refined PRD path in its context paragraph, so a later run can find it. The related issues are empty here, because the issues do not exist yet; stage 6 links them.

When the PM declines one ADR, that decision becomes `PRD only` in the draft and the flow goes on to the next ADR. A declined ADR never stops the flow. The output lists the decisions that changed mark.

### Stage 3b: store the refined PRD (no new approval)

The command writes the refined PRD with `docs create` at the path approved in stage 2, with the final marks. The content differs from the approved draft only in the marks the PM changed by declining an ADR, so stage 2's approval covers it, and the command says which marks changed. When `docs create` answers `CONFLICT` because the path appeared meanwhile, the command asks for another name and writes nothing until the PM answers; the ADRs already written cite the old path, so the output names both paths.

### Stage 4: epic and milestones (approval 2)

The command proposes the epic (title, start and target dates when the PRD gives them) and the milestones, one per phase, and asks for approval. With an `epic-id`, it shows the existing epic and only the new milestones. After approval it creates them with the dry runs and writes of `spec:import` steps 6 and 7.

### Stage 5: issue tree (approval 3)

Drafting subagents, one per milestone or per group of about 5 requirements **(builder's call)**, each draft for their requirements:

- issues and sub-issues with a title, a type and the description template of `issues:create`;
- the acceptance criteria copied from the refined PRD, never new ones;
- an estimate from the scale of `discover`. `issues similar` needs an existing issue ID, so it cannot rate a draft row. **(builder's call)** The evidence is the code the requirement touches plus completed issues found with `issues list --category done --text <word>` for the 2 or 3 most specific words of the row, keeping the hits that have an estimate. When there is no such hit, the row says the estimate rests on the code alone;
- the issues each one is blocked by.

The main agent merges the drafts, removes overlaps and shows the full tree as the table of `spec:import` step 4, with the total estimate per milestone. The PM edits, merges, removes or adds rows. After approval, the command creates the issues and their blocker links with `spec:import` steps 6, 8 and 9.

### Stage 6: final check (approval 4 when it finds something)

A checking subagent, given the refined PRD, the epic ID, the new issue IDs, the issues the epic already held (the `issues list --parent` result of stage 5) and the ADRs of stage 3 and of the resume, reads every new and held issue with `issues get --json` and `issues dependencies <epic-id> --json` and reports:

- requirements of the refined PRD with no issue;
- issues with no criteria or no estimate;
- missing blocker links it can infer from the text, and any cycle;
- ADRs not yet linked to the issues they affect.

The main agent fixes what it can only with approval: the missing links through `issues link` (shown together as one bulk preview), and the ADR links through `record-decision` step 6. A requirement with no issue goes back to the PM as a question, never as an issue created without approval.

### Output

The refined PRD path, the ADR numbers and titles, the epic ID, the created tree with full IDs and totals per milestone, the critical path from `issues dependencies`, the open questions, and the issues that still need criteria. It offers `/pmkit:cycle:plan` as the next step.

### When the PM declines a stage

A declined ADR is the exception: stage 3 goes on, as above. For any other stage, the flow stops there. It lists what it already wrote and names the command that continues from there: `/pmkit:spec:from-prd specs/<slug>-prd.md` reruns from the stored refined PRD.

### Resuming

When the input is a refined PRD already in `docs/specs/` **(builder's call: recognized by its `-prd.md` name and its Decisions section)**, the command skips stages 1 and 2. It finds the ADRs that cite the PRD path in both places an ADR can live: the tracker's ADRs through `docs list` and `docs read`, and the repository's `docs/adr/` through the file tools **(builder's call)**. It skips the decisions that already have one. It finds an epic whose title matches the PRD and asks whether it is the one; when it is, stage 4 is skipped and stage 5 does not repeat the issues the epic already holds, as `spec:import` step 2 does.

## Subagents

| Subagent | Stage | Reads | Writes | Fallback without subagents |
|---|---|---|---|---|
| Recon | 0 | PRD, docs, tracker, code | nothing | the main agent reads in sequence |
| Drafting | 5 | refined PRD, its slice of requirements, `discover`, `issues similar` | nothing; returns rows | the main agent drafts each slice in turn |
| Check | 6 | refined PRD, new issues, `issues dependencies` | nothing; returns findings | the main agent runs the same checklist |

No subagent writes to the tracker. Every write runs in the main agent after an approval, so the confirmations stay where the user can see them.

## Files

- `commands/spec/from-prd.md`: the command, with the six sections the plugin test requires.
- `skills/pmkit/SKILL.md`: a routing row ("turn a vague PRD into a refined spec, ADRs and a linked backlog").
- `README.md`: the command line.
- `CHANGELOG.md`: an entry.
- `docs/runbooks/spec-from-prd.md`: the runbook of the flow.
- `scripts/from-prd-command.test.mjs`: static checks of the command text, in the style of `scripts/estimate-command.test.mjs`. They pin the rules that matter: no technical questions, one question per message, criteria only from the refined PRD, one approval per stage, no write from a subagent, the fallback without subagents, and the stop message with the next command.

## Left to the builder

- The exact wording of the interview rules and of the refined PRD template.
- How the drafting slices are split when the PRD has no phases.
- What the runbook's E2E script can check, given that the flow is a conversation: at least the plugin test, the static checks, and a scenario that stores a refined PRD and imports it on the Local tracker.

## Open questions

None.
