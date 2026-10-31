import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { makeRepo, userStoreEnv } from './test-helpers.mjs'

const CLI = path.join(path.dirname(fileURLToPath(import.meta.url)), 'pmkit.mjs')
const ITEM_KEYS = ['key', 'kind', 'issue', 'title', 'at', 'by', 'in', 'comment', 'excerpt', 'synthetic', 'seen']

function setup() {
  const root = makeRepo('no-sprints')
  const { env: store } = userStoreEnv()
  const run = (args, { user = 'fred', now = '2026-10-31T10:00:00Z' } = {}) => {
    const env = { ...process.env, ...store, PMKIT_USER: user, PMKIT_NOW: now, PMKIT_SEED: '1', GIT_CONFIG_GLOBAL: os.devNull, GIT_CONFIG_NOSYSTEM: '1' }
    const result = spawnSync(process.execPath, [CLI, ...args], { cwd: root, env, encoding: 'utf8' })
    return { status: result.status, stdout: result.stdout, stderr: result.stderr }
  }
  const json = (args, options) => {
    const result = run([...args, '--json'], options)
    assert.equal(result.status, 0, result.stderr + result.stdout)
    return JSON.parse(result.stdout)
  }
  return { root, store, run, json }
}

test('inbox list prints the stable JSON keys, the item keys and a table with the key', () => {
  const { run, json } = setup()
  assert.equal(run(['issues', 'assign', 'ISS-1V9Z', 'fred'], { user: 'ana', now: '2026-10-31T09:00:00Z' }).status, 0)
  const empty = json(['inbox', 'list', '--since', '2026-10-31T09:30:00Z'])
  assert.deepEqual(Object.keys(empty), ['available', 'user', 'checked', 'since', 'hidden', 'items', 'counts', 'complete', 'problems'])
  assert.deepEqual(empty.items, [])
  assert.match(run(['inbox', 'list', '--since', '2026-10-31T09:30:00Z']).stdout, /no unseen mentions or assignments for fred since 2026-10-31T09:30:00Z/)
  const data = json(['inbox', 'list'])
  assert.equal(data.available, true)
  assert.deepEqual([data.user, data.checked, data.hidden], ['fred', null, 0])
  assert.deepEqual(Object.keys(data.items[0]), ITEM_KEYS)
  assert.deepEqual([data.items[0].kind, data.items[0].issue, data.items[0].by, data.items[0].seen], ['assignment', 'ISS-1V9Z', 'ana', false])
  const text = run(['inbox', 'list']).stdout
  assert.match(text, /assignment/)
  assert.match(text, /ISS-1V9Z/)
  assert.ok(text.includes(data.items[0].key))
})

test('inbox list with --all, with --as and with --all and --since together', () => {
  const { run, json } = setup()
  assert.equal(json(['inbox', 'list', '--all']).since, null)
  assert.equal(json(['inbox', 'list', '--as', 'ana']).user, 'ana')
  const both = run(['inbox', 'list', '--all', '--since', '2026-10-31T09:30:00Z', '--json'])
  assert.equal(both.status, 2)
  assert.equal(JSON.parse(both.stdout).error.code, 'INVALID_INPUT')
})

test('inbox mark-read --dry-run writes nothing, --key marks only that key and the list shows the rest', () => {
  const { store, run, json } = setup()
  run(['issues', 'assign', 'ISS-1V9Z', 'fred'], { user: 'ana', now: '2026-10-31T09:00:00Z' })
  run(['issues', 'assign', 'ISS-2K5P', 'fred'], { user: 'ana', now: '2026-10-31T09:10:00Z' })
  const [first, second] = json(['inbox', 'list']).items
  const dry = json(['inbox', 'mark-read', '--dry-run'])
  assert.deepEqual(dry, { user: 'fred', previous: null, recorded: '2026-10-31T10:00:00Z', marked: [first.key, second.key].sort(), pruned: 0, changed: true, dryRun: true })
  assert.equal(fs.existsSync(path.join(store.PMKIT_HOME, 'inbox')), false)
  assert.match(run(['inbox', 'mark-read', '--dry-run']).stdout, /would mark 2 items read for fred\ndry run: nothing was written/)
  const done = json(['inbox', 'mark-read', '--key', first.key])
  assert.deepEqual([done.changed, done.marked.includes(first.key)], [true, true])
  assert.equal(fs.readdirSync(path.join(store.PMKIT_HOME, 'inbox')).length, 1)
  assert.deepEqual(json(['inbox', 'list']).items.map((item) => item.key), [second.key])
  assert.match(run(['inbox', 'mark-read']).stdout, /marked 1 item read for fred/)
  assert.deepEqual(json(['inbox', 'list']).items, [])
  assert.match(run(['inbox', 'mark-read']).stdout, /nothing to mark read for fred/)
})

test('an incomplete inbox says so in the text, the warnings and the JSON, and mark-read refuses', () => {
  const { root, store, run, json } = setup()
  fs.mkdirSync(path.join(root, '.issues', 'issues', 'ISS-2K5P', 'comments'), { recursive: true })
  fs.writeFileSync(path.join(root, '.issues', 'issues', 'ISS-2K5P', 'comments', 'bad.md'), '---\nauthor: [\n---\n@fred\n')
  const result = run(['inbox', 'list', '--all'])
  assert.equal(result.status, 0)
  assert.match(result.stdout, /the inbox is incomplete: 1 problem/)
  assert.match(result.stderr, /warning: ISS-2K5P: INVALID_INPUT comment bad\.md cannot be read.*; run pmkit validate/)
  const data = json(['inbox', 'list', '--all'])
  assert.equal(data.complete, false)
  assert.equal(data.problems[0].id, 'ISS-2K5P')
  const refused = run(['inbox', 'mark-read', '--json'])
  assert.equal(refused.status, 2)
  const error = JSON.parse(refused.stdout).error
  assert.equal(error.code, 'INVALID_INPUT')
  assert.equal(error.problems.length, 1)
  assert.equal(fs.existsSync(path.join(store.PMKIT_HOME, 'inbox')), false)
})

test('inbox commands refuse a bad value with INVALID_INPUT', () => {
  const { run } = setup()
  for (const args of [['inbox', 'list', '--since', 'later'], ['inbox', 'list', '--as', 'nobody'], ['inbox', 'mark-read', '--key', 'comment:ISS-1V9Z:none']]) {
    const result = run([...args, '--json'])
    assert.equal(result.status, 2, args.join(' '))
    assert.equal(JSON.parse(result.stdout).error.code, 'INVALID_INPUT', args.join(' '))
  }
})
