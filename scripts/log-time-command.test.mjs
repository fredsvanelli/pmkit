// /pmkit:issues:log-time degrades to a comment where the tracker has no time tracking (the Linear case).
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { test } from 'node:test'
import { LINEAR_CAPABILITIES } from './lib/linear/manifest.mjs'

const read = (rel) => fs.readFileSync(path.join(import.meta.dirname, '..', rel), 'utf8')
const step = (text, n) => text.split('\n').find((line) => line.startsWith(`${n}. `)) ?? ''

test('the command file reads time_tracking and comments when it is absent', () => {
  const text = read('commands/issues/log-time.md')
  assert.match(step(text, 1), /`time_tracking`.*`absent`.*never calls `issues log-time`.*`enableHint`/)
  assert.match(step(text, 6), /only when step 1 found `absent`.*issues comment/)
  assert.match(step(text, 4), /Skip this step and step 5 when step 1 found `absent`/)
  assert.match(step(text, 6), /issues parse-time <time> --json.*Post nothing for a time the CLI cannot read.*minutes/)
  assert.match(step(text, 5), /issues time-entries .*`total`/)
})

test('the command names the invalid times and leaves the conversion to the CLI', () => {
  const step4 = step(read('commands/issues/log-time.md'), 4)
  assert.match(step4, /INVALID_INPUT/)
  assert.match(step4, /negative/)
  assert.match(step4, /Never fix the time yourself/)
})

test('progress step 8 points at the log-time command', () => {
  const step8 = step(read('commands/issues/progress.md'), 8)
  assert.match(step8, /\/pmkit:issues:log-time/)
  assert.match(step8, /`absent`/)
})

test('Linear has no time tracking, which is the case the comment covers', () => {
  assert.equal(LINEAR_CAPABILITIES.time_tracking.path, 'absent')
})
