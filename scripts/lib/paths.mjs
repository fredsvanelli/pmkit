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
// Where a path may start (PMK-277, PMK-284): the beginning of a line, one of ` (=:[,;<@{|`, or a `>` that is a redirect (after a line start, a space, a digit, `&` or another `>`: `2>/x`, `&>/x`, ` >/x`, `>>/x`), never one after a letter, which closes `<remote>/<branch>`.
const START = String.raw`^|[\s(=:\[,;<@\`{|]|(?:^|[\s\d&>])>`
// scheme://host...: a URL is not a path and stays whole, except file://, which is always a local path, with or without a host (PMK-278).
const SCHEME_URL = String.raw`\b(?![Ff][Ii][Ll][Ee]:)[A-Za-z][A-Za-z0-9+.-]+:\/\/(?=[^\/\s])\S*`

/**
 * `text` with every absolute path (`/x`, `C:\x`, `C:/x`, UNC `\\host\x`) replaced by `<path>`, so no part of a path shows (PMK-271).
 * A path starts where `START` says, or after a quote or a backtick (PMK-277 added `[ , ; < @`, PMK-284 added `{ |`, a redirect `>` and the backtick). A path with a space is ambiguous in git's
 * stderr, so the rule never shows part of one: inside quotes it ends at the closing quote, which is a quote followed by the end of
 * the line, a space, `:` or `)`, or by `]` or `>` (one or more) followed by one of those (so the apostrophe of O'Brien stays inside; a backtick quotes like `'` and `"`); an unquoted one, or a quote that never closes, ends at
 * the end of the line. That can hide text after the path, which is the safe side. A URL `scheme://host/...` is not a path and shows whole
 * with its credentials redacted (`user:pw@`, a token); a `file://` URL, a path without a scheme and a UNC path are hidden (PMK-278).
 */
export const hideAbsolutePaths = (text) =>
  text
    .replace(new RegExp(`(?<=${START})(['"\`])${ABSOLUTE}[^\\r\\n]*?\\1(?=$|[\\s:)]|[\\]>]+(?=$|[\\s:)]))`, 'gm'), '$1<path>$1')
    .replace(new RegExp(`(${SCHEME_URL})|(?<=${START}|['"\`])${ABSOLUTE}[^\\r\\n]*`, 'gm'), (_, url) => (url === undefined ? '<path>' : redact(url).text))
