import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { tempDir } from '../../test-helpers.mjs'
import { stringifyYaml } from '../yaml.mjs'
import { MIGRATIONS_DIR, chooseMap, createMapStore, listMaps, mapCounts, mapFileName, newMap, readMap, sameTarget } from './id-map.mjs'

const LINEAR = { system: 'linear', workspace: 'acme', team: 'ACME' }
const LOCAL = { system: 'local', path: '.issues', commit: '87cc467', digest: 'sha256:abc' }

const exportMap = (overrides = {}) => newMap({ direction: 'export', started: '2026-10-28T20:00:00Z', source: LOCAL, target: LINEAR, mappings: { status: { in_review: 'In Review' } }, people: { fred: 'u-fred' }, ...overrides })

function writeMap(root, name, map) {
  fs.mkdirSync(path.join(root, MIGRATIONS_DIR), { recursive: true })
  fs.writeFileSync(path.join(root, MIGRATIONS_DIR, name), stringifyYaml(map))
}

test('mapFileName adds -2 for a second map of the day', () => {
  const root = tempDir()
  const first = { date: '2026-10-28', direction: 'export', system: 'linear' }
  assert.equal(mapFileName(root, first), '.pmkit/migrations/2026-10-28-export-linear.yaml')
  writeMap(root, '2026-10-28-export-linear.yaml', exportMap())
  assert.equal(mapFileName(root, first), '.pmkit/migrations/2026-10-28-export-linear-2.yaml')
  writeMap(root, '2026-10-28-export-linear-2.yaml', exportMap())
  assert.equal(mapFileName(root, first), '.pmkit/migrations/2026-10-28-export-linear-3.yaml')
})

test('newMap starts unfinished with no records', () => {
  const map = exportMap()
  assert.equal(map.version, 1)
  assert.equal(map.finished, null)
  assert.deepEqual(map.records, {})
})

test('set writes the file after every state change', () => {
  const root = tempDir()
  const file = mapFileName(root, { date: '2026-10-28', direction: 'export', system: 'linear' })
  const store = createMapStore(root, file, exportMap())
  store.set('issue', 'ISS-1', { state: 'sent', uuid: 'u1' })
  assert.deepEqual(readMap(root, file).records.issue['ISS-1'], { state: 'sent', uuid: 'u1' })
  store.set('issue', 'ISS-1', { state: 'done', uuid: 'u1', id: 'ACME-1', at: '2026-10-28T20:00:09Z' })
  assert.equal(readMap(root, file).records.issue['ISS-1'].state, 'done')
  assert.equal(readMap(root, file).records.issue['ISS-1'].id, 'ACME-1')
  assert.deepEqual(store.entry('issue', 'ISS-1').id, 'ACME-1')
  assert.equal(store.entry('issue', 'ISS-9'), undefined)
})

test('link and comment keys round-trip through the file', () => {
  const root = tempDir()
  const file = '.pmkit/migrations/2026-10-28-export-linear.yaml'
  const store = createMapStore(root, file, exportMap())
  store.set('link', 'blocks PMK-35 PMK-38', { state: 'done', uuid: 'u2' })
  store.set('comment', 'PMK-38/2026-10-28T18-11-19Z-fred', { state: 'failed', uuid: 'u3', error: { code: 'UPSTREAM', message: 'Linear did not answer: 502' } })
  const map = readMap(root, file)
  assert.equal(map.records.link['blocks PMK-35 PMK-38'].uuid, 'u2')
  assert.deepEqual(map.records.comment['PMK-38/2026-10-28T18-11-19Z-fred'].error, { code: 'UPSTREAM', message: 'Linear did not answer: 502' })
  assert.equal(map.finished, null)
  assert.deepEqual(map.people, { fred: 'u-fred' })
})

test('finish sets the time and writes the file', () => {
  const root = tempDir()
  const file = '.pmkit/migrations/2026-10-28-export-linear.yaml'
  const store = createMapStore(root, file, exportMap())
  store.finish('2026-10-28T20:05:00Z')
  assert.equal(readMap(root, file).finished, '2026-10-28T20:05:00Z')
})

test('readMap refuses a bad file and leaves it', () => {
  for (const [text, why] of [['version: 2\ndirection: export\n', 'version must be 1'], ['records: [\n', 'not valid YAML']]) {
    const root = tempDir()
    fs.mkdirSync(path.join(root, MIGRATIONS_DIR), { recursive: true })
    const file = path.join(root, MIGRATIONS_DIR, '2026-10-28-export-linear.yaml')
    fs.writeFileSync(file, text)
    assert.throws(() => readMap(root, '.pmkit/migrations/2026-10-28-export-linear.yaml'), (error) => {
      assert.equal(error.code, 'INVALID_INPUT')
      assert.equal(error.message, `.pmkit/migrations/2026-10-28-export-linear.yaml is not valid: ${why}`)
      assert.equal(error.nextStep, 'Fix the file; do not delete it while the migration is unfinished')
      return true
    })
    assert.equal(fs.readFileSync(file, 'utf8'), text)
  }
})

test('readMap names a missing key', () => {
  const root = tempDir()
  const { direction, ...rest } = exportMap()
  writeMap(root, '2026-10-28-export-linear.yaml', rest)
  assert.throws(() => readMap(root, '.pmkit/migrations/2026-10-28-export-linear.yaml'), /is not valid: direction is missing/)
})

test('chooseMap resumes the newest unfinished map of the same target', () => {
  const root = tempDir()
  writeMap(root, '2026-10-26-export-linear.yaml', exportMap({ started: '2026-10-26T10:00:00Z' }))
  const finished = { ...exportMap({ started: '2026-10-25T10:00:00Z' }), finished: '2026-10-25T10:05:00Z' }
  writeMap(root, '2026-10-25-export-linear.yaml', finished)
  writeMap(root, '2026-10-27-export-linear.yaml', exportMap({ target: { ...LINEAR, team: 'OTHER' } }))
  const choice = chooseMap(root, { direction: 'export', target: LINEAR })
  assert.equal(choice.resume.file, '.pmkit/migrations/2026-10-26-export-linear.yaml')
  assert.deepEqual(choice.finished.map((entry) => entry.file), ['.pmkit/migrations/2026-10-25-export-linear.yaml'])
})

test('chooseMap with a finished newest map returns no resume', () => {
  const root = tempDir()
  writeMap(root, '2026-10-25-export-linear.yaml', { ...exportMap(), finished: '2026-10-25T10:05:00Z' })
  const choice = chooseMap(root, { direction: 'export', target: LINEAR })
  assert.equal(choice.resume, null)
  assert.equal(choice.finished.length, 1)
})

test('chooseMap with a file resumes that map when it is unfinished', () => {
  const root = tempDir()
  writeMap(root, '2026-10-25-export-linear.yaml', exportMap())
  writeMap(root, '2026-10-26-export-linear.yaml', exportMap())
  const choice = chooseMap(root, { direction: 'export', target: LINEAR, file: '.pmkit/migrations/2026-10-25-export-linear.yaml' })
  assert.equal(choice.resume.file, '.pmkit/migrations/2026-10-25-export-linear.yaml')
})

test('listMaps orders by date, then by suffix, newest first', () => {
  const root = tempDir()
  for (const name of ['2026-10-25-export-linear.yaml', '2026-10-25-export-linear-2.yaml', '2026-10-25-export-linear-10.yaml', '2026-10-26-import-linear.yaml']) writeMap(root, name, exportMap())
  assert.deepEqual(listMaps(root).map((entry) => path.basename(entry.file)), [
    '2026-10-26-import-linear.yaml', '2026-10-25-export-linear-10.yaml', '2026-10-25-export-linear-2.yaml', '2026-10-25-export-linear.yaml',
  ])
  assert.deepEqual(listMaps(tempDir()), [])
})

test('sameTarget compares the system and its scope', () => {
  assert.equal(sameTarget(LINEAR, { ...LINEAR }), true)
  assert.equal(sameTarget(LINEAR, { ...LINEAR, team: 'OTHER' }), false)
  assert.equal(sameTarget({ system: 'local', path: '.issues' }, { system: 'local', path: '.issues', commit: 'x' }), true)
  assert.equal(sameTarget({ system: 'local', path: '.issues' }, LINEAR), false)
})

test('mapCounts counts each state per kind', () => {
  const map = exportMap()
  map.records = {
    issue: { A: { state: 'done' }, B: { state: 'sent' }, C: { state: 'failed', error: { code: 'UPSTREAM', message: 'x' } } },
    link: { 'blocks A B': { state: 'removed' } },
  }
  const counts = mapCounts(map)
  assert.deepEqual(counts.kinds.issue, { done: 1, sent: 1, failed: 1, removed: 0 })
  assert.deepEqual(counts.kinds.link, { done: 0, sent: 0, failed: 0, removed: 1 })
  assert.deepEqual(counts.failed, [{ kind: 'issue', key: 'C', error: { code: 'UPSTREAM', message: 'x' } }])
  assert.equal(counts.total, 4)
  assert.equal(counts.done, 1)
})
