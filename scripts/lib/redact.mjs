// Replaces the secrets that a log, a diff or a stack trace may hold with [redacted]. It only reads text: no tracker, no
// file, no network. The patterns are a floor, not a guarantee, so a command that posts the result still shows it first.

const MARK = '[redacted]'
// An Authorization value that is the mark followed by wrappers only: text this module wrote, which a second pass leaves alone.
const MARKED = /^\[redacted\][)\]}>*`'",.;:|_~]*$/

// Order matters: a longer match (a private key, a URL, an Authorization line) goes before the shorter ones inside it.
const PATTERNS = [
  // To the matching END line. Without one, to the blank line that follows, or to the end of the text.
  ['private_key', /-----BEGIN [A-Z ]*PRIVATE KEY(?: BLOCK)?-----(?:[\s\S]*?-----END [A-Z ]*PRIVATE KEY(?: BLOCK)?-----|[\s\S]*?(?=\n[ \t]*\n|$))/g, () => MARK],
  // The user may be empty (`redis://:password@host`). The password runs to the last @ before the path.
  ['url_credentials', /(?<![a-z0-9+.-])([a-z][a-z0-9+.-]*:\/\/)[^\s/@:]*:[^\s/]+@/gi, (_, scheme) => `${scheme}${MARK}@`],
  // Before the tokens, so a token inside the header is one value of this type. The value may be in quotes.
  ['authorization', /(\bAuthorization["']?:[^\S\n]*)("(?:[^"\\\n]|\\.)*"|'(?:[^'\\\n]|\\.)*'|[^\s"'][^\n"']*)/gi, (whole, head, value) => (MARKED.test(value.trim()) ? whole : `${head}${MARK}`)],
  // The user and password of -u or --user, when it holds a colon. The lookback is bounded so a line of `curl` stays linear.
  ['curl_user', /(\bcurl\b[^\n]{0,500}?[ \t](?:--user[ \t=]+|-u[ \t]*))(?:"[^"\n]*:[^"\n]*"|'[^'\n]*:[^'\n]*'|[^\s"']*:[^\s"']*)/g, (_, head) => `${head}${MARK}`],
  ['jwt', /\beyJ[\w-]+\.eyJ[\w-]+\.[\w-]*/g, () => MARK],
  ['github_token', /\b(?:gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,})/g, () => MARK],
  ['gitlab_token', /(?<![A-Za-z0-9])glpat-[\w-]{20,}/g, () => MARK],
  ['slack_token', /(?<![A-Za-z0-9])xox[abposr]-[A-Za-z0-9-]{10,}/g, () => MARK],
  ['ai_api_key', /(?<![A-Za-z0-9_-])sk-(?:proj-|ant-)?[A-Za-z0-9_-]{20,}/g, () => MARK],
  ['stripe_key', /(?<![A-Za-z0-9])[sr]k_live_[A-Za-z0-9]{16,}/g, () => MARK],
  ['google_api_key', /(?<![A-Za-z0-9])AIza[\w-]{35}(?![\w-])/g, () => MARK],
  ['npm_token', /(?<![A-Za-z0-9])npm_[A-Za-z0-9]{36}(?![A-Za-z0-9])/g, () => MARK],
  ['aws_key', /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/g, () => MARK],
  // A short word after "bearer" is prose. A long one, or one with a digit or a symbol, is a token.
  ['bearer', /(\bBearer[ \t]+)(?=[A-Za-z0-9._~+/=-]{20}|[A-Za-z0-9._~+/=-]*[\d._~+/=-])[A-Za-z0-9._~+/=-]{8,}/gi, (_, head) => `${head}${MARK}`],
]

// PMK-197: a value after a secret key is replaced in full, trading false positives for no missed secrets. The false
// positives this accepts are listed in docs/superpowers/specs/2026-11-09-pmk-197-redact-no-missed-secrets-design.md.
//   - A quoted value is the quoted text (an escaped quote and line breaks inside, up to 4096 characters), unless a word goes
//     on right after the closing quote.
//   - Any other value runs to the end of the line, or to the next `|` in a table row. Only the Markdown that opened before
//     the value and is still open (a backtick, `**`, `__`, `~~`, `(`, `[`, `{`) keeps its last closing mark on the line.
//   - Nothing after the key, or a YAML `|` or `>`: the lines below that are more indented than the key (see `under`). With
//     nothing after the key and a `name:` pair on the first of them, they are a mapping read pair by pair.
//   - Left alone: a value that is the mark already, a number after a key that does not end in the secret word (`max_tokens`,
//     `token_limit`, `token.mjs:12:5`) and a directory after the shell variable PWD or OLDPWD.
const SECRET_WORD = 'api[_-]?key|private[_-]?key|token|secret|passw(?:or)?d|pwd|credentials?'
const KEY_WORDS = new RegExp(SECRET_WORD, 'i')
const SECRET_LAST = new RegExp(`(?:${SECRET_WORD})$`, 'i')
const SHELL_PWD = /^(?:old)?pwd$/i
const KEY_SEPARATOR = /(?<![\w.-])([\w.-]+)(["']?[^\S\n]*(?:=>|:=|===?|[=:])[^\S\n]*)/g
const QUOTED = /"(?:[^"\\]|\\[\s\S]){0,4096}"|'(?:[^'\\]|\\[\s\S]){0,4096}'/y
const NUMBER = /\d+(?::\d+)*(?=[\s,;)\]}]|$)/y
const DONE = /\[redacted\](?=[\s,;]|$)/y
const TABLE_ROW = /[^\S\n]*\|/y
const BLOCK = /^[|>][+-]?\d?[+-]?$/
const MAPPING = /[\w.-]+["']?[^\S\n]*:(?=\s|$)/y
const MARKDOWN = [['`', '`'], ['**', '**'], ['__', '__'], ['~~', '~~'], ['(', ')'], ['[', ']'], ['{', '}']]

const lineEnd = (text, from) => {
  const end = text.indexOf('\n', from)
  return end === -1 ? text.length : end
}
const at = (pattern, text, from) => {
  pattern.lastIndex = from
  return pattern.test(text)
}
// Leading space and diff marks, so `- ` of a list item and the `+` of a diff count as indentation.
const leadOf = (line) => line.match(/^[\s+-]*/)[0].length
const space = (char) => char !== undefined && /\s/.test(char)

// The closing marks of the Markdown that is still open in `before`.
const openClosers = (before) => MARKDOWN.filter(([open, close]) => {
  const opens = before.split(open).length - 1
  return open === close ? opens % 2 : opens > before.split(close).length - 1
}).map(([, close]) => close)

// The lines after the line break at `from` that belong to the value of a key at `column` of a line that starts with `lead`
// characters of indentation: a line with a space at the key's column (and the same kind of character just before it, so a
// diff `+`, a timestamp or a list `- ` before the key is matched) or with more indentation. Blank lines inside belong too.
// Returns where the text of the first line starts and where the last line ends, or nothing.
function under(text, from, column, lead, before) {
  let first = -1
  let last = -1
  for (let pos = from; pos < text.length; ) {
    const start = pos + 1
    pos = lineEnd(text, start)
    const line = text.slice(start, pos)
    const indent = leadOf(line)
    if (indent === line.length) continue
    const sameColumn = space(line[column]) && (column === 0 || space(line[column - 1]) === space(before))
    if (!sameColumn && indent <= lead) break
    if (first < 0) first = start + (sameColumn ? column + line.slice(column).search(/\S/) : indent)
    last = start + line.trimEnd().length
  }
  return first < 0 ? null : { first, last }
}

function redactPairs(text, counts) {
  let out = ''
  let position = 0
  let lineStart = 0
  let lineStop = -1
  let table = false
  const replace = (from, to) => {
    out += `${text.slice(position, from)}${MARK}`
    position = to
    KEY_SEPARATOR.lastIndex = Math.max(to, KEY_SEPARATOR.lastIndex)
    counts.api_key_value = (counts.api_key_value ?? 0) + 1
  }
  KEY_SEPARATOR.lastIndex = 0
  for (let match = KEY_SEPARATOR.exec(text); match; match = KEY_SEPARATOR.exec(text)) {
    const key = match[1]
    const start = match.index + match[0].length
    if (!KEY_WORDS.test(key) || match.index < position) continue
    if ((at(NUMBER, text, start) && !SECRET_LAST.test(key)) || at(DONE, text, start)) continue
    if (SHELL_PWD.test(key) && (text[start] === '/' || text[start] === '~')) continue
    if (text[start] === '"' || text[start] === "'") {
      QUOTED.lastIndex = start
      const quoted = QUOTED.exec(text)
      if (quoted && !/\w/.test(text[QUOTED.lastIndex] ?? '')) {
        const inner = quoted[0].slice(1, -1)
        if (inner && inner !== MARK && !(at(NUMBER, inner, 0) && !SECRET_LAST.test(key))) replace(start, QUOTED.lastIndex)
        continue
      }
    }
    // The line is read once, however many keys it holds.
    if (match.index > lineStop) {
      lineStart = text.lastIndexOf('\n', match.index) + 1
      lineStop = lineEnd(text, match.index)
      table = at(TABLE_ROW, text, lineStart)
    }
    const cell = table ? text.lastIndexOf('|', match.index) + 1 : lineStart
    let end = table ? text.indexOf('|', start) : lineStop
    if (end === -1 || end > lineStop) end = lineStop
    let value = text.slice(start, end).trimEnd()
    if (!table && (!value || BLOCK.test(value))) {
      const column = match.index - lineStart
      const lines = under(text, lineStop, column, leadOf(text.slice(lineStart, match.index)), text[match.index - 1])
      if (!lines || text.slice(lines.first, lines.last) === MARK || (!value && at(MAPPING, text, lines.first))) continue
      replace(value ? start : lines.first, lines.last)
      continue
    }
    // A key's leading underscores are Markdown (`__token=x__`), not part of the name.
    for (const close of openClosers(text.slice(cell, match.index + key.match(/^_*/)[0].length))) {
      const cut = value.lastIndexOf(close)
      if (cut !== -1) value = value.slice(0, cut)
    }
    value = value.trimEnd()
    if (!value || value === MARK) continue
    replace(start, start + value.length)
  }
  return out + text.slice(position)
}

/** Returns { text, count, counts, summary }: the text with each secret replaced, the total, the number replaced per type and the line for the comment. */
export function redact(input) {
  let text = String(input)
  const counts = {}
  for (const [type, pattern, replace] of PATTERNS) {
    text = text.replace(pattern, (...args) => {
      const out = replace(...args)
      if (out !== args[0]) counts[type] = (counts[type] ?? 0) + 1
      return out
    })
  }
  text = redactPairs(text, counts)
  const count = Object.values(counts).reduce((sum, n) => sum + n, 0)
  return { text, count, counts, summary: `Redacted ${count} ${count === 1 ? 'value' : 'values'}.` }
}
