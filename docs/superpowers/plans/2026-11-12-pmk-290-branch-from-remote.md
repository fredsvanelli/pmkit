# PMK-290 plan

1. Test (cli-pr.test.mjs): clone with only `origin/main` remote ref and no local `main`: `issues branch` creates the branch from `origin/main`, JSON `from` and text say so; dry-run too.
2. Test: `--from nope` and a missing default with no remote fail with `INVALID_INPUT` and a next step; nothing is written.
3. Implement in `scripts/pmkit.mjs` (`issues branch`): resolve `from` with `git rev-parse --verify --quiet <ref>^{commit}` (reads via `readGit`), fall back to `origin/<default>`, fail with a next step.
4. Fix the existing dry-run test that relied on a missing `main`.
5. CHANGELOG line; tick criteria; `npm test`; PR.
