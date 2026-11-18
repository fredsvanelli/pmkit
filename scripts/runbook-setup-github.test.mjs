// E2E test of docs/runbooks/setup-github.md: the real CLI, run as a subprocess, with a fake gh first on PATH.
// The fake answers from a fixture file through answerGh (scripts/fake-github-api.mjs) and logs each call.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { projectReply, repoReply, SCOPE_ERROR, standardFixture } from './fake-github-api.mjs'
import { childEnv } from './golden-helpers.mjs'
import { tempDir, userStoreEnv } from './test-helpers.mjs'

const SCRIPTS = path.dirname(fileURLToPath(import.meta.url))
const CLI = path.join(SCRIPTS, 'pmkit.mjs')
const TOKEN = `ghp_${'Zx9Q'.repeat(9)}`
const RUNBOOK = path.join(SCRIPTS, '..', 'docs', 'runbooks', 'setup-github.md')

/** Writes the fake gh into a new folder and returns { bin, fixtureFile, log }. */
function fakeGhOnPath(fixture) {
  const bin = tempDir('pmkit-fake-gh-')
  const fixtureFile = path.join(bin, 'fixture.json')
  const log = path.join(bin, 'calls.jsonl')
  fs.writeFileSync(fixtureFile, JSON.stringify(fixture))
  const api = pathToFileURL(path.join(SCRIPTS, 'fake-github-api.mjs')).href
  const script = `#!/usr/bin/env node
import fs from 'node:fs'
import { answerGh } from ${JSON.stringify(api)}
const args = process.argv.slice(2)
let input = ''
try { input = fs.readFileSync(0, 'utf8') } catch {}
fs.appendFileSync(${JSON.stringify(log)}, JSON.stringify({ args, input }) + '\\n')
const fixture = JSON.parse(fs.readFileSync(${JSON.stringify(fixtureFile)}, 'utf8'))
const answer = answerGh(args, input, fixture)
process.stdout.write(answer.stdout)
process.stderr.write(answer.stderr)
process.exitCode = answer.status
`
  fs.writeFileSync(path.join(bin, 'gh.mjs'), script)
  fs.writeFileSync(path.join(bin, 'gh'), `#!/bin/sh\nexec "${process.execPath}" "${path.join(bin, 'gh.mjs')}" "$@"\n`, { mode: 0o755 })
  return { bin, fixtureFile, log }
}

function repository(remote = 'git@github.com:acme/widgets.git') {
  const root = tempDir('pmkit-runbook-github-')
  const env = { ...childEnv(), ...userStoreEnv().env }
  spawnSync('git', ['init', '-q'], { cwd: root, env })
  spawnSync('git', ['remote', 'add', 'origin', remote], { cwd: root, env })
  return root
}

function pmkit(root, fake, args) {
  const env = { ...childEnv(), ...userStoreEnv().env, GH_TOKEN: TOKEN, PATH: `${fake.bin}${path.delimiter}${process.env.PATH}` }
  const result = spawnSync(process.execPath, [CLI, ...args], { cwd: root, env, encoding: 'utf8' })
  return { code: result.status, stdout: result.stdout, stderr: result.stderr }
}

const json = (result) => {
  assert.equal(result.code, 0, `${result.stdout}\n${result.stderr}`)
  return JSON.parse(result.stdout)
}
const calls = (fake) => (fs.existsSync(fake.log) ? fs.readFileSync(fake.log, 'utf8').split('\n').filter(Boolean).map((line) => JSON.parse(line)) : [])

const INIT = ['init', '--tracker', 'github', '--git-host', 'github']
const ANSWERS = [
  '--project', 'acme/7',
  ...['backlog=Backlog', 'todo=Todo', 'in_progress=In Progress', 'in_review=In Review', 'done=Done', 'canceled=none', 'blocked=none'].flatMap((item) => ['--status', item]),
  ...['priority=issue:Priority', 'estimate=issue:Effort', 'start_date=issue:Start date', 'target_date=issue:Target date', 'sprint=project:Sprint'].flatMap((item) => ['--field', item]),
  ...['feature=Feature', 'bug=Bug', 'task=Task', 'chore=none'].flatMap((item) => ['--type-label', item]),
]

test('the runbook names the commands this test runs', () => {
  const text = fs.readFileSync(RUNBOOK, 'utf8')
  for (const command of ['init --tracker github --git-host github --dry-run --json', '--project acme/7', 'validate --json', 'discover --json', 'capabilities --json', 'init --update --dry-run --json', 'init --tracker github --git-host github --project none --dry-run --json', '--type-label bug=bug']) {
    assert.ok(text.includes(command), command)
  }
})

test('runbook: first run, check, and an update with nothing changed', () => {
  const root = repository()
  const fake = fakeGhOnPath(standardFixture())

  // Step 1: the repository and the Project question.
  const first = json(pmkit(root, fake, [...INIT, '--dry-run', '--json']))
  assert.equal(first.host, 'github.com')
  assert.equal(first.repo, 'acme/widgets')
  assert.deepEqual(first.questions.map((q) => q.path), ['tracker.scope.project'])
  assert.deepEqual(first.questions[0].candidates, ['acme/7'])

  // Step 2: every Status category is asked.
  const second = json(pmkit(root, fake, [...INIT, '--project', 'acme/7', '--dry-run', '--json']))
  const status = second.questions.filter((q) => q.path.startsWith('mappings.status.'))
  assert.deepEqual(status.map((q) => q.path.split('.')[2]), ['backlog', 'todo', 'in_progress', 'in_review', 'done', 'canceled', 'blocked'])
  assert.deepEqual(status.filter((q) => q.required).map((q) => q.path.split('.')[2]), ['todo', 'in_progress', 'done'])
  assert.equal(status.find((q) => q.path.endsWith('.in_review')).recommended, 'In Review')

  // Step 3: the preview.
  const preview = json(pmkit(root, fake, [...INIT, ...ANSWERS, '--dry-run', '--json']))
  assert.deepEqual(preview.questions, [])
  assert.deepEqual(preview.files, [{ path: '.pmkit/config.yaml', action: 'create' }])
  assert.equal(fs.existsSync(path.join(root, '.pmkit', 'config.yaml')), false)

  // Step 4: the write.
  json(pmkit(root, fake, [...INIT, ...ANSWERS, '--json']))
  const config = fs.readFileSync(path.join(root, '.pmkit', 'config.yaml'), 'utf8')
  assert.match(config, /system: github\n {2}scope:\n {4}host: github\.com\n {4}repo: acme\/widgets\n {4}project: acme\/7/)

  // Step 5: validate, discover, capabilities.
  const validated = json(pmkit(root, fake, ['validate', '--json']))
  assert.deepEqual(validated.problems.filter((problem) => problem.path === '.pmkit/config.yaml'), [])
  const discovered = json(pmkit(root, fake, ['discover', '--json']))
  assert.deepEqual(discovered.issueTypes.map((type) => type.name), ['Task', 'Bug', 'Feature'])
  assert.deepEqual(discovered.issueFields.map((field) => field.name), ['Priority', 'Effort', 'Start date', 'Target date'])
  assert.ok(discovered.projectFields.some((field) => field.name === 'Story points'))
  assert.deepEqual(discovered.statusOptions, ['Backlog', 'Todo', 'In Progress', 'In Review', 'Done'])
  assert.equal(discovered.statuses.find((item) => item.name === 'In Review').category, 'in_review')
  const capabilities = json(pmkit(root, fake, ['capabilities', '--json']))
  assert.equal(capabilities.tracker, 'github')
  assert.deepEqual(capabilities.capabilities.filter((entry) => entry.path !== 'absent').map((entry) => [entry.id, entry.path]), [['cycles', 'native'], ['estimation', 'native'], ['multilevel_hierarchy', 'native'], ['dependencies', 'native'], ['deliverables', 'native'], ['status_update', 'native'], ['capacity', 'derived'], ['native_metrics', 'derived'], ['linked_code', 'derived']])

  // Step 6: nothing changed.
  const again = json(pmkit(root, fake, ['init', '--update', '--dry-run', '--json']))
  assert.deepEqual(again.questions, [])
  assert.deepEqual(again.files, [{ path: '.pmkit/config.yaml', action: 'keep' }])

  // Every call names the host, and none holds the token.
  const made = calls(fake)
  assert.ok(made.length > 0)
  for (const call of made) {
    assert.deepEqual(call.args.slice(0, 3), ['api', '--hostname', 'github.com'])
    assert.ok(!JSON.stringify(call).includes(TOKEN), 'a gh call holds the token')
  }
})

test('runbook: a renamed Status option is asked again on update (step 8)', () => {
  const root = repository()
  const fake = fakeGhOnPath(standardFixture())
  json(pmkit(root, fake, [...INIT, ...ANSWERS, '--json']))
  fs.writeFileSync(fake.fixtureFile, JSON.stringify(standardFixture({ graphql: { PmkitRepo: repoReply(), PmkitProject: projectReply({ status: ['Backlog', 'Todo', 'In Progress', 'Reviewing', 'Done'] }) } })))
  const broken = json(pmkit(root, fake, ['init', '--update', '--dry-run', '--json']))
  assert.deepEqual(broken.broken.map((item) => item.path), ['mappings.status.in_review'])
  assert.deepEqual(broken.questions.map((q) => q.path), ['mappings.status.in_review'])
  json(pmkit(root, fake, ['init', '--update', '--status', 'in_review=Reviewing', '--json']))
  assert.match(fs.readFileSync(path.join(root, '.pmkit', 'config.yaml'), 'utf8'), /in_review: Reviewing/)
})

test('runbook: the sprint field is offered, written and asked again when the Project loses it (steps 2, 4 and 7)', () => {
  const root = repository()
  const iteration = { __typename: 'ProjectV2IterationField', id: 'PF_4', name: 'Sprint', dataType: 'ITERATION', isIssueField: false, configuration: { duration: 14, startDay: 1, iterations: [], completedIterations: [] } }
  const withIteration = (...extra) => {
    const nodes = projectReply().data.repositoryOwner.projectV2.fields.nodes.filter((node) => node.dataType !== 'ITERATION')
    return standardFixture({ graphql: { PmkitRepo: repoReply(), PmkitProject: projectReply({ extra: [...nodes, ...extra] }) } })
  }
  const fake = fakeGhOnPath(withIteration(iteration, { ...iteration, id: 'PF_9', name: 'Cycle' }))
  const asked = json(pmkit(root, fake, [...INIT, '--project', 'acme/7', '--dry-run', '--json']))
  const sprint = asked.questions.find((q) => q.path === 'mappings.fields.sprint')
  assert.deepEqual(sprint.candidates, ['project:Sprint', 'project:Cycle'])
  assert.equal(sprint.recommended, 'project:Sprint')
  json(pmkit(root, fake, [...INIT, ...ANSWERS, '--json']))
  assert.match(fs.readFileSync(path.join(root, '.pmkit', 'config.yaml'), 'utf8'), /sprint: project:Sprint/)
  assert.deepEqual(json(pmkit(root, fake, ['validate', '--json'])).problems.filter((problem) => problem.path === '.pmkit/config.yaml'), [])
  fs.writeFileSync(fake.fixtureFile, JSON.stringify(withIteration()))
  const broken = json(pmkit(root, fake, ['init', '--update', '--dry-run', '--json']))
  assert.deepEqual(broken.broken.map((item) => item.path), ['mappings.fields.sprint'])
  assert.deepEqual(broken.questions.map((q) => q.path), ['mappings.fields.sprint'])
  json(pmkit(root, fake, ['init', '--update', '--field', 'sprint=none', '--json']))
  assert.match(fs.readFileSync(path.join(root, '.pmkit', 'config.yaml'), 'utf8'), /sprint: none/)
})

test('runbook: without the project scope the Project question offers none with the step (step 1)', () => {
  const root = repository('https://acme.ghe.com/acme/widgets.git')
  const fake = fakeGhOnPath(standardFixture({ graphql: { PmkitRepo: repoReply(), PmkitLinkedProjects: SCOPE_ERROR } }))
  const first = json(pmkit(root, fake, [...INIT, '--dry-run', '--json']))
  assert.equal(first.host, 'acme.ghe.com')
  assert.equal(first.questions[0].recommended, 'none')
  assert.match(first.questions[0].note, /gh auth refresh -s project -h acme\.ghe\.com/)
})

test('runbook: GHES below 3.19 stops setup with NOT_SUPPORTED (step 1)', () => {
  const root = repository('git@ghes.example.com:acme/widgets.git')
  const fake = fakeGhOnPath(standardFixture({ meta: { installed_version: '3.17.9' } }))
  const result = pmkit(root, fake, [...INIT, '--dry-run', '--json'])
  assert.equal(result.code, 2)
  const { error } = JSON.parse(result.stdout)
  assert.equal(error.code, 'NOT_SUPPORTED')
  assert.equal(error.message, 'GitHub Enterprise Server 3.17.9 is older than 3.19, the oldest version pmkit supports')
  assert.deepEqual(calls(fake).map((call) => call.args), [['api', '--hostname', 'ghes.example.com', 'meta']])
  assert.equal(fs.existsSync(path.join(root, '.pmkit', 'config.yaml')), false)
})

test('runbook: setup without a Project maps status and type labels (steps 9 to 11)', () => {
  const root = repository()
  const fixture = standardFixture()
  fixture.graphql.PmkitRepo = repoReply({ labels: ['bug', 'documentation', 'Backlog', 'In progress', 'In review'], types: [] })
  const fake = fakeGhOnPath(fixture)
  const asked = json(pmkit(root, fake, [...INIT, '--project', 'none', '--dry-run', '--json']))
  assert.equal(asked.project, null)
  const status = asked.questions.filter((q) => q.path.startsWith('mappings.status.'))
  assert.deepEqual(status.map((q) => [q.path, q.recommended]), [
    ['mappings.status.triage', 'none'], ['mappings.status.backlog', 'Backlog'], ['mappings.status.in_progress', 'In progress'], ['mappings.status.in_review', 'In review'],
  ])
  assert.equal(asked.questions.filter((q) => q.path.startsWith('mappings.types.')).length, 4)
  assert.ok(!calls(fake).some((call) => /PmkitProject/.test(call.input)))

  const answers = [
    '--project', 'none',
    ...['triage=none', 'backlog=Backlog', 'in_progress=In progress', 'in_review=In review'].flatMap((item) => ['--status', item]),
    ...['priority=issue:Priority', 'estimate=issue:Effort', 'start_date=issue:Start date', 'target_date=issue:Target date'].flatMap((item) => ['--field', item]),
    ...['feature=none', 'bug=bug', 'task=none', 'chore=none'].flatMap((item) => ['--type-label', item]),
  ]
  const written = json(pmkit(root, fake, [...INIT, ...answers, '--json']))
  const config = fs.readFileSync(path.join(root, '.pmkit', 'config.yaml'), 'utf8')
  assert.match(config, /project: none/)
  assert.match(config, /in_progress: "?label:In progress"?/)
  assert.match(config, /bug: "?label:bug"?/)
  assert.deepEqual(written.statuses.map((row) => [row.name, row.category]), [
    ['Backlog', 'backlog'], ['In progress', 'in_progress'], ['In review', 'in_review'], ['Open', 'todo'], ['Closed', 'done'], ['Closed as not planned', 'canceled'],
  ])

  const manifest = json(pmkit(root, fake, ['capabilities', '--json']))
  assert.equal(manifest.capabilities.find((item) => item.id === 'deliverables').enableHint, 'Needs a GitHub Project: set tracker.scope.project with /pmkit:setup')
  assert.ok(manifest.warnings.includes('tracker.scope.project is none, so cycles, capacity, deliverables and status_update are absent'))
})
