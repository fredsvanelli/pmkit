# PMK-288: hideAbsolutePaths in linear time

## Intent
`hideAbsolutePaths` (`scripts/lib/paths.mjs`) takes quadratic time on long lines. The output must not change; only the time.

## Measured (develop, ms, 5k / 20k / 200k chars)
`"a.".repeat`, `"a+"`, `"a-"`: 18 / 306 / 34,000. `a+...+file`: 19 / 303 / 100,000. Quoted openers that never close (`"/ ` repeated, `'`, backtick): 17 / 285 / 28,000. `x://` and `ab://` are already linear.

## Causes
1. URL alternative: `\b` makes every letter after `.`, `+`, `-` a start; each scans the rest of the run (and the `FILE_SCHEME` look-ahead scans it again, with backtracking) before failing on the missing `://`.
2. Quoted-path pass: each opener scans to the end of the line for a closing quote that does not exist; the next opener repeats it.

## Design (same output, a byte-for-byte rule)
1. URL: a match can only begin at the first `\b` letter of a run of `[A-Za-z0-9+.-]` (a later start sees the same run end, so it fails or is rejected for the same reason: the `://` test and the `FILE_SCHEME` test depend on the run end, and a `+file` ending rejects every start). The regex now starts only at a run start (`(?<![A-Za-z0-9+.-])`), consumes the text before the first candidate as a captured prefix (`P`), and the callback puts the prefix back unchanged. Each run is scanned once.
2. Quotes: the pass finds openers with a regex that stops after the absolute-path start, then looks for the closing quote with `indexOf` plus a sticky regex for the closer rule. A search that fails for a quote character on a line fails for every later opener of that character on that line, so it is remembered (per quote, per line end) and not repeated.
3. Nothing else changes: START, `FILE_SCHEME`, `redact`, `HTTP_USER` and the replacement strings stay as they are.

## Non-goals
Changing which text is hidden. Touching `redact.mjs`.

## Verification
- All `paths.test.mjs` cases pass unchanged.
- Differential run: develop's `paths.mjs` against the branch over every `paths.test.mjs` input plus a generated battery and an exhaustive short-string sweep. Different outputs must be 0.
- Timing test in the style of `redact-probes.test.mjs` (under one second per input, at 200,000 characters).
- The table of before/after times goes in the PR.
