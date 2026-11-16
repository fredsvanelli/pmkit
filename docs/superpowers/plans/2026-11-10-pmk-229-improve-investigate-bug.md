# PMK-229 improve investigate-bug: plan

Spec: `docs/superpowers/specs/2026-11-10-pmk-229-improve-investigate-bug-design.md`. Inline execution, TDD.

1. `--redact` (criterion 2). Red: `scripts/cli-redact-comment.test.mjs` (Local: body redacted, count line, `redacted` in JSON, dry run body equals real body, no flag unchanged, body of only a secret). Green: add the flag to `issues comment` in `scripts/pmkit.mjs`. Add a Linear case in `cli-linear.test.mjs` style if cheap. Commit.
2. Command file (criteria 2 and 3). Step 7 reads the branch ref; step 10 uses `--redact`; the confirmation point, Output and "If something is missing" follow. Commit.
3. Scenarios (criterion 1). Rewrite `scripts/__scenarios__/issues-investigate-bug.mjs` as three entries, rename the snapshot, regenerate the others with the command in `scripts/scenarios.test.mjs` (`REGENERATE`). Commit.
4. Docs: `CHANGELOG.md` line under `## Unreleased`, README and `skills/pmkit/SKILL.md` where `issues comment` is documented. Commit.
5. Check the three criteria with `issues update PMK-229 --check n` (dry run, then real), commit `.issues/`. `npm test` in the foreground, exit code 0. Open the PR, comment, move to `in_review`.
