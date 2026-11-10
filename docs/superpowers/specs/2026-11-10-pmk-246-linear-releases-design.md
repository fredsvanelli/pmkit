# PMK-246: map Linear releases

## Intent

PMK-226 left the Linear release out of `issues bulk` because the Linear adapter maps no releases. `release list` comes back empty or as a stub, `--release` answers `NOT_SUPPORTED`, and teams on a Linear plan with releases cannot set or read them through pmkit. This issue maps them: list the releases, read and write the release of an issue, and use the release in a bulk change.

## Sources

- Issue PMK-246, its criteria and the two decisions in its comments (PMK-246-1 and PMK-246-2).
- Linear's public SDK schema (`packages/sdk/src/schema.graphql` in `linear/linear`, read 2026-11-10): `Release`, `ReleasePipeline`, `ReleaseStage` (`type`: `planned`, `started`, `completed`, `canceled`), `Issue.releases` (a connection), `IssueUpdateInput.addedReleaseIds` and `removedReleaseIds`, `IssueFilter.releases` (`ReleaseCollectionFilter` with `some`), `ReleaseFilter.pipeline.teams`, and the queries `releases(filter, first, after)` and `release(id)`.
- `scripts/lib/linear/API-VERIFICATION.md`, "Releases": the types exist, a Free workspace answers `releases(first: 1)` with an empty list, and `Organization.releasesEnabled` is the flag.
- PMK-40 answer 1: release reads on a workspace without releases answer empty with `note: releases is absent: <hint>`.

## Goals

1. `release list` on a workspace with releases lists them (criterion 1).
2. `issues get` on a Linear issue shows its release (criterion 2).
3. `issues update --release` and `issues bulk release` set the release of Linear issues (criterion 3).
4. With releases off, the release writes and the release filter refuse with a message that says releases are off (criterion 4).
5. The mapping is recorded next to the adapter, with what still needs a real workspace (criterion 5 stays open until that check runs).
6. Added by decision PMK-246-2: the `release` filter (`issues list --release`, `searchIssues`) and `release issues` work on Linear, so `release-readiness` and `release-notes` by release do not break once `release list` answers.

## Non-goals

- `release create`, `release mark-released` and `issues create --release` on Linear. They stay `NOT_SUPPORTED` (follow-ups).
- Keeping releases in a migration to or from Linear.
- One release per pipeline (option B of PMK-246-1). Follow-up if teams with several pipelines ask for it.
- Mapping the Linear `version` to a git `tag`.

## Anti-goals

- An issue never leaves a Linear release without the user seeing it in the preview.
- A state pmkit cannot express (an issue in two releases) never turns into "no release".
- A workspace without releases sends no release query, so a Free workspace pays no new request and meets no unverified field.

## The mapping

### A release

| pmkit | Linear |
|---|---|
| `id` | `Release.id` (the UUID), as milestones use theirs |
| `name` | `name` |
| `target` | `targetDate`, when set |
| `released` | `completedAt`, when set |
| `state` | `released` when `completedAt` is set, else `planned` |
| `description` | `description`, or `''` |
| `tag` | not set |

A release whose stage type is `canceled` is outside pmkit: `release list` leaves it out, `release get` answers `NOT_FOUND` ("release <id> was canceled in Linear"), an issue's canceled releases do not count as its release, and a write to one refuses.

`release list` reads `releases(filter: { pipeline: { teams: { some: { key: { eq: <scope team> } } } } })` page by page, so it lists only the releases of pipelines linked to the scope team. `--state` filters on the result. The order is by `compareReleaseIds` of the version (or the name when there is no version), then the id.

### The release of an issue (decision PMK-246-1, option A)

`Issue.releases` is a list. `issues get` reads it with one more query (`issue(id) { releases }`) only when the workspace has releases on.

- Exactly one release that is not canceled: `release` is its id.
- Two or more: `releases` is the sorted list of ids, a Linear-only key like `delegate`, and `release` is absent.
- None: neither key.

`issues list` does not read releases per issue (one more request per issue). The filter covers the list case.

### Writing the release

`issues update --release X` and `issues bulk release X` read the issue's releases first.

- Two or more releases that are not canceled: refuse `INVALID_INPUT` "the issue is in N Linear releases, and pmkit sets one release per issue", next step "Change the releases of the issue in Linear". The words do not name the issue, so `issues bulk` shows the same message on every issue it refuses.
- Otherwise the input is `addedReleaseIds: [X]` and `removedReleaseIds: [the current one]` (when there is one and it is not X). `none` sends only `removedReleaseIds`. When nothing changes, no mutation is sent.
- X must be a release that exists and is not canceled. It is read once per run, so a bulk change reads it once. An unknown id is `NOT_FOUND`, as `release get` says.
- The dry run's `after` shows the new `release`. After the real write the releases are read again, so `after` is what Linear holds.

### Releases off

When `Organization.releasesEnabled` is false (the `releases` capability is `absent`):

- `release list`, `release get` and `release issues` keep PMK-40's answer: empty (a get is `NOT_FOUND`) with `note: releases is absent: <hint>`. The note says releases are off.
- `issues update --release`, `issues bulk release` and the `--release` filter refuse `NOT_SUPPORTED` "Linear releases are off in this workspace", with the manifest's hint as the next step. No request is sent for the release.
- `issues get` shows no release and sends no release query.

### The release filter and `release issues` (decision PMK-246-2)

`filter.release` translates to `{ releases: { some: { id: { eq: <id> } } } }`. An issue matches when the release is any of its releases. `release issues <id>` reads the release first (so an unknown or canceled one is `NOT_FOUND`) and then searches with the filter, archived issues included when `--archived` is given. `release-readiness --release` and `release-notes --release` then work on Linear.

### What stays refused

`issues create --release` refuses `NOT_SUPPORTED` "issues create does not set a Linear release", next step "Create the issue, then run pmkit issues update <id> --release <release>". `release create` and `release mark-released` keep the stub's refusal. The manifest's `releases` entry on a workspace with releases is `native` with `detail.unsupported: ['createRelease', 'markReleased']`, so a skill can read that before it offers either.

## Files

| File | Change |
|---|---|
| `scripts/lib/linear/documents.mjs` | `RELEASES_QUERY`, `RELEASE_QUERY`, `ISSUE_RELEASES_QUERY`. |
| `scripts/lib/linear/releases.mjs` | New. `toRelease`, `issueReleaseFields`, `releasesOff`, and the release operations (`listReleases`, `getRelease`, `resolveRelease`, `releaseIssues`). |
| `scripts/lib/linear/issues.mjs` | `toIssue` adds `release` or `releases` when the node carries `releases`. |
| `scripts/lib/linear/writes.mjs` | `toInput` builds the release input and refuses on create; `applyInput` applies it for the preview. |
| `scripts/lib/linear/issue-ops.mjs` | `getIssue` and `updateIssue` read the issue's releases when releases are on; the release check of option A. |
| `scripts/lib/linear/filter.mjs` | The release clause, or the releases-off refusal. |
| `scripts/lib/linear/tracker.mjs` | The release reads run the real operations when releases are on. |
| `scripts/lib/linear/manifest.mjs` | `detail.unsupported` on the native entry; the hint as a constant. |
| `scripts/fake-linear-api.mjs` | Releases and pipelines in the issue fake, the three queries, the update fields and the filter. |
| `scripts/lib/linear/API-VERIFICATION.md` | "Releases (PMK-246)": the schema check, and what a Business workspace still has to confirm. |
| Docs | `CHANGELOG.md`, `README.md`, `commands/issues/bulk.md` and the other command files that say Linear releases are not mapped. |

## Risks

- Nothing here ran against a real workspace with releases. The field names come from the public schema. `API-VERIFICATION.md` lists the checks a Business workspace must run: the team filter on `releases`, `Issue.releases` with `stage { type }`, `addedReleaseIds` and `removedReleaseIds` on `issueUpdate`, and the `releases.some` issue filter.
- An issue in releases of other teams' pipelines still counts those releases in its list. That is what Linear holds, so it stays.
