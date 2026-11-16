# PMK-188 plan: link-repo fixes

Spec: `docs/superpowers/specs/2026-11-09-pmk-188-link-repo-fixes-design.md`. Tests in `scripts/cli-link-repo.test.mjs` and `scripts/validate.test.mjs`. Each task is test first, then code, then commit with `(PMK-188)`.

1. Branch only from the written repo (AC 1). Test: `--remote my.remote --repo z/z` with `refs/remotes/my.remote/HEAD` set keeps the file's branch. Code: in `runLinkRepo` infer the branch only when `repoAfter === inferred.repo`.
2. `--git-host none` clears `default_branch` (AC 2). Update the two existing tests that expect `default_branch: main` to stay. Code: `branchAfter = null` for the flag, `removeKey` on `git_host.default_branch`.
3. github without repo (AC 3). Tests: `link-repo --git-host github` with no remote fails `INVALID_INPUT`, dry run too; `validate` reports the missing repo. Code: refusal in `runLinkRepo`, problem in `validate.mjs`.
4. Argument hint (AC 4). Test in `plugin.test.mjs` style or `cli-link-repo.test.mjs`: every `--flag` in the Parameters section appears in `argument-hint`. Code: edit `commands/link-repo.md`.
5. `readRemotes` root check. Test: a pmkit root in a subdirectory of a git repository with a remote infers nothing and notes why. Code: `rev-parse --show-toplevel`.
6. Docs: CHANGELOG line under `## Unreleased`, goldens/scenario if the output changes, `commands/link-repo.md` steps if a new note needs repeating.
7. Check the four criteria with `issues update PMK-188 --check <n>`, commit `.issues/`, `npm test` in the foreground, then deliver (PR, comment, `in_review`).
