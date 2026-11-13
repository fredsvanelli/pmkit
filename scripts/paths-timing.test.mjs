// hideAbsolutePaths takes time linear in the line (PMK-288): long lines of the shapes that made the URL and quoted-path rules
// rescan the same text take well under a second at 200,000 characters (the same slack as redact-probes.test.mjs).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { hideAbsolutePaths } from './lib/paths.mjs'
import { redact } from './lib/redact.mjs'

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

test("probe: a line of 200 thousand characters of '!', '|' after a URL, 'a>' and '<a b>' takes less than a second (PMK-295)", () => {
  const inputs = [rep('!', n), rep('a!/', n / 3), rep('https://h/x|', n / 12), rep('https://h/|/', n / 12), rep('a|', n / 2), rep('a>', n / 2), rep('a>/', n / 3), rep('<a b>', n / 5), rep('<a b', n / 4), rep('<', n), rep('a b>', n / 4)]
  for (const input of inputs) {
    const start = process.hrtime.bigint()
    hideAbsolutePaths(input)
    const ms = Number(process.hrtime.bigint() - start) / 1e6
    assert.ok(ms < 1000, `${JSON.stringify(input.slice(0, 20))} took ${ms} ms`)
  }
})

test('probe: a URL of millions of pipes does not overflow the regex stack and takes about as long as redact alone (PMK-295 cycle 2)', () => {
  for (const input of ['http://h/' + 'a|'.repeat(5e6), 'http://h/' + '|'.repeat(5e6), 'http://h/' + 'a|b'.repeat(2e6) + '|/Users/x']) {
    const base = process.hrtime.bigint()
    redact(input) // the redaction of the URL is most of the time at this size
    const redactMs = Number(process.hrtime.bigint() - base) / 1e6
    const start = process.hrtime.bigint()
    hideAbsolutePaths(input)
    const ms = Number(process.hrtime.bigint() - start) / 1e6
    assert.ok(ms < 3 * redactMs + 1000, `${JSON.stringify(input.slice(0, 20))} took ${ms} ms, redact alone ${redactMs} ms`)
  }
})

test("probe: a line of 200 thousand characters of quotes followed by '.', ',', ';' and '}' takes less than a second (PMK-296)", () => {
  const inputs = [rep("'/a'.", n / 5), rep("'/a'.x", n / 6), `'/a'${rep('.', n)}x`, `'/a'${rep('.,;}', n / 4)}x`, rep(" '/a'.,;}x", n / 10), rep(' "/a b".', n / 8), `'/a ${rep("'.", n / 2)}x`]
  for (const input of inputs) {
    const start = process.hrtime.bigint()
    hideAbsolutePaths(input)
    const ms = Number(process.hrtime.bigint() - start) / 1e6
    assert.ok(ms < 1000, `${JSON.stringify(input.slice(0, 20))} took ${ms} ms`)
  }
})

test("probe: a line of 200 thousand characters with many quotes before '.', ',', ';' and '}' takes less than a second (PMK-296 review)", () => {
  const inputs = [rep("'/a', ", n / 6), rep("'/a'. 'b' ", n / 10), `'/a'. ${rep("'x", n / 2)}`, `${rep("'/a'. ", n / 6)}'`, rep("'/a'.\n", n / 6), rep('"/a"} "', n / 7), `'/a ${rep("'. ", n / 3)}`, `${rep("'/a ", n / 4)}'`]
  for (const input of inputs) {
    const start = process.hrtime.bigint()
    hideAbsolutePaths(input)
    const ms = Number(process.hrtime.bigint() - start) / 1e6
    assert.ok(ms < 1000, `${JSON.stringify(input.slice(0, 20))} took ${ms} ms`)
  }
})

test("probe: a line of 200 thousand characters of '<1', '<1>', '<1>/' and '<a-1' takes less than a second (PMK-297)", () => {
  const inputs = [rep('<1', n / 2), rep('<1>', n / 3), rep('<1>/', n / 4), rep('<a-1', n / 4), rep('<a-1>', n / 5), rep('1>', n / 2), rep('<1 ', n / 3)]
  for (const input of inputs) {
    const start = process.hrtime.bigint()
    hideAbsolutePaths(input)
    const ms = Number(process.hrtime.bigint() - start) / 1e6
    assert.ok(ms < 1000, `${JSON.stringify(input.slice(0, 20))} took ${ms} ms`)
  }
})
