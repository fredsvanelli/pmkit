# PMK-277: hide an absolute path after a bracket, comma, semicolon, angle bracket or at sign

## Intent

`hideAbsolutePaths` (`scripts/lib/paths.mjs`) hides absolute paths in the `UPSTREAM` message of a failed `auto_commit` (PMK-271). A path starts only at the line start or after a space, a quote, `(`, `=` or `:`. A path right after `[`, `,`, `;`, `<` or `@` is shown whole, a gap PMK-268 already had. The orchestrator asked for these five as new starts, with a test for each.

## Decisions (brainstorming ran without questions: the coordinator opted out, so these are my calls)

- Add `[`, `,`, `;`, `<` and `@` to both start lookbehinds (the quoted rule and the unquoted rule). Name and signature of `hideAbsolutePaths` do not change, because PMK-278 calls it from other commands.
- The end rules stay as they are. An unquoted path ends at the end of the line, so a `]` or `>` after it is hidden with it and no piece of the path shows. A quote that closes before `]` or `>` is not a closing quote (the closing quote needs end of line, space, `:` or `)`), so the quoted rule does not match and the unquoted rule hides up to the end of the line. This is the safe side: it can hide text after the path, never part of the path. Adding `]` `>` `,` `;` to the closing set is rejected: it would break the O'Brien rule for a name such as `/Users/O'Brien,x`.
- Non-goals: other commands' messages (sibling issue), any change to `relativeTo`.

## Acceptance

- `[/Users/x/repo]`, `a,/Users/x`, `a;/Users/x`, `</Users/x>`, `user@/Users/x` show no part of the path, one test each.
- Quoted forms after the new starts (`['/Users/x y']`, `<'/Users/x y'>`) show no part of the path.
- Existing tests (O'Brien, `key=/x`, `file:///x`, UNC, `https:<path>`) keep passing.
- An end-to-end test: a failed `auto_commit` whose git stderr has a path after each new start shows no part of the path in `UPSTREAM`.
