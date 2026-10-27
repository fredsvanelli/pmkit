// The CLI over a hosted tracker, run in process with a test registry. No test here touches the network.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { run } from './pmkit.mjs'

test('run returns a promise of the code and both streams', async () => {
  const pending = run(['--help'])
  assert.ok(pending instanceof Promise)
  const result = await pending
  assert.equal(result.code, 2)
  assert.ok(result.stdout.startsWith('Usage: pmkit.mjs'))
})
