# PMK-289: hide the absolute paths left in git and gh error texts (design)

Issue: PMK-289 (EPC-6). Follows PMK-278 / PR #233.

## Goal
No error text of `link-repo`, `todos` or a failed `gh` call shows an absolute path, and a `gh api` error still sets `httpStatus`.

## Non-goals
`hideAbsolutePaths` (regex and signature) stays as it is; PMK-284 changes it in parallel. `host.mjs` near the `issues branch` code and `pmkit.mjs` near line 1937 belong to PMK-290: no reformatting there.

## Decisions (my calls, no business rule is open)
1. `link-repo`: `"${ctx.root} is not the root of a git repository"` becomes `"the project root is not the root of a git repository"`. The root is left out (the user already knows where they ran the command).
2. `todos`: `"cannot list the files of ${root}: ..."` becomes `"cannot list the files of this repository: ..."`. `listed.error?.message` also goes through `hideAbsolutePaths`. The four goldens named `todos-scan.txt` change with it.
3. Spawn error messages (`grepFailure` and `tagWarning` in `scripts/pmkit.mjs`) go through `hideAbsolutePaths`. The `readRemotes` one already does.
4. `failure()` in `scripts/lib/github/host.mjs` hides the detail for every command, not only git. The HTTP status regexes run on the raw first line, before the hiding, so a path that swallows the end of the line cannot hide `(HTTP 404)`.
5. `host.mjs` `run()` rethrows other spawn errors as they are; `defaultExec` throws `result.error`. Those are not shown as text by this code, so they stay (out of scope unless a test shows an absolute path).

## Tests
One per place: link-repo, todos, `grepFailure` (issues delete, already covered but with spawn message), `tagWarning`, gh failure with a path in stderr, gh api HTTP status with a path in the same line (both `(HTTP 404)` and `HTTP 502:` forms).
