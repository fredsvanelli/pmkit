// Replaces the secrets that a log, a diff or a stack trace may hold with [redacted]. It only reads text: no tracker, no
// file, no network. The patterns are a floor, not a guarantee, so a command that posts the result still shows it first.

const MARK = '[redacted]'
const strip = (value) => value.replace(/^["']|["']$/g, '')
const keep = (value) => strip(value) === MARK

// PMK-197: a value after one of these keys is replaced in full unless it is provably not a secret (see `exempt`). The false
// positives this accepts are listed in docs/superpowers/specs/2026-11-09-pmk-197-redact-no-missed-secrets-design.md.
// The mark followed by wrappers only: text this module wrote, which a second pass leaves alone.
const MARKED = /^\[redacted\][)\]}>*`'",.;:|_~]*$/
const KEY_WORDS = /api[_-]?key|private[_-]?key|token|secret|passw(?:or)?d|pwd|credentials?/i
const PASSWORD_KEYS = /passw(?:or)?d|pwd|credentials?/i
const SHELL_PWD = /^(?:old)?pwd$/i
// Wrapper and sentence characters at the end of a value stay in the text, so `(token=x)`, `` `token=x` ``, `**token=x**`,
// `__token=x__`, `~~token=x~~` and a table cell keep their mark.
const WRAPPERS = new Set(')]}>*`\'",.;:|_~')
// A file name before the line and column of a stack frame (`password.ts:42:13`): the key is a file, not a password.
const FILE_KEY = /\.(?:[cm]?[jt]sx?|py|rb|go|rs|java|kt|cs|php|sh|ya?ml|json|toml|ini|env|conf|cfg|txt|md|log|properties|xml|html?|css|swift|c|h|cpp|hpp)$/i

// The end of the value text[from, to) without the wrappers at its end, found from the back so it is linear. A value that
// starts with the mark keeps the mark whole.
function trimEnd(text, from, to) {
  let end = to
  while (end > from && WRAPPERS.has(text[end - 1])) end--
  return text.startsWith(MARK, from) ? Math.max(end, Math.min(to, from + MARK.length)) : end
}

// The only values left alone: empty, a number or line:column after a name that is not a password (a limit, a port, a stack
// frame) or after a file name, and the directory in the shell variable PWD or OLDPWD.
function exempt(key, value) {
  if (!value) return true
  if ((!PASSWORD_KEYS.test(key) || FILE_KEY.test(key)) && /^\d+(?::\d+)*$/.test(value)) return true
  return SHELL_PWD.test(key) && /^[/~]/.test(value)
}

// Order matters: a longer match (a private key, a URL, an Authorization line) goes before the shorter ones inside it.
const PATTERNS = [
  // To the matching END line. Without one, to the blank line that follows, or to the end of the text.
  ['private_key', /-----BEGIN [A-Z ]*PRIVATE KEY(?: BLOCK)?-----(?:[\s\S]*?-----END [A-Z ]*PRIVATE KEY(?: BLOCK)?-----|[\s\S]*?(?=\n[ \t]*\n|$))/g, () => MARK],
  // The user may be empty (`redis://:password@host`). The password runs to the last @ before the path.
  ['url_credentials', /(?<![a-z0-9+.-])([a-z][a-z0-9+.-]*:\/\/)[^\s/@:]*:[^\s/]+@/gi, (_, scheme) => `${scheme}${MARK}@`],
  // Before the tokens, so a token inside the header is one value of this type. The value may be in quotes.
  ['authorization', /(\bAuthorization["']?:[ \t]*)("[^"\n]*"|'[^'\n]*'|[^\s"'][^\n"']*)/gi, (whole, head, value) => (MARKED.test(value.trim()) ? whole : `${head}${MARK}`)],
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

// Finds every `key=value` or `key: value` and replaces the value when the key names a secret. The scan goes on inside a
// value it leaves alone, so `?a=1&api_key=...` and `env: GITHUB_TOKEN=...` are found. A match starts only at the beginning
// of a word. An unquoted value runs to the next space; `&` ends it only before a new `name=`, `](` ends it so a link survives
// and `|` ends it so a table cell does. A quoted value may hold an escaped quote or a line break (up to 4096 characters); a
// quote that never closes runs to the end of the line. A YAML block (`|` or `>`) takes its more indented lines, and a key with
// nothing after it takes the next line when that line is more indented and is not itself a `name:` pair.
const KEY_SEPARATOR = /(?<![\w.-])([\w.-]+)(["']?[^\S\n]*[=:][^\S\n]*)/g
const QUOTED = /"(?:[^"\\]|\\[\s\S]){0,4096}"|'(?:[^'\\]|\\[\s\S]){0,4096}'/y
const UNQUOTED = /(?:\](?!\()|&(?![\w.-]+=)|[^\s&\]|])+/y
const BLOCK = /[|>][+-]?\d?[+-]?[^\S\n]*(?=\n|$)/y
const MAPPING = /^[\w.-]+["']?[^\S\n]*[=:]/

const indentOf = (line) => line.length - line.trimStart().length
const lineEnd = (text, from) => {
  const end = text.indexOf('\n', from)
  return end === -1 ? text.length : end
}

// The end of the more indented lines that follow the line break at `from`, or `from` when there are none. Blank lines inside
// the block belong to it.
function blockEnd(text, from, keyIndent) {
  let last = from
  for (let pos = from; pos < text.length; ) {
    const end = lineEnd(text, pos + 1)
    const line = text.slice(pos + 1, end)
    if (line.trim() && indentOf(line) <= keyIndent) break
    if (line.trim()) last = end
    pos = end
  }
  return last
}

function redactPairs(text, counts) {
  let out = ''
  let position = 0
  let runStart = 0
  let runEnd = 0
  let runTrim = 0
  const replace = (from, to) => {
    out += `${text.slice(position, from)}${MARK}`
    position = to
    KEY_SEPARATOR.lastIndex = Math.max(to, KEY_SEPARATOR.lastIndex)
    counts.api_key_value = (counts.api_key_value ?? 0) + 1
  }
  KEY_SEPARATOR.lastIndex = 0
  for (let match = KEY_SEPARATOR.exec(text); match; match = KEY_SEPARATOR.exec(text)) {
    const start = match.index + match[0].length
    const key = match[1]
    if (!KEY_WORDS.test(key) || start < position) continue
    const first = text[start]
    // Only a block or an empty value needs the indent of the key's line, so it is not read for every key.
    const keyIndent = () => indentOf(text.slice(text.lastIndexOf('\n', match.index) + 1, match.index + 1))
    if (first === undefined || first === '\n') {
      const from = start + 1
      const end = lineEnd(text, from)
      const line = text.slice(from, end)
      const body = line.trimStart()
      if (start >= text.length || !body.trim() || indentOf(line) <= keyIndent() || MAPPING.test(body) || MARKED.test(body.trimEnd())) continue
      replace(end - body.length, end - (body.endsWith('\r') ? 1 : 0))
      continue
    }
    BLOCK.lastIndex = start
    if (BLOCK.test(text)) {
      const head = lineEnd(text, start)
      replace(start, blockEnd(text, head, keyIndent()))
      continue
    }
    let end
    let value
    if (first === '"' || first === "'") {
      QUOTED.lastIndex = start
      const quoted = QUOTED.exec(text)
      if (quoted) {
        end = start + quoted[0].length
        value = strip(quoted[0])
        if (value === MARK || exempt(key, value)) continue
        replace(start, end)
        continue
      }
      end = trimEnd(text, start, lineEnd(text, start))
      value = text.slice(start, end)
    } else {
      // Every start inside a run reaches the same end, so the run is found once, not again for each key inside it.
      if (!(start > runStart && start < runEnd)) {
        UNQUOTED.lastIndex = start
        const found = UNQUOTED.exec(text)
        if (!found) continue
        runStart = start
        runEnd = start + found[0].length
        runTrim = trimEnd(text, start, runEnd)
      }
      end = Math.max(start, runTrim)
      value = text.slice(start, end)
    }
    if (value === MARK || exempt(key, value)) continue
    replace(start, end)
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
