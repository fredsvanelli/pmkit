# PMK-298 plan

1. Tests first (`scripts/cli-pr.test.mjs`): clone whose local default is behind origin by 2 -> dry run and real run give text + `notes` with the count and next steps; up to date -> no note; `--from` -> no note; no local default -> only the existing "(no local main)".
2. `branchBase` in `scripts/pmkit.mjs`: count `rev-list --count <name>..origin/<name>`; return `behind`.
3. `issues branch`: add the note to text and notes (dry run and real).
4. `commands/issues/work.md` step 6; README row; `CHANGELOG.md` line at top of Unreleased.
5. Check both acceptance criteria, commit `.issues/`, `npm test` (Node 22) in foreground, PR.
