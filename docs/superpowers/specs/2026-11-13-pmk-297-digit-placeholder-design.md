# PMK-297: keep `<sha-1>/<x>` visible (design)

## Intent
Since PMK-284 a digit before `>` starts a path (`2>/dev/null`) unless a word character, `~` or `^` precedes it. After `-`, `.` or `<` it still does, so `<sha-1>/<x> rest`, `<v1.2>/<x> rest` and `<1>/<2> rest` lose the rest of the line. Nothing leaks; the text is just hidden too much.

## Goals / non-goals
- A digit that closes a `<placeholder>` starts no path.
- `2>/dev/null`, `>/dev/null`, `&>/x`, `cmd 2>/Users/x` stay hidden. Other redirect forms are out of scope.
- Anti-goal: leaking a path. When unsure, hide.

## Approaches
1. Add `-`, `.`, `<` to the `(?<![\w~^])` lookbehind of the digit. Also un-hides `a-2>/Users/x` and `x.2>/Users/x`, which could be redirects: rejected, it can leak.
2. Reuse the PMK-295 placeholder lookbehind for the digit, limited to placeholder characters: `(?<!<[\w.-]{0,64})` after the digit. Chosen (cycle 2: the first version allowed any non-space character, so `cmd <in&2>/Users/x` and `(<f)2>/Users/x` showed their path). `cat <in 2>/Users/x` (a space) and `cmd <in&2>/Users/x` (a separator) still hide. A spaced placeholder that ends in a digit (`<remote 1>/x`) is hidden as before, never leaked.

## Design
`START` digit branch becomes `(?<![\w~^])\d(?<!<[\w.-]{0,64})`. The letter branch (PMK-295) now reads `(?<!<[^<>\r\n;&|$()\x60'"]{0,64})`: a space is allowed, a shell separator, backtick or quote is not, so `cat <in;echo>/Users/x` and `cmd <a&b>/Users/x` hide again, while `<remote name>/<branch>`, `<a b>/x` and `Map<string, number>/x` stay. The bound of 64 keeps it linear (PMK-288), no repeated group. Tests first in `scripts/paths.test.mjs`, a probe in `scripts/paths-timing.test.mjs`, a CHANGELOG line, and a git/gh battery on develop vs the branch.

## Compromise
An input redirect whose file name looks like a placeholder, `cat <in-2>/Users/x/y`, leaves the path visible: it is indistinguishable from `<sha-1>/<x>`. PMK-295 has the same cost for letters (`cat <in>/Users/x`).
