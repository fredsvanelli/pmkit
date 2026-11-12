# PMK-295 design

Intent: `hideAbsolutePaths` leaves three paths whole: `!/Users/x`, `from>/Users/x`, `https://h.com/x|/Users/y`.

Goals: hide the path in the three cases. Non-goals: other starts, the URL user (PMK-287). Anti-goal: reopening PMK-284 (`<remote>/<branch>`, `<rev1>/<rev2>`, `HEAD~1>/x`, closing backtick of ``git`/`gh``) or quadratic time (PMK-288).

Approaches: (a) add `!` to the START class; for `>` after a letter, accept it unless the word before it follows a `<` (`(?<=[A-Za-z])(?<!<[^\s<>]*)>`); end the URL before a `|` that is followed by an absolute path start. (b) post-process the URL match and re-scan its tail: more code, rejected. Chose (a), in the same regexes.

Design: three edits in `scripts/lib/paths.mjs`. The `>` lookbehind stops at the previous `>`, so it stays linear. The URL body becomes `(?:[^\s|]|\|(?!ABSOLUTE))*`: disjoint alternatives, linear. A `|` not followed by a path (`https://h/a|b`) stays inside the URL.
