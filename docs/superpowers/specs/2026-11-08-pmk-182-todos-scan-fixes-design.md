# PMK-182: todos scan on a missing path and the incomplete docs

Follow-up of PMK-64 (PR #90). Size: a small change, so this is the whole design. No question was open: the issue gives each criterion, and the choices below are my calls.

## Goals

1. The README, the CHANGELOG, the PMK-64 spec and `commands/issues/todos.md` describe the three fields of the tracker read: `incomplete`, `cut` and `unread`.
2. `todos scan --path <missing>` answers `INVALID_INPUT` instead of "no TODO or FIXME found" with exit 0. The docs say `--path` is relative to the repository root.
3. SQL `/* */`, Lua `--[[ ]]` (and Haskell `{- -}`) block comments are read.
4. The comment in `readExistingIssues` says what the code does.

## Non-goals

The improvements in `docs/superpowers/epc-6-follow-ups.md`. Lua long strings and `--[==[` levels, Haskell nested comments.

## Decisions (my calls)

- **Meaning of the fields.** `cut` is true when the tracker has more issues than the CLI read (`hasMore`, or the read reached `READ_LIMIT`). `unread` is `{ count, ids }` for issues whose files could not be read. `incomplete` is `cut || unread.count > 0`: the tracker read is not complete, so the command must not create from the list. The comment at `scripts/lib/todos.mjs` (the "counts as a cut read too" line) said unread issues set `cut`; they do not, they set `incomplete` only. The comment is fixed, not the code.
- **`cut` in the JSON.** The command file and docs name `cut`, and the agent reads the JSON, so `todos scan` data now carries `cut` next to `incomplete` and `unread`.
- **Missing path.** `scanRepo` checks that `<root>/<path>` exists (`fs.existsSync`) after the path is validated. Not existing is `INVALID_INPUT` with the next step "Pass a path relative to the repository root". An existing folder with no readable file still answers "no TODO or FIXME found", which is true. A path git ignores or does not list is not an error either.
- **Block comments.** `sql` gets its own style: `--`, `/* */`, strings. `lua` gets `--`, `--[[ ]]`. `hs` gets `--`, `{- -}`. The block mark is tested before the line mark, so `--[[` opens a block, and `--[ x` stays a line comment.
- Ceiling, marked with `ponytail:` comments: Lua `--[=[` levels and long strings, Haskell nesting.
