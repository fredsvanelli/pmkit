// E2E test of docs/runbooks/discover-jira.md: the real CLI as a subprocess, with globalThis.fetch replaced by the fake Jira
// site before the CLI loads, so no socket opens. It walks the runbook on a company-managed and a team-managed space.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { childEnv } from './golden-helpers.mjs'
import { FAKE_EMAIL, FAKE_ENV, FAKE_HEADER, FAKE_TOKEN } from './fake-jira-api.mjs'
import { makeRepo, tempDir } from './test-helpers.mjs'

const SCRIPTS = path.dirname(fileURLToPath(import.meta.url))
const RUNBOOK = path.join(SCRIPTS, '..', 'docs', 'runbooks', 'discover-jira.md')
const url = (name) => pathToFileURL(path.join(SCRIPTS, name)).href

/** Writes a launcher that installs the fake fetch for a site of `style` and `locale`, with `routes` over it, and runs the CLI. */
function launcher(style, routes = {}, locale = 'en') {
  const file = path.join(tempDir('pmkit-jira-launcher-'), 'launch.mjs')
  fs.writeFileSync(file, `import { fakeJiraFetch, jiraSiteRoutes } from ${JSON.stringify(url('fake-jira-api.mjs'))}
globalThis.fetch = fakeJiraFetch({ ...jiraSiteRoutes({ style: ${JSON.stringify(style)}, locale: ${JSON.stringify(locale)} }), ...${JSON.stringify(routes)} })
const { run } = await import(${JSON.stringify(url('pmkit.mjs'))})
const result = await run(process.argv.slice(2))
process.stdout.write(result.stdout)
process.stderr.write(result.stderr)
process.exitCode = result.code
`)
  return file
}

/** The repository the runbook's "Before you start" describes: tracker.system jira with a site and a space. */
function jiraRepo(scope = '    site: acme.atlassian.net\n    space: ENG') {
  const root = makeRepo('basic')
  const file = path.join(root, '.pmkit', 'config.yaml')
  fs.writeFileSync(file, fs.readFileSync(file, 'utf8').replace(/^ {2}system: local$/m, `  system: jira\n  scope:\n${scope}`))
  return root
}

function pmkit(root, args, { style = 'company-managed', locale, routes, env = FAKE_ENV } = {}) {
  const result = spawnSync(process.execPath, [launcher(style, routes, locale), ...args], { cwd: root, env: { ...childEnv(), ...env }, encoding: 'utf8' })
  const out = `${result.stdout}${result.stderr}`
  for (const secret of [FAKE_TOKEN, FAKE_EMAIL, FAKE_HEADER, FAKE_HEADER.slice(6)]) assert.ok(!out.includes(secret), 'a credential reached the output')
  return { code: result.status, stdout: result.stdout, stderr: result.stderr }
}

const json = (result) => {
  assert.equal(result.code, 0, `${result.stdout}\n${result.stderr}`)
  return JSON.parse(result.stdout)
}
const failure = (result) => {
  assert.equal(result.code, 2, `${result.stdout}\n${result.stderr}`)
  return JSON.parse(result.stdout).error
}

test('the runbook names every command the test runs', () => {
  const text = fs.readFileSync(RUNBOOK, 'utf8')
  for (const command of ['pmkit.mjs validate --json', 'pmkit.mjs discover --json', 'pmkit.mjs capabilities --json', 'pmkit.mjs discover']) assert.ok(text.includes(command), command)
})

test('steps 1 to 3 on a company-managed space: validate, discover and capabilities', () => {
  const root = jiraRepo()
  assert.equal(pmkit(root, ['validate', '--json']).code, 0)
  const found = json(pmkit(root, ['discover', '--json']))
  assert.equal(Object.keys(found)[0], 'auth')
  assert.deepEqual(found.auth, { source: 'JIRA_API_TOKEN', viewer: { accountId: 'acc-1', displayName: 'Test User' }, site: 'acme.atlassian.net' })
  assert.deepEqual(found.space, { key: 'ENG', name: 'Engineering', style: 'company-managed', type: 'software' })
  assert.deepEqual(found.spaces.map((s) => [s.key, s.style]), [['ENG', 'company-managed'], ['OPS', 'team-managed']])
  assert.deepEqual(found.workTypes.map((t) => [t.name, t.level]), [['Epic', 'epic'], ['Story', 'standard'], ['Bug', 'standard'], ['Sub-task', 'subtask']])
  assert.deepEqual(found.statuses.map((s) => s.category), ['todo', 'in_progress', 'done', 'in_progress'])
  assert.deepEqual(found.fields.estimate, { id: 'customfield_10016', name: 'Story Points' })
  const manifest = json(pmkit(root, ['capabilities', '--json']))
  assert.equal(manifest.tracker, 'jira')
  assert.equal(manifest.capabilities.length, 20)
  assert.equal(manifest.capabilities.find((c) => c.id === 'cycles').path, 'native')
  assert.match(pmkit(root, ['discover']).stdout, /^space: ENG Engineering \(company-managed, software\)$/m)
})

test('step 2 on a team-managed space reads its own estimate field', () => {
  const found = json(pmkit(jiraRepo(), ['discover', '--json'], { style: 'team-managed' }))
  assert.equal(found.space.style, 'team-managed')
  assert.deepEqual(found.fields.estimate, { id: 'customfield_10016', name: 'Story point estimate' })
})

test('step 2 on a site in another language finds the fields by their English name', () => {
  const found = json(pmkit(jiraRepo(), ['discover', '--json'], { locale: 'pt' }))
  assert.deepEqual(found.fields.start_date, { id: 'customfield_10015', name: 'Data de início' })
  assert.deepEqual(found.fields.acceptance_criteria, { id: 'customfield_10050', name: 'Critérios de aceite' })
  assert.ok(found.statuses.some((status) => status.name === 'Tarefas pendentes' && status.category === 'todo'))
  assert.ok(fs.readFileSync(RUNBOOK, 'utf8').includes("site's language"), 'the runbook says names follow the site language')
})

test('failures: no token, a Data Center site, no site at the host, an unknown space, no space in the config', () => {
  const root = jiraRepo()
  const env = { ...FAKE_ENV, JIRA_API_TOKEN: '' }
  assert.equal(failure(pmkit(root, ['discover', '--json'], { env })).code, 'AUTH')
  const dataCenter = { 'GET /rest/api/3/serverInfo': { json: { deploymentType: 'DataCenter' } } }
  assert.equal(failure(pmkit(root, ['discover', '--json'], { routes: dataCenter })).code, 'NOT_SUPPORTED')
  const noSite = failure(pmkit(root, ['discover', '--json'], { routes: { 'GET /rest/api/3/serverInfo': { status: 404, text: 'Not Found' } } }))
  assert.equal(noSite.code, 'NOT_CONFIGURED')
  assert.equal(noSite.message, 'No Jira site answers at acme.atlassian.net')
  assert.ok(fs.readFileSync(RUNBOOK, 'utf8').includes('`tracker.scope.site` names a host with no Jira site'), 'the failures table lists no site')
  const unknown = { 'GET /rest/api/3/project/ENG': { status: 404, json: { errorMessages: ['No project'] } } }
  assert.equal(failure(pmkit(root, ['discover', '--json'], { routes: unknown })).code, 'NOT_CONFIGURED')
  const noSpace = pmkit(jiraRepo('    site: acme.atlassian.net'), ['validate', '--json'])
  assert.ok(noSpace.stdout.includes('tracker.scope.space is required for jira'), noSpace.stdout)
})
