# PMK-52 issues delete: plan

Spec: `docs/superpowers/specs/2026-10-31-pmk-52-issues-delete-design.md`. Each task is test first.

1. Local `delete` in `scripts/lib/local/tracker.mjs`, tests in the new `scripts/tracker-delete.test.mjs`. Cases: deletes the folder, the index and search forget it, a dry run writes nothing, refusal for each of blockedBy, related, duplicateOf and parent with `references`, own links do not block, an unreadable issue refuses, warnings (sprint, released release, agent, time, todo-key, view, branch), mentions in descriptions and comments, `writtenFiles` carries the folder.
2. Contract: add `delete` to `TRACKER_OPERATIONS` (test in `scripts/contract.test.mjs`) and a case in `scripts/contract-suite.mjs`, run against Local and the Linear fake.
3. Linear `delete` in `scripts/lib/linear/issue-ops.mjs`, wired in `scripts/lib/linear/tracker.mjs`, tests in `scripts/lib/linear/tracker.test.mjs`: refusal for each relation kind and for children, a dry run sends no mutation, a delete sends `issueDelete` once, a trashed issue is `NOT_FOUND`.
4. CLI `issues delete` in `scripts/pmkit.mjs`: text, JSON, error body with `references` and `problems`, auto_commit commit of the removal. Tests in `scripts/cli-delete.test.mjs`, using a git repo in a temp directory, never inside `scripts/__fixtures__/`.
5. Command file `commands/issues/delete.md`, a scenario in `scripts/__scenarios__/`, counts in `scripts/scenarios.test.mjs`, `scripts/scenarios-live.mjs`, the `COMMANDS` list in `scripts/plugin.test.mjs`, a golden case if the harness needs one, the conventions text, the README table, `skills/pmkit/SKILL.md` and `CHANGELOG.md` under `## Unreleased`.
6. Tick the acceptance criteria with `issues update PMK-52 --check <n>`, commit `.issues/`, run `npm test`, open the PR.
