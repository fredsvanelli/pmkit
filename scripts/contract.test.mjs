import { describe, test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { TRACKER_OPERATIONS, assertTracker } from './lib/contract.mjs'
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
function setupLocal() {
  const root = makeRepo()
  let counter = 0
  const random = (n) => counter++ % n
  const now = () => new Date('2026-10-23T12:00:00Z')
  const tracker = createLocalTracker(root, { now, random })
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
