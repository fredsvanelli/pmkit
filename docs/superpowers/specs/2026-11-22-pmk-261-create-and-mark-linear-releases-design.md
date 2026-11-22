# PMK-261: create and mark releases on Linear

## Problem

PMK-246 reads Linear releases and sets an issue's release, but `issues create --release`, `release create` and `release mark-released` answer `NOT_SUPPORTED` on Linear.

## Schema (introspected live, 2026-11-22, on a workspace with releases off)

- `releaseCreate(input: ReleaseCreateInput!)`: `id`, `name!`, `description`, `version`, `commitSha`, `pipelineId!`, `stageId`, `startDate`, `targetDate`, `createdAt`, `startedAt`, `completedAt`. Answers `ReleasePayload { success release }`.
- `releaseUpdate(id: String!, input: ReleaseUpdateInput!)`: `name`, `description`, `version`, `commitSha`, `stageId`, `startDate`, `targetDate`, `startedAt`, `completedAt`, `trashed`.
- `releaseComplete(input: { pipelineId!, version, ... })` completes by pipeline and version, not by release id, so pmkit does not use it.
- `ReleasePipeline.stages` (each with `type`), `Team.releasePipelines`; `IssueCreateInput.releaseIds`.

## Approaches

1. **`releaseCreate` in the scope team's one pipeline, and `releaseUpdate` to the pipeline's completed stage with `completedAt`** (chosen): a release by id, as the Local tracker marks one.
2. `releaseComplete` by pipeline and version: it completes whatever release of the pipeline has that version, which is not the id the user named.

## Design

- `scripts/lib/linear/documents.mjs`: `TEAM_RELEASE_PIPELINES_QUERY` (the team's pipelines with their stages), `RELEASE_CREATE`, `RELEASE_UPDATE`, both answering the list's release fields.
- `scripts/lib/linear/releases.mjs`:
  - `createRelease(input, actor, { dryRun })`: the pmkit id is Linear's `version`, `--name` the name (the id when absent), `--target` the `targetDate`. `--tag` is refused (`INVALID_INPUT`, "Linear releases have no git tag", next step "Drop --tag on Linear"). The scope team must have exactly one pipeline: none is `NOT_SUPPORTED` ("create a release pipeline in Linear"), several are `INVALID_INPUT` naming them (picking one is a follow-up). A release of that pipeline with the same version is `CONFLICT`. The dry run returns the planned record with `id: null`. The write sends a UUID pmkit chose, so an unconfirmed answer is checked with one read.
  - `markReleased(id, actor, { tag, dryRun })`: `--tag` refused the same way; a released release is `CONFLICT` "release <id> was released at <time>", as on Local; otherwise `releaseUpdate` with the pipeline's first `completed` stage and `completedAt` now (`NOT_SUPPORTED` when the pipeline has none). It returns `{ before, after, unfinished, problems }` as Local, `unfinished` from the release's issues not done or canceled.
- `scripts/lib/linear/writes.mjs` / `issue-ops.mjs`: `issues create --release <id>` resolves the release (refused when releases are off) and sends `releaseIds: [id]`; the dry run shows it.
- `scripts/lib/linear/tracker.mjs`: `createRelease` and `markReleased` run when releases are on; when they are off, the existing refusal with the manifest's hint answers (acceptance criterion 4). `manifest.mjs`: releases on has no `unsupported` list.
- The fake: the team's pipelines with stages, `releaseCreate`, `releaseUpdate`, and `releaseIds` on create.
- CHANGELOG, `API-VERIFICATION.md` (the schema above), README.

## Interview

- Several pipelines per team: refused, not guessed; a `--pipeline` flag is a follow-up ticket.
- Live check: the workspace has releases off (Free plan); skipped (coordinator decision for EPC-5). The schema above was read live.
- New terms or ADRs: none.
- Approval: no product question beyond the acceptance criteria. pmkit PO approves.
