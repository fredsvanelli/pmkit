# PMK-296: a quoted path closes before `.`, `,`, `;` and `}` (design)

## Intent
`QUOTED_CLOSE` (`scripts/lib/paths.mjs`) closes a quoted path at a quote followed by the line end, whitespace, `:`, `)`, or a run of `]`/`>` that is itself followed by one of those (PMK-284). A quote followed by `.`, `,`, `;` or `}` does not close, so the rest of the line is hidden: `'/Users/x/a'. next` gives `'<path>` and git's `Cloning into 'file:///x/y'...` gives `Cloning into 'file:<path>`. The message loses its cause.

## Goals
- A quote followed by a run of `[\]>.,;}]` that includes one of `. , ; }` (then `$`, whitespace, `:` or `)`) closes the path only when **no other quote of the same kind follows on the line** (review cycle 1: punctuation and a space do not prove the path ended, `'/Users/x/a', b/c'` has a quote in its name). With another quote on the line, the PMK-284 rule decides: the path runs to the next quote that closes by it, or to the line end.
- A run of only `]` and `>` keeps the PMK-284 rule.
- Cost: two quotes of one kind on a line, as in `'/a', '/b'` or `'/Users/x/a'. Don't retry`, keep the behaviour of develop for the first path (the safe side).
- A quote inside a name (`'/Users/x/a'.b c/d'`) still hides the whole path: `.b` is not followed by an end, so the first quote does not close.

## Non-goals
- Unquoted paths (run to line end by design); the start rules; URLs.

## Constraints
- Linear time (PMK-288, PMK-295): no new repeated group; the next quote is found with `indexOf` from the closing candidate (the loop's next candidate scans from the same place, so each quote is passed once). Timing probes with many quotes.

## Approaches
1. Add a second sticky regex for the punctuation run and the "no other quote on the line" check with `indexOf` (chosen after review cycle 1; the first cut, widening the class alone, leaked `b/c'` in `'/Users/x/a', b/c'`).
2. A separate alternative per punctuation char: more code, same behaviour.
3. Close at any such punctuation, or at punctuation plus a space: leaks parts of names with quotes (`a'. b c/d'`); rejected by the issue and the review.

## Size
Small change: one regex, one `indexOf` check, tests, timing probes, CHANGELOG.
