# PMK-59 estimate-issue command plan

Spec: `docs/superpowers/specs/2026-10-30-pmk-59-estimate-issue-design.md`.

1. Red tests. Add `estimate` to `COMMANDS.issues` in `scripts/plugin.test.mjs`, raise the command-file count in `scripts/scenarios.test.mjs` to 34, and add `scripts/__scenarios__/issues-estimate.mjs`. Run `npm test` and see them fail because the command file is missing. Covers criteria 1 to 3 as tests.
2. Write `commands/issues/estimate.md` with the six standard sections. Steps: read the manifest, read the issue, read the scale, read the code, find similar completed issues, propose, then save (native) or comment (absent). Run the tests until they pass.
3. Generate the snapshot with `UPDATE_GOLDENS=1 node --test scripts/scenarios.test.mjs` and read the diff.
4. Register the command: README, `skills/pmkit/SKILL.md`, CHANGELOG, and the live-run count in `scripts/scenarios-live.mjs` if it names one.
5. Run `npm test`, tick the three criteria with `issues update --check`, commit `.issues/`, open the PR.
