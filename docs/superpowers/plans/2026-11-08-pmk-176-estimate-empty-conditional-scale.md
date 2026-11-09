# PMK-176 plan: estimate command on an empty or conditional scale

Spec: `docs/superpowers/specs/2026-11-08-pmk-176-estimate-empty-conditional-scale-design.md`.

Criteria: (1) conditional or missing mapping falls back to a comment; (2) the proposal uses the issue's team scale and never writes days as points; (3) the user can pick another value when the proposal equals the current one.

- [ ] Task 1 (red): add `scripts/estimate-command.test.mjs`, which reads `commands/issues/estimate.md` and asserts one rule per criterion. Run it; it fails.
- [ ] Task 2 (green): edit steps 1, 3, 6, 7, 8, Confirmation points, Output and "If something is missing" of `commands/issues/estimate.md`. Keep every CLI call as is, so the scenario `issues-estimate` and its snapshot do not change. Run the new test and `node --test scripts/scenarios.test.mjs scripts/plugin.test.mjs`.
- [ ] Task 3: add the CHANGELOG line under `## Unreleased`, at the top, in the style of the others. README and `SKILL.md` need no change (no new command).
- [ ] Task 4: tick the three criteria (`issues update PMK-176 --check n`, dry run then real), commit `.issues/`.
- [ ] Task 5: `npm test` in the foreground, exit code 0; then the PR through `pr open`, summary comment, move to `in_review`.
