// The per-issue event log (issues/<ID>/events.jsonl), its replay and drift detection.
// See the pmkit design spec, "Event log".

import fs from 'node:fs'
import { ISSUE_KEYS } from './issue-file.mjs'

const EVENT_KEYS = ['at', 'by', 'op', 'field', 'from', 'to', 'minutes', 'synthetic']
const LIST_FIELDS = ['blocked_by', 'related', 'duplicate_of']
const DRIFT_SKIP = ['id', 'created', 'updated']

const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value)

function sortedStringify(value) {
  return JSON.stringify(value, (key, inner) => (isObject(inner)
    ? Object.fromEntries(Object.keys(inner).sort().map((name) => [name, inner[name]]))
    : inner))
}

function checkEvent(event) {
  if (!isObject(event)) return 'the line is not a JSON object'
  const missing = ['at', 'by', 'op'].filter((key) => event[key] == null || event[key] === '')
  return missing.length ? `missing ${missing.join(', ')}` : null
}

export function readEvents(file) {
  if (!fs.existsSync(file)) return { events: [], problems: [] }
  const text = fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, '').replace(/\r\n/g, '\n')
  const events = []
  const problems = []
  const seen = new Set()
  text.split('\n').forEach((line, index) => {
    if (line.trim() === '') return
    let event
    try {
      event = JSON.parse(line)
    } catch (error) {
      problems.push(`line ${index + 1}: ${error.message}`)
      return
    }
    const reason = checkEvent(event)
    if (reason) {
      problems.push(`line ${index + 1}: ${reason}`)
      return
    }
    const key = sortedStringify(event)
    if (seen.has(key)) return
    seen.add(key)
    events.push(event)
  })
  events.sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : 0))
  return { events, problems }
}

function endsWithoutNewline(file) {
  if (!fs.existsSync(file)) return false
  const { size } = fs.statSync(file)
  if (size === 0) return false
  const fd = fs.openSync(file, 'r')
  try {
    const last = Buffer.alloc(1)
    fs.readSync(fd, last, 0, 1, size - 1)
    return last[0] !== 0x0a
  } finally {
    fs.closeSync(fd)
  }
}

export function appendEvents(file, events) {
  const lines = events.map((event) => {
    const ordered = {}
    for (const key of EVENT_KEYS) if (event[key] !== undefined) ordered[key] = event[key]
    return JSON.stringify(ordered) + '\n'
  })
  if (lines.length === 0) return
  const lead = endsWithoutNewline(file) ? '\n' : ''
  fs.appendFileSync(file, lead + lines.join(''))
}

export function replay(events) {
  const state = {}
  for (const event of events) {
    if (event.op === 'create') Object.assign(state, event.to)
    else if (['update', 'move', 'assign'].includes(event.op)) state[event.field] = event.to
    else if (event.op === 'link' || event.op === 'unlink') {
      if (!LIST_FIELDS.includes(event.field)) continue
      const list = Array.isArray(state[event.field]) ? state[event.field] : []
      state[event.field] = event.op === 'link'
        ? (list.includes(event.to) ? list : [...list, event.to])
        : list.filter((item) => item !== event.to)
    } else if (event.op === 'archive') state.archived = true
  }
  return state
}

const isEmpty = (value) => value == null || value === '' || (Array.isArray(value) && value.length === 0)
const same = (a, b) => (isEmpty(a) && isEmpty(b)) || JSON.stringify(a) === JSON.stringify(b)

export function driftEvents(frontmatter, events, { at, by }) {
  if (events.length === 0) return [{ at, by, op: 'create', to: frontmatter, synthetic: true }]
  const replayed = replay(events)
  const drift = []
  for (const key of ISSUE_KEYS) {
    if (DRIFT_SKIP.includes(key) || same(replayed[key], frontmatter[key])) continue
    const op = key === 'status' ? 'move' : key === 'assignee' ? 'assign' : 'update'
    drift.push({ at, by, op, field: key, from: replayed[key], to: frontmatter[key] ?? null, synthetic: true })
  }
  return drift
}
