# PMK-203 plan

Spec: `docs/superpowers/specs/2026-11-09-pmk-203-goals-overview-fallback-design.md`. Tests in `scripts/cli-goals-overview.test.mjs` and `scripts/initiatives.test.mjs`, TDD (test first, see it fail, then fix).

1. (AC1) Test: no goals, a broken `epic.md` and no broken issue file: `source: top_level`, `complete: true`, no epic warning. Fix in `runGoalsOverview` (`scripts/pmkit.mjs`): push `listed.problems` warnings only on the goals path; on the fallback drop them. The goals-path test for a broken epic stays.
2. (AC3) Test: `notes.md` in `.issues/goals` (with and without goals): fallback runs, `complete: true`, a `note:` names the file. Fix: `listGoals` gives a stem that is not a goal id `kind: 'file'`; the overview treats only `kind: 'goal'` as unreadable and turns `kind: 'file'` into a note.
3. (AC2) Unit tests for `topLevelRollup`: a child of an archived parent and a child of an `unreadable` parent are not rows and are in `unreached`. CLI tests: an archived parent with a live child and a parent issue file that does not parse give a warning, `complete: false`, no top-level row. Fix: `topLevelRollup(issues, { unreadable })`, `searchIssues({ archived: true })` in the fallback, the warning text.
4. (AC4) `commands/report/initiatives-and-goals.md`: "needs an epic" only when `complete` is true; mention the three cases; check the scenario/golden files agree (`scripts/__scenarios__`).
5. CHANGELOG line, PMK-67 spec update, check the ACs (`issues update PMK-203 --check n`), commit `.issues/`.
6. `npm test` in the foreground, exit 0, then PR.
