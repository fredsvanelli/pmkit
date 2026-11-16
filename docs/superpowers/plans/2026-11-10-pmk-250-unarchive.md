# PMK-250 plan

Spec: `docs/superpowers/specs/2026-11-10-pmk-250-unarchive-design.md`. TDD, each step test first.

1. Events: `unarchive` in `EVENT_OPS`, `replay`, `metrics.mjs`; tests in `events.test.mjs`, `model.test.mjs`, metrics. (AC1 history)
2. Local `unarchive` + contract entry + Linear stub; tests in `tracker-issues.test.mjs` / linear tracker test: brings back, dry run writes nothing (AC2), not archived is a no-op (AC3), shows in list again (AC1).
3. CLI `issues unarchive`; cli test for text/JSON, no-op message, dry run, autocommit message; update list tests/golden cases that enumerate commands.
4. Bulk `unarchive`: `parseChange`, `checkBulkFilter`, `runBulk` (`archived` flag, keep archived only, view rule); tests in bulk tests and a CLI bulk test with digest (AC4).
5. Docs: CHANGELOG, README table, `skills/pmkit/SKILL.md`, bulk.md line.
6. Check ACs with `issues update --check`, commit `.issues/`, `npm test` foreground, PR.
