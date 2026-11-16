# PMK-249 plan

1. TDD `scripts/lib/linear/writes.test.mjs`: `toInput` create with `milestoneNode` sets `projectMilestoneId`; without a node it is `INVALID_INPUT`. Then edit `writes.mjs` (both modes, drop `LATER.milestone`).
2. TDD `scripts/lib/linear/tracker.test.mjs` (epicSetup + `seedMilestone`): create under an epic with a milestone (dry run shows it, real create sends `projectMilestoneId`); another project's milestone refused with no mutation; no parent / issue parent refused with "Add --parent <epic>"; unknown milestone NOT_FOUND. Then edit `issue-ops.mjs` `createIssue`.
3. CHANGELOG line under `## Unreleased`; check README/SKILL mention of the refusal; tick the three acceptance criteria; commit `.issues/`.
4. `npm test` in the foreground, exit code 0.
