---
description: Delegate an issue to an agent. Hand it to agent:<name>, post the instructions, and run the agent locally only when you say so
argument-hint: "<id> [agent] [instructions]"
disable-model-invocation: true
---

# Delegate an issue to an agent

Arguments: `$ARGUMENTS`

## Parameters

- `id` (required): the issue ID, for example `ISS-7K3Q`.
- `agent` (optional): an agent member ID such as `agent:claude`, or the agent's name. When it is empty and the project has one agent member, the command proposes that one.
- `instructions` (optional): what the agent should do, in the user's words. The command adds the acceptance criteria and what the comments say.

## Steps

Read `${CLAUDE_PLUGIN_ROOT}/skills/pmkit/references/conventions.md` first.

1. Run `node "${CLAUDE_PLUGIN_ROOT}/scripts/pmkit.mjs" capabilities --json` and read the `agent_delegation` entry. When its path is `absent`, show its `enableHint` and stop. When the entry has `detail.run: local`, say in one line that this tracker does not run agents itself, so the agent runs locally. When it has `detail.run: native` (Linear), say in one line that the tracker starts the agent itself: the person stays the assignee and the agent becomes the issue's delegate.
2. Run `node "${CLAUDE_PLUGIN_ROOT}/scripts/pmkit.mjs" discover --json` and keep the agents: the members whose ID starts with `agent:`, and the entries of `agents` when the result has that list (Linear, where an agent ID is `agent:<Linear user id>` and its name is the app's name). Resolve `agent` to one of them. When no member is an agent, stop and say that `/pmkit:setup` can add one, such as `agent:claude`. When the name matches more than one agent, or none exactly, show the agent members and ask with `AskUserQuestion` which one the user means. When the user declines to choose, stop and change nothing.
3. Run `node "${CLAUDE_PLUGIN_ROOT}/scripts/pmkit.mjs" issues get <id> --comments --json`. List every readiness problem: the issue is `done` or `canceled`, it is blocked by an issue not in `done` or `canceled`, it has no acceptance criteria, or a person other than the user is its assignee, so the delegation takes it from them. With `detail.run: native` the assignee stays, so the problem is a `delegate` that is another agent instead. When it already has this agent (as assignee or delegate), say that the delegation posts new instructions and changes nothing else. When there is a problem, ask with `AskUserQuestion` whether to continue. When the user declines, stop and change nothing.
4. Draft the instructions in a few short lines: what to do, taken from the user's text and the comments, what done means, taken from the acceptance criteria, and any limit the user named, such as files not to touch. Write them to a temporary file outside `.issues/`.
5. Run `node "${CLAUDE_PLUGIN_ROOT}/scripts/pmkit.mjs" issues delegate <id> <agent> --instructions-file <file> --dry-run --json`. Show the assignee (local run) or the `delegate` (native run) `before` and `after`, and the full `comment.body`. Ask once with `AskUserQuestion` whether to delegate. This question is always asked, even with `write_policy.confirm: none`, because the write hands the issue to an agent. When the user declines, stop and change nothing.
6. When the user approves, run `node "${CLAUDE_PLUGIN_ROOT}/scripts/pmkit.mjs" issues delegate <id> <agent> --instructions-file <file> --json`. The issue now has the agent as its assignee (local run) or its delegate (native run), and the comment records the delegation. On Linear the comment is posted before the delegate is set, so the agent reads the instructions when Linear starts it. When the CLI answers that the comment was posted but the delegate failed, show `error.message` and `error.nextStep`, say what changed (`error.details.written`) and what is missing (`error.details.missing`), and stop.
7. Run the agent. When `run` in the result is `native`, the tracker hands the work to the agent itself: say so and skip this step. When `run` is `local`, the command never starts the agent by itself. Ask with `AskUserQuestion` whether to run it now in this session or later; this question is always asked. Now: follow `${CLAUDE_PLUGIN_ROOT}/commands/issues/work.md` for `<id> --as <agent>`. Its `--as` parameter adds `--as <agent>` to every pmkit write and treats the agent as the user in its assignment checks, so the tracker events (claim, status moves, comments) are recorded as the agent's. Say that `--as` changes only the actor of those events: commits and the pull request keep the user's git and GitHub identity. Every question of that command stays: the plan, the branch, the PR and each tracker write. Later: show the steps from the comment's "Run it locally" section and stop.
8. Remove the temporary file.

## Confirmation points

- Step 2: the agent, when the name matches more than one or none. This is a choice, not a confirmation.
- Step 3: continue despite a readiness problem.
- Step 5: the delegation. It is always asked, whatever `write_policy.confirm` says.
- Step 7: running the agent now or later. It is always asked. Nothing starts without it, and the work command asks at each of its own points.

## Output

The issue line with its full ID and its new assignee or delegate, the ID of the delegation comment, and how the agent runs: in the tracker (native), in this session now, or the steps to run it later. End with `/pmkit:issues:summary <id>` to read what the agent did.

## If something is missing

- No ID: ask for it.
- No agent member: say that the project has none and offer `/pmkit:setup` to add one, such as `agent:claude`.
- The CLI answers `INVALID_INPUT` because the ID is not an agent member: show `error.message` and the agent members in `error.nextStep`, and ask which one to use.
- The CLI answers `NOT_SUPPORTED`: show `error.message`. On Linear, it means the workspace has no app agent; `error.nextStep` says how to install one.
- An error from the CLI: apply the rules for reading errors in the conventions.
