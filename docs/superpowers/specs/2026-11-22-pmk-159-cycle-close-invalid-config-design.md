# PMK-159: stop cycle close from proposing moves it cannot run on an invalid config

## Root cause

Found in PMK-120. Since PMK-120 every write and dry run refuses while `.pmkit/config.yaml` is invalid (`INVALID_INPUT`, `.pmkit/config.yaml is not valid, so writes are refused: ...`), and reads go on with a `warning:`. `/pmkit:cycle:close` handles it in a sentence of step 1: skip the sync, go on with the reads of steps 2 to 6, "when one fails with the same error, stop", then "show the sprint report of step 7 without asking for decisions, and stop there". Two problems:

- Step 6 is one of the reads, and it proposes a move, a split or a backlog move for each unfinished issue. Step 7 cannot run any of them (`cycle add`, `issues create`, `issues update`, `cycle close` all refuse), so the report carries a proposal that cannot happen.
- "Stop" and "show the report" sit side by side for two different cases (a read that fails, and the writes that will fail), and the rule lives inside step 1, where a reader of steps 6 and 7 does not see it.

## Decision

With an invalid `.pmkit/config.yaml`, `/pmkit:cycle:close` is a report only. It skips step 1's sync, runs the reads of steps 2 to 5, skips step 6 (no proposal), shows the report of step 7 without a proposal or a question, says that the moves, the splits, the close and the retro wait for the file to be fixed, offers `pmkit validate` and `/pmkit:local:doctor`, and stops. When a read of steps 2 to 5 fails with that same error, the CLI cannot find the tracker: show the error and stop there. The rule is said once, in "If something is missing", and step 1 points to it.

## Approaches

1. **Report only, in one place (chosen).** The sprint numbers are still worth showing (they come from reads), nothing is proposed that cannot run, and the user gets the fix.
2. Stop at step 1. The user loses the report, which the reads can still give.
3. Propose the moves anyway and let step 8 fail. That is the defect.

## Design

- `commands/cycle/close.md` step 1: the sentence about `.pmkit/config.yaml` becomes "When it fails with `INVALID_INPUT` and `error.message` starts with `.pmkit/config.yaml is not valid`, follow "An invalid `.pmkit/config.yaml`" under "If something is missing"." The rest of step 1 stays.
- `commands/cycle/close.md`, "If something is missing", a bullet "An invalid `.pmkit/config.yaml`" with the decision above; it also covers the warning a read prints when step 1 was skipped (no git host).
- `scripts/scenarios.test.mjs`: a static test that step 1 points to the bullet and that the bullet skips step 6 and shows the report without a question.
- `scripts/__scenarios__/cycle-close.mjs`: a second scenario, `invalidConfig`, on the team fixture with GitHub, whose setup breaks `write_policy.confirm`. Step 1's dry run fails with `INVALID_INPUT` (`expectError`), steps 2 to 5 read, and nothing is written: `expect` checks the sprint is still active and no issue changed. The first scenario's snapshot becomes `cycle-close.0.after.txt`.
- CHANGELOG.

## Interview

- Does step 9 (the retro document) also refuse? Yes, `docs create` is a write, so it waits too; the bullet names it.
- Can the reads of steps 2 to 5 fail with this error? Only when the file is too broken to find the tracker (`loadConfig` throws for a bad `tracker.system` or `tracker.path`); then stop with the error, as the conventions say.
- New terms or ADRs: none.
- Approval: the issue asks to decide and say it in one place; the decision keeps the reads and drops what cannot run. pmkit PO approves.
