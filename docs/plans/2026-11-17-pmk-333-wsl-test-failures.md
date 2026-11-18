# PMK-333 plan: fix the npm test failures on WSL

Design: `docs/specs/2026-11-17-pmk-333-wsl-test-failures-design.md`. The code stays unchanged; only three test files change.

## Task 1: cli-pr commits without a git identity

1. Red: run `node --test --test-name-pattern "stacked pull request uses the PR base|counts only what the branch lacks" scripts/cli-pr.test.mjs`. Both tests fail with "no current branch (detached HEAD)" or the behind note.
2. In `scripts/cli-pr.test.mjs`, give the `git rebase -q stack` call and the `git merge -q --no-edit refs/remotes/origin/main` call the flags `-c user.name=t -c user.email=t@x.dev`.
3. Green: run the same command. Both pass.

## Task 2: validate-views case test reads by path

1. Red: `node --test --test-name-pattern "differ only in case" scripts/validate-views.test.mjs` fails with "the file contains git conflict markers".
2. Replace `result.problems[0].message` with the message of the problem whose path ends with `.issues/views/mine.yaml`.
3. Green: the same command passes.

## Task 3: github-host ENOENT test with a fixed PATH

1. Red: run `node --test --test-name-pattern "throws ENOENT" scripts/github-host.test.mjs` with a folder of mode 000 at the front of `PATH`. It fails with `EACCES`.
2. In `scripts/github-host.test.mjs`, run `defaultExec` with `env: { ...process.env, PATH: <empty temp folder> }`, made with `tempDir` from `test-helpers.mjs`.
3. Green: the same command with the mode-000 folder passes, and so does the plain run.

## Task 4: full suite and commit

1. Run `npm test`. Expect 0 failures.
2. Commit the three test files, the design doc, this plan and the `.issues/` changes for PMK-333, with the issue ID in the message.
