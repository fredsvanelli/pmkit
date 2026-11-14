import { test } from 'node:test'
import assert from 'node:assert/strict'
import { assertFast, PROBE_CEILING_MS } from './assert-fast.mjs'

// PMK-303, PMK-307: a fixed small limit failed under load (a loaded machine runs the same input 35 times slower), and a growth
// ratio of two small runs failed too. The probes use a size where a quadratic regex takes tens of seconds or more and linear code
// takes well under a second, with a ceiling that only quadratic time reaches even when the machine is loaded.
// PMK-312: the function runs in a Worker that is terminated at the ceiling, so a slow one fails at it and does not hold the run.
const input = 'a'.repeat(8000)
const targets = 'assert-fast-targets.mjs'

test('assertFast: a quadratic regex fails it and a linear one passes', async () => {
  await assert.rejects(assertFast(`${targets}#quadratic`, input, 10), /took [\d.]+ ms/)
  await assertFast(`${targets}#linear`, [input, input], PROBE_CEILING_MS)
})

test('assertFast: awaits an async export', async () => {
  await assert.rejects(assertFast(`${targets}#asyncQuadratic`, input, 10), /took [\d.]+ ms/)
  await assertFast(`${targets}#asyncLinear`, input)
})

test('assertFast: a function that runs 60 s fails within a few seconds of a 1 s ceiling, names the input and leaves nothing running', async () => {
  const start = Date.now()
  await assert.rejects(assertFast(`${targets}#busy60s`, 'long input that is cut', 1000), /^AssertionError.*"long input that is c" took [\d.]+ ms \(stopped at the ceiling of 1000 ms\)/)
  assert.ok(Date.now() - start < 5000, `took ${Date.now() - start} ms`)
  // A Worker left in its loop would burn a CPU of this process: the process CPU time over half a second stays far below that.
  const cpu = process.cpuUsage()
  await new Promise((r) => setTimeout(r, 500))
  const { user, system } = process.cpuUsage(cpu)
  assert.ok((user + system) / 1000 < 250, `the process used ${(user + system) / 1000} ms of CPU in 500 ms`)
})

test('assertFast: a quadratic regex on a long input stops at the ceiling', async () => {
  const start = Date.now()
  await assert.rejects(assertFast(`${targets}#quadratic`, 'a'.repeat(300000), 1000), /stopped at the ceiling/)
  assert.ok(Date.now() - start < 5000, `took ${Date.now() - start} ms`)
})

test('assertFast: an error thrown by the function is the failure, and `names` replaces the input in the message', async () => {
  await assert.rejects(assertFast(`${targets}#throws`, 'x'), /boom/)
  await assert.rejects(assertFast(`${targets}#quadratic`, input, 10, ['the name']), /"the name" took/)
})

test('assertFast: a module that never finishes its import fails at the start ceiling, and one that ends the Worker fails at once', async () => {
  const start = Date.now()
  await assert.rejects(assertFast('assert-fast-hangs.mjs#never', 'x', 1000, 'x', 500), /did not start in 500 ms/)
  await assert.rejects(assertFast('assert-fast-dies.mjs#x', 'x', 1000, 'x', 20000), /exited with code 4 before it started/)
  await assert.rejects(assertFast(`${targets}#exits`, 'x', 20000), /exited with code 3 while it ran/)
  assert.ok(Date.now() - start < 5000, `took ${Date.now() - start} ms`)
})

test('assertFast: a start error keeps its cause, and a name that is not a function says so', async () => {
  await assert.rejects(assertFast('no-such-module.mjs#x', 'x'), /no-such-module/)
  await assert.rejects(assertFast(`${targets}#neverImported`, 'x'), /no function export neverImported/)
})

test('assertFast: an input that is an array is one input, not several', async () => {
  await assertFast(`${targets}#lengths`, [['a', 'b', 'c']])
  await assert.rejects(assertFast(`${targets}#lengths`, ['a', 'b', 'c']), /not an array/)
})

test('assertFast: the stack of the Worker is the size of the main thread (1 MB): deep recursion overflows at about the same depth', async () => {
  await assert.rejects(assertFast(`${targets}#recurse`, 1e6), /Maximum call stack/)
})
