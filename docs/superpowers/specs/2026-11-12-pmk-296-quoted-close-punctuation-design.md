# PMK-296: a quoted path closes before `.`, `,`, `;` and `}` (design)

## Intent
`QUOTED_CLOSE` (`scripts/lib/paths.mjs`) closes a quoted path at a quote followed by the line end, whitespace, `:`, `)`, or a run of `]`/`>` that is itself followed by one of those (PMK-284). A quote followed by `.`, `,`, `;` or `}` does not close, so the rest of the line is hidden: `'/Users/x/a'. next` gives `'<path>` and git's `Cloning into 'file:///x/y'...` gives `Cloning into 'file:<path>`. The message loses its cause.

## Goals
- The run class becomes `[\]>.,;}]+`, followed by the same lookahead (`$`, whitespace, `:`, `)`). The quote closes only when what follows ends the path.
- A quote inside a name (`'/Users/x/a'.b c/d'`) still hides the whole path: `.b` is not followed by an end, so the first quote does not close.

## Non-goals
- Unquoted paths (run to line end by design); the start rules; URLs.

## Constraints
- Linear time (PMK-288, PMK-295): no new repeated group; one sticky character-class run per quote attempt, as before. Add a timing probe.

## Approaches
1. Widen the existing character class (chosen): one-token change, same rule, same cost.
2. A separate alternative per punctuation char: more code, same behaviour.
3. Close at any such punctuation: leaks parts of names with quotes (`a'.b c`); rejected by the issue.

## Size
Small change: one regex edit, tests, a timing probe, CHANGELOG.
