import crypto from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const fixtures = path.join(path.dirname(fileURLToPath(import.meta.url)), '__fixtures__')

/** Copies a fixture into a fresh temp folder and returns its path. */
export function makeRepo(name = 'basic') {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pmkit-'))
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
