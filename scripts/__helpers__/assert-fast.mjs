// Shared by the timing probes (PMK-303, PMK-307). Not named *.test.mjs, so the glob of scripts/run-tests.mjs does not run it.
import assert from 'node:assert/strict'

export const PROBE_CEILING_MS = 10000

const check = (start, input, limitMs) => {
  const ms = Number(process.hrtime.bigint() - start) / 1e6
  assert.ok(ms < limitMs, `${JSON.stringify(input.slice(0, 20))} took ${ms} ms`)
}

export function assertFast(fn, input, limitMs = PROBE_CEILING_MS) {
  const start = process.hrtime.bigint()
  fn(input)
  check(start, input, limitMs)
}

export async function assertFastAsync(fn, input, limitMs = PROBE_CEILING_MS) {
  const start = process.hrtime.bigint()
  await fn(input)
  check(start, input, limitMs)
}
