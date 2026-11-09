// Replaces the secrets that a log, a diff or a stack trace may hold with [redacted]. It only reads text: no tracker, no
// file, no network. The patterns are a floor, not a guarantee, so a command that posts the result still shows it first.

const MARK = '[redacted]'
const strip = (value) => value.replace(/^["']|["']$/g, '')
const keep = (value) => strip(value) === MARK

// PMK-197: a value after one of these keys is replaced in full unless it is provably not a secret (see `exempt`). The false
// positives this accepts are listed in docs/superpowers/specs/2026-11-09-pmk-197-redact-no-missed-secrets-design.md.
const KEY_WORDS = /api[_-]?key|private[_-]?key|token|secret|passw(?:or)?d|pwd|credentials?/i
const PASSWORD_KEYS = /passw(?:or)?d|pwd|credentials?/i
const SHELL_PWD = /^(?:old)?pwd$/i
// Wrapper and sentence characters at the end of a value stay in the text, so `(token=x)`, `` `token=x` `` and `**token=x**` keep their mark.
const TRAILER = /[)\]}>*`'",.;:]+$/

// The only values left alone: empty, a number or line:column after a name that is not a password (a limit, a port, a stack
// frame), and the directory in the shell variable PWD or OLDPWD.
function exempt(key, value) {
  if (!value) return true
  if (!PASSWORD_KEYS.test(key) && /^\d+(?::\d+)*$/.test(value)) return true
  return SHELL_PWD.test(key) && /^[/~]/.test(value)
}

// Order matters: a longer match (a private key, a URL, an Authorization line) goes before the shorter ones inside it.
const PATTERNS = [
  // To the matching END line. Without one, to the blank line that follows, or to the end of the text.
  ['private_key', /-----BEGIN [A-Z ]*PRIVATE KEY(?: BLOCK)?-----(?:[\s\S]*?-----END [A-Z ]*PRIVATE KEY(?: BLOCK)?-----|[\s\S]*?(?=\n[ \t]*\n|$))/g, () => MARK],
  // The user may be empty (`redis://:password@host`). The password runs to the last @ before the path.
  ['url_credentials', /(?<![a-z0-9+.-])([a-z][a-z0-9+.-]*:\/\/)[^\s/@:]*:[^\s/]+@/gi, (_, scheme) => `${scheme}${MARK}@`],
  // Before the tokens, so a token inside the header is one value of this type. The value may be in quotes.
  ['authorization', /(\bAuthorization["']?:[ \t]*)("[^"\n]*"|'[^'\n]*'|[^\s"'][^\n"']*)/gi, (whole, head, value) => (keep(value.trim()) ? whole : `${head}${MARK}`)],
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
// of a word. An unquoted value runs to the next space; `&` ends it only before a new `name=`, and `](` ends it so a link survives.
const KEY_SEPARATOR = /(?<![\w.-])([\w.-]+)(["']?[ \t]*[=:][ \t]*)/g
const VALUE = /"[^"\n]*"|'[^'\n]*'|(?:\](?!\()|&(?![\w.-]+=)|[^\s&\]])+/y

function redactPairs(text, counts) {
  let out = ''
  let position = 0
  KEY_SEPARATOR.lastIndex = 0
  for (let match = KEY_SEPARATOR.exec(text); match; match = KEY_SEPARATOR.exec(text)) {
    const start = match.index + match[0].length
    if (!KEY_WORDS.test(match[1])) continue
    VALUE.lastIndex = start
    const found = VALUE.exec(text)
    if (!found || found[0].startsWith(MARK)) continue
    const quoted = /^["']/.test(found[0])
    const length = quoted ? found[0].length : found[0].replace(TRAILER, '').length
    const value = quoted ? strip(found[0]) : found[0].slice(0, length)
    if (keep(found[0]) || exempt(match[1], value)) continue
    out += `${text.slice(position, start)}${MARK}`
    position = start + length
    KEY_SEPARATOR.lastIndex = position
    counts.api_key_value = (counts.api_key_value ?? 0) + 1
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
