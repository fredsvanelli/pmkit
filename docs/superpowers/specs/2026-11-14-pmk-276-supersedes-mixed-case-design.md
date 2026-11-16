# PMK-276: test the Supersedes line of a repository ADR that replaces a tracker ADR

Status: approved by the orchestrator's brief (non-interactive; the calls below are ours).

## Intent

PMK-270 made `docs adr-get --from` compute `supersedesRef` relative to the new ADR (`adrRef`, `scripts/lib/adr.mjs`). The mixed case has no test of its own: the new ADR is in the repository (`docs/adr/`), the old one is in a Local tracker outside it. There `supersedesRef` must equal `ref` (the path from the repository root, `../<outside>/docs/adr/0001-a.md`), because a repository ADR cannot cite a tracker ADR relative to its own folder.

## Goals and non-goals

- Goal: one test that fixes `supersedesRef === ref` for that case, with the new ADR actually present in the repository.
- Non-goal: changing `adrRef` or the base rule for the mixed case (out of scope per the issue).

## Approaches

1. **New test next to the PMK-270 `--from` tests (chosen).** One `withOutsideTracker` test in `scripts/adr.test.mjs`, reusing `adrGetFrom` and the fixture. Smallest diff, sits with its siblings.
2. Extend the existing PMK-270 test. Rejected: that test already asserts the mixed case in one line, but buried after other assertions; a named test makes the failure readable.
3. A unit test on `adrRef` only. Rejected: the issue asks for the `adr-get` behaviour end to end.

## Design

- Fixture: `withOutsideTracker(false, ...)` (old ADR `0001-a.md` lives outside). Write the new ADR `docs/adr/0003-x.md` in the repository, so the test does not rely on a missing file.
- Call: `adrGetFrom(root, '1', '--from', 'docs/adr/0003-x.md')`.
- Assert: exit 0, `supersedesRef === ref`, and `ref === ../<basename(outside)>/docs/adr/0001-a.md`.

## Calls made without asking

- The test writes the repository ADR file, even though the current assertion would pass without it, so the test matches the real situation.
- Placement: after the PMK-270 "keeps ref" test.
- No production code change; if the test fails, we stop and report the value (per the brief).

## Left to the builder

- Nothing else. Estimate 1.
