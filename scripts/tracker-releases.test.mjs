import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { createLocalTracker } from './lib/local/tracker.mjs'
import { issueRecord } from './lib/format.mjs'
import { issuePaths } from './lib/local/store.mjs'
import { hashTree, makeRepo } from './test-helpers.mjs'

function setup() {
  const root = makeRepo()
  const releasesDir = path.join(root, '.issues', 'releases')
  // Ids for issues and epics come from a counter, so each create gets a new one.
  let counter = 0
  const tracker = createLocalTracker(root, { now: () => new Date('2026-10-23T12:00:00Z'), random: (n) => counter++ % n })
  const write = (name, text) => {
    fs.mkdirSync(releasesDir, { recursive: true })
    fs.writeFileSync(path.join(releasesDir, name), text)
  }
  return { root, releasesDir, tracker, write }
}

const code = (expected, pattern, nextStep) => (error) => {
  assert.equal(error.code, expected)
  if (pattern) assert.match(error.message, pattern)
  if (nextStep !== undefined) assert.equal(error.nextStep, nextStep)
  return true
}

test('createRelease writes releases/<id>.md, then list and get return it', () => {
  const { tracker, releasesDir } = setup()
  const { before, after } = tracker.createRelease({ id: '1.2.0', name: 'Webhooks', tag: 'v1.2.0', target: '2026-11-30' }, 'fred')
  assert.equal(before, null)
  assert.deepEqual(after, { id: '1.2.0', name: 'Webhooks', tag: 'v1.2.0', target: '2026-11-30', state: 'planned', description: '' })
  assert.equal(fs.readFileSync(path.join(releasesDir, '1.2.0.md'), 'utf8'), '---\nname: Webhooks\ntag: v1.2.0\ntarget: 2026-11-30\n---\n')
  assert.deepEqual(tracker.listReleases(), [after])
  assert.deepEqual(tracker.getRelease('1.2.0'), after)
})

test('createRelease defaults name to the id and trims a given name', () => {
  const { tracker } = setup()
  assert.equal(tracker.createRelease({ id: '1.0.0' }, 'fred').after.name, '1.0.0')
  assert.equal(tracker.createRelease({ id: '2.0.0', name: '  Webhooks  ' }, 'fred').after.name, 'Webhooks')
})

test('createRelease dry run writes nothing and makes no releases folder', () => {
  const { tracker, root, releasesDir } = setup()
  const hash = hashTree(root)
  const { before, after } = tracker.createRelease({ id: '1.0.0', name: 'One' }, 'fred', { dryRun: true })
  assert.equal(before, null)
  assert.equal(after.id, '1.0.0')
  assert.equal(hashTree(root), hash)
  assert.equal(fs.existsSync(releasesDir), false)
})

test('createRelease refuses an id that matches an existing one ignoring case', () => {
  const { tracker, root } = setup()
  tracker.createRelease({ id: 'v1.2.0' }, 'fred')
  const hash = hashTree(root)
  assert.throws(() => tracker.createRelease({ id: 'V1.2.0' }, 'fred'), code('CONFLICT', /^release v1\.2\.0 already exists$/, 'pmkit release list'))
  assert.equal(hashTree(root), hash)
})

test('createRelease refuses bad input and writes nothing', () => {
  const { tracker, root, releasesDir } = setup()
  const hash = hashTree(root)
  assert.throws(() => tracker.createRelease({ id: '1.0.0+build.5' }, 'fred'),
    code('INVALID_INPUT', /^release id "1\.0\.0\+build\.5" must start and end with a letter or digit/, 'Use an id like 1.2.0 or v1.2.0'))
  assert.throws(() => tracker.createRelease({ id: 'a', tag: 'v1..2' }, 'fred'),
    code('INVALID_INPUT', /^tag "v1\.\.2" is not a valid git tag name$/, 'Use a tag like v1.2.0'))
  assert.throws(() => tracker.createRelease({ id: 'a', target: '2026-13-40' }, 'fred'), code('INVALID_INPUT', /^target must be a date as YYYY-MM-DD$/))
  assert.throws(() => tracker.createRelease({ id: 'a', name: '   ' }, 'fred'), code('INVALID_INPUT', /^name must be a non-empty string$/))
  assert.throws(() => tracker.createRelease({ id: 'a', name: 'One\nTwo' }, 'fred'), code('INVALID_INPUT', /line break/))
  assert.throws(() => tracker.createRelease({ id: 'a', released: '2026-10-23T12:00:00Z' }, 'fred'), code('INVALID_INPUT', /unknown field "released"/))
  assert.equal(hashTree(root), hash)
  assert.equal(fs.existsSync(releasesDir), false)
})

test('createRelease checks the actor before anything else', () => {
  const { tracker } = setup()
  assert.throws(() => tracker.createRelease({ id: 'bad+id', color: 'red' }, 'nobody'), code('INVALID_INPUT', /actor "nobody"/))
})

test('listReleases orders by version', () => {
  const { tracker } = setup()
  for (const id of ['1.10.0', '1.9.0', '1.0.0-rc.1']) tracker.createRelease({ id }, 'fred')
  assert.deepEqual(tracker.listReleases().map((r) => r.id), ['1.0.0-rc.1', '1.9.0', '1.10.0'])
})

test('listReleases filters by state and refuses an unknown state', () => {
  const { tracker, write } = setup()
  tracker.createRelease({ id: '1.0.0' }, 'fred')
  write('0.9.0.md', '---\nname: Old\nreleased: 2026-09-01T10:00:00Z\n---\n')
  assert.deepEqual(tracker.listReleases({ state: 'released' }).map((r) => r.id), ['0.9.0'])
  assert.deepEqual(tracker.listReleases({ state: 'planned' }).map((r) => r.id), ['1.0.0'])
  assert.throws(() => tracker.listReleases({ state: 'open' }), code('INVALID_INPUT', /^state must be planned or released$/, 'pmkit release list'))
})

test('listReleases leaves out a bad file and a bad id, and gives [] without a folder', () => {
  const { tracker, write } = setup()
  assert.deepEqual(tracker.listReleases(), [])
  tracker.createRelease({ id: 'good' }, 'fred')
  write('bad-target.md', '---\ntarget: 2026-13-40\n---\n')
  write('bad+id.md', '---\nname: x\n---\n')
  assert.deepEqual(tracker.listReleases().map((r) => r.id), ['good'])
})

test('getRelease of an unknown or invalid id is NOT_FOUND', () => {
  const { tracker } = setup()
  assert.throws(() => tracker.getRelease('nope'), code('NOT_FOUND', /^release nope does not exist$/, 'pmkit release list'))
  assert.throws(() => tracker.getRelease('bad+id'), code('NOT_FOUND', /^release bad\+id does not exist$/, 'pmkit release list'))
})

test('an issue cannot name a release that has no file', () => {
  const { tracker } = setup()
  assert.throws(() => tracker.createIssue({ title: 'T', release: '1.2.0' }, 'fred'),
    code('INVALID_INPUT', /^release 1\.2\.0 does not exist$/, 'pmkit release create 1.2.0'))
})

test('create and update set release, and update records the event', () => {
  const { tracker, root } = setup()
  tracker.createRelease({ id: '1.2.0' }, 'fred')
  const created = tracker.createIssue({ title: 'T', release: '1.2.0' }, 'fred').after
  assert.equal(created.release, '1.2.0')
  const rawEvents = (id) => fs.readFileSync(issuePaths(path.join(root, '.issues'), id).events, 'utf8').trim().split('\n').map((line) => JSON.parse(line))
  assert.equal(rawEvents(created.id)[0].to.release, '1.2.0')
  assert.throws(() => tracker.createIssue({ title: 'T', release: 'V1.2.0' }, 'fred'), code('INVALID_INPUT', /^release V1\.2\.0 does not exist$/))
  const other = tracker.createIssue({ title: 'U' }, 'fred').after
  tracker.updateIssue(other.id, { release: '1.2.0' }, 'fred')
  const set = rawEvents(other.id).at(-1)
  assert.deepEqual({ op: set.op, field: set.field, from: set.from, to: set.to }, { op: 'update', field: 'release', from: null, to: '1.2.0' })
  assert.equal(tracker.updateIssue(other.id, { release: null }, 'fred').after.release, undefined)
  assert.equal(rawEvents(other.id).at(-1).to, null)
})

test('updating another field of an issue whose release file is gone is not checked', () => {
  const { tracker, releasesDir } = setup()
  tracker.createRelease({ id: '1.2.0' }, 'fred')
  const { id } = tracker.createIssue({ title: 'T', release: '1.2.0' }, 'fred').after
  fs.rmSync(path.join(releasesDir, '1.2.0.md'))
  const { after } = tracker.updateIssue(id, { priority: 'high' }, 'fred')
  assert.equal(after.priority, 'high')
  assert.equal(after.release, '1.2.0')
})

test('a hand-added release gives a synthetic update event, and getIssue shows it', () => {
  const { tracker, root } = setup()
  const { id } = tracker.createIssue({ title: 'T' }, 'fred').after
  const { file } = issuePaths(path.join(root, '.issues'), id)
  fs.writeFileSync(file, fs.readFileSync(file, 'utf8').replace(/^(due|branch|archived|created): /m, 'release: 1.2.0\n$&'))
  const edited = new Date('2026-10-23T11:00:00Z')
  fs.utimesSync(file, edited, edited)
  tracker.assign(id, 'fred', 'fred')
  const drift = tracker.getHistory(id).filter((event) => event.synthetic)
  assert.deepEqual(drift.map((e) => [e.op, e.field, e.from ?? null, e.to]), [['update', 'release', null, '1.2.0']])
  assert.equal(tracker.getIssue(id).release, '1.2.0')
})

test('issueRecord shows release on the line after milestone', () => {
  const { tracker } = setup()
  tracker.createRelease({ id: '1.2.0' }, 'fred')
  const { after } = tracker.createIssue({ title: 'T', milestone: 'v2', release: '1.2.0' }, 'fred')
  assert.match(issueRecord(after), /^milestone: v2\nrelease: 1\.2\.0$/m)
})
