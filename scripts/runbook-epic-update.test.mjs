// E2E test of docs/runbooks/epic-update.md: the real CLI, run as a subprocess, on a Local tracker (PMK-348).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { childEnv } from './golden-helpers.mjs'
import { hashTree, makeRepo, tempDir } from './test-helpers.mjs'

const SCRIPTS = path.dirname(fileURLToPath(import.meta.url))
const CLI = path.join(SCRIPTS, 'pmkit.mjs')
const RUNBOOK = path.join(SCRIPTS, '..', 'docs', 'runbooks', 'epic-update.md')

const pmkit = (root, args) => spawnSync(process.execPath, [CLI, ...args], { cwd: root, env: childEnv(), encoding: 'utf8' })
const json = (result) => {
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`)
  return JSON.parse(result.stdout)
}
const failure = (result) => {
  assert.equal(result.status, 2, `${result.stdout}\n${result.stderr}`)
  return JSON.parse(result.stdout).error
}
const tempFile = (name, text) => {
  const file = path.join(tempDir('pmkit-epic-update-tmp-'), name)
  fs.writeFileSync(file, text)
  return file
}
const DESCRIPTION = 'Ship the second release to every customer.'

function runbookRepo() {
  const root = makeRepo('basic')
  const epic = json(pmkit(root, ['epic', 'create', '--title-file', tempFile('epic-title.txt', 'Release 2'), '--json'])).after.id
  const events = () => fs.readFileSync(path.join(root, '.issues', 'epics', epic, 'events.jsonl'), 'utf8').trim().split('\n').map((line) => JSON.parse(line))
  return { root, epic, events, description: tempFile('description.md', DESCRIPTION), title: tempFile('new-title.txt', 'Release 2.0') }
}

test('the runbook names every call the test runs', () => {
  const text = fs.readFileSync(RUNBOOK, 'utf8')
  for (const call of [
    'epic create --title-file tmp/epic-title.txt --json',
    'epic update <epic-id> --description-file tmp/description.md --dry-run --json',
    'epic update <epic-id> --description-file tmp/description.md --json',
    'epic get <epic-id> --json',
    'epic update <epic-id> --title-file tmp/new-title.txt --json',
    'epic update <epic-id> --json',
    'epic update EPC-ZZZZ --title-file tmp/new-title.txt --json',
  ]) assert.ok(text.includes(`node scripts/pmkit.mjs ${call}`), call)
})

test('steps 1 to 3: a dry run writes nothing, then the description and the title change, each with an update event', () => {
  const { root, epic, events, description, title } = runbookRepo()
  const tracker = path.join(root, '.issues')
  const before = hashTree(tracker)
  const dry = json(pmkit(root, ['epic', 'update', epic, '--description-file', description, '--dry-run', '--json']))
  assert.equal(dry.before.description, '')
  assert.equal(dry.after.description, DESCRIPTION)
  assert.equal(hashTree(tracker), before)

  json(pmkit(root, ['epic', 'update', epic, '--description-file', description, '--json']))
  let read = json(pmkit(root, ['epic', 'get', epic, '--json']))
  assert.equal(read.description, DESCRIPTION)
  assert.equal(read.title, 'Release 2')
  const described = events().at(-1)
  assert.deepEqual({ ...described, at: undefined }, { at: undefined, by: described.by, op: 'update', field: 'description', from: '', to: DESCRIPTION })
  assert.ok(described.by && described.at, JSON.stringify(described))

  json(pmkit(root, ['epic', 'update', epic, '--title-file', title, '--json']))
  read = json(pmkit(root, ['epic', 'get', epic, '--json']))
  assert.equal(read.title, 'Release 2.0')
  assert.equal(read.description, DESCRIPTION)
  const renamed = events().at(-1)
  assert.deepEqual([renamed.op, renamed.field, renamed.from, renamed.to], ['update', 'title', 'Release 2', 'Release 2.0'])
})

test('steps 4 to 6: no change and no flag refuse with INVALID_INPUT, an unknown epic with NOT_FOUND, and nothing is written', () => {
  const { root, epic, title } = runbookRepo()
  json(pmkit(root, ['epic', 'update', epic, '--title-file', title, '--json']))
  const tracker = path.join(root, '.issues')
  const before = hashTree(tracker)
  assert.equal(failure(pmkit(root, ['epic', 'update', epic, '--title-file', title, '--json'])).code, 'INVALID_INPUT')
  assert.equal(failure(pmkit(root, ['epic', 'update', epic, '--json'])).code, 'INVALID_INPUT')
  assert.equal(failure(pmkit(root, ['epic', 'update', 'EPC-ZZZZ', '--title-file', title, '--json'])).code, 'NOT_FOUND')
  assert.equal(hashTree(tracker), before)
})

test('the edit keeps every other frontmatter key, its comments and the status', () => {
  const { root, epic, title } = runbookRepo()
  const file = path.join(root, '.issues', 'epics', epic, 'epic.md')
  fs.writeFileSync(file, fs.readFileSync(file, 'utf8').replace(/^status: (.*)$/m, 'status: $1 # keep me'))
  json(pmkit(root, ['epic', 'update', epic, '--title-file', title, '--json']))
  const text = fs.readFileSync(file, 'utf8')
  assert.match(text, /^title: Release 2\.0$/m)
  assert.match(text, /# keep me$/m)
})
