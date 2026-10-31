import { describe, test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { TRACKER_OPERATIONS, assertTracker, contractView } from './lib/contract.mjs'
import { createLocalTracker } from './lib/local/tracker.mjs'
import { FAMILIES, cycleHelper, runTrackerContract } from './contract-suite.mjs'
import { makeRepo } from './test-helpers.mjs'

test('resolveThread is a contract operation next to comment', () => {
  assert.equal(TRACKER_OPERATIONS.indexOf('resolveThread'), TRACKER_OPERATIONS.indexOf('comment') + 1)
})

test('delete is a contract operation next to archive', () => {
  assert.equal(TRACKER_OPERATIONS.indexOf('delete'), TRACKER_OPERATIONS.indexOf('archive') + 1)
})

describe('assertTracker', () => {
  test('lists every missing operation', () => {
    const partial = { discover() {}, getIssue() {} }
    assert.throws(() => assertTracker(partial), (error) => {
      const missing = TRACKER_OPERATIONS.filter((name) => !['discover', 'getIssue'].includes(name))
      return missing.every((name) => error.message.includes(name)) && !error.message.includes('getIssue,')
    })
  })

  test('rejects a value that is not an object', () => {
    assert.throws(() => assertTracker(null), /missing operations/)
  })
})

// Fresh clock and ids per setup; the id source is a counter so ids never repeat.
function setupLocal(options = {}) {
  const root = makeRepo()
  const config = path.join(root, '.issues', 'config.yaml')
  fs.writeFileSync(config, fs.readFileSync(config, 'utf8').replace(/^members:\n/m, 'members:\n  agent:claude: { name: Claude, availability: 1 }\n'))
  let counter = 0
  const random = (n) => counter++ % n
  const now = () => new Date('2026-10-23T12:00:00Z')
  const tracker = createLocalTracker(root, { now, random, ...options })
  return { tracker, actor: 'fred', agent: 'agent:claude', today: '2026-10-23', teardown: () => fs.rmSync(root, { recursive: true, force: true }) }
}

runTrackerContract({ name: 'Local tracker contract', setup: setupLocal })

// Every operation returns a promise, as a hosted adapter's would. The suite must await them.
function setupAsync() {
  const env = setupLocal()
  const tracker = Object.fromEntries(Object.entries(env.tracker).map(([name, operation]) => [name, async (...args) => operation(...args)]))
  return { ...env, tracker }
}

runTrackerContract({ name: 'Local tracker contract through promises', setup: setupAsync })

runTrackerContract({ name: 'Local tracker contract without the index', setup: () => setupLocal({ index: false }) })

describe('contractView', () => {
  test('holds exactly the contract operations and is frozen', () => {
    const env = setupLocal()
    try {
      const view = contractView(env.tracker)
      assert.deepEqual(Object.keys(view), TRACKER_OPERATIONS)
      assert.ok(Object.isFrozen(view))
      for (const name of ['eventsByIssue', 'writtenFiles', 'reindex', 'categoryOf', 'unfiledMilestones']) {
        assert.equal(view[name], undefined, name)
      }
      assert.ok(view.discover().statuses.length > 0)
    } finally {
      env.teardown()
    }
  })

  test('passes promises through', async () => {
    const env = setupAsync()
    try {
      const pending = contractView(env.tracker).discover()
      assert.ok(pending instanceof Promise)
      await pending
    } finally {
      env.teardown()
    }
  })

  test('refuses a tracker that lacks an operation', () => {
    assert.throws(() => contractView({ discover() {} }), (error) => error instanceof TypeError && /missing operations/.test(error.message))
  })
})

test('the contract carries no triage operation and a view hides the Linear extension', () => {
  assert.ok(!TRACKER_OPERATIONS.some((name) => /triage/i.test(name)))
  const tracker = Object.fromEntries(TRACKER_OPERATIONS.map((name) => [name, () => {}]))
  const view = contractView({ ...tracker, triage: { show() {} } })
  assert.deepEqual(Object.keys(view), TRACKER_OPERATIONS)
})

describe('the cycle helper of the suite', () => {
  const fakeTest = () => ({ reasons: [], skip(reason) { this.reasons.push(reason) } })
  const recording = () => {
    const calls = []
    const tracker = { openCycle: async (input, actor) => { calls.push([input, actor]); return { after: { id: `opened-${calls.length}` } } } }
    return { calls, tracker }
  }

  test('FAMILIES lists cycle-lifecycle', () => {
    assert.ok(FAMILIES.includes('cycle-lifecycle'))
    assert.ok(FAMILIES.includes('cycles'))
  })

  test('without a provider it opens a cycle with the arguments the tests used before', async () => {
    const { calls, tracker } = recording()
    const cycle = cycleHelper({ tracker, actor: 'fred', today: '2026-10-23' }, fakeTest())
    assert.equal((await cycle('active')).id, 'opened-1')
    assert.equal((await cycle('planned')).id, 'opened-2')
    assert.deepEqual(calls, [[{ start: '2026-10-23' }, 'fred'], [{ start: '2099-01-01' }, 'fred']])
  })

  test('a provider supplies the cycle and openCycle is not called', async () => {
    const { calls, tracker } = recording()
    const cycles = { active: async () => ({ id: '7', start: '2026-10-19', end: '2026-11-02' }), planned: async () => ({ id: '8' }) }
    const cycle = cycleHelper({ tracker, actor: 'fred', today: '2026-10-23', cycles }, fakeTest())
    assert.equal((await cycle('active')).id, '7')
    assert.equal((await cycle('planned')).id, '8')
    assert.deepEqual(calls, [])
  })

  test('a provider that returns null skips the test with the reason', async () => {
    const { tracker } = recording()
    const t = fakeTest()
    const cycle = cycleHelper({ tracker, actor: 'fred', today: '2026-10-23', cycles: { active: async () => null, planned: async () => null } }, t)
    assert.equal(await cycle('active'), null)
    assert.equal(await cycle('planned'), null)
    assert.deepEqual(t.reasons, ['needs an active cycle', 'needs a planned cycle'])
  })
})
