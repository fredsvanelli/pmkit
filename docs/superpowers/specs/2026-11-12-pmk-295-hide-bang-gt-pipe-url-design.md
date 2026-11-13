# PMK-295 design

Intent: `hideAbsolutePaths` leaves three paths whole: `!/Users/x`, `from>/Users/x`, `https://h.com/x|/Users/y`.

Goals: hide the path in the three cases. Non-goals: other starts, the URL user (PMK-287). Anti-goals: reopening PMK-284 (`<remote>/<branch>`, `<rev1>/<rev2>`, `HEAD~1>/x`, closing backtick of ``git`/`gh``), quadratic time (PMK-288), a regex-stack overflow on a huge URL.

Approaches: (a) regex edits only; the URL body as a repeated group stops at `|`+path, but the group grows the regex stack per `|` (RangeError at millions of pipes), rejected after review. (b) regex for the start, a loop for the end, as PMK-288 did for the closing quote. Chose (b) for the URL and a regex edit for the other two.

Design, in `scripts/lib/paths.mjs`:
- `!` joins the START class.
- A `>` after a letter starts a path unless it closes a placeholder: `(?<!<[^<>\r\n]{0,64})`, a `<` up to 64 characters back with no `<`, `>` or line break between. This keeps `<a b>/x` and `<remote name>/<branch>`; the 64 bounds the lookbehind, so it is linear. A placeholder longer than 64 is not one.
- The URL regex keeps `\S*`. `hideAbsolutePaths` runs a loop over the matches: in a URL it looks for the first `|` followed by an absolute path (`indexOf` plus a sticky test), keeps the URL before it, writes `|<path>` and skips to the end of the line.
