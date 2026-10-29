import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import { COMMANDS, run } from './pmkit.mjs'
import { makeRepo } from './test-helpers.mjs'

const FAKES = [
  { name: 'zz-notes', summary: 't', flags: [], exempt: true, run: async () => ({ data: { ok: true }, text: 'done', warnings: ['w1'], notes: ['n1', 'n2'] }) },
  { name: 'zz-refuse', summary: 't', flags: [], exempt: true, run: async () => { throw Object.assign(new Error('nope'), { code: 'NOT_SUPPORTED', nextStep: 'x' }) } },
]
COMMANDS.push(...FAKES)
after(() => { for (const fake of FAKES) COMMANDS.splice(COMMANDS.indexOf(fake), 1) })

test('result notes print as note lines on stderr after the warnings, in text mode', async () => {
  const result = await run(['zz-notes', '--root', makeRepo()])
  assert.equal(result.stdout, 'done\n')
  assert.equal(result.stderr, 'warning: w1\nnote: n1\nnote: n2\n')
})

test('result notes print the same way with --json and stdout is the data only', async () => {
  const result = await run(['zz-notes', '--json', '--root', makeRepo()])
  assert.deepEqual(JSON.parse(result.stdout), { ok: true })
  assert.equal(result.stderr, 'warning: w1\nnote: n1\nnote: n2\n')
})

test('a refusal prints no note', async () => {
  const result = await run(['zz-refuse', '--root', makeRepo()])
  assert.doesNotMatch(result.stderr, /note:/)
})
