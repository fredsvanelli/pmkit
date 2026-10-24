// The Local tracker's format version and the one-way migrations between formats.
// See the upgrade design, "Tracker format and migrations". A migration edits the
// tracker files of a copy, so planning one never writes to the repository.

import crypto from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { PmkitError } from '../errors.mjs'
import { setScalar } from '../yaml-edit.mjs'
import { writeFileAtomic } from './store.mjs'

export const FORMAT_VERSION = 1

/** Each entry is `{ from, to, describe, run(dir) }`, where `run` edits the tracker files under `dir` in place. */
export const MIGRATIONS = []

export function formatState(version, current = FORMAT_VERSION) {
  if (!Number.isInteger(version)) {
    throw new PmkitError('INVALID_INPUT', `the tracker format version must be a whole number, found ${JSON.stringify(version) ?? 'nothing'}`)
  }
  return version === current ? 'current' : version < current ? 'behind' : 'ahead'
}

/** The NOT_SUPPORTED error for a tracker whose format is behind or ahead of this pmkit. */
export function formatError({ state, version, current }) {
  const can = state === 'ahead' ? 'reads up to' : 'writes'
  return new PmkitError('NOT_SUPPORTED', `this repository uses tracker format ${version}, this pmkit ${can} format ${current}`, '/pmkit:upgrade', { format: { state, version, current } })
}

// Temporary copies live until the process exits.
const copies = new Set()
function removeOnExit(dir) {
  if (copies.size === 0) process.once('exit', () => { for (const copy of copies) fs.rmSync(copy, { recursive: true, force: true }) })
  copies.add(dir)
}

function snapshot(dir) {
  const files = new Map()
  const walk = (current) => {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const full = path.join(current, entry.name)
      if (entry.isDirectory()) walk(full)
      else files.set(path.relative(dir, full), crypto.createHash('sha1').update(fs.readFileSync(full)).digest('hex'))
    }
  }
  walk(dir)
  return files
}

function chain(from, to, migrations) {
  if (from > to) throw new PmkitError('NOT_SUPPORTED', `tracker format ${from} cannot go back to format ${to}`)
  const steps = []
  for (let version = from; version < to;) {
    const step = migrations.find((migration) => migration.from === version)
    if (!step || step.to <= version || step.to > to) {
      throw new PmkitError('NOT_SUPPORTED', `this pmkit has no migration from tracker format ${version} toward format ${to}`)
    }
    steps.push(step)
    version = step.to
  }
  return steps
}

/** Copies the tracker folder to a temporary folder and migrates the copy from `from` to `to`, step by step. */
export function planMigration({ root, trackerPath, from, to, migrations = MIGRATIONS }) {
  const steps = chain(from, to, migrations)
  const source = path.join(root, trackerPath)
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pmkit-format-'))
  removeOnExit(dir)
  fs.cpSync(source, dir, { recursive: true })
  const toRoot = (rel) => path.relative(root, path.join(source, rel)).split(path.sep).join('/')
  const configFile = path.join(dir, 'config.yaml')
  const planned = []
  for (const step of steps) {
    const before = snapshot(dir)
    try {
      step.run(dir)
    } catch (error) {
      throw new PmkitError('INVALID_INPUT', `migration ${step.from} to ${step.to} failed: ${error.message}`, 'pmkit validate')
    }
    fs.writeFileSync(configFile, setScalar(fs.readFileSync(configFile, 'utf8'), ['version'], step.to))
    const after = snapshot(dir)
    const changes = []
    for (const [rel, hash] of after) {
      if (!before.has(rel)) changes.push({ path: toRoot(rel), action: 'create' })
      else if (before.get(rel) !== hash) changes.push({ path: toRoot(rel), action: 'change' })
    }
    for (const rel of before.keys()) if (!after.has(rel)) changes.push({ path: toRoot(rel), action: 'delete' })
    changes.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0))
    planned.push({ from: step.from, to: step.to, describe: step.describe, changes })
  }
  return { from, to, steps: planned, dir, trackerPath }
}

/** The migrated copy of the tracker folder, for reads. */
export function migratedCopy(opts) {
  return planMigration(opts).dir
}

/** Writes the plan into the real tracker folder: every created or changed file is copied from the plan's copy, every deleted one is removed. */
export function applyMigration(plan, { root }) {
  const source = path.join(root, plan.trackerPath)
  const touched = new Set(plan.steps.flatMap((step) => step.changes.map((change) => path.relative(source, path.join(root, change.path)))))
  // config.yaml goes last, so an interrupted run still reads as the old format.
  const ordered = [...touched].sort((a, b) => (a === 'config.yaml') - (b === 'config.yaml') || (a < b ? -1 : a > b ? 1 : 0))
  for (const rel of ordered) {
    const from = path.join(plan.dir, rel)
    const to = path.join(source, rel)
    if (fs.existsSync(from)) {
      fs.mkdirSync(path.dirname(to), { recursive: true })
      writeFileAtomic(to, fs.readFileSync(from))
    } else {
      fs.rmSync(to, { force: true })
    }
  }
}
