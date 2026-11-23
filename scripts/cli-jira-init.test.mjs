// init --tracker jira over the fake Jira fetch (PMK-365). No test opens a socket.
// See docs/superpowers/specs/2026-11-22-pmk-365-setup-pmkit-on-jira-design.md, "The CLI: `init --tracker jira`".
import assert from 'node:assert/strict'
import test from 'node:test'
import fs from 'node:fs'
import path from 'node:path'
import { ADAPTERS } from './lib/adapters.mjs'
import { FAKE_EMAIL, FAKE_ENV, FAKE_HEADER, FAKE_TOKEN, fakeJiraFetch, jiraSiteRoutes } from './fake-jira-api.mjs'
import { makeRepo, userStoreEnv } from './test-helpers.mjs'
import { run } from './pmkit.mjs'
import { jiraDescriptor } from './lib/jira/adapter.mjs'

globalThis.fetch = () => {
  throw new Error('the real fetch was called')
}

const configFile = (root) => path.join(root, '.pmkit', 'config.yaml')
const MISSING = { status: 404, json: { errorMessages: ['No project could be found'] } }

/** A repository without .pmkit/config.yaml, and a cli over a fake site. `held` writes a Jira config first. */
function session({ routes = {}, env = { ...FAKE_ENV }, held } = {}) {
  const root = makeRepo('basic')
  fs.rmSync(configFile(root))
  if (held !== undefined) fs.writeFileSync(configFile(root), held)
  const fetch = fakeJiraFetch({ ...jiraSiteRoutes(), ...routes })
  const fullEnv = { ...env, ...userStoreEnv().env }
  const cli = async (args) => {
    const result = await run(args, { cwd: root, env: fullEnv, adapters: { ...ADAPTERS, jira: jiraDescriptor({ fetch }) } })
    for (const secret of [FAKE_TOKEN, FAKE_EMAIL, FAKE_HEADER]) assert.ok(!(result.stdout + result.stderr).includes(secret), 'the output holds a secret')
    return result
  }
  return { root, fetch, cli }
}

const INIT = ['init', '--tracker', 'jira', '--site', 'acme.atlassian.net']
const ANSWERS = [
  ...['backlog=none', 'in_review=Review', 'canceled=none'].flatMap((item) => ['--status', item]),
  '--field', 'estimate=customfield_10016',
  ...['feature=Story', 'bug=Bug', 'task=none', 'chore=none'].flatMap((item) => ['--type-label', item]),
]
const dataOf = (result) => {
  assert.equal(result.code, 0, result.stdout + result.stderr)
  return JSON.parse(result.stdout)
}
const errorOf = (result) => {
  assert.notEqual(result.code, 0, result.stdout)
  return JSON.parse(result.stdout).error
}

/** A complete Jira config, as the real run of every answer writes it. */
async function completeConfig() {
  const { root, cli } = session()
  dataOf(await cli([...INIT, '--space', 'ENG', ...ANSWERS, '--json']))
  return fs.readFileSync(configFile(root), 'utf8')
}

test('without --site it asks for the site', async () => {
  const { cli } = session()
  const error = errorOf(await cli(['init', '--tracker', 'jira', '--dry-run', '--json']))
  assert.equal(error.code, 'INVALID_INPUT')
  assert.equal(error.nextStep, 'Pass --site <host>, such as --site acme.atlassian.net')
})

test('a URL as --site is refused before any request', async () => {
  const { cli, fetch } = session()
  const error = errorOf(await cli(['init', '--tracker', 'jira', '--site', 'https://acme.atlassian.net/', '--dry-run', '--json']))
  assert.equal(error.code, 'INVALID_INPUT')
  assert.equal(error.nextStep, 'Pass --site <host>, such as --site acme.atlassian.net')
  assert.equal(fetch.calls.length, 0)
})

test('without --space it returns the space question', async () => {
  const { root, cli } = session()
  const data = dataOf(await cli([...INIT, '--dry-run', '--json']))
  assert.deepEqual(Object.keys(data), ['dryRun', 'tracker', 'site', 'space', 'viewer', 'applied', 'questions', 'broken', 'statuses', 'notes', 'files'])
  assert.equal(data.tracker, 'jira')
  assert.equal(data.site, 'acme.atlassian.net')
  assert.equal(data.space, null)
  assert.equal(data.questions.length, 1)
  assert.equal(data.questions[0].path, 'tracker.scope.space')
  assert.deepEqual(data.questions[0].candidates, ['ENG', 'OPS'])
  assert.deepEqual(data.questions[0].titles, { ENG: 'Engineering', OPS: 'Operations' })
  assert.equal(data.files[0].action, 'create')
  assert.equal(fs.existsSync(configFile(root)), false)
  const text = await cli([...INIT, '--dry-run'])
  assert.match(text.stdout, /^site: acme\.atlassian\.net, viewer Test User\nspace: \(not chosen yet\)\n/)
})

test('with --space it returns the status, field and type questions', async () => {
  const { root, cli } = session()
  const data = dataOf(await cli([...INIT, '--space', 'ENG', '--dry-run', '--json']))
  assert.deepEqual(data.questions.map((q) => q.path), [
    'mappings.status.backlog', 'mappings.status.in_review', 'mappings.status.canceled',
    'mappings.fields.estimate',
    'mappings.types.feature', 'mappings.types.bug', 'mappings.types.task', 'mappings.types.chore',
  ])
  assert.deepEqual(data.space, { key: 'ENG', name: 'Engineering', style: 'company-managed' })
  assert.deepEqual(data.viewer, { id: 'acc-1', name: 'Test User' })
  assert.deepEqual(data.statuses, [
    { name: 'To Do', category: 'todo' },
    { name: 'In Progress', category: 'in_progress' },
    { name: 'Done', category: 'done' },
    { name: 'Review', category: 'in_progress' },
  ])
  assert.equal(fs.existsSync(configFile(root)), false)
  const text = await cli([...INIT, '--space', 'ENG', '--dry-run'])
  assert.match(text.stdout, /^site: acme\.atlassian\.net, viewer Test User\nspace: ENG Engineering \(company-managed\)\n/)
})

test('every answer, then the real run, writes the config', async () => {
  const { root, cli } = session()
  const dry = dataOf(await cli([...INIT, '--space', 'ENG', ...ANSWERS, '--dry-run', '--json']))
  assert.deepEqual(dry.questions, [])
  assert.equal(dry.statuses.find((s) => s.name === 'Review').category, 'in_review')
  assert.equal(fs.existsSync(configFile(root)), false)
  const real = dataOf(await cli([...INIT, '--space', 'ENG', ...ANSWERS, '--json']))
  assert.equal(real.files[0].action, 'create')
  const written = fs.readFileSync(configFile(root), 'utf8')
  for (const line of ['system: jira', 'site: acme.atlassian.net', 'space: ENG', 'in_review: Review', 'estimate: customfield_10016', 'feature: Story']) {
    assert.ok(written.includes(line), `${line} in\n${written}`)
  }
  const validate = await cli(['validate', '--json'])
  assert.equal(validate.code, 0, validate.stdout + validate.stderr)
})

test('a real run with questions left writes nothing', async () => {
  const { root, cli } = session()
  const error = errorOf(await cli([...INIT, '--space', 'ENG', '--json']))
  assert.equal(error.code, 'INVALID_INPUT')
  assert.match(error.message, /setup has unanswered questions/)
  assert.equal(fs.existsSync(configFile(root)), false)
  const spaceLeft = errorOf(await cli([...INIT, '--json']))
  assert.match(spaceLeft.message, /setup has unanswered questions: tracker\.scope\.space/)
  assert.equal(fs.existsSync(configFile(root)), false)
})

test('--update on a complete config keeps the file', async () => {
  const held = await completeConfig()
  const { root, cli } = session({ held })
  const data = dataOf(await cli(['init', '--update', '--dry-run', '--json']))
  assert.deepEqual(data.questions, [])
  assert.equal(data.files[0].action, 'keep')
  assert.equal(fs.readFileSync(configFile(root), 'utf8'), held)
})

test('--update asks a mapping that broke', async () => {
  const held = (await completeConfig()).replace('in_review: Review', 'in_review: Gone')
  const { cli } = session({ held })
  const data = dataOf(await cli(['init', '--update', '--dry-run', '--json']))
  assert.deepEqual(data.questions.map((q) => q.path), ['mappings.status.in_review'])
  assert.equal(data.questions[0].broken.was, 'Gone')
})

test('a held space the site lacks is asked again', async () => {
  const held = (await completeConfig()).replace('space: ENG', 'space: NOPE')
  const { cli } = session({ held, routes: { 'GET /rest/api/3/project/NOPE': MISSING, 'GET /rest/api/3/project/NOPE/statuses': MISSING } })
  const data = dataOf(await cli(['init', '--update', '--dry-run', '--json']))
  assert.deepEqual(data.questions.map((q) => q.path), ['tracker.scope.space'])
  assert.equal(data.questions[0].broken.was, 'NOPE')
  assert.deepEqual(data.questions[0].candidates, ['ENG', 'OPS'])
})

test('--space the site lacks is INVALID_INPUT naming the keys', async () => {
  const { cli } = session({ routes: { 'GET /rest/api/3/project/NOPE': MISSING, 'GET /rest/api/3/project/NOPE/statuses': MISSING } })
  const error = errorOf(await cli([...INIT, '--space', 'NOPE', '--dry-run', '--json']))
  assert.equal(error.code, 'INVALID_INPUT')
  assert.equal(error.nextStep, 'Pass one of: ENG, OPS')
})

test('--team, --project and --prefix are refused with --tracker jira', async () => {
  const { cli, fetch } = session()
  for (const flag of [['--team', 'ENG'], ['--project', 'acme/7'], ['--prefix', 'ISS']]) {
    const error = errorOf(await cli([...INIT, ...flag, '--dry-run', '--json']))
    assert.equal(error.code, 'INVALID_INPUT', flag[0])
  }
  assert.equal(fetch.calls.length, 0)
})

test('--site and --space are refused with another tracker', async () => {
  const { cli } = session()
  const error = errorOf(await cli(['init', '--site', 'acme.atlassian.net', '--dry-run', '--json']))
  assert.equal(error.code, 'INVALID_INPUT')
  assert.equal(error.message, '--site applies only with --tracker jira')
})

test('without JIRA_EMAIL it is AUTH', async () => {
  const { cli, fetch } = session({ env: {} })
  const error = errorOf(await cli([...INIT, '--space', 'ENG', '--dry-run', '--json']))
  assert.equal(error.code, 'AUTH')
  assert.equal(error.nextStep, '/pmkit:setup')
  assert.equal(fetch.calls.length, 0)
})

test('a Server site is NOT_SUPPORTED', async () => {
  const { cli } = session({ routes: { 'GET /rest/api/3/serverInfo': { json: { deploymentType: 'Server', version: '9.12.0' } } } })
  for (const args of [[...INIT, '--dry-run', '--json'], [...INIT, '--space', 'ENG', '--dry-run', '--json']]) {
    assert.equal(errorOf(await cli(args)).code, 'NOT_SUPPORTED')
  }
})
