// The ID map of a migration: one YAML file per run under .pmkit/migrations/, written after every state change.
// See the PMK-41 spec, "The ID map".

import fs from 'node:fs'
import path from 'node:path'
import { PmkitError } from '../errors.mjs'
import { writeFileAtomic } from '../local/store.mjs'
import { parseYaml, stringifyYaml } from '../yaml.mjs'

export const MIGRATIONS_DIR = '.pmkit/migrations'
export const MAP_STATES = ['sent', 'done', 'failed', 'removed']

const ORDER = ['version', 'direction', 'started', 'finished', 'source', 'target', 'mappings', 'people', 'records']
const REQUIRED = ['version', 'direction', 'started', 'source', 'target']
const NAME = /^(\d{4}-\d{2}-\d{2})-(export|import)-([a-z0-9]+)(?:-([1-9]\d*))?\.yaml$/

const invalid = (file, why) => new PmkitError('INVALID_INPUT', `${file} is not valid: ${why}`, 'Fix the file; do not delete it while the migration is unfinished')

/** The root-relative path of a new map, with -2, -3 before .yaml when the name is taken. */
export function mapFileName(root, { date, direction, system }) {
  const base = `${date}-${direction}-${system}`
  for (let n = 1; ; n++) {
    const name = n === 1 ? `${base}.yaml` : `${base}-${n}.yaml`
    if (!fs.existsSync(path.join(root, MIGRATIONS_DIR, name))) return `${MIGRATIONS_DIR}/${name}`
  }
}

export function newMap({ direction, started, source, target, mappings = {}, people = {} }) {
  return { version: 1, direction, started, finished: null, source, target, mappings, people, records: {} }
}

/** Reads one map. Refuses unreadable YAML, a missing key or another version, and never touches the file. */
export function readMap(root, file) {
  let map
  try {
    map = parseYaml(fs.readFileSync(path.join(root, file), 'utf8'))
  } catch (error) {
    if (error.code === 'ENOENT') throw new PmkitError('NOT_FOUND', `${file} does not exist`, 'Run pmkit local-migrate status to list the maps')
    throw invalid(file, 'not valid YAML')
  }
  if (!map || typeof map !== 'object' || Array.isArray(map)) throw invalid(file, 'not a YAML map')
  if (map.version !== undefined && map.version !== 1) throw invalid(file, 'version must be 1')
  for (const key of REQUIRED) {
    if (map[key] === undefined || map[key] === null) throw invalid(file, `${key} is missing`)
  }
  if (!['export', 'import'].includes(map.direction)) throw invalid(file, 'direction must be export or import')
  for (const key of ['source', 'target']) {
    if (typeof map[key] !== 'object' || typeof map[key].system !== 'string') throw invalid(file, `${key} has no system`)
  }
  const records = map.records ?? {}
  if (typeof records !== 'object' || Array.isArray(records)) throw invalid(file, 'records must be a map')
  for (const [kind, entries] of Object.entries(records)) {
    if (!entries || typeof entries !== 'object') throw invalid(file, `records.${kind} must be a map`)
    for (const [key, entry] of Object.entries(entries)) {
      if (!MAP_STATES.includes(entry?.state)) throw invalid(file, `records.${kind}.${key} has no valid state`)
    }
  }
  return { ...map, finished: map.finished ?? null, mappings: map.mappings ?? {}, people: map.people ?? {}, records }
}

const writeMap = (root, file, map) => {
  fs.mkdirSync(path.join(root, MIGRATIONS_DIR), { recursive: true })
  writeFileAtomic(path.join(root, file), stringifyYaml(map, { order: ORDER }))
}

/** A map in memory that writes the whole file on every set and on finish. */
export function createMapStore(root, file, map) {
  const records = map.records
  return {
    file,
    map,
    entry: (kind, key) => records[kind]?.[key],
    set(kind, key, entry) {
      records[kind] ??= {}
      records[kind][key] = entry
      writeMap(root, file, map)
    },
    finish(at) {
      map.finished = at
      writeMap(root, file, map)
    },
  }
}

/** A store that keeps the map in memory only, for a dry run. */
export function memoryMapStore(file, map) {
  const records = map.records
  return {
    file,
    map,
    entry: (kind, key) => records[kind]?.[key],
    set(kind, key, entry) {
      records[kind] ??= {}
      records[kind][key] = entry
    },
    finish(at) {
      map.finished = at
    },
  }
}

const sortKey = (name) => {
  const match = NAME.exec(name)
  return { date: match?.[1] ?? '', n: Number(match?.[4] ?? 1) }
}

/** Every map under .pmkit/migrations/, newest first: by date, then by suffix number. */
export function listMaps(root) {
  const dir = path.join(root, MIGRATIONS_DIR)
  if (!fs.existsSync(dir)) return []
  return fs.readdirSync(dir)
    .filter((name) => NAME.test(name))
    .sort((a, b) => {
      const x = sortKey(a)
      const y = sortKey(b)
      if (x.date !== y.date) return x.date < y.date ? 1 : -1
      if (x.n !== y.n) return y.n - x.n
      return a < b ? 1 : a > b ? -1 : 0
    })
    .map((name) => {
      const file = `${MIGRATIONS_DIR}/${name}`
      return { file, map: readMap(root, file) }
    })
}

export function sameTarget(a, b) {
  if (!a || !b || a.system !== b.system) return false
  if (a.system === 'local') return (a.path ?? '.issues') === (b.path ?? '.issues')
  return a.workspace === b.workspace && a.team === b.team
}

/** The map a run resumes, and the finished maps of the same target, whose records the run already knows. */
export function chooseMap(root, { direction, target, file }) {
  const maps = listMaps(root)
  const finished = maps.filter((entry) => entry.map.finished && sameTarget(entry.map.target, target))
  if (file) {
    const named = maps.find((entry) => entry.file === file) ?? { file, map: readMap(root, file) }
    return { resume: named.map.finished ? null : named, finished: finished.filter((entry) => entry.file !== file) }
  }
  const resume = maps.find((entry) => entry.map.direction === direction && !entry.map.finished && sameTarget(entry.map.target, target)) ?? null
  return { resume, finished }
}

export function mapCounts(map) {
  const kinds = {}
  const failed = []
  let total = 0
  let done = 0
  for (const [kind, entries] of Object.entries(map.records ?? {})) {
    kinds[kind] = { done: 0, sent: 0, failed: 0, removed: 0 }
    for (const [key, entry] of Object.entries(entries)) {
      kinds[kind][entry.state]++
      total++
      if (entry.state === 'done') done++
      if (entry.state === 'failed') failed.push({ kind, key, error: entry.error })
    }
  }
  return { kinds, failed, total, done }
}
