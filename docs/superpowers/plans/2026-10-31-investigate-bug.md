# investigate-bug plan (PMK-63)

Criterion 1 (hypotheses from issue, comments, CI logs, code) maps to steps 2 to 8 of `commands/issues/investigate-bug.md`, with the degraded cases under "If something is missing".
Criterion 2 (optional comment after confirmation) maps to step 10, with a dry run and one confirmation.

1. Write `commands/issues/investigate-bug.md` in the format of `issues/review.md`.
2. Add `scripts/__scenarios__/issues-investigate-bug.mjs` and its snapshot, with a failed CI run, a pull request diff and one posted comment.
3. Update the counts (45 to 46 command files, 57 to 58 runs), `COMMANDS` in `scripts/plugin.test.mjs`, the README and SKILL.md tables, and add a CHANGELOG line.
4. Run `npm test` in the foreground and check exit code 0.
5. Tick the criteria, commit `.issues/`, open the PR, comment and move to `in_review`.
