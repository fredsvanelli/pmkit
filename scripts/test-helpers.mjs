import crypto from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach } from 'node:test'
import { fileURLToPath } from 'node:url'

const fixtures = path.join(path.dirname(fileURLToPath(import.meta.url)), '__fixtures__')

const made = []

/** Makes a temp folder under os.tmpdir() and records it, so the test run removes it. */
export function tempDir(prefix = 'pmkit-') {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix))
  made.push(dir)
  return dir
}

/** Removes every folder made by tempDir since the last call. A folder already gone is fine. */
export function removeTempDirs() {
  for (const dir of made.splice(0)) fs.rmSync(dir, { recursive: true, force: true })
}

// Each test cleans up after itself. The exit hook catches folders made outside a test, at file level.
afterEach(removeTempDirs)
process.on('exit', removeTempDirs)

/** Copies a fixture into a fresh temp folder and returns its path. */
export function makeRepo(name = 'basic') {
  const root = tempDir('pmkit-')
  fs.cpSync(path.join(fixtures, name), root, { recursive: true })
  return root
}

export const fixedNow = (iso = '2026-10-23T12:00:00Z') => () => new Date(iso)

/** A random(n) that returns the listed values in order and fails when they run out. */
export function scriptedRandom(values) {
  let index = 0
  return () => {
    if (index >= values.length) throw new Error('scriptedRandom ran out of values')
    return values[index++]
  }
}

/** One hash over the relative path and bytes of every file under dir. The paths in `skip`, relative to dir with `/`, are left out. */
export function hashTree(dir, skip = []) {
  const hash = crypto.createHash('sha1')
  const walk = (current) => {
    for (const entry of fs.readdirSync(current, { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : 1))) {
      const full = path.join(current, entry.name)
      if (skip.includes(path.relative(dir, full).split(path.sep).join('/'))) continue
      if (entry.isDirectory()) walk(full)
      else hash.update(path.relative(dir, full)).update(fs.readFileSync(full))
    }
  }
  walk(dir)
  return hash.digest('hex')
}
