# PMK-176 design: fix `/pmkit:issues:estimate` on an empty or conditional estimate scale

Issue PMK-176 (bug, follow-up of PMK-59, PR #84). Decisions come from an autonomous brainstorming run on 2026-11-08 with no user dialogue, from the issue, `commands/issues/estimate.md`, `scripts/lib/linear/manifest.mjs`, `scripts/lib/linear/discovery.mjs` and the Local tracker. Calls marked **(builder's call)** change no acceptance criterion.

## Problem

`commands/issues/estimate.md` is the whole product here: the CLI already answers correctly, the command file reads it wrongly.

1. Step 1 knows two paths. `capabilities` answers `estimation` as `native`, `absent`, or `conditional` (some teams in scope estimate, `detail.teams` lists them; Linear, no `tracker.scope.team`). On `conditional` the file takes the native path, and `issues update --estimate --dry-run` fails with `INVALID_INPUT` "team X has estimates off". With no `mappings.fields.estimate` the manifest may still say `native`, and the dry run fails with `NOT_SUPPORTED`. Both end the command without a comment.
2. Step 3 reads `discover` `estimate`, which is the workspace-wide scale: `{ unit: 'points', scale: [] }` when teams differ or none estimates. The file then says "state the estimate in ideal days" on every path, so on the native path a number of days goes to `--estimate` and is saved as points, or is refused on a t-shirt team.
3. Step 6 stops when the proposal equals the current estimate, so the user never reaches the question where another value can be picked.

## Goals

- A `conditional` estimation, a team of the issue outside `detail.teams`, a missing `mappings.fields.estimate`, or a native dry run that fails with `NOT_SUPPORTED` or `INVALID_INPUT` about estimates being off, falls back to the comment path (step 8) and says why.
- The proposal uses the scale of the issue's team: `discover` `teams[]` entry whose `key` is the prefix of the issue ID (Linear IDs are `<TEAM>-<n>`), else the top-level `estimate`. A scale with no values (`scale: []`) is not a scale.
- Days are never passed to `--estimate`. When the scale is empty, the estimate is stated in ideal days **in a comment only** (step 8), and says it is days, not points.
- When the proposal equals the current estimate, the command says so and still asks once, offering to keep it or pick another value of the scale.

## Non-goals

- No CLI or adapter change. The manifest and `discover` already carry what the command needs. The improvements in `docs/superpowers/epc-6-follow-ups.md` stay out.
- No new command call, so scenario, README table and `SKILL.md` command lists do not change.

## Design

Edit only `commands/issues/estimate.md` (plus tests, CHANGELOG, scenario notes).

- **Step 1** reads `estimation`. `absent`: comment path. `conditional`: take the team key from the issue ID; in `detail.teams` means native path, otherwise comment path. `native`: native path, still subject to the fallbacks below. Say the path in one line with the `enableHint`.
- **Step 3** takes the scale as above. Empty or missing scale: comment path with ideal days (builder's call: the comment is the only place a day count is safe).
- **Step 6** proposes one value; when it equals the current estimate, says "the estimate already fits" and continues to the question instead of stopping.
- **Step 7** (native path). 7.1 dry run. If it fails with `NOT_SUPPORTED`, or `INVALID_INPUT` saying estimates are off, do not retry: go to step 8 and say the tracker refused the field. Any other error follows the conventions. 7.2 asks once; when the proposal equals the current estimate the question offers "keep" and "another value of the scale", and "keep" stops with nothing changed.
- **Step 8** runs when step 1, 3 or 7.1 chose the comment path.
- Output and "If something is missing" name the new cases.

## Tests

A static test reads the command file and asserts the rules above are written (conditional, `detail.teams`, `NOT_SUPPORTED`, per-team scale, no `--estimate` with days, equal value still asks). The existing scenario (Local, native) must keep passing unchanged.
