// hideAbsolutePaths takes time linear in the line (PMK-288): long lines of the shapes that made the URL and quoted-path rules
// rescan the same text take well under a second at 200,000 characters (the same slack as redact-probes.test.mjs).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { hideAbsolutePaths } from './lib/paths.mjs'

const rep = (text, n) => text.repeat(n)
const n = 200000

test('probe: a line of 200 thousand characters with no :// takes less than a second', () => {
  const inputs = [rep('a.', n / 2), rep('a+', n / 2), rep('a-', n / 2), `${rep('a+', n / 2)}file`, `${rep('a.', n / 2)}b://x`, rep('x://', n / 4), rep('ab://', n / 5), rep('1a.', n / 3), rep('_a.', n / 3)]
  for (const input of inputs) {
    const start = process.hrtime.bigint()
    hideAbsolutePaths(input)
    const ms = Number(process.hrtime.bigint() - start) / 1e6
    assert.ok(ms < 1000, `${JSON.stringify(input.slice(0, 20))} took ${ms} ms`)
  }
})

test('probe: a line of 200 thousand characters of quotes and backticks that never close a path takes less than a second', () => {
  const inputs = [rep('"/ ', n / 3), rep(" '/a", n / 4), rep(' "/a"b', n / 6), rep(' `/a', n / 4), rep(' `/a`b', n / 6), rep(` "C:\\a 'x`, n / 9)]
  for (const input of inputs) {
    const start = process.hrtime.bigint()
    hideAbsolutePaths(input)
    const ms = Number(process.hrtime.bigint() - start) / 1e6
    assert.ok(ms < 1000, `${JSON.stringify(input.slice(0, 20))} took ${ms} ms`)
  }
})
