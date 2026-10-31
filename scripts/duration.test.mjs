import assert from 'node:assert/strict'
import { test } from 'node:test'
import { longEntryNote, parseMinutes } from './lib/duration.mjs'

test('parseMinutes reads minutes, hours and mixed forms', () => {
  const cases = { '90': 90, '45m': 45, '2h': 120, '1h30': 90, '1h30m': 90, '1.5h': 90, '0.5h': 30, ' 1H30 ': 90, '1440': 1440, '24h': 1440, '1500': 1500, '100000': 100000, '25h': 1500 }
  for (const [text, minutes] of Object.entries(cases)) assert.equal(parseMinutes(text), minutes, text)
})

test('parseMinutes rejects zero, negatives, empty, text and fractions of a minute', () => {
  for (const text of ['', '   ', '0', '0m', '0h', '-5', '-1h', 'abc', '1.5', '1h90', '0.01h', '1h-5', '1h30x', 'h', '1 h 30']) {
    assert.throws(() => parseMinutes(text), (error) => error.code === 'INVALID_INPUT' && /1h30/.test(error.nextStep), `"${text}"`)
  }
  assert.throws(() => parseMinutes(undefined), (error) => error.code === 'INVALID_INPUT')
})

test('longEntryNote flags an entry above one day and nothing else', () => {
  assert.equal(longEntryNote(1440), null)
  assert.equal(longEntryNote(90), null)
  assert.match(longEntryNote(1500), /1500 minutes \(25h\) is more than a day; check the time before you confirm/)
  assert.match(longEntryNote(100000), /100000 minutes \(1666h40\)/)
})
