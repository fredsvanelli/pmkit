// Replaces the secrets that a log, a diff or a stack trace may hold with [redacted]. It only reads text: no tracker, no
// file, no network. The patterns are a floor, not a guarantee, so a command that posts the result still shows it first.

const MARK = '[redacted]'
const strip = (value) => value.replace(/^["']|["']$/g, '')
const keep = (value) => strip(value) === MARK

const KEY_WORDS = /api[_-]?key|token|secret|passw(?:or)?d|pwd|credentials/i
// Short passwords are common, so these names have a floor of 6 characters, and a plain word counts as a password.
const SHORT_KEYS = /passw(?:or)?d|pwd|credentials/i
const CODE_WORDS = /^(?:string|number|boolean|undefined|null|any|true|false)$/i
const ENDS_WITH_NUMBER = /:\d+$/

// Whether the value after a key such as `token=` or `password:` is a secret. It is not when it is short, only digits, a
// port or a line:column, code (`string`, `process.env.NAME`, `req.body.password`) or a path. A password name accepts a
// plain word. Any other name needs a digit or a symbol, or 16 letters or more.
function looksSecret(key, raw) {
  const quoted = /^["']/.test(raw)
  const value = quoted ? strip(raw) : raw.replace(/[)>\]}`:]+$/, '')
  const short = SHORT_KEYS.test(key)
  if (value.length < (short ? 6 : 8) || /^\d+$/.test(value) || ENDS_WITH_NUMBER.test(value)) return false
  if (short) return !CODE_WORDS.test(value) && !/[.(]/.test(value) && !/^[/~]/.test(value)
  return /[\d\-_+/=@$!%^&*~]/.test(value) || (value.length >= 16 && !/[.(/]/.test(value))
}

// Order matters: a longer match (a private key, a URL, an Authorization line) goes before the shorter ones inside it.
const PATTERNS = [
  // To the matching END line. Without one, to the blank line that follows, or to the end of the text.
  ['private_key', /-----BEGIN [A-Z ]*PRIVATE KEY(?: BLOCK)?-----(?:[\s\S]*?-----END [A-Z ]*PRIVATE KEY(?: BLOCK)?-----|[\s\S]*?(?=\n[ \t]*\n|$))/g, () => MARK],
  // The user may be empty (`redis://:password@host`). The password runs to the last @ before the path.
  ['url_credentials', /(?<![a-z0-9+.-])([a-z][a-z0-9+.-]*:\/\/)[^\s/@:]*:[^\s/]+@/gi, (_, scheme) => `${scheme}${MARK}@`],
  // Before the tokens, so a token inside the header is one value of this type. The value may be in quotes.
  ['authorization', /(\bAuthorization:[ \t]*)("[^"\n]*"|'[^'\n]*'|[^\s"'][^\n"']*)/gi, (whole, head, value) => (keep(value.trim()) ? whole : `${head}${MARK}`)],
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

// Finds every `key=value` or `key: value` and replaces the value when the key names a secret and the value looks like one.
// The scan goes on inside a value it leaves alone, so `?a=1&api_key=...` and `env: GITHUB_TOKEN=...` are found. A match
// starts only at the beginning of a word and a value stops at 512 characters, so the scan stays linear.
const KEY_SEPARATOR = /(?<![\w.-])([\w.-]+)(["']?[ \t]*[=:][ \t]*)/g
const VALUE = /"[^"\n]*"|'[^'\n]*'|[^\s"',;&]{1,512}/y

function redactPairs(text, counts) {
  let out = ''
  let position = 0
  KEY_SEPARATOR.lastIndex = 0
  for (let match = KEY_SEPARATOR.exec(text); match; match = KEY_SEPARATOR.exec(text)) {
    const start = match.index + match[0].length
    if (!KEY_WORDS.test(match[1])) continue
    VALUE.lastIndex = start
    const found = VALUE.exec(text)
    if (!found || keep(found[0]) || !looksSecret(match[1], found[0])) continue
    out += `${text.slice(position, start)}${MARK}`
    position = start + found[0].length
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
