// Replaces the secrets that a log, a diff or a stack trace may hold with [redacted]. It only reads text: no tracker, no
// file, no network. The patterns are a floor, not a guarantee, so a command that posts the result still shows it first.

const MARK = '[redacted]'
// An Authorization value that is the mark followed by wrappers only: text this module wrote, which a second pass leaves alone.
const MARKED = /^["']?\[redacted\][)\]}>*`'",.;:|_~]*$/

// Order matters: a longer match (a private key, a URL, an Authorization line) goes before the shorter ones inside it. These
// run before the key/value pairs, the token patterns (TOKENS) after them, so a value after a secret key that starts with a
// token is replaced to its end as one value, and a mark at the start of a value can only come from an earlier pass.
const PATTERNS = [
  // To the matching END line. Without one, to the blank line that follows, or to the end of the text.
  ['private_key', /-----BEGIN [A-Z ]*PRIVATE KEY(?: BLOCK)?-----(?:[\s\S]*?-----END [A-Z ]*PRIVATE KEY(?: BLOCK)?-----|[\s\S]*?(?=\n[ \t]*\n|$))/g, () => MARK],
  // The user may be empty (`redis://:password@host`). The password runs to the last @ before the path.
  ['url_credentials', /(?<![a-z0-9+.-])([a-z][a-z0-9+.-]*:\/\/)[^\s/@:]*:[^\s/]+@/gi, (_, scheme) => `${scheme}${MARK}@`],
  // Before the tokens, so a token inside the header is one value of this type. The value may be in quotes, closed or not.
  ['authorization', /(\bAuthorization["']?:[^\S\n]*)("(?:[^"\\\n]|\\.)*"?|'(?:[^'\\\n]|\\.)*'?|[^\s"'][^\n"']*)/gi, (whole, head, value) => (MARKED.test(value.trim()) ? whole : `${head}${MARK}`)],
  // The user and password of -u (alone or after other short options, `-su`) or --user, when it holds a colon. The lookback
  // is bounded so a line of `curl` stays linear.
  ['curl_user', /(\bcurl\b[^\n]{0,500}?[ \t](?:--user[ \t=]+|-[A-Za-z]*u[ \t]*))(?:"[^"\n]*:[^"\n]*"|'[^'\n]*:[^'\n]*'|[^\s"']*:[^\s"']*)/g, (_, head) => `${head}${MARK}`],
]
const TOKENS = [
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
//     the value and is still open (a backtick, `**`, `__`, `~~`, `(`, `[`, `{`) keeps its last closing mark on the line, and
//     only one that ends a word (see `ENDS`), so `login(password=Pa)ss` loses `)ss`.
//   - Nothing after the key, a YAML `|` or `>`, or a value that opens `{`, `[` or `(` without closing it or ends in `\`: the
//     lines below that are more indented than the key (see `under`) go too. With nothing after the key and a `name:` pair on
//     the first of them, they are a mapping: each value in it goes, the names stay.
//   - Left alone: a value that is the mark already, a number that is the whole value after a key that names a quantity
//     (`max_tokens`, `token_limit`, `secret_version`), a file location (`token.mjs:12:5`, `password.ts:42-50`), an empty
//     quoted value and a directory after the shell variable PWD or OLDPWD.
const SECRET_WORD = 'api[_-]?key|private[_-]?key|token|secret|passw(?:or)?d|pwd|credentials?|authorization'
const KEY_WORDS = new RegExp(SECRET_WORD, 'i')
const SECRET_LAST = new RegExp(`(?:${SECRET_WORD})$`, 'i')
const SHELL_PWD = /^(?:old)?pwd$/i
// A plural (`max_tokens`, not `SECRET_PASS`) or a word of quantity.
const QUANTITY = /(?:(?<!s)s|limit|count|version|size|length|max|min)$/i
const keepsNumber = (key, value) => /^\d+(?:\.\d+)?$/.test(value) && QUANTITY.test(key) && !SECRET_LAST.test(key)
// A source or config file name before `:line`, `:line:column` or `:line-line`, and what may follow it: the end, a space,
// a quote, a closing mark, a sentence mark, or a colon and a space (`file.py:42: AssertionError`, not `file.txt:1:hunter2`).
const FILE_KEY = /\.(?:[cm]?[jt]sx?|py|rb|go|rs|java|kts?|scala|swift|c|h|cc|cpp|hpp|cs|php|sh|bash|zsh|ps1|pl|lua|exs?|erl|dart|vue|svelte|sql|ya?ml|json|toml|ini|cfg|conf|env|txt|md|log|xml|html?|css|scss|tf|gradle|properties)$/i
const LOCATION = /\d+(?::\d+)*(?:-\d+)?(?=[\s`'")\],;!?]|[.:](?=\s|$)|$)/y// A key starts with a word character or a dot, so the `-` of a removed diff line is not part of it. It may have an index
// (`secret[0]=`) and close a quote, an escaped quote (`{\"password\":`) or a bracket (`config["password"] =`).
const KEY_SEPARATOR = /(?<![\w.-])-*([\w.][\w.-]*)((?:\[[^\]\s"']{0,64}\])?\\?["']?\]?[^\S\n]*(?:=>|:=|===?|[=:])[^\S\n]*)/g
// YAML doubles a single quote inside single quotes (`'it''s'`).
const QUOTED = /"(?:[^"\\]|\\[\s\S]){0,4096}"|'(?:[^'\\]|\\[\s\S]|''){0,4096}'/y
// What may follow a closing quote for the quoted text to be the whole value (`"pa"ss`, `"abc"-def` are not).
const AFTER_QUOTE = /[\s,;)\]}]|$/y
// An empty quoted value is left alone only when nothing but a separator or a closing mark follows it (`password: "" x` goes).
const EMPTY_END = /[^\S\n]*(?:[,;)\]}]|\n|$)/y
// The mark of an earlier pass, followed by what may end a value.
const DONE = /\[redacted\](?=[\s,;'"`)\]}]|$)/y
// A value that opens a bracket without closing it, or ends in a line continuation.
const OPENS = (value) => value.endsWith('\\') || ['{}', '[]', '()'].some(([open, close]) => value.split(open).length > value.split(close).length)
// What may follow a closing mark that ends the value: the end, a space, a sentence mark, a quote or another closing mark.
const ENDS = /[\s.,;:!?'"`)\]}>*_~|]|$/y
const TABLE_ROW = /[^\S\n]*\|/y
// A YAML block indicator, a comment or both, after an anchor or a tag: the value is on the lines below.
const BLOCK = /^(?:[&!]\S*[^\S\n]+)*(?:[|>][+-]?\d?[+-]?)?(?:[^\S\n]*#.*)?$/
const MAPPING = /[\w.-]+["']?[^\S\n]*:(?=\s|$)/y
const PAIR = /(?<![\w.-])[\w.-]+["']?[^\S\n]*:(?:[^\S\n]+|$)/
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
    // A blank line, or a YAML comment in any column, belongs to the block if more of it follows.
    if (indent === line.length || line[indent] === '#' || (space(line[column]) && !line.slice(column).trim())) continue
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
    const keyAt = start - match[2].length - key.length
    if (!KEY_WORDS.test(key) || keyAt < position) continue
    if (at(DONE, text, start) || (match[2] === ':' && FILE_KEY.test(key) && at(LOCATION, text, start))) continue
    if (SHELL_PWD.test(key) && (text[start] === '/' || text[start] === '~')) continue
    if (text[start] === '"' || text[start] === "'") {
      QUOTED.lastIndex = start
      const quoted = QUOTED.exec(text)
      if (quoted && at(AFTER_QUOTE, text, start + quoted[0].length)) {
        const inner = quoted[0].slice(1, -1)
        if (inner && inner !== MARK && !keepsNumber(key, inner)) replace(start, start + quoted[0].length)
        if (inner || at(EMPTY_END, text, start + 2)) continue
      }
    }
    // The line is read once, however many keys it holds.
    if (keyAt > lineStop) {
      lineStart = text.lastIndexOf('\n', keyAt) + 1
      lineStop = lineEnd(text, keyAt)
      table = at(TABLE_ROW, text, lineStart)
    }
    const cell = table ? text.lastIndexOf('|', keyAt) + 1 : lineStart
    let end = table ? text.indexOf('|', start) : lineStop
    if (end === -1 || end > lineStop) end = lineStop
    let value = text.slice(start, end).trimEnd()
    const below = !table && (!value || BLOCK.test(value))
    const opens = !table && !below && OPENS(value)
    const lines = (below || opens) && under(text, lineStop, keyAt - lineStart, leadOf(text.slice(lineStart, keyAt)), text[keyAt - 1])
    if (lines) {
      if (text.slice(lines.first, lines.last) === MARK) continue
      if (!value && at(MAPPING, text, lines.first)) {
        // A mapping under a secret key: every value in it goes and the names stay. A line with no `name:` goes whole.
        for (let from = lines.first; from < lines.last; from = lineEnd(text, from) + 1) {
          const stop = Math.min(lineEnd(text, from), lines.last)
          const line = text.slice(from, stop)
          const pair = line.match(PAIR)
          const begin = from + (pair ? pair.index + pair[0].length : leadOf(line))
          const rest = text.slice(begin, stop).trimEnd()
          if (rest && rest !== MARK) replace(begin, begin + rest.length)
        }
        continue
      }
      // A lone opening mark stays (`"credentials": {`), and so does the closing line below.
      replace(!value || /^[{[(\\]$/.test(value) ? lines.first : start, lines.last)
      continue
    }
    // With no line below, a lone `|` or `>` is left alone and a comment is the value itself (`PASSWORD=#hunter2`).
    if (below && !value.startsWith('#')) continue
    // A key's leading underscores are Markdown (`__token=x__`), not part of the name.
    for (const close of openClosers(text.slice(cell, keyAt + key.match(/^_*/)[0].length))) {
      let cut = value.lastIndexOf(close)
      while (cut !== -1 && !(at(ENDS, value, cut + close.length) || (close === ']' && value[cut + 1] === '('))) cut = cut ? value.lastIndexOf(close, cut - 1) : -1
      if (cut !== -1) value = value.slice(0, cut)
    }
    value = value.trimEnd()
    if (!value || value === MARK || keepsNumber(key, value)) continue
    replace(start, start + value.length)
  }
  return out + text.slice(position)
}

/** Returns { text, count, counts, summary }: the text with each secret replaced, the total, the number replaced per type and the line for the comment. */
export function redact(input) {
  let text = String(input)
  const counts = {}
  const run = (patterns) => {
    for (const [type, pattern, replace] of patterns) {
      text = text.replace(pattern, (...args) => {
        const out = replace(...args)
        if (out !== args[0]) counts[type] = (counts[type] ?? 0) + 1
        return out
      })
    }
  }
  run(PATTERNS)
  text = redactPairs(text, counts)
  run(TOKENS)
  const count = Object.values(counts).reduce((sum, n) => sum + n, 0)
  return { text, count, counts, summary: `Redacted ${count} ${count === 1 ? 'value' : 'values'}.` }
}
