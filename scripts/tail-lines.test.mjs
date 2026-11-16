import assert from 'node:assert/strict'
import test from 'node:test'
import { tailLines } from './lib/tail-lines.mjs'

// What the CLI did before: split the whole log.
function bySplit(log, n) {
  const lines = log.split('\n')
  const final = log.endsWith('\n')
  const body = final ? lines.slice(0, -1) : lines
  return body.length > n ? { log: `${body.slice(-n).join('\n')}${final ? '\n' : ''}`, truncated: true } : { log, truncated: false }
}

test('tailLines keeps the last n lines and keeps the final newline', () => {
  assert.deepEqual(tailLines('a\nb\nc\n', 2), { log: 'b\nc\n', truncated: true })
  assert.deepEqual(tailLines('a\nb\nc', 2), { log: 'b\nc', truncated: true })
  assert.deepEqual(tailLines('a\nb\n', 1), { log: 'b\n', truncated: true })
})

test('tailLines leaves a log of exactly n lines, or fewer, alone', () => {
  for (const log of ['', 'a', 'a\n', 'a\nb', 'a\nb\n', '\n', '\nb']) {
    for (const n of [1, 2, 3, 200]) assert.deepEqual(tailLines(log, n), bySplit(log, n), JSON.stringify([log, n]))
  }
  assert.deepEqual(tailLines('a\nb\n', 2), { log: 'a\nb\n', truncated: false })
})

test('tailLines agrees with the split on every log of up to 6 short lines, blank ones included', () => {
  const pieces = ['', 'x', '']
  const logs = ['']
  for (let len = 1; len <= 6; len++) for (let i = 0; i < 3 ** len; i++) logs.push(Array.from({ length: len }, (_, k) => pieces[Math.floor(i / 3 ** k) % 3]).join('\n'))
  for (const base of [...logs]) logs.push(`${base}\n`)
  for (const log of logs) for (const n of [1, 2, 3, 7]) assert.deepEqual(tailLines(log, n), bySplit(log, n), JSON.stringify([log, n]))
})
