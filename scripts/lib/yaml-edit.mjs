// Line editor for pmkit config files: changes one value or adds one map entry
// and leaves every other line, comments included, as it was. It reads block
// maps indented by two spaces, the shape every pmkit config uses.

import { stringifyYaml, stripComment } from './yaml.mjs'

const isContent = (line) => line.trim() !== '' && !line.trim().startsWith('#')
const indentOf = (line) => line.match(/^ */)[0].length
const hasKey = (line, key) => {
  const text = line.trim()
  return text.startsWith(`${key}:`) && (text.length === key.length + 1 || /\s/.test(text[key.length + 1]))
}

// Writes a value with stringifyYaml, so the quoting rules match the writer.
function formatValue(value) {
  if (Array.isArray(value) && value.length === 0) return '[]'
  if (value === '') return "''"
  const out = stringifyYaml({ k: value })
  if (!out.startsWith('k: ')) throw new TypeError(`cannot write ${JSON.stringify(value)}`)
  return out.slice(3).replace(/\n$/, '')
}

const split = (text) => text.replace(/^\uFEFF/, '').replace(/\r\n/g, '\n').split('\n')
const join = (lines) => lines.join('\n')

// Finds the direct children of the block that starts after `header` (-1 for the root).
function block(lines, header) {
  const parentIndent = header < 0 ? -1 : indentOf(lines[header])
  let last = header
  let childIndent = null
  const children = []
  for (let i = header + 1; i < lines.length; i++) {
    if (!isContent(lines[i])) continue
    const indent = indentOf(lines[i])
    if (indent <= parentIndent) break
    last = i
    if (childIndent === null) childIndent = indent
    if (indent === childIndent) children.push(i)
  }
  return { children, last, childIndent: childIndent ?? parentIndent + 2 }
}

// Header line of each key in the path, or an error naming the path. With createParents, a missing key
// at any depth gives { parent, depth } for the first one: the line it belongs under and its place in the path.
function walk(lines, keyPath, { lastMayBeMissing, createParents = false }) {
  let header = -1
  for (let depth = 0; depth < keyPath.length; depth++) {
    const key = keyPath[depth]
    const { children } = block(lines, header)
    const found = children.find((i) => hasKey(lines[i], key))
    if (found === undefined) {
      if (createParents || (lastMayBeMissing && depth === keyPath.length - 1)) return { parent: header, missing: key, depth }
      throw new Error(`key path ${keyPath.slice(0, depth + 1).join('.')} not found`)
    }
    if (depth < keyPath.length - 1 && stripComment(lines[found]).trim().slice(key.length + 1).trim() !== '') {
      throw new Error(`key path ${keyPath.join('.')} crosses a value that is not a block map`)
    }
    header = found
  }
  return { header }
}

function insertAfter(lines, parent, line) {
  const { last, childIndent } = block(lines, parent)
  const at = parent < 0 && last < 0 ? lines.filter(isContent).length === 0 ? 0 : last + 1 : last + 1
  lines.splice(at, 0, ' '.repeat(parent < 0 ? 0 : childIndent) + line)
  return at
}

function ensureTrailingNewline(lines) {
  if (lines.length === 0 || lines[lines.length - 1] !== '') lines.push('')
}

// Adds the parent maps of keyPath that the file lacks and returns the line of the last one (-1 for the root).
function createParents(lines, keyPath, found) {
  let parent = found.parent
  if (parent >= 0 && stripComment(lines[parent]).trim().slice(keyPath[found.depth - 1].length + 1).trim() !== '') {
    throw new Error(`key path ${keyPath.join('.')} crosses a value that is not a block map`)
  }
  for (let depth = found.depth; depth < keyPath.length - 1; depth++) parent = insertAfter(lines, parent, `${keyPath[depth]}:`)
  return parent
}

export function setScalar(text, keyPath, value) {
  if (keyPath.length === 0) throw new Error('key path is empty')
  const lines = split(text)
  const found = walk(lines, keyPath, { lastMayBeMissing: true, createParents: true })
  const formatted = formatValue(value)
  const key = keyPath[keyPath.length - 1]
  if (found.missing !== undefined) {
    insertAfter(lines, createParents(lines, keyPath, found), `${key}: ${formatted}`)
    ensureTrailingNewline(lines)
    return join(lines)
  }
  const line = lines[found.header]
  const { children } = block(lines, found.header)
  if (children.length > 0) throw new Error(`key path ${keyPath.join('.')} holds a block, not a scalar`)
  const rest = line.slice(stripComment(line).trimEnd().length)
  lines[found.header] = `${' '.repeat(indentOf(line))}${key}: ${formatted}${rest}`
  return join(lines)
}

/**
 * Sets keyPath to a map of scalars, creating the parent maps. An empty object is written as `key: {}`.
 * An existing block or flow value at keyPath is replaced, and the lines around it stay.
 */
export function setMap(text, keyPath, object) {
  if (keyPath.length === 0) throw new Error('key path is empty')
  const lines = split(text)
  const key = keyPath[keyPath.length - 1]
  const entries = Object.entries(object).map(([name, value]) => {
    const entry = stringifyYaml({ [name]: value }).replace(/\n$/, '')
    if (entry.includes('\n')) throw new Error(`cannot write ${name} as one line`)
    return entry
  })
  const found = walk(lines, keyPath, { lastMayBeMissing: true, createParents: true })
  let header
  if (found.missing !== undefined) {
    header = insertAfter(lines, createParents(lines, keyPath, found), `${key}:`)
  } else {
    header = found.header
    const { last } = block(lines, header)
    lines.splice(header + 1, last - header)
    lines[header] = `${' '.repeat(indentOf(lines[header]))}${key}:`
  }
  if (entries.length === 0) lines[header] = `${lines[header]} {}`
  else lines.splice(header + 1, 0, ...entries.map((entry) => ' '.repeat(indentOf(lines[header]) + 2) + entry))
  ensureTrailingNewline(lines)
  return join(lines)
}

export function addMapEntry(text, keyPath, key, value) {
  const lines = split(text)
  const { header } = walk(lines, keyPath, { lastMayBeMissing: false })
  const line = lines[header]
  const name = keyPath[keyPath.length - 1]
  const inline = stripComment(line).trim().slice(name.length + 1).trim()
  if (inline !== '' && inline !== '{}') throw new Error(`key path ${keyPath.join('.')} is not a block map`)
  const { children } = block(lines, header)
  if (children.some((i) => hasKey(lines[i], key))) throw new Error(`${keyPath.join('.')} already has the key ${key}`)
  if (inline === '{}') {
    const rest = line.slice(stripComment(line).trimEnd().length)
    lines[header] = `${' '.repeat(indentOf(line))}${name}:${rest}`
  }
  const entry = stringifyYaml({ [key]: value }).replace(/\n$/, '')
  if (entry.includes('\n')) throw new Error(`cannot write ${key} as one line`)
  insertAfter(lines, header, entry)
  ensureTrailingNewline(lines)
  return join(lines)
}

const SCHEMA_LINE = /^#\s*yaml-language-server:\s*\$schema=(\S+)\s*$/

// Classifies a line: null when it is not a schema line, 'pmkit' when its URL
// is a pmkit schema URL of the same repository as `url` (any ref), else 'other'.
export function schemaLineMatcher(url) {
  const repo = /^https:\/\/raw\.githubusercontent\.com\/([^/]+\/[^/]+)\//.exec(url)?.[1]
  const own = repo
    ? new RegExp(`^https://raw\\.githubusercontent\\.com/${repo.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}/[^/\\s]+/schemas/(pmkit|issues)\\.config\\.schema\\.json$`)
    : null
  return (line) => {
    const found = SCHEMA_LINE.exec(line)
    if (!found) return null
    return own?.test(found[1]) ? 'pmkit' : 'other'
  }
}

// Puts the yaml-language-server schema line first: replaces an old pmkit line
// in place, leaves a line for another schema alone, otherwise inserts it.
export function setSchemaLine(text, url) {
  const matcher = schemaLineMatcher(url)
  const line = `# yaml-language-server: $schema=${url}`
  const lines = split(text)
  const kinds = lines.map(matcher)
  if (kinds.includes('pmkit')) {
    lines[kinds.indexOf('pmkit')] = line
    return join(lines)
  }
  if (kinds.includes('other')) return text
  lines.unshift(line)
  return join(lines)
}
