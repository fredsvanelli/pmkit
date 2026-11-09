# PMK-214: improve delegate

Size: a project. Sources: PMK-214 (issue), PMK-57 (delegate, `2026-10-30-pmk-57-delegate-to-agent-design.md`), PMK-58 (track-agents), ADR-0005, Linear's public GraphQL schema (`packages/sdk/src/schema.graphql` in `linear/linear`, read on 2026-11-09).

## Intent

PMK-57 shipped `issues delegate` for the Local tracker only. Its reviewers left five improvements: delegate natively on Linear, show a real delegation in the goldens, make the write atomic, let `/pmkit:issues:work` run a delegated issue as the agent without the "assigned to someone else" question, and stop the contract suite from requiring `run === 'local'`.

## Acceptance criteria

1. Native delegation on Linear, through its `delegate` field for installed app agents.
2. An agent member in the `team` fixture, so the goldens show a real delegation.
3. Make `delegate` atomic.
4. Teach `/pmkit:issues:work` about delegated issues, so the agent run skips the "assigned to someone else" question.
5. The contract suite accepts an adapter with native delegation.

## Facts checked

- Linear's schema has `Issue.delegate: User` ("The agent user that is delegated to work on this issue"), `IssueUpdateInput.delegateId: String` ("The identifier of the agent user to delegate the issue to") and `User.app: Boolean!`. No live call was made: there is no key in this environment.
- ADR-0005: a personal key can delegate an issue to an agent the workspace installed.
- PMK-57: Linear refuses app users as assignees, so on Linear the human assignee stays and the agent goes in `delegate`.

## Decisions

These are my calls, made without a live user (the Orca brief says to pick and go on).

1. **Agent ids on Linear are `agent:<Linear user id>`.** A Linear user id is a lowercase UUID, so it matches `AGENT_ID` (`agent:[a-z0-9-]+`) and stays stable when the agent is renamed. A name slug would collide and break on rename. Discovery's `agents` list on Linear returns these ids, so `/pmkit:issues:delegate` finds the agents of both trackers the same way.
2. **The issue model gains `delegate` on Linear only.** `toIssue` sets `issue.delegate = 'agent:<id>'` when `node.delegate` is set; the issue fragment reads `delegate { id }`. On Local the agent stays the assignee, as PMK-57 decided, and no `delegate` field appears.
3. **Linear `delegate(id, agent, instructions, actor, { dryRun })`.** The checks run before any write: the actor is the key owner (ADR-0005), the agent has the `agent:` shape and names an app user of the workspace (one discovery refresh before refusing), and the issue exists. A workspace with no app user answers `NOT_SUPPORTED` with the manifest's hint. Then two mutations, in this order: the delegation comment (`commentCreate`), then `issueUpdate { delegateId }`. The comment goes first because Linear starts the agent's session when the delegate is set, and the agent should see the instructions. When the issue already has this delegate, only the comment is posted. Result: `{ before, after, comment, run: 'native' }`. The dry run returns the same shape and sends no mutation.
4. **Atomic, per tracker.**
   - Local: one write. The comment file is written first, then `issue.md` and one append of both events (`assign`, `comment`) with the same timestamp. When the issue write fails, the comment file is removed, so the issue is either delegated with its record or untouched. When the agent is already the assignee, only the comment is written, as today.
   - Linear has no transaction. Everything that can be checked is checked before the first mutation. When the comment is posted and the delegate update then fails, the error says so: `error.message` names the posted comment and the failed delegate, `error.details` has `written: ['comment <id>']` and `missing: ['delegate']`, and the next step is to delegate again (the newest record wins) or to set the delegate in Linear. Tested.
5. **The delegation comment names how the agent runs.** The first line is `Delegated to <agent> by <actor>, to run locally.` or `Delegated to <agent> by <actor>, to run in the tracker.` `parseDelegation` returns `run: 'local'` or `run: 'native'`. The native comment has the instructions and no "Run it locally" section.
6. **The local run passes the agent to the work command.** The comment, `localRunLine` and `/pmkit:issues:delegate` step 7 say `/pmkit:issues:work <id> --as <agent>`. `/pmkit:issues:work` gains an optional `--as <agent>` parameter: the session runs the issue as that agent member. Then step 3 treats the agent as the user (an issue assigned to that agent is not "assigned to someone else"; one assigned to anyone else is), step 5 claims for the agent, and every pmkit write carries `--as <agent>`. Without `--as`, an issue whose assignee is an `agent:` member, or that has a `delegate`, is a readiness problem that names the agent, so a person does not take work an agent may be doing without being asked.
7. **Linear capability.** `agent_delegation` is `native` when the workspace has at least one app user, with `detail: { workspace: 'conditional', run: 'native', agents: [names], unsupported: ['issues track-agents'] }`. With no app user it is `absent`, with the hint `Install an agent in this Linear workspace to delegate issues to it`. `delegate` leaves `STUB_CAPABILITY`. `issues track-agents` finds agent issues by an `agent:` assignee, which a Linear issue never has, so on Linear it would wrongly report no agent work. It refuses with `NOT_SUPPORTED` when the entry lists it under `unsupported`; teaching it to read `delegate` is a follow-up.
8. **Contract suite.** The `agents` family accepts `run` of `local` or `native`. The agent is read from `assignee` for a local run and from `delegate` for a native run. The Linear contract run over the fake adds the `agents` family with `agent: 'agent:user-4'`.
9. **Fixture.** The `team` fixture gets `agent:claude: { name: Claude, availability: 1 }`. The `issues delegate` golden of that fixture then records a real delegation; the delegate scenario no longer adds the member in its setup.

## Non-goals

- `issues track-agents` on Linear (follow-up).
- Filtering Linear app users by `isAssignable`. Linear refuses a delegate it does not accept, and the error is shown as it is (follow-up).
- Undoing the comment on Linear when the delegate update fails. A delete can fail too; the error lists what changed instead.

## Anti-goals

- A delegation that writes the assignee without the record, or the other way around, without saying so.
- A Linear delegation that sends a mutation before every check passed.

## Tests

- `scripts/lib/delegation.test.mjs` or the existing delegation tests: the native comment and `parseDelegation` for both lines.
- `scripts/lib/local/tracker.test.mjs` or `scripts/cli-delegate.test.mjs`: a blocked comments directory makes delegate fail with the issue unassigned and no new event; one change writes both events with one timestamp.
- `scripts/lib/linear/tracker.test.mjs`: delegate over the fake (comment then update, `run: 'native'`, the dry run sends nothing, a human or an unknown id is refused before any mutation, no app user answers `NOT_SUPPORTED`, the partial failure error).
- `scripts/lib/linear/contract.test.mjs`: the `agents` family over the fake.
- `scripts/lib/linear/manifest.test.mjs`: both Linear entries. A track-agents test for the refusal.
- Goldens and the delegate scenario regenerate with `UPDATE_GOLDENS=1` and are read before commit.
