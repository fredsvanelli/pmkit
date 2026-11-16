import path from 'node:path'
import { redact } from './redact.mjs'

/**
 * True when `rel`, a relative path, climbs out of its base. A name that only starts with two dots, such as `..board.md`, stays inside.
 * The separator does not matter (a list of written files uses `/`, `path.relative` uses `path.sep`), and an absolute path of either
 * flavour counts, so a Windows path is seen on any system (PMK-268).
 */
export const climbsOut = (rel) => rel === '..' || /^\.\.[\\/]/.test(rel) || path.isAbsolute(rel) || path.win32.isAbsolute(rel)

/** `text` with each folder of `dirs` removed from the paths that start with it, which leaves them relative; a folder alone becomes `.`. A longer name that only starts with the folder, such as /tmp/tracker for /tmp/t, is left as it is. */
export const relativeTo = (text, dirs) => {
  let result = text
  for (const dir of [...dirs].sort((a, b) => b.length - a.length)) {
    result = result.replace(new RegExp(`${dir.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?:([\\\\/])|(?=['"\\s:]|$))`, 'g'), (_, separator) => (separator ? '' : '.'))
  }
  return result
}

const ABSOLUTE = String.raw`(?:[A-Za-z]:[\\/]|\\\\|/)`
// Where a path may start (PMK-277, PMK-284, PMK-295): the beginning of a line, one of ` (=:[,;<@{|!`, or a `>` that is a redirect (after a line start, a space, `&`, another `>`, a digit that is not the end of a word or a revision, or a letter, as in `from>/x`: `2>/x`, `&>/x`, ` >/x`, `>>/x`, but not `<rev1>/x` or `HEAD~1>/x`). A `>` after a digit that closes a placeholder of plain characters (`<sha-1>/<x>`, `<v1.2>/<x>`, `<1>/<2>`: a `<` up to 64 characters of `[\w.-]` back, PMK-297) starts nothing; `cat <in 2>/x` still does, and so does a `>` after a shell separator (`cmd <in&2>/x`, `(<f)2>/x`). The cost, as in PMK-295: an input redirect whose file name looks like a placeholder (`cat <in-2>/Users/x/y`) leaves the path visible. A `>` after a letter that closes a placeholder (`<remote>/<branch>`, `<remote name>/x`: a `<` up to 64 characters back with no `<`, `>`, `;`, `&`, `|`, `$`, `(`, `)`, backtick or quote between, so a space is fine, PMK-297 review) starts nothing; the 64 keeps the lookbehind linear in the line.
const START = String.raw`^|[\s(=:\[,;<@{|!]|(?:^|[\s&>]|(?<![\w~^])\d(?<!<[\w.-]{0,64})|(?<=[A-Za-z])(?<!<[^<>\r\n;&|$()\x60'"]{0,64}))>`
// The scheme of a local path: `file:`, or `<scheme>+file:` such as `git+file:` (PMK-286), in any case.
const FILE_SCHEME = String.raw`(?:[A-Za-z][A-Za-z0-9+.-]*\+)?[Ff][Ii][Ll][Ee]:`
// scheme://host...: a URL is not a path and stays whole, except file:// and <scheme>+file://, which are always a local path, with or without a host (PMK-278, PMK-286).
// A URL can only start at the first letter that follows a non-word character in a run of `[A-Za-z0-9+.-]` (a later start in the same run sees the same end of the run, so it fails or is
// rejected for the same reason). The regex starts only at the start of a run, takes the text before that first letter as a prefix and gives it back, so a run is read once (PMK-288).
const RUN_START = String.raw`(?<![A-Za-z0-9+.-])`
const URL_PREFIX = String.raw`(?:(?<!\w)(?=[A-Za-z])|(?:(?<=_)|(?![A-Za-z]))(?:[A-Za-z0-9]|[.+-](?![A-Za-z]))*[.+-](?=[A-Za-z]))`
const SCHEME_URL = String.raw`${RUN_START}(${URL_PREFIX})((?!${FILE_SCHEME})[A-Za-z][A-Za-z0-9+.-]+:\/\/(?=[^\/\s])\S*)`
// The user of an http(s) URL, or of a `<scheme>+http(s)` one such as `git+https` (PMK-287): up to the last `@` before the path, a query or a fragment.
const HTTP_USER = /^((?:[A-Za-z][A-Za-z0-9+.-]*\+)?[Hh][Tt][Tt][Pp][Ss]?:\/\/)[^\/\s?#]+@/

// A quoted path: the opening quote and the start of the path, then the closing quote (PMK-271, PMK-285). The closer is found by hand, not by a lazy
// `[^\r\n]*?` in the regex, because a quote that never closes made every later opener of the line read to its end again (PMK-288).
const QUOTED_OPEN = new RegExp(`(?<=${START})(['"\`])((?:${FILE_SCHEME}(?=\\/\\/))?)${ABSOLUTE}`, 'gm')
const QUOTED_CLOSE = Object.fromEntries(["'", '"', '`'].map((quote) => [quote, new RegExp(`${quote}(?=$|[\\s:)]|[\\]>]+(?=$|[\\s:)]))`, 'my')]))
// A quote before `.`, `,`, `;` or `}` (one or more, with `]` and `>` mixed in) closes the path only when no other quote of its kind follows on the line (PMK-296): punctuation and a space
// do not prove the path ended, `'/Users/x/a', b/c'` has a quote in its name. With another quote on the line, the older rule decides, which can hide more, never less.
const PUNCT_CLOSE = Object.fromEntries(["'", '"', '`'].map((quote) => [quote, new RegExp(`${quote}[\\]>.,;}]+(?=$|[\\s:)])`, 'my')]))

const LINE_BREAK = /[\r\n]/g
const PIPE_PATH = new RegExp(`\\|(?=${ABSOLUTE})`)

const hideQuotedPaths = (text) => {
  let result = ''
  let copied = 0
  let line = { from: 0, end: -1 } // the line of the last opener: it ends at `end`, the first \r or \n at or after `from`
  const failed = {} // quote -> the end of the line where a search for its closer failed: no later opener of that quote on that line finds one
  QUOTED_OPEN.lastIndex = 0
  for (let open; (open = QUOTED_OPEN.exec(text)); ) {
    const quote = open[1]
    const from = open.index + open[0].length
    if (!(from >= line.from && from <= line.end)) {
      LINE_BREAK.lastIndex = from
      line = { from, end: LINE_BREAK.test(text) ? LINE_BREAK.lastIndex - 1 : text.length }
    }
    let close = failed[quote] === line.end ? -1 : text.indexOf(quote, from)
    for (; close !== -1 && close < line.end; close = text.indexOf(quote, close + 1)) {
      QUOTED_CLOSE[quote].lastIndex = close
      if (QUOTED_CLOSE[quote].test(text)) break
      PUNCT_CLOSE[quote].lastIndex = close
      if (PUNCT_CLOSE[quote].test(text)) {
        const next = text.indexOf(quote, close + 1) // the next candidate scans from here too, so a line of quotes is still read once
        if (next === -1 || next >= line.end) break
      }
    }
    if (close === -1 || close >= line.end) {
      failed[quote] = line.end
      QUOTED_OPEN.lastIndex = open.index + 1
      continue
    }
    result += `${text.slice(copied, open.index)}${quote}${open[2]}<path>${quote}`
    copied = QUOTED_OPEN.lastIndex = close + 1
  }
  return result + text.slice(copied)
}

/**
 * `text` with every absolute path (`/x`, `C:\x`, `C:/x`, UNC `\\host\x`) replaced by `<path>`, so no part of a path shows (PMK-271).
 * A path starts where `START` says, or after a quote, or after a backtick that is itself at a start, so the closing backtick of `` `git`/`gh` `` opens nothing (PMK-277 added `[ , ; < @`, PMK-284 added `{ |`, a redirect `>` and the backtick, PMK-295 added `!` and a `>` after a letter that does not close a `<placeholder>`, PMK-297 added that a digit that closes a `<[\w.-]{0,64}` placeholder starts nothing and that a letter placeholder holds no shell separator). A `>` that closes a placeholder starts no path, so an input redirect with a placeholder-shaped file name followed by a redirect (`cat <in-2>/Users/x/y`) stays visible: the compromise of PMK-295, kept for the digit. A path with a space is ambiguous in git's
 * stderr, so the rule never shows part of one: inside quotes (a `file://` URL too, PMK-285) it ends at the closing quote, which is a quote followed by the end of
 * the line, a space, `:` or `)`, or by one or more of `]` and `>` followed by one of those, or by one or more of `] > . , ; }` that include one of `. , ; }` when no other quote of its kind follows on the line (PMK-296) (so the apostrophe of O'Brien stays inside; a backtick quotes like `'` and `"`); an unquoted one, or a quote that never closes, ends at
 * the end of the line. That can hide text after the path, which is the safe side. A URL `scheme://host/...` is not a path and shows whole (it ends before a `|` that is followed by an absolute path, which is hidden, PMK-295)
 * with its credentials redacted (`user:pw@`, a token, and the user of an `http(s)` URL, PMK-287); a `file://` or `<scheme>+file://` URL (PMK-286), a path without a scheme and a UNC path are hidden (PMK-278).
 */
export const hideAbsolutePaths = (text) => {
  const text2 = hideQuotedPaths(text)
  const re = new RegExp(`${SCHEME_URL}|(?<=${START}|['"]|(?<=${START})\`)${ABSOLUTE}[^\\r\\n]*`, 'gm')
  let result = ''
  let copied = 0
  for (let m; (m = re.exec(text2)); ) {
    const [whole, prefix, url] = m
    if (url === undefined) {
      result += `${text2.slice(copied, m.index)}<path>`
      copied = re.lastIndex
      continue
    }
    // A URL ends before a `|` that is followed by an absolute path, and the path after it is hidden to the end of the line (PMK-295). The end is found by one scan of the URL (`search`),
    // not by a repeated group in the regex, because a group repeated once per `|` grew the regex stack with the line (a RangeError at millions of pipes).
    const cut = url.search(PIPE_PATH)
    const kept = cut === -1 ? url : url.slice(0, cut)
    result += text2.slice(copied, m.index) + prefix + redact(kept).text.replace(HTTP_USER, '$1[redacted]@')
    copied = re.lastIndex
    if (cut !== -1) {
      LINE_BREAK.lastIndex = re.lastIndex
      const end = LINE_BREAK.test(text2) ? LINE_BREAK.lastIndex - 1 : text2.length
      result += '|<path>'
      copied = re.lastIndex = end
    }
  }
  return result + text2.slice(copied)
}
