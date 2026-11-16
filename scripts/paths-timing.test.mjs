// hideAbsolutePaths takes time linear in the line (PMK-288): long lines of the shapes that made the URL and quoted-path rules
// rescan the same text take 20 to 460 ms at 400,000 characters (load 30 to 100), and the quadratic code of PMK-288 took 43 s at
// 200,000. The ceiling is the one of assert-fast.mjs (PMK-307): a fixed 1 s limit failed under load.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { assertFast } from './assert-fast.mjs'

const rep = (text, n) => text.repeat(n)
const n = 400000
const target = 'lib/paths.mjs#hideAbsolutePaths'

test('probe: a line of 400 thousand characters with no :// takes less than ten seconds', async () => {
  const inputs = [rep('a.', n / 2), rep('a+', n / 2), rep('a-', n / 2), `${rep('a+', n / 2)}file`, `${rep('a.', n / 2)}b://x`, rep('x://', n / 4), rep('ab://', n / 5), rep('1a.', n / 3), rep('_a.', n / 3)]
  await assertFast(target, inputs)
})

test('probe: a line of 400 thousand characters of quotes and backticks that never close a path takes less than ten seconds', async () => {
  const inputs = [rep('"/ ', n / 3), rep(" '/a", n / 4), rep(' "/a"b', n / 6), rep(' `/a', n / 4), rep(' `/a`b', n / 6), rep(` "C:\\a 'x`, n / 9)]
  await assertFast(target, inputs)
})

test("probe: a line of 400 thousand characters of '!', '|' after a URL, 'a>' and '<a b>' takes less than ten seconds (PMK-295)", async () => {
  const inputs = [rep('!', n), rep('a!/', n / 3), rep('https://h/x|', n / 12), rep('https://h/|/', n / 12), rep('a|', n / 2), rep('a>', n / 2), rep('a>/', n / 3), rep('<a b>', n / 5), rep('<a b', n / 4), rep('<', n), rep('a b>', n / 4)]
  await assertFast(target, inputs)
})

// PMK-307: the comparison with redact alone (3 * redactMs + 1000) failed once in 24 loaded runs (redact took 106 ms by chance,
// hideAbsolutePaths 3983 ms). Linear time on 5 million pipes is 0.2 to 4 s at load 100, so the 10 s ceiling is too close; 60 s is
// 15 times the worst linear run, and the quadratic version does not finish in minutes. A stack overflow still throws.
const PIPES_CEILING_MS = 60000

test('probe: a URL of millions of pipes does not overflow the regex stack and takes less than a minute (PMK-295 cycle 2)', async () => {
  const inputs = ['http://h/' + 'a|'.repeat(5e6), 'http://h/' + '|'.repeat(5e6), 'http://h/' + 'a|b'.repeat(2e6) + '|/Users/x']
  await assertFast(target, inputs, PIPES_CEILING_MS)
})

test("probe: a line of 400 thousand characters of quotes followed by '.', ',', ';' and '}' takes less than ten seconds (PMK-296)", async () => {
  const inputs = [rep("'/a'.", n / 5), rep("'/a'.x", n / 6), `'/a'${rep('.', n)}x`, `'/a'${rep('.,;}', n / 4)}x`, rep(" '/a'.,;}x", n / 10), rep(' "/a b".', n / 8), `'/a ${rep("'.", n / 2)}x`]
  await assertFast(target, inputs)
})

test("probe: a line of 400 thousand characters with many quotes before '.', ',', ';' and '}' takes less than ten seconds (PMK-296 review)", async () => {
  const inputs = [rep("'/a', ", n / 6), rep("'/a'. 'b' ", n / 10), `'/a'. ${rep("'x", n / 2)}`, `${rep("'/a'. ", n / 6)}'`, rep("'/a'.\n", n / 6), rep('"/a"} "', n / 7), `'/a ${rep("'. ", n / 3)}`, `${rep("'/a ", n / 4)}'`]
  await assertFast(target, inputs)
})

test("probe: a line of 400 thousand characters of '<1', '<1>', '<1>/' and '<a-1' takes less than ten seconds (PMK-297)", async () => {
  const inputs = [rep('<1', n / 2), rep('<1>', n / 3), rep('<1>/', n / 4), rep('<a-1', n / 4), rep('<a-1>', n / 5), rep('1>', n / 2), rep('<1 ', n / 3)]
  await assertFast(target, inputs)
})
