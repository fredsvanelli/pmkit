import { describe, test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { TRACKER_OPERATIONS, assertTracker, contractView } from './lib/contract.mjs'
import { createLocalTracker } from './lib/local/tracker.mjs'
import { runTrackerContract } from './contract-suite.mjs'
import { makeRepo } from './test-helpers.mjs'

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
  let counter = 0
  const random = (n) => counter++ % n
  const now = () => new Date('2026-10-23T12:00:00Z')
  const tracker = createLocalTracker(root, { now, random, ...options })
  return { tracker, actor: 'fred', today: '2026-10-23', teardown: () => fs.rmSync(root, { recursive: true, force: true }) }
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
