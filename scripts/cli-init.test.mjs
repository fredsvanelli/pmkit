import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { hashTree } from './test-helpers.mjs'
import { lineDiff } from './lib/diff.mjs'
import { FORMAT_VERSION } from './lib/local/migrations.mjs'
import { parseYaml } from './lib/yaml.mjs'

const CLI = path.join(path.dirname(fileURLToPath(import.meta.url)), 'pmkit.mjs')

function run(cwd, args, { input } = {}) {
  const env = { ...process.env, PMKIT_USER: 'fred', PMKIT_NOW: '2026-10-23T12:00:00Z', PMKIT_SEED: '1', GIT_CONFIG_GLOBAL: os.devNull, GIT_CONFIG_NOSYSTEM: '1' }
  const result = spawnSync(process.execPath, [CLI, ...args], { cwd, env, input, encoding: 'utf8' })
  return { status: result.status, stdout: result.stdout, stderr: result.stderr }
}

const json = (cwd, args, options) => {
  const result = run(cwd, [...args, '--json'], options)
  assert.equal(result.status, 0, result.stderr)
  return JSON.parse(result.stdout)
}

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'pmkit-init-'))
const read = (dir, file) => fs.readFileSync(path.join(dir, file), 'utf8')

test('lineDiff marks removed and added lines and keeps the common ones', () => {
  assert.equal(lineDiff('a\nb\n', 'a\nc\n'), '  a\n-b\n+c\n')
  assert.equal(lineDiff('a\n', 'a\n'), '  a\n')
  assert.equal(lineDiff('', 'x\n'), '+x\n')
})

test('a first run sets the estimate unit, adds every member from stdin and writes the current format version', () => {
  const dir = tmp()
  const members = 'fred: { name: Fred, email: f@x.dev }\nana: { name: Ana }\n'
  const result = json(dir, ['init', '--estimate-unit', 'hours', '--members-file', '-'], { input: members })
  assert.deepEqual(result.files.map((f) => f.action).filter((a) => a !== 'create'), [])
  assert.deepEqual(result.kept, [])
  const local = parseYaml(read(dir, '.issues/config.yaml'))
  assert.equal(local.estimate.unit, 'hours')
  assert.deepEqual(Object.keys(local.members), ['fred', 'ana'])
  assert.equal(local.members.fred.email, 'f@x.dev')
  assert.equal(local.version, FORMAT_VERSION)
})

test('--estimate-unit sizes also sets the scale', () => {
  const dir = tmp()
  assert.equal(run(dir, ['init', '--estimate-unit', 'sizes']).status, 0)
  const local = parseYaml(read(dir, '.issues/config.yaml'))
  assert.equal(local.estimate.unit, 'sizes')
  assert.deepEqual(local.estimate.scale, ['XS', 'S', 'M', 'L', 'XL'])
  assert.equal(run(dir, ['init', '--root', tmp(), '--estimate-unit', 'days']).status, 2)
})

test('--update --git-host changes only the system line', () => {
  const dir = tmp()
  assert.equal(run(dir, ['init']).status, 0)
  const file = path.join(dir, '.pmkit/config.yaml')
  const edited = `# my notes\n${fs.readFileSync(file, 'utf8').replace('confirm: single_writes', 'confirm: none # no prompts')}`
  fs.writeFileSync(file, edited)
  const result = json(dir, ['init', '--update', '--git-host', 'github'])
  const change = result.files.find((f) => f.path === '.pmkit/config.yaml')
  assert.equal(change.action, 'change')
  assert.match(change.diff, /^-  system: none$/m)
  assert.equal(read(dir, '.pmkit/config.yaml'), edited.replace('system: none', 'system: github'))
  assert.ok(result.files.filter((f) => f.path !== '.pmkit/config.yaml').every((f) => f.action === 'keep'))
})

test('--update reports a hand-edited template file as differs and replaces it only when asked', () => {
  const dir = tmp()
  assert.equal(run(dir, ['init']).status, 0)
  const file = path.join(dir, '.issues/.gitattributes')
  fs.writeFileSync(file, 'events.jsonl merge=ours\n')
  const first = json(dir, ['init', '--update'])
  const entry = first.files.find((f) => f.path === '.issues/.gitattributes')
  assert.equal(entry.action, 'differs')
  assert.match(entry.diff, /^-events\.jsonl merge=ours$/m)
  assert.match(entry.diff, /^\+events\.jsonl merge=union$/m)
  assert.equal(fs.readFileSync(file, 'utf8'), 'events.jsonl merge=ours\n')
  const second = json(dir, ['init', '--update', '--replace', '.issues/.gitattributes'])
  assert.equal(second.files.find((f) => f.path === '.issues/.gitattributes').action, 'replace')
  assert.match(fs.readFileSync(file, 'utf8'), /merge=union/)
})

test('--update recreates a missing file and keeps an existing member', () => {
  const dir = tmp()
  assert.equal(run(dir, ['init', '--member', 'fred', '--name', 'Fred']).status, 0)
  fs.rmSync(path.join(dir, '.issues/.gitignore'))
  const result = json(dir, ['init', '--update', '--members-file', '-'], { input: 'fred: { name: Other }\nana: { name: Ana }\n' })
  assert.equal(result.files.find((f) => f.path === '.issues/.gitignore').action, 'create')
  assert.deepEqual(result.kept, ['fred'])
  const members = parseYaml(read(dir, '.issues/config.yaml')).members
  assert.equal(members.fred.name, 'Fred')
  assert.equal(members.ana.name, 'Ana')
})

test('--update reads the tracker folder from the config', () => {
  const dir = tmp()
  assert.equal(run(dir, ['init']).status, 0)
  fs.renameSync(path.join(dir, '.issues'), path.join(dir, 'tracker'))
  fs.writeFileSync(path.join(dir, '.pmkit/config.yaml'), read(dir, '.pmkit/config.yaml').replace('path: .issues', 'path: tracker'))
  const result = json(dir, ['init', '--update', '--estimate-unit', 'hours'])
  assert.ok(result.files.every((f) => f.path.startsWith('tracker/') || f.path.startsWith('.pmkit/')))
  assert.equal(parseYaml(read(dir, 'tracker/config.yaml')).estimate.unit, 'hours')
  assert.equal(fs.existsSync(path.join(dir, '.issues')), false)
})

test('--update --dry-run writes nothing, and --update refuses --prefix or a missing setup', () => {
  const dir = tmp()
  assert.equal(run(dir, ['init']).status, 0)
  const before = hashTree(dir)
  const dry = json(dir, ['init', '--update', '--dry-run', '--git-host', 'github', '--estimate-unit', 'hours'])
  assert.equal(dry.dryRun, true)
  assert.ok(dry.files.some((f) => f.action === 'change'))
  assert.equal(hashTree(dir), before)
  const prefix = run(dir, ['init', '--update', '--prefix', 'ABC', '--json'])
  assert.equal(prefix.status, 2)
  assert.match(JSON.parse(prefix.stdout).error.message, /id_prefix cannot change after setup/)
  const empty = run(tmp(), ['init', '--update', '--json'])
  assert.equal(empty.status, 2)
  assert.equal(JSON.parse(empty.stdout).error.code, 'INVALID_INPUT')
  assert.match(JSON.parse(empty.stdout).error.nextStep, /without --update/)
})

test('--update that cannot edit a key fails with INVALID_INPUT naming the file and the key', () => {
  const dir = tmp()
  assert.equal(run(dir, ['init']).status, 0)
  const file = path.join(dir, '.issues/config.yaml')
  fs.writeFileSync(file, read(dir, '.issues/config.yaml').replace('scale: [1, 2, 3, 5, 8, 13]', 'scale:\n    - 1\n    - 2\n    - 3'))
  const before = hashTree(dir)
  const result = run(dir, ['init', '--update', '--estimate-unit', 'sizes', '--json'])
  assert.equal(result.status, 2)
  const error = JSON.parse(result.stdout).error
  assert.equal(error.code, 'INVALID_INPUT')
  assert.match(error.message, /\.issues\/config\.yaml/)
  assert.match(error.message, /estimate\.scale/)
  assert.doesNotMatch(error.message, /members/)
  assert.equal(hashTree(dir), before)
})
