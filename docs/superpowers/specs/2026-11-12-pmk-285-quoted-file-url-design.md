# PMK-285: a quoted file:// URL ends at its closing quote

**Spec for** `hideAbsolutePaths` in `scripts/lib/paths.mjs`.

## Problem
`fatal: 'file:///Users/a/r': does not appear to be a git repository` becomes `fatal: 'file:<path>`: the `file:` prefix keeps the quote from being seen by the quoted-path rule (it needs `/` right after the quote), so the unquoted rule runs to the end of the line.

## Design
Extend the quoted-path rule (rule 1) so the quoted text may start with `file://` (any case) before the absolute part. It uses the same closing rule as a quoted path (quote at end of line, before a space, `:` or `)`, or `]`/`>` followed by one of those), so a path with a quote in its name is hidden whole. Result: `'file:<path>': does not appear to be a git repository`. Rule 2 stays as the fallback, so a quote that never closes still hides to the end of the line.

## Non-goals
Unquoted `file://` URLs still run to the end of the line. START, redirect and backtick rules are untouched (PMK-286..288 own them).

## Tests
In `scripts/paths.test.mjs`: the git message above (both quote kinds and a backtick), host forms (`file://localhost/x`), a quote inside the name (`'file:///x/a'b': cause`), an unclosed quote, and an unquoted URL unchanged.
