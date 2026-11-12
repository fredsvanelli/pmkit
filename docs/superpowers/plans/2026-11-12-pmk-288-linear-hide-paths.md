# PMK-288 plan: hideAbsolutePaths in linear time

Spec: `docs/superpowers/specs/2026-11-12-pmk-288-linear-hide-paths-design.md`

1. Build the comparison harness (scratchpad): develop's `paths.mjs` as reference, every `paths.test.mjs` input, a generated battery, an exhaustive short-string sweep. Run it first against the unchanged file (0 differences, sanity).
2. Test first (TDD): `scripts/paths-timing.test.mjs`, pathological inputs at 200,000 characters under one second (`a.`, `a+`, `a-`, `a+...file`, `x://`, quotes, backticks). It fails on develop.
3. Rewrite the URL alternative: run-start lookbehind, captured prefix, callback keeps the prefix. Covers criterion 1 for the `.`, `+`, `-` lines.
4. Rewrite the quoted pass: opener regex, `indexOf` + sticky closer, per-quote per-line failure memo.
5. Rerun the harness (must be 0 different), the timing test, `paths.test.mjs` unchanged (criterion 2), then `npm test` in the foreground.
6. CHANGELOG line, check both criteria, before/after table in the PR body, PR, summary comment, move to `in_review`.
