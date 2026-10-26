import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  CONFIRM, ESTIMATE_UNITS, GIT_HOSTS, MEMBER_ID, PREFIX, PREVIEW, TRACKERS, WEEKDAYS,
  findRoot, loadConfig, localConfigShapeProblems, validateLocalConfig, validatePmkitConfig, withLocalDefaults,
} from './lib/config.mjs'
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

test('validateLocalConfig accepts a missing id_style and refuses an unknown one', () => {
  const local = template('issues.config.yaml')
  delete local.id_style
  assert.deepEqual(validateLocalConfig(local), [])
  local.id_style = 'sequential'
  assert.deepEqual(validateLocalConfig(local), ['id_style must be random or numbered'])
  assert.equal(withLocalDefaults({}).id_style, 'random')
})

test('both templates validate with no problem', () => {
  assert.deepEqual(validatePmkitConfig(template('pmkit.config.yaml')), [])
  assert.deepEqual(validateLocalConfig(withLocalDefaults(template('issues.config.yaml'))), [])
})

test('the git templates hold the expected lines', () => {
  const read = (name) => readFileSync(new URL(`../templates/${name}`, import.meta.url), 'utf8')
  assert.equal(read('issues.gitattributes'), 'events.jsonl merge=union\n*.jsonl text eol=lf\n*.md text eol=lf\n')
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

test('an empty or non-map .pmkit/config.yaml and a non-string tracker.path are INVALID_INPUT', () => {
  for (const text of ['', '# nothing yet\n', '- local\n', 'version: 1\n']) {
    const root = tmp()
    mkdirSync(join(root, '.pmkit'))
    writeFileSync(join(root, '.pmkit', 'config.yaml'), text)
    assert.throws(() => loadConfig(root), (error) => error.code === 'INVALID_INPUT' && error.nextStep === '/pmkit:setup', JSON.stringify(text))
  }
  const root = tmp()
  mkdirSync(join(root, '.pmkit'))
  writeFileSync(join(root, '.pmkit', 'config.yaml'), 'version: 1\ntracker:\n  system: local\n  path: 5\n')
  assert.throws(() => loadConfig(root), (error) => error.code === 'INVALID_INPUT' && /tracker\.path/.test(error.message))
})

test('config.mjs exports the constants the schemas mirror', () => {
  assert.deepEqual(TRACKERS, ['local', 'linear', 'jira', 'github', 'gitlab', 'azure-devops'])
  assert.deepEqual(GIT_HOSTS, ['github', 'none'])
  assert.deepEqual(CONFIRM, ['all_writes', 'single_writes', 'none'])
  assert.deepEqual(PREVIEW, ['bulk', 'delete', 'publish_update', 'move_scope'])
  assert.deepEqual(WEEKDAYS, ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'])
  assert.deepEqual(ESTIMATE_UNITS, ['points', 'hours', 'sizes'])
  assert.ok(PREFIX instanceof RegExp && MEMBER_ID instanceof RegExp)
})

test('localConfigShapeProblems accepts the template and leaves the cross-field rules out', () => {
  const local = withLocalDefaults(template('issues.config.yaml'))
  assert.deepEqual(localConfigShapeProblems(local), [])
  local.id_prefix = local.epic_prefix
  local.default_status = 'nope'
  assert.deepEqual(localConfigShapeProblems(local), [])
  assert.ok(validateLocalConfig(local).includes('id_prefix and epic_prefix must differ'))
  assert.ok(validateLocalConfig(local).includes('default_status must be a status'))
})

test('localConfigShapeProblems reports every key the CLI reads', () => {
  const cases = [
    [{ auto_commit: 'yes' }, 'auto_commit must be true or false'],
    [{ members: { fred: null } }, 'member fred must be a map'],
    [{ members: { fred: { name: 1 } } }, 'member fred: name must be a string'],
    [{ members: { fred: { email: 1 } } }, 'member fred: email must be a string'],
    [{ members: null }, 'members must be a map'],
    [{ labels: null }, 'labels must be a list of strings'],
    [{ labels: [1] }, 'labels must be a list of strings'],
    [{ estimate: { unit: 'points', scale: null } }, 'estimate.scale must be a list of numbers or strings'],
    [{ estimate: null }, 'estimate must be a map'],
    [{ defaults: null }, 'defaults must be a map'],
    [{ statuses: null }, 'statuses must be a map'],
    [{ default_status: 1 }, 'default_status must be a string'],
    [{ version: 0 }, 'version must be a whole number of 1 or more'],
    [{ version: 1.5 }, 'version must be a whole number of 1 or more'],
  ]
  for (const [patch, message] of cases) {
    const local = { ...withLocalDefaults(template('issues.config.yaml')), ...patch }
    const problems = localConfigShapeProblems(local)
    assert.ok(problems.includes(message), `${JSON.stringify(patch)} gave ${JSON.stringify(problems)}`)
  }
})

test('validatePmkitConfig checks git_host.repo, git_host.default_branch and write_policy.preview', () => {
  const base = () => template('pmkit.config.yaml')
  const cases = [
    [(c) => { c.git_host.repo = 1 }, 'git_host.repo must be a string'],
    [(c) => { c.git_host.default_branch = 1 }, 'git_host.default_branch must be a string'],
    [(c) => { c.write_policy.preview = ['x'] }, 'write_policy.preview must be a list of bulk, delete, publish_update, move_scope'],
    [(c) => { c.write_policy.preview = null }, 'write_policy.preview must be a list of bulk, delete, publish_update, move_scope'],
  ]
  for (const [edit, message] of cases) {
    const pmkit = base()
    edit(pmkit)
    assert.ok(validatePmkitConfig(pmkit).includes(message), message)
  }
  const ok = base()
  ok.write_policy.preview = ['bulk', 'delete']
  assert.deepEqual(validatePmkitConfig(ok), [])
})

test('validatePmkitConfig accepts tracker.path absent, null and .issues for the local tracker', () => {
  for (const path of [undefined, null, '.issues']) {
    const pmkit = template('pmkit.config.yaml')
    if (path === undefined) delete pmkit.tracker.path
    else pmkit.tracker.path = path
    assert.deepEqual(validatePmkitConfig(pmkit), [], String(path))
  }
})
