// E2E test of docs/runbooks/setup-jira.md: the real CLI as a subprocess, with globalThis.fetch replaced by the fake Jira
// site before the CLI loads, so no socket opens. It walks the first run, an update and the two errors of the runbook.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { childEnv } from './golden-helpers.mjs'
import { FAKE_EMAIL, FAKE_ENV, FAKE_HEADER, FAKE_TOKEN, jiraSiteRoutes } from './fake-jira-api.mjs'
import { makeRepo, tempDir, userStoreEnv } from './test-helpers.mjs'

const SCRIPTS = path.dirname(fileURLToPath(import.meta.url))
const RUNBOOK = path.join(SCRIPTS, '..', 'docs', 'runbooks', 'setup-jira.md')
const SETUP = path.join(SCRIPTS, '..', 'commands', 'setup.md')
const url = (name) => pathToFileURL(path.join(SCRIPTS, name)).href

/** Writes a launcher that installs the fake fetch of the site, with `routes` over it, and runs the CLI. */
function launcher(routes = {}) {
  const file = path.join(tempDir('pmkit-jira-launcher-'), 'launch.mjs')
  fs.writeFileSync(file, `import { fakeJiraFetch, jiraSiteRoutes } from ${JSON.stringify(url('fake-jira-api.mjs'))}
globalThis.fetch = fakeJiraFetch({ ...jiraSiteRoutes(), ...${JSON.stringify(routes)} })
const { run } = await import(${JSON.stringify(url('pmkit.mjs'))})
const result = await run(process.argv.slice(2))
process.stdout.write(result.stdout)
process.stderr.write(result.stderr)
process.exitCode = result.code
`)
  return file
}

const configFile = (root) => path.join(root, '.pmkit', 'config.yaml')

/** The repository of "Before you start": no .pmkit/config.yaml yet. */
function repository() {
  const root = makeRepo('basic')
  fs.rmSync(configFile(root))
  return root
}

function pmkit(root, args, { routes, env = FAKE_ENV } = {}) {
  const result = spawnSync(process.execPath, [launcher(routes), ...args], { cwd: root, env: { ...childEnv(), ...userStoreEnv().env, ...env }, encoding: 'utf8' })
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

const INIT = ['init', '--tracker', 'jira', '--git-host', 'none', '--site', 'acme.atlassian.net']
const ANSWERS = [
  '--space', 'ENG',
  ...['backlog=none', 'in_review=Review', 'canceled=none'].flatMap((item) => ['--status', item]),
  '--field', 'estimate=customfield_10016',
  ...['feature=Story', 'bug=Bug', 'task=none', 'chore=none'].flatMap((item) => ['--type-label', item]),
]

test('the runbook names every command the test runs', () => {
  const text = fs.readFileSync(RUNBOOK, 'utf8')
  for (const command of [
    'pmkit.mjs init --tracker jira --git-host none --site acme.atlassian.net --dry-run --json',
    '--space ENG --dry-run --json',
    '--status in_review=Review',
    '--field estimate=customfield_10016',
    '--type-label feature=Story',
    'pmkit.mjs init --update --dry-run --json',
    'pmkit.mjs validate --json',
    'pmkit.mjs discover --json',
  ]) assert.ok(text.includes(command), command)
})

test('first run: the space, the questions, the preview, the write and the check (steps 1 to 5)', () => {
  const root = repository()

  // Step 1: the space question, nothing written.
  const first = json(pmkit(root, [...INIT, '--dry-run', '--json']))
  assert.equal(first.tracker, 'jira')
  assert.equal(first.site, 'acme.atlassian.net')
  assert.deepEqual(first.viewer, { id: 'acc-1', name: 'Test User' })
  assert.equal(first.space, null)
  assert.deepEqual(first.questions.map((q) => q.path), ['tracker.scope.space'])
  assert.deepEqual(first.questions[0].candidates, ['ENG', 'OPS'])
  assert.deepEqual(first.questions[0].titles, { ENG: 'Engineering', OPS: 'Operations' })
  assert.equal(first.questions[0].recommended, null)
  assert.equal(fs.existsSync(configFile(root)), false)

  // Step 2: the status, field and type questions.
  const second = json(pmkit(root, [...INIT, '--space', 'ENG', '--dry-run', '--json']))
  assert.deepEqual(second.space, { key: 'ENG', name: 'Engineering', style: 'company-managed' })
  assert.deepEqual(second.questions.map((q) => q.path), [
    'mappings.status.backlog', 'mappings.status.in_review', 'mappings.status.canceled',
    'mappings.fields.estimate',
    'mappings.types.feature', 'mappings.types.bug', 'mappings.types.task', 'mappings.types.chore',
  ])
  const byPath = Object.fromEntries(second.questions.map((q) => [q.path, q]))
  assert.equal(byPath['mappings.status.in_review'].recommended, 'Review')
  assert.equal(byPath['mappings.fields.estimate'].recommended, 'customfield_10016')
  assert.equal(byPath['mappings.fields.estimate'].titles.customfield_10016, 'Story Points')
  assert.equal(byPath['mappings.types.feature'].recommended, 'Story')
  assert.equal(byPath['mappings.types.bug'].recommended, 'Bug')
  assert.ok(second.notes.includes('the site has no field for the acceptance criteria'), second.notes.join('\n'))
  assert.equal(fs.existsSync(configFile(root)), false)

  // Step 3: every answer, the preview.
  const preview = json(pmkit(root, [...INIT, ...ANSWERS, '--dry-run', '--json']))
  assert.deepEqual(preview.questions, [])
  assert.deepEqual(preview.files.map((file) => [file.path, file.action]), [['.pmkit/config.yaml', 'create']])
  assert.equal(preview.statuses.find((s) => s.name === 'Review').category, 'in_review')
  assert.equal(fs.existsSync(configFile(root)), false)

  // Step 4: the write.
  json(pmkit(root, [...INIT, ...ANSWERS, '--json']))
  const config = fs.readFileSync(configFile(root), 'utf8')
  for (const line of ['system: jira', 'site: acme.atlassian.net', 'space: ENG', 'in_review: Review', 'estimate: customfield_10016', 'feature: Story', 'bug: Bug']) {
    assert.ok(config.includes(line), `${line} in\n${config}`)
  }

  // Step 5: validate and discover.
  assert.equal(pmkit(root, ['validate', '--json']).code, 0)
  const found = json(pmkit(root, ['discover', '--json']))
  assert.equal(found.space.key, 'ENG')
  assert.deepEqual(found.fields.estimate, { id: 'customfield_10016', name: 'Story Points' })
})

test('existing config: nothing changed keeps the file, a renamed status is asked again (steps 6 and 7)', () => {
  const root = repository()
  json(pmkit(root, [...INIT, ...ANSWERS, '--json']))
  const held = fs.readFileSync(configFile(root), 'utf8')

  // Step 6: nothing changed in Jira.
  const again = json(pmkit(root, ['init', '--update', '--dry-run', '--json']))
  assert.deepEqual(again.questions, [])
  assert.deepEqual(again.files.map((file) => file.action), ['keep'])

  // Step 7: Review renamed to Code Review in Jira.
  const statuses = jiraSiteRoutes()['GET /rest/api/3/project/ENG/statuses']
  const renamed = { 'GET /rest/api/3/project/ENG/statuses': JSON.parse(JSON.stringify(statuses).replaceAll('"Review"', '"Code Review"')) }
  const broken = json(pmkit(root, ['init', '--update', '--dry-run', '--json'], { routes: renamed }))
  assert.deepEqual(broken.broken.map((item) => item.path), ['mappings.status.in_review'])
  assert.deepEqual(broken.questions.map((q) => q.path), ['mappings.status.in_review'])
  assert.equal(broken.questions[0].broken.was, 'Review')
  assert.equal(broken.questions[0].recommended, 'Code Review')
  assert.equal(fs.readFileSync(configFile(root), 'utf8'), held)
  json(pmkit(root, ['init', '--update', '--status', 'in_review=Code Review', '--json'], { routes: renamed }))
  assert.match(fs.readFileSync(configFile(root), 'utf8'), /in_review: Code Review/)

  // Step 7: a held space the site lacks is the space question again.
  const missing = { status: 404, json: { errorMessages: ['No project could be found'] } }
  fs.writeFileSync(configFile(root), fs.readFileSync(configFile(root), 'utf8').replace('space: ENG', 'space: NOPE'))
  const gone = json(pmkit(root, ['init', '--update', '--dry-run', '--json'], { routes: { 'GET /rest/api/3/project/NOPE': missing, 'GET /rest/api/3/project/NOPE/statuses': missing } }))
  assert.deepEqual(gone.questions.map((q) => q.path), ['tracker.scope.space'])
  assert.equal(gone.questions[0].broken.was, 'NOPE')
  assert.deepEqual(gone.questions[0].candidates, ['ENG', 'OPS'])
})

test('errors: no variables is AUTH, a Server site is NOT_SUPPORTED, no site is NOT_CONFIGURED, and nothing is written (steps 8 to 10)', () => {
  const root = repository()
  const auth = failure(pmkit(root, [...INIT, '--dry-run', '--json'], { env: { JIRA_EMAIL: '', JIRA_API_TOKEN: '' } }))
  assert.equal(auth.code, 'AUTH')
  assert.equal(auth.nextStep, '/pmkit:setup')
  const server = { 'GET /rest/api/3/serverInfo': { json: { deploymentType: 'Server', version: '9.12.0' } } }
  assert.equal(failure(pmkit(root, [...INIT, '--dry-run', '--json'], { routes: server })).code, 'NOT_SUPPORTED')
  const noSite = failure(pmkit(root, [...INIT, '--dry-run', '--json'], { routes: { 'GET /rest/api/3/serverInfo': { status: 404, text: 'Not Found' } } }))
  assert.equal(noSite.code, 'NOT_CONFIGURED')
  assert.equal(noSite.message, 'No Jira site answers at acme.atlassian.net')
  assert.ok(fs.readFileSync(RUNBOOK, 'utf8').includes('No Jira site answers at <site>'), 'step 10 names the message')
  assert.equal(failure(pmkit(root, ['init', '--tracker', 'jira', '--site', 'https://acme.atlassian.net/', '--dry-run', '--json'])).code, 'INVALID_INPUT')
  assert.equal(fs.existsSync(configFile(root)), false)
})

test('a site in another language: recommendations follow the English names, the file holds the shown ones (step 12)', () => {
  const root = repository()
  const routes = jiraSiteRoutes({ locale: 'pt', taskType: true })
  const proposal = json(pmkit(root, [...INIT, '--space', 'ENG', '--dry-run', '--json'], { routes }))
  const byPath = Object.fromEntries(proposal.questions.map((q) => [q.path, q]))
  assert.equal(byPath['mappings.status.in_review'].recommended, 'Em análise')
  assert.deepEqual(['feature', 'bug', 'task', 'chore'].map((type) => byPath[`mappings.types.${type}`].recommended), ['História', 'Bug', 'Tarefa', 'none'])
  const flag = { status: '--status', fields: '--field', types: '--type-label' }
  const answers = proposal.questions.flatMap((q) => [flag[q.path.split('.')[1]], `${q.path.split('.')[2]}=${q.recommended}`])
  assert.deepEqual(json(pmkit(root, [...INIT, '--space', 'ENG', ...answers, '--json'], { routes })).questions, [])
  const config = fs.readFileSync(configFile(root), 'utf8')
  for (const line of ['in_review: Em análise', 'feature: História', 'task: Tarefa']) assert.ok(config.includes(line), `${line} in\n${config}`)
  assert.equal(pmkit(root, ['validate', '--json'], { routes }).code, 0)
  // A create without --type takes the work type named Task in English, shown as Tarefa.
  fs.writeFileSync(path.join(root, 'title.txt'), 'New')
  const created = json(pmkit(root, ['issues', 'create', '--title-file', 'title.txt', '--dry-run', '--json'], { routes }))
  assert.equal(created.after.type, 'task')
  const text = fs.readFileSync(RUNBOOK, 'utf8')
  for (const expected of ['## A site in another language', 'untranslatedName', '`Em análise`', '`Tarefa`', 'PMK-394', 'without `--type`']) assert.ok(text.includes(expected), expected)
})

test('setup.md offers Jira', () => {
  const text = fs.readFileSync(SETUP, 'utf8')
  for (const expected of ['can browse no space', 'Browse access', 'in Jira first', '### Jira first run', '### Existing Jira config', 'id.atlassian.com', 'JIRA_EMAIL', 'JIRA_API_TOKEN', 'Jira Cloud only', '"Jira"', 'init --tracker jira']) {
    assert.ok(text.includes(expected), expected)
  }
})
