# PMK-278: hide absolute paths in the git errors of other commands

## Why

PMK-271 made `hideAbsolutePaths` (`scripts/lib/paths.mjs`) hide absolute paths in the `auto_commit` failure message. Other messages still repeat git's stderr, so a path such as `/Users/John Doe/repo` can reach the agent's `--json` output, a pasted report or a log. The brief for PMK-278 asks for every such message to go through the same function.

## Rules

- Only text that comes from git's stderr (or a git spawn error) is hidden. A path the user typed that a command repeats on purpose stays: hide the git text, never the whole message.
- `hideAbsolutePaths` keeps its regex and its signature. PMK-277 changes the regex in parallel.
- The `auto_commit` message of PMK-271 does not change.
- Output that is already a pmkit-worded reason ("not a git repository", "git is not installed") is unchanged.

## The messages that repeat git's stderr

Found by reading every `spawnSync` and `execFileSync` call in `scripts/` (`.stderr`, `.error.message`) and following where each text goes.

| # | Place | What it repeats | Reaches |
|---|-------|-----------------|---------|
| 1 | `scripts/pmkit.mjs` `grepFailure` (493) | first line of `git grep` stderr | `unchecked` of `issues delete` |
| 2 | `scripts/pmkit.mjs` `tagWarning` (2373) | first line of `git rev-parse` stderr | warning of `release readiness` and related |
| 3 | `scripts/pmkit.mjs` `readRemotes` (3801) | first line of `git remote -v` stderr or spawn error | `link-repo` reason |
| 4 | `scripts/lib/todos.mjs` `scanRepo` (450) | whole `git ls-files` stderr | `INVALID_INPUT` of `todos scan` |
| 5 | `scripts/lib/local/tracker.mjs` `branchReader` (1002, 1004, 1012) | stderr of `git ls-tree`, `git show`, `git for-each-ref` | `note` of `inbox` |
| 6 | `scripts/lib/github/host.mjs` `failure` (40) | first line of the stderr of a `git` call (push, switch, diff, branch) | `UPSTREAM` message of `pr open` and others |
| 7 | `scripts/pmkit.mjs` `commitIn` (4215) | git's stderr | already hidden by PMK-271 |

Not changed: `user-store.mjs`, `actor.mjs`, `migrate/cli.mjs` and `adr.mjs` read git's status or stdout only and never put stderr in a message. `${ctx.root} is not the root of a git repository` (`readRemotes`) comes from pmkit's own root, not from git's stderr, so it is out of scope (follow-up candidate). Items 6 hides only `git` calls: a `gh` message is not git's stderr.

## Decisions

- Item 6 hides `detail` in the message only. The HTTP status is still read from the raw line.
- Item 5 hides the first line that the note repeats.
- Tests: `tagWarning` and `scanRepo` directly (a `GIT_DIR` that points at an absolute folder that does not exist makes git print it), two commands through the CLI (`todos scan`, `issues delete`), and one each for the host `failure` and the inbox note.
- Known ceiling: the regex hides `//host/x` after `https:` too, so a remote URL in a git push error shows as `https:<path>`. That is the safe side and the regex is PMK-277's.
