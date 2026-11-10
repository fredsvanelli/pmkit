import assert from 'node:assert/strict'
import { test } from 'node:test'
import { formatMinutes, isPositiveMinutes, longEntryNote, parseMinutes } from './lib/duration.mjs'

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
  assert.match(longEntryNote(1500), /1500 minutes \(1d1h\) is more than a day; check the time before you confirm/)
  assert.match(longEntryNote(100000), /100000 minutes \(69d10h40\)/)
  assert.match(longEntryNote(2880), /\(2d\) is more than a day/)
  assert.match(longEntryNote(1470), /\(1d0h30\) is more than a day/)
})

test('longEntryNote on a written entry says the time is already logged', () => {
  const note = longEntryNote(1500, { written: true })
  assert.match(note, /1500 minutes \(1d1h\) is more than a day; the time is already logged, check it/)
  assert.doesNotMatch(note, /before you confirm/)
  assert.equal(longEntryNote(90, { written: true }), null)
})

test('parseMinutes keeps safe integers and rejects larger ones', () => {
  assert.equal(parseMinutes('9007199254740991'), 9007199254740991)
  for (const text of ['9007199254740992', '99999999999999999999999', '99999999999999999999h', '1' + '0'.repeat(400)]) {
    assert.throws(() => parseMinutes(text), (error) => error.code === 'INVALID_INPUT' && /too large/.test(error.message) && /1h30/.test(error.nextStep), text.slice(0, 30))
  }
})

test('isPositiveMinutes accepts whole minutes above zero and nothing else', () => {
  for (const value of [1, 90, 100000]) assert.equal(isPositiveMinutes(value), true, String(value))
  for (const value of [0, -1, 1.5, '5', NaN, Infinity, null, undefined]) assert.equal(isPositiveMinutes(value), false, String(value))
})

test('formatMinutes writes minutes as 45m, 1h, 1h30 and 1d1h', () => {
  const cases = { 1: '1m', 45: '45m', 60: '1h', 90: '1h30', 125: '2h05', 1440: '1d', 1500: '1d1h', 1530: '1d1h30' }
  for (const [minutes, text] of Object.entries(cases)) assert.equal(formatMinutes(Number(minutes)), text, minutes)
})
