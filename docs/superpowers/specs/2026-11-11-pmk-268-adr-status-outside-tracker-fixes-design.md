# PMK-268 `docs adr-status` paths and messages with a tracker outside the repository

**Issue:** PMK-268 (source: PMK-257 / PR #215, PMK-263 / PR #216). Builds on `commitTracker`, `commitIn`, `refFolder` and `docs adr-get`; none of that is undone. The `## Status` reading is untouched (PMK-269 changes it).

## Decisions

1. **No absolute path in the auto_commit failure.** `commitIn` builds the `UPSTREAM` message from git's stderr. Fix in `commitIn`, so every write benefits: the repository the commit ran in (`cwd`, with and without symlinks resolved) is removed from the text, which leaves the paths relative to it, and any other absolute path left in the text becomes `<path>`. The hint names the files relative to the repository that holds them; for a tracker outside the project it says so ("in the git repository that holds the tracker").
2. **`--by` with both ADRs in a tracker outside the repository.** The reference is the path of the newer ADR relative to the folder of the ADR that holds it (the standard Markdown relative link), so for two ADRs in the tracker's `docs/adr/` it is the bare file name `0003-x.md`. A reader of the tracker on its own opens it from the ADR. Rationale: the code, docs and ADRs name no other format, the link has no `..` and no machine path, and it keeps working if the tracker folder moves. Every other pair keeps `ref` (from the repository root): a repository ADR, a tracker inside the repository or at `tracker.path: .`, and an outside-tracker ADR that names a repository ADR (no path can work from the tracker alone there, since the repository is not at a fixed place from it). `ref` and `path` in the JSON are unchanged.
3. **`climbsOut` ignores the separator.** One shared helper (`scripts/lib/paths.mjs`) used by `pmkit.mjs` and `adrLocation`: `..` followed by `/` or `\`, or an absolute path of either flavour (`C:\x`, `\\host\x`, `/x`). A name that merely starts with two dots stays inside.
4. **Other write commands.** `scripts/cli-autocommit.test.mjs` gets tests for `issues create` and `issues update` (a write that touches the tracker's `issues/` folder and one that edits an existing file) with the tracker outside the repository in its own git repository, and for the failure message.

## Acceptance criteria to tests

1. UPSTREAM message of a failed commit (a stale `.git/index.lock` in the tracker's repository) has no absolute path: `scripts/cli-autocommit.test.mjs`.
2. `--by` both outside: `scripts/adr.test.mjs`.
3. `climbsOut`: `scripts/paths.test.mjs`.
4. Other write commands commit into the outside tracker: `scripts/cli-autocommit.test.mjs`.
