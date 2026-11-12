# PMK-286: hide the path of a git+file:// URL

**Spec for** `hideAbsolutePaths` in `scripts/lib/paths.mjs`.

## Problem
Only the scheme `file` is a local path. `git+file://host/Users/a/r.git` matches `SCHEME_URL` as an ordinary URL and shows whole, and `'git+file:///Users/a/r'` is not seen by the quoted-path rule, so the line is cut at `git+file:<path>`.

## Design (autonomous brainstorming, choices made without asking)
One constant, `FILE_SCHEME` = an optional `<scheme>+` prefix, then `file:` in any case. The duplicated `file:` pieces of rule 1 (quoted) and `SCHEME_URL` (the exclusion) both use it, which also answers the PMK-285 review note about the duplicate. A `<scheme>+file://` URL then follows every `file://` rule: hidden with or without a host, a quoted one ends at its closing quote, an unquoted one runs to the end of the line. The prefix is kept in the output (`git+file:<path>`).

`git+ssh://`, `git+https://` and every other scheme are untouched: whole URLs with credentials redacted.

## Non-goals
START, redirect, backtick rules (PMK-287, PMK-288 own them). Schemes that only contain `file` (`x-file://`, `a.file://`) stay URLs.

## Tests
`scripts/paths.test.mjs`: the acceptance URLs with and without host, quoted (`'`, `"`, backtick), unquoted, unclosed, an apostrophe in the name, upper case, and `git+ssh`/`git+https` kept whole with redacted credentials.
