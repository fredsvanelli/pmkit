# PMK-356: verify Linear projectUpdate with statusId against a live workspace

## Problem

PMK-353 moves a Linear epic with `projectUpdate(id, input: { statusId })` (`PROJECT_SET_STATUS` in `scripts/lib/linear/projects.mjs`). That mutation has only run against `scripts/fake-linear-api.mjs`. The live contract run (`scripts/lib/linear/contract-live.mjs`) leaves out the `deliverable-writes` family, because the sandbox's write guard has no `projectUpdate` rule. `scripts/lib/linear/API-VERIFICATION.md` records `statusId` on `ProjectCreateInput` only.

## Approaches

1. **A guard rule for `projectUpdate` that takes only a project the run created and only the `statusId` input key, then `deliverable-writes` in the live families and a live run** (chosen). This is the same shape as every other rule: ownership by id, and an input key list.
2. Let the live run send `projectUpdate` on any project of the test team. Wider than needed: the run creates every project it moves, so ownership is the tighter rule, and it is what the issue asks.

## Design

- `scripts/lib/linear/sandbox.mjs`:
  - `SUITE_INPUT_KEYS.projectUpdate = ['statusId']`, so a rename, a content change or a team move is refused before it leaves the process.
  - `SUITE_RULES.projectUpdate`: `rules.owns(ctx, 'project', variables.id, 'project')`, then `statusId` must be a string.
  - The suite allowlist grows from 15 to 16 mutations. The stop-signal rule is unchanged: after a stop, only deletes pass.
- `scripts/lib/linear/contract-live.mjs`: `deliverable-writes` joins `LINEAR_FAMILIES`, and the comment drops the reason it stayed out. `scripts/contract-suite.mjs` loses the same reason in its comment.
- `scripts/lib/linear/API-VERIFICATION.md` gains the introspection result: `__type(ProjectUpdateInput)` has `statusId: String`, `Mutation.projectUpdate(id: String!, input: ProjectUpdateInput!)`. It also records the live run of the epic move. The allowlist paragraph names `projectUpdate`.
- Tests (`scripts/lib/linear/sandbox.test.mjs`):
  - The guard passes `projectUpdate` on a project the run created, with `{ statusId }`.
  - It refuses a project the run did not create, an input with `name`, and a `statusId` that is not a string.
  - The allowlist count is 16.

## The live run

- The key is read at run time from the file the owner named. It is never printed, logged or committed. `PMKIT_LIVE_WORKSPACE` is the organization's URL key, read at run time from `viewer.organization` and kept only in the scratchpad. The repository is public, so no file, commit or comment holds it.
- The workspace already has the sandbox team `pmkit-test` (key `PKT`, with the marker, not archived, cycles and triage on), and no other team uses `PKT`. That was checked read-only before any write. The run writes only through the guard, which pins every mutation to that team and to the items the run creates.
- The PR records the result (pass and fail counts, and the epic move test), without the workspace name.

## Interview

- Is a live write allowed? The owner chose to run it with this key, and only on a sandbox team. The team exists and passes the sandbox's checks, so nothing outside it is written.
- `statusId` from the workspace's project statuses: those belong to the workspace, not the run, so the rule checks only that it is a string. A wrong id is Linear's refusal (`UPSTREAM`), not a write outside the sandbox.
- New terms or ADRs: none.
- Approval: there is no product question.
