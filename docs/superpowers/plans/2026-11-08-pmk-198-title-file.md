# PMK-198 plan

1. (TDD) `scripts/alerts-scan.test.mjs`: an advisory title with `\n` and `\r\n` becomes one line. Fix `alertCandidate` in `scripts/lib/alerts.mjs`. Criterion 3.
2. (TDD) `scripts/plugin.test.mjs`: no command file has `issues create --title "`; `conventions.md` names the file tool and `echo`. Then edit the seven command files and `conventions.md`. Criteria 1 and 2.
3. `CHANGELOG.md` line under `## Unreleased`.
4. Check the criteria with `issues update PMK-198 --check n`, `npm test` in the foreground, commit, PR.
