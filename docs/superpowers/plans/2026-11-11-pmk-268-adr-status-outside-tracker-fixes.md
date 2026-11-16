# PMK-268 plan

Spec: `docs/superpowers/specs/2026-11-11-pmk-268-adr-status-outside-tracker-fixes-design.md`. Each task: failing test first, then the code, then commit with `(PMK-268)`.

1. **climbsOut** (criterion 3). Test `scripts/paths.test.mjs`: `..`, `../a`, `..\a`, `/a`, `C:\a`, `C:/a`, `\\host\a` climb out; `a`, `a/b`, `..board.md`, `a\..\b` stay. Add `scripts/lib/paths.mjs`; use it in `pmkit.mjs` and `adrLocation`.
2. **Failure message** (criterion 1). Test: tracker outside in its own repo with `.git/index.lock`; `issues create` fails `UPSTREAM`; message and hint hold no tracker or home path. Change `commitIn`.
3. **`--by` reference** (criterion 2). Test in `adr.test.mjs` (both outside gives `0003-x.md`; mixed pairs unchanged). Change `runAdrStatus`; update `commands/spec/adr-status.md`.
4. **Other writes** (criterion 4). Tests for `issues create` and `issues update` with an outside tracker and `auto_commit: true`.
5. **Docs.** CHANGELOG line, check README/SKILL mention nothing to change, `npm test`, tick criteria, commit `.issues/`.
