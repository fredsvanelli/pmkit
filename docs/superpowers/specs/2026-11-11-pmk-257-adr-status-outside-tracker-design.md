# PMK-257 `docs adr-status` with a tracker outside the repository and in its report

**Issue:** PMK-257 (source: PMK-247 / PR #207, PMK-248 / PR #203). Out of scope: a third status form (`Status:` line next to front matter), and anything of PMK-263.

## Problem and decisions

1. **Commit fails with an outside tracker.** `commitTracker` (`scripts/pmkit.mjs`) hands git paths such as `../outside/docs/adr/0001-a.md`; git refuses, and the `UPSTREAM` message and the "Commit <path> yourself" hint print them.
   *Decision (fix in the shared function, so every write benefits):* paths that climb out of the repository are committed in the git repository that holds them (found with `git rev-parse --show-toplevel` from their folder), with paths relative to that top level. When the folder is in no git repository there is nothing to commit: skip it and say so with a `note:` on stderr. Messages name the paths relative to the tracker folder (`tracker:<rest>`), never an absolute path.
2. **`--by` to an outside ADR.** `ref` for an ADR in an outside tracker becomes its path relative to the repository root (`../trackers/x/docs/adr/0003-x.md`), the same base `tracker.path` is written in, so a reader can open it. `path` keeps the `tracker:` display label. Repository ADRs and a tracker at the repository keep `docs/adr/<name>`.
3. **Unchanged status.** `before` and `after` are the same text when nothing changes.
4. **Front matter and `## Status` both present.** The report shows both: `status: accepted; ## Status: Accepted`. A section-only or key-only ADR reports as before.
5. **YAML comment.** `status: accepted # note` counts as accepted (the trailing ` #...` is ignored when comparing) and the rewrite keeps the comment.

## Acceptance criteria to tests

Each criterion gets a failing test first (`scripts/adr.test.mjs`, the outside-tracker ones use `auto_commit` and a git repo around the tracker or none).
