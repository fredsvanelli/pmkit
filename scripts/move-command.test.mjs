// Static checks of commands/issues/move.md for PMK-77: how step 4 asks for the values of a transition's required fields.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const FILE = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'commands', 'issues', 'move.md')
const text = fs.readFileSync(FILE, 'utf8').replace(/\r\n/g, '\n')
const step4 = text.split('\n').find((line) => line.startsWith('4. Run `node "${CLAUDE_PLUGIN_ROOT}/scripts/pmkit.mjs" issues move'))

test('step 4 asks for a typed value when a required field has no allowed names', () => {
  assert.ok(step4, 'step 4 is the dry run of issues move')
  assert.match(step4, /`allowed` is empty[^.]*typed value/)
})

test('step 4 offers the first allowed names and lets the user type another when there are more than four', () => {
  assert.match(step4, /more than four[^.]*first[^.]*type another/)
})
