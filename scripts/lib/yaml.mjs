// A YAML subset for runbook frontmatter: block maps, block lists of scalars,
// flow lists [a, b], flow maps { k: v }, quoted and plain scalars, comments.
// references/format.md documents the same subset for runbook authors.

export class FrontmatterError extends Error {}

// A key may hold a colon that is not followed by a space, as in `agent:claude`.
const KEY = '[A-Za-z0-9_.-]+(?::[A-Za-z0-9_.-]+)*'
const KEY_LINE = new RegExp(`^(${KEY}):(?:\\s+(.*))?$`)
const PLAIN_KEY = new RegExp(`^${KEY}$`)

export function splitFrontmatter(text) {
  const normalized = text.replace(/^\uFEFF/, '').replace(/\r\n/g, '\n')
  const match = normalized.match(/^---\n([\s\S]*?)\n---[ \t]*(?:\n|$)([\s\S]*)$/)
  if (!match) return null
  return { yaml: match[1], body: match[2] }
}

export function stripComment(line) {
  let quote = null
  for (let i = 0; i < line.length; i++) {
    const char = line[i]
    if (quote) {
      if (char === quote) quote = null
      continue
    }
    if (char === '"' || char === "'") quote = char
    else if (char === '#' && (i === 0 || /\s/.test(line[i - 1]))) return line.slice(0, i)
  }
  return line
}

function scalar(raw) {
  const text = raw.trim()
  if (text === '' || text === '~' || text === 'null') return null
  if (text === 'true') return true
  if (text === 'false') return false
  if (/^-?(0|[1-9]\d*)(\.\d+)?$/.test(text)) return Number(text)
  return text
}

function parseFlow(text, lineNo) {
  let i = 0
  const fail = (message) => {
    throw new FrontmatterError(`line ${lineNo}: ${message}`)
  }
  const skipSpace = () => {
    while (i < text.length && /\s/.test(text[i])) i++
  }
  // Brackets inside a plain scalar nest, so `/deliveries/[id]` stays one value.
  const readUntil = (stops) => {
    const start = i
    let depth = 0
    while (i < text.length) {
      const char = text[i]
      if (depth === 0 && stops.includes(char)) break
      if (char === '[' || char === '{') depth++
      else if ((char === ']' || char === '}') && depth > 0) depth--
      i++
    }
    return text.slice(start, i)
  }
  // A flow key ends at a colon followed by a space, a comma, a closing brace or the end.
  const readKey = () => {
    const start = i
    while (i < text.length && !',}'.includes(text[i])) {
      if (text[i] === ':' && (i + 1 >= text.length || /[\s,}]/.test(text[i + 1]))) break
      i++
    }
    return text.slice(start, i)
  }
  const quoted = () => {
    const quote = text[i++]
    let out = ''
    while (i < text.length && text[i] !== quote) {
      if (quote === '"' && text[i] === '\\' && i + 1 < text.length) {
        out += text[i + 1]
        i += 2
        continue
      }
      out += text[i++]
    }
    if (i >= text.length) fail('unterminated string')
    i++
    return out
  }
  const value = (stops) => {
    skipSpace()
    if (text[i] === '[') {
      i++
      const list = []
      skipSpace()
      if (text[i] === ']') {
        i++
        return list
      }
      for (;;) {
        list.push(value(',]'))
        skipSpace()
        if (text[i] === ',') {
          i++
          continue
        }
        if (text[i] === ']') {
          i++
          return list
        }
        fail('expected , or ]')
      }
    }
    if (text[i] === '{') {
      i++
      const map = {}
      skipSpace()
      if (text[i] === '}') {
        i++
        return map
      }
      for (;;) {
        skipSpace()
        const key = text[i] === '"' || text[i] === "'" ? quoted() : readKey().trim()
        skipSpace()
        if (text[i] !== ':') fail(`expected : after "${key}"`)
        i++
        map[key] = value(',}')
        skipSpace()
        if (text[i] === ',') {
          i++
          continue
        }
        if (text[i] === '}') {
          i++
          return map
        }
        fail('expected , or }')
      }
    }
    if (text[i] === '"' || text[i] === "'") return quoted()
    return scalar(readUntil(stops))
  }
  const result = value('')
  skipSpace()
  if (i < text.length) fail(`unexpected "${text[i]}"`)
  return result
}

const isItem = (text) => text === '-' || text.startsWith('- ')
const itemText = (text) => text.slice(1).trim()

function parseBlock(lines, start, indent) {
  const list = isItem(lines[start].text)
  const result = list ? [] : {}
  let i = start
  while (i < lines.length && lines[i].indent === indent) {
    const line = lines[i]
    if (list) {
      if (!isItem(line.text)) throw new FrontmatterError(`line ${line.no}: expected a list item`)
      result.push(parseFlow(itemText(line.text), line.no))
      i++
      continue
    }
    const match = line.text.match(KEY_LINE)
    if (!match) throw new FrontmatterError(`line ${line.no}: expected "key: value"`)
    const [, key, rest] = match
    i++
    if (rest) {
      result[key] = parseFlow(rest, line.no)
    } else if (i < lines.length && lines[i].indent > indent) {
      const [child, next] = parseBlock(lines, i, lines[i].indent)
      result[key] = child
      i = next
    } else if (i < lines.length && lines[i].indent === indent && isItem(lines[i].text)) {
      const items = []
      while (i < lines.length && lines[i].indent === indent && isItem(lines[i].text)) {
        items.push(parseFlow(itemText(lines[i].text), lines[i].no))
        i++
      }
      result[key] = items
    } else {
      result[key] = null
    }
  }
  return [result, i]
}

export function flowDepth(text) {
  let depth = 0
  let quote = null
  for (const char of text) {
    if (quote) {
      if (char === quote) quote = null
      continue
    }
    if (char === '"' || char === "'") quote = char
    else if (char === '[' || char === '{') depth++
    else if (char === ']' || char === '}') depth--
  }
  return depth
}

// A flow list or map left open at the end of a line continues on the next lines.
function joinFlowLines(lines) {
  const joined = []
  for (let k = 0; k < lines.length; k++) {
    const line = { ...lines[k] }
    const value = isItem(line.text) ? itemText(line.text) : line.text.match(KEY_LINE)?.[2] ?? ''
    if (/^[[{]/.test(value)) {
      while (flowDepth(line.text) > 0 && k + 1 < lines.length) {
        k++
        line.text = `${line.text} ${lines[k].text}`
      }
    }
    joined.push(line)
  }
  return joined
}

export function parseYaml(text) {
  const lines = []
  text.replace(/\r\n/g, '\n').split('\n').forEach((raw, index) => {
    const content = stripComment(raw)
    if (content.trim() === '') return
    const leading = content.match(/^\s*/)[0]
    if (leading.includes('\t')) throw new FrontmatterError(`line ${index + 1}: tabs are not allowed for indentation`)
    lines.push({ no: index + 1, indent: leading.length, text: content.trim() })
  })
  if (lines.length === 0) return {}
  const joined = joinFlowLines(lines)
  const [value, next] = parseBlock(joined, 0, joined[0].indent)
  if (next < joined.length) throw new FrontmatterError(`line ${joined[next].no}: unexpected indentation`)
  return value
}

// Writer: the inverse of parseYaml for the same subset.

const isScalar = (value) => ['string', 'number', 'boolean'].includes(typeof value)
const isPlainObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value)
const isEmpty = (value) =>
  value === undefined ||
  value === null ||
  value === '' ||
  (Array.isArray(value) && value.length === 0) ||
  (isPlainObject(value) && Object.values(value).every(isEmpty))

function formatScalar(value) {
  if (typeof value !== 'string') return String(value)
  const risky =
    value !== value.trim() ||
    /: | #|[[\]{},"']/.test(value) ||
    /^[-?:&*!|>'"%@`#]/.test(value) ||
    /:$/.test(value) ||
    scalar(value) !== value
  if (!risky) return value
  // flowDepth does not read backslash escapes, so a string holding " goes in single quotes.
  if (value.includes('"') && !value.includes("'")) return `'${value}'`
  return `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`
}

const formatKey = (key) => (PLAIN_KEY.test(key) ? key : formatScalar(key))

function formatList(list) {
  const items = list.filter((item) => !isEmpty(item))
  if (!items.every(isScalar)) throw new TypeError('lists may hold scalars only')
  return `[${items.map(formatScalar).join(', ')}]`
}

function formatFlowMap(map) {
  const entries = Object.entries(map).filter(([, value]) => !isEmpty(value))
  return `{ ${entries.map(([key, value]) => `${formatKey(key)}: ${formatScalar(value)}`).join(', ')} }`
}

function writeBlock(map, indent, keys) {
  const lines = []
  const pad = ' '.repeat(indent)
  for (const key of keys) {
    const value = map[key]
    if (isEmpty(value)) continue
    if (!PLAIN_KEY.test(key)) throw new TypeError(`key "${key}" cannot be written as a block key`)
    if (Array.isArray(value)) lines.push(`${pad}${key}: ${formatList(value)}`)
    else if (isPlainObject(value)) {
      const entries = Object.values(value).filter((entry) => !isEmpty(entry))
      if (entries.every(isScalar)) lines.push(`${pad}${key}: ${formatFlowMap(value)}`)
      else {
        lines.push(`${pad}${key}:`)
        lines.push(...writeBlock(value, indent + 2, Object.keys(value)))
      }
    } else if (isScalar(value)) lines.push(`${pad}${key}: ${formatScalar(value)}`)
    else throw new TypeError(`cannot write ${typeof value} for "${key}"`)
  }
  return lines
}

export function stringifyYaml(object, { order = [] } = {}) {
  const rest = Object.keys(object).filter((key) => !order.includes(key)).sort()
  const keys = [...order.filter((key) => key in object), ...rest]
  const lines = writeBlock(object, 0, keys)
  return lines.length ? `${lines.join('\n')}\n` : ''
}

export function joinFrontmatter(object, body, options) {
  return `---\n${stringifyYaml(object, options) || '\n'}---\n\n${body}`
}
