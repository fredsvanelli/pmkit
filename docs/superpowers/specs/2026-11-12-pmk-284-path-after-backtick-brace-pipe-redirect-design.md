# PMK-284 Hide a path after a backtick, a brace, a pipe or a redirect (design)

Size: a small change (one function, two regexes). No clarifying questions: the issue, PMK-277 and PMK-278 settle the rules.

## Intent

`hideAbsolutePaths` (`scripts/lib/paths.mjs`) must never show part of a local path. PMK-277 widened the start characters, but a path after `` ` ``, `{`, `|` or `>` still shows, and a quoted path followed by `]` or `>` is not closed, so the unquoted rule hides the rest of the line.

## Decisions

1. Start characters: add `` ` ``, `{`, `|`, `>` to both lookbehind sets. A backtick also counts as a quote character in the quoted rule, so `` x `/Users/a/r` y `` becomes `` x `<path>` y ``. This is my call: the issue says only "becomes `<path>`".
2. Closing quote: the lookahead after the closing quote becomes end of line, a space, `:`, `)`, `]` or `>`. `'/Users/a/r'] gone` becomes `'<path>'] gone`. The apostrophe of O'Brien (PMK-271) still stays inside, because it is followed by a letter.
3. Negative lookbehind `(?<![\w.~/\\-])` instead of the list: not taken. It would change which text counts as a start in places the issue does not name (for example `"x"/y`, `)/y`) and PMK-285 to PMK-288 edit the same regexes next. The explicit list keeps the diff small and the behaviour predictable.
4. Unquoted paths still end at the end of the line (PMK-271/277). URLs (PMK-278) are untouched.

## Existing expectations that change

Only the PMK-277 test `"['/Users/x y'] and '/b c/d'"`, which expected `"['<path>'"`. It loses text after the closing quote by design of the old rule; it now expects `['<path>'] and '<path>'`, the behaviour criterion 2 asks for. No O'Brien or URL test changes.

## Acceptance

- A path after `` ` ``, `{`, `|` or `>` is hidden, with a test.
- A quoted path followed by `]` or `>` keeps the text after it, with a test.
