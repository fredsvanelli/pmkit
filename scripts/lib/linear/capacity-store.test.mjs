import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import { FAKE_KEY } from '../../fake-linear-api.mjs'
import { tempDir } from '../../test-helpers.mjs'
import { entryFor, readCapacity, writeEntry } from './capacity-store.mjs'

const FILE = '.pmkit/capacity.yaml'
const SPRINT = { id: '12', start: '2026-11-02', end: '2026-11-13' }
const SECOND = { id: '9', start: '2026-10-19', end: '2026-10-30' }
const MEMBERS = ['4f1c9a2e-0000-0000-0000-000000000001', 'user-2']
const [ADA, BOB] = MEMBERS
const write = (root, change, options = {}, sprint = SPRINT) => writeEntry(root, 'ACME', sprint.id, change, { sprint, members: MEMBERS, ...options })
const fileOf = (root) => path.join(root, FILE)
const text = (root) => fs.readFileSync(fileOf(root), 'utf8')

test('a read with no file gives an empty entry', () => {
  const root = tempDir()
  assert.deepEqual(entryFor(readCapacity(root, 'ACME'), '12'), { capacity: {}, daysOff: {} })
  assert.equal(fs.existsSync(fileOf(root)), false)
})

test('a write creates the file with version 1 and the shape of the spec', () => {
  const root = tempDir()
  const { before, after } = write(root, { capacity: { [ADA]: 8 }, daysOff: { [ADA]: ['2026-11-03'] } })
  assert.deepEqual(before, { capacity: {}, daysOff: {} })
  assert.deepEqual(after, { capacity: { [ADA]: 8 }, daysOff: { [ADA]: ['2026-11-03'] } })
  assert.equal(text(root), `version: 1\ncycles:\n  ACME:\n    12:\n      capacity: { ${ADA}: 8 }\n      days_off:\n        ${ADA}: [2026-11-03]\n`)
  assert.deepEqual(entryFor(readCapacity(root, 'ACME'), '12'), after)
})

test('a second cycle keeps the first, and other teams stay', () => {
  const root = tempDir()
  write(root, { capacity: { [ADA]: 8 } })
  writeEntry(root, 'OPS', '3', { capacity: { [BOB]: 5 } }, { sprint: SPRINT, members: MEMBERS })
  write(root, { capacity: { [BOB]: 4 } }, {}, SECOND)
  assert.deepEqual(entryFor(readCapacity(root, 'ACME'), '12').capacity, { [ADA]: 8 })
  assert.deepEqual(entryFor(readCapacity(root, 'ACME'), '9').capacity, { [BOB]: 4 })
  assert.deepEqual(entryFor(readCapacity(root, 'OPS'), '3').capacity, { [BOB]: 5 })
})

test('cycle ids sort numerically and two writes of the same data give the same bytes', () => {
  const root = tempDir()
  write(root, { capacity: { [BOB]: 4, [ADA]: 8 } })
  write(root, { capacity: { [ADA]: 3 } }, {}, SECOND)
  const first = text(root)
  assert.ok(first.indexOf('\n    9:') < first.indexOf('\n    12:'))
  assert.ok(first.indexOf(ADA) < first.indexOf(BOB))
  write(root, { capacity: { [BOB]: 4, [ADA]: 8 } })
  assert.equal(text(root), first)
})

test('member null clears the days off of a member and the rest stays', () => {
  const root = tempDir()
  write(root, { daysOff: { [ADA]: ['2026-11-03'], [BOB]: ['2026-11-04'] } })
  const { after } = write(root, { daysOff: { [ADA]: null } })
  assert.deepEqual(after.daysOff, { [BOB]: ['2026-11-04'] })
  assert.deepEqual(entryFor(readCapacity(root, 'ACME'), '12').daysOff, { [BOB]: ['2026-11-04'] })
  write(root, { daysOff: { [BOB]: null } })
  assert.deepEqual(entryFor(readCapacity(root, 'ACME'), '12'), { capacity: {}, daysOff: {} })
})

test('a day off outside the cycle, a weekend and a capacity key that is not a member are INVALID_INPUT', () => {
  const root = tempDir()
  assert.throws(() => write(root, { daysOff: { [ADA]: ['2026-12-01'] } }), { code: 'INVALID_INPUT', message: /outside the sprint/ })
  assert.throws(() => write(root, { daysOff: { [ADA]: ['2026-11-07'] } }), { code: 'INVALID_INPUT', message: /not a weekday/ })
  assert.throws(() => write(root, { capacity: { stranger: 3 } }), { code: 'INVALID_INPUT', message: /not a member/ })
  assert.throws(() => write(root, { capacity: { [ADA]: -1 } }), { code: 'INVALID_INPUT' })
  assert.equal(fs.existsSync(fileOf(root)), false)
})

test('a file with bad YAML or another version fails and stays byte-identical', () => {
  const bad = ['cycles: [oops\n  x', 'version: 2\ncycles: {}\n', 'version: 1\ncycles: 5\n', 'version: 1\ncycles:\n  ACME:\n    12:\n      capacity: { u: lots }\n', '- a\n- b\n']
  for (const content of bad) {
    const root = tempDir()
    fs.mkdirSync(path.join(root, '.pmkit'))
    fs.writeFileSync(fileOf(root), content)
    for (const attempt of [() => readCapacity(root, 'ACME'), () => write(root, { capacity: { [ADA]: 8 } })]) {
      assert.throws(attempt, (error) => {
        assert.equal(error.code, 'INVALID_INPUT')
        assert.match(error.message, /^\.pmkit\/capacity\.yaml is not valid: /)
        assert.equal(error.nextStep, 'Fix or delete the file')
        return true
      }, content)
    }
    assert.equal(text(root), content)
  }
})

test('a dry run builds after and writes no file', () => {
  const root = tempDir()
  const { after } = write(root, { capacity: { [ADA]: 8 } }, { dryRun: true })
  assert.deepEqual(after.capacity, { [ADA]: 8 })
  assert.equal(fs.existsSync(fileOf(root)), false)
  assert.equal(fs.existsSync(path.join(root, '.pmkit')), false)
})

test('a write goes through a temporary file and leaves none behind', () => {
  const root = tempDir()
  write(root, { capacity: { [ADA]: 8 } })
  write(root, { capacity: { [ADA]: 9 } })
  assert.deepEqual(fs.readdirSync(path.join(root, '.pmkit')), ['capacity.yaml'])
})

test('no file under the root holds the key', () => {
  const root = tempDir()
  write(root, { capacity: { [ADA]: 8 } })
  for (const entry of fs.readdirSync(root, { recursive: true, withFileTypes: true }).filter((item) => item.isFile())) {
    assert.ok(!fs.readFileSync(path.join(entry.parentPath, entry.name), 'utf8').includes(FAKE_KEY))
  }
})
