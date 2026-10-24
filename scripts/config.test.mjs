import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { findRoot, loadConfig, validateLocalConfig, validatePmkitConfig, withLocalDefaults } from './lib/config.mjs'
import { parseYaml } from './lib/yaml.mjs'

const fixture = fileURLToPath(new URL('./__fixtures__/basic', import.meta.url))
const template = (name) => parseYaml(readFileSync(new URL(`../templates/${name}`, import.meta.url), 'utf8'))
const tmp = () => mkdtempSync(join(tmpdir(), 'pmkit-config-'))

test('the fixture loads with defaults applied', () => {
  const config = loadConfig(fixture)
  assert.equal(config.root, fixture)
  assert.equal(config.issuesDir, join(fixture, '.issues'))
  assert.equal(config.pmkit.git_host.system, 'none')
  assert.equal(config.local.members.fred.email, 'fred@example.com')
  assert.equal(config.local.epic_prefix, 'EPC')
  assert.deepEqual(validateLocalConfig(config.local), [])
})

test('withLocalDefaults fills what is missing and keeps what is set', () => {
  const local = withLocalDefaults({ id_prefix: 'ABC', estimate: { unit: 'hours' }, defaults: { stale_days: 10 } })
  assert.deepEqual(local.types, ['feature', 'bug', 'task', 'chore'])
  assert.equal(local.estimate.unit, 'hours')
  assert.deepEqual(local.estimate.scale, [1, 2, 3, 5, 8, 13])
  assert.equal(local.defaults.stale_days, 10)
  assert.equal(local.defaults.velocity_window, 3)
  assert.equal(local.default_status, 'backlog')
  assert.equal(local.auto_commit, false)
  assert.deepEqual(local.members, {})
})

test('a folder without .pmkit/config.yaml throws NOT_CONFIGURED', () => {
  assert.throws(
    () => loadConfig(tmp()),
    (error) => error.code === 'NOT_CONFIGURED' && error.nextStep === '/pmkit:setup',
  )
})

test('a missing local config throws NOT_CONFIGURED', () => {
  const root = tmp()
  mkdirSync(join(root, '.pmkit'))
  writeFileSync(join(root, '.pmkit', 'config.yaml'), 'version: 1\ntracker:\n  system: local\n  path: .issues\n')
  assert.throws(() => loadConfig(root), (error) => error.code === 'NOT_CONFIGURED')
})

test('tracker.system jira throws NOT_SUPPORTED', () => {
  const root = tmp()
  mkdirSync(join(root, '.pmkit'))
  writeFileSync(join(root, '.pmkit', 'config.yaml'), 'version: 1\ntracker:\n  system: jira\n')
  assert.throws(() => loadConfig(root), (error) => error.code === 'NOT_SUPPORTED')
})

test('a local config that is not valid YAML throws INVALID_INPUT', () => {
  const root = tmp()
  mkdirSync(join(root, '.pmkit'))
  mkdirSync(join(root, '.issues'))
  writeFileSync(join(root, '.pmkit', 'config.yaml'), 'version: 1\ntracker:\n  system: local\n  path: .issues\n')
  writeFileSync(join(root, '.issues', 'config.yaml'), 'a: [1, 2\n')
  assert.throws(() => loadConfig(root), (error) => error.code === 'INVALID_INPUT')
})

test('validateLocalConfig reports a missing category', () => {
  const local = template('issues.config.yaml')
  delete local.statuses.done
  assert.deepEqual(validateLocalConfig(local), ['category done has no status'])
})

test('validateLocalConfig reports an unknown category', () => {
  const local = template('issues.config.yaml')
  local.statuses.x = { category: 'blocked' }
  assert.ok(validateLocalConfig(local).includes('status x: unknown category blocked'))
})

test('validateLocalConfig checks prefixes, members, estimate and defaults', () => {
  const local = template('issues.config.yaml')
  local.id_prefix = 'EPC'
  local.members = { Fred: { availability: 1 }, 'agent:claude': { availability: 2 } }
  local.estimate.unit = 'days'
  local.defaults.stale_days = 0
  local.defaults.sprint_start_weekday = 'xyz'
  local.default_status = 'nope'
  local.types = []
  const problems = validateLocalConfig(local)
  assert.equal(problems.length, 8)
})

test('both templates validate with no problem', () => {
  assert.deepEqual(validatePmkitConfig(template('pmkit.config.yaml')), [])
  assert.deepEqual(validateLocalConfig(withLocalDefaults(template('issues.config.yaml'))), [])
})

test('the git templates hold the expected lines', () => {
  const read = (name) => readFileSync(new URL(`../templates/${name}`, import.meta.url), 'utf8')
  assert.equal(read('issues.gitattributes'), 'events.jsonl merge=union\n')
  assert.equal(read('issues.gitignore'), '.cache/\n')
})

test('validatePmkitConfig reports problems', () => {
  const pmkit = template('pmkit.config.yaml')
  pmkit.version = 2
  pmkit.tracker.system = 'trello'
  pmkit.git_host.system = 'gitlab'
  pmkit.write_policy.confirm = 'sometimes'
  assert.equal(validatePmkitConfig(pmkit).length, 4)
})

test('findRoot walks up to the folder with .pmkit/config.yaml', () => {
  assert.equal(findRoot(join(fixture, '.issues', 'issues')), fixture)
})

test('findRoot falls back to .git, then to the start folder', () => {
  const root = tmp()
  mkdirSync(join(root, '.git'))
  mkdirSync(join(root, 'a', 'b'), { recursive: true })
  assert.equal(findRoot(join(root, 'a', 'b')), root)
  const bare = tmp()
  assert.equal(findRoot(bare), bare)
})
