import { test } from 'node:test'
import assert from 'node:assert/strict'
import { assertFast, assertFastAsync, PROBE_CEILING_MS } from './assert-fast.mjs'

// PMK-303, PMK-307: a fixed small limit failed under load (a loaded machine runs the same input 35 times slower), and a growth
// ratio of two small runs failed too. The probes use a size where a quadratic regex takes tens of seconds or more and linear code
// takes well under a second, with a ceiling that only quadratic time reaches even when the machine is loaded.
const input = 'a'.repeat(8000)

test('assertFast: a quadratic regex fails it and a linear one passes', () => {
  assert.throws(() => assertFast((s) => /a+b/.test(s), input, 10), /took [\d.]+ ms/)
  assertFast((s) => /a/.test(s), input, PROBE_CEILING_MS)
})

test('assertFastAsync: awaits the call, a quadratic regex fails it and a linear one passes', async () => {
  await assert.rejects(assertFastAsync(async (s) => /a+b/.test(s), input, 10), /took [\d.]+ ms/)
  await assertFastAsync(async (s) => /a/.test(s), input)
})
