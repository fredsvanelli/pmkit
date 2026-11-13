# PMK-305 plan

Spec: `docs/superpowers/specs/2026-11-13-pmk-305-pr-open-behind-origin-design.md`

1. Tests first (`scripts/cli-pr.test.mjs`), real git repos with a bare origin, `fakeGh`:
   - behind by 2: dry run and real run give a note with the count and `git fetch origin`, `git rebase origin/main`, in `notes` of the JSON and on stderr, not in the text; singular for 1.
   - open PR already (dry and real): same note.
   - up to date (branch has all of origin/main), branch ahead only: no note.
   - no `origin/main` ref: no note.
   - git cannot count (branch ref not a local branch): "could not compare" note, no "behind".
   - the push still happens when behind.
2. Implement `behindNotes(ctx, branch, base)` in `scripts/pmkit.mjs` near `syncNotes`; add it to the notes of the three return paths of `pr open`.
3. Docs: `commands/issues/work.md` step 9, `README.md` row of `pr open`, `CHANGELOG.md` line; check scenarios/goldens that quote `pr open` notes.
4. `npm test` in foreground (exit code 0), check criteria (`issues update --check`), commit `.issues/`, open PR.
