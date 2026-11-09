// Static checks of commands/issues/estimate.md for PMK-176: the command file is the product, so the rules are pinned in its text.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const FILE = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'commands', 'issues', 'estimate.md')
const text = fs.readFileSync(FILE, 'utf8').replace(/\r\n/g, '\n')

test('a conditional estimation falls back to a comment for a team without estimates', () => {
  assert.match(text, /`conditional`/)
  assert.match(text, /`detail\.teams`/)
})

test('a refused estimate field (NOT_SUPPORTED or estimates off) falls back to a comment', () => {
  assert.match(text, /`NOT_SUPPORTED`/)
  assert.match(text, /estimates are off/)
})

test("the scale is the one of the issue's team, and an empty scale is not a scale", () => {
  assert.match(text, /`teams`/)
  assert.match(text, /prefix of the issue ID/)
  assert.match(text, /`scale: \[\]`/)
})

test('days never reach --estimate', () => {
  assert.match(text, /never pass (a number of )?days to `issues update --estimate`/i)
})

test('an equal proposal still asks, and offers another value', () => {
  assert.doesNotMatch(text, /equals the current estimate, say that the estimate already fits and stop/)
  assert.match(text, /keep the current estimate or pick another value/)
})

test('step 7 is skipped on every comment path, whatever step 6 found', () => {
  assert.doesNotMatch(text, /Skip this step when step 1 found `absent`/)
  assert.match(text, /Skip this step, and go to step 8, unless step 1 and step 3 both chose the save path/)
  assert.match(text, /On the comment path go on to step 8/)
})

test('an equal proposal with confirm none writes nothing', () => {
  assert.match(text, /With `write_policy\.confirm: none` the question is skipped, so an equal proposal stops here without writing/)
})

test('the comment names its unit, days are not compared, and hours need no scale', () => {
  assert.match(text, /always states the unit/)
  assert.match(text, /do not compare them or measure a distance/)
  assert.match(text, /except for the unit `hours`/)
  assert.match(text, /prefix is not a known team key/)
})
