# PMK-293: read the ADR title with the closing rule of the Status heading

## Intent

PMK-282 reads the `## Status` heading with `headingText`, which drops a closing `#` sequence. `adrInfo` still reads the title with `lines[title].replace(/^ {0,3}#/, '').trim()`, so `# 5. Use X #` gives `5. Use X #`. The title uses the same helper, so the two headings follow one rule.

## Goals

- `adrInfo` gives the title with `headingText(lines[title])`.
- A test pins `# 5. Use X #` -> `5. Use X`, and the closing forms around it (`##`-style run of any length, tab before the run, `\#` kept, `#` alone, a `#` glued to the word kept, up to three spaces of indent).
- A test pins `## Status #` and `## Status # #` as the Status section and `## Status \#` as not.

## Non-goals

- Setext titles. The `title` key of the front matter is unchanged.
- No change to `headingText`, `headingLevel` or `locate`.

## Calls made without the user

- The only reader of `adrInfo().title` is `docs adr-get` in `scripts/pmkit.mjs`. No other caller needs a change.
- `# #` now gives the title `''`, as `#` alone already did (`adr-get` prints it as an empty title, not `(no title)`). Kept, to stay in scope.
