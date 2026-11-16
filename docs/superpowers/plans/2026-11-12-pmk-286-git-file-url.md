# PMK-286 plan: hide the path of a git+file:// URL

Spec: `docs/superpowers/specs/2026-11-12-pmk-286-git-file-url-design.md`.

1. (TDD, red) Add tests to `scripts/paths.test.mjs`: `git+file://host/Users/a/r.git` and `git+file:///Users/a/r.git` hide the path (acceptance criterion); quoted forms; unquoted to end of line; upper case; `git+ssh`/`git+https` whole with credentials redacted. Run `node --test scripts/paths.test.mjs`: the new ones fail.
2. (green) In `scripts/lib/paths.mjs` add `FILE_SCHEME` and use it in rule 1 (quoted, capture group 2) and in the `SCHEME_URL` exclusion. Update the doc comment.
3. Compare the battery of common git/gh texts on `develop` and the branch.
4. CHANGELOG line under `## Unreleased`; check criterion 1 with `issues update PMK-286 --check 1`; commit `.issues/`.
5. `npm test` in the foreground, then the PR through `pr open`, summary comment, move to `in_review`.
