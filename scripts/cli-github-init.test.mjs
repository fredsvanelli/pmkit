// init --tracker github and discover over the GitHub adapter with a fake gh runner. No test starts gh or opens a socket.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { capWarning, run } from './pmkit.mjs'
import { ADAPTERS } from './lib/adapters.mjs'
import { githubDescriptor } from './lib/github/adapter.mjs'
import { fakeGhExec, linkedReply, projectReply, repoReply, SCOPE_ERROR, standardFixture } from './fake-github-api.mjs'
import { BB, FAKE_BB_ENV, fakeBitbucketFetch } from './fake-bitbucket-api.mjs'
import { childEnv } from './golden-helpers.mjs'
import { tempDir, userStoreEnv } from './test-helpers.mjs'

process.env.GIT_CONFIG_GLOBAL = os.devNull
process.env.GIT_CONFIG_NOSYSTEM = '1'
process.env.GIT_CEILING_DIRECTORIES = fs.realpathSync(os.tmpdir())

const git = (cwd, ...args) => spawnSync('git', args, { cwd, encoding: 'utf8' })

function fresh({ remote = 'git@github.com:acme/widgets.git' } = {}) {
  const root = tempDir('pmkit-github-init-')
  git(root, 'init', '-q')
  if (remote) git(root, 'remote', 'add', 'origin', remote)
  return { root, env: { ...childEnv(), ...userStoreEnv().env } }
}

function cli(context, args, fixture = standardFixture()) {
  const fake = fakeGhExec(fixture)
  const result = run(args, { cwd: context.root, env: context.env, adapters: { ...ADAPTERS, github: githubDescriptor({ exec: fake.exec }) } })
  return result.then((out) => ({ ...out, calls: fake.calls }))
}

const read = (context) => fs.readFileSync(path.join(context.root, '.pmkit', 'config.yaml'), 'utf8')
const dataOf = (result) => {
  assert.equal(result.code, 0, result.stderr)
  return JSON.parse(result.stdout)
}
const errorOf = (result) => JSON.parse(result.stdout).error
const operations = (calls) => calls.filter((call) => call.args.includes('graphql')).map((call) => /query (\w+)/.exec(JSON.parse(call.input).query)[1])

const INIT = ['init', '--tracker', 'github', '--git-host', 'github']
const STATUS = ['backlog=Backlog', 'todo=Todo', 'in_progress=In Progress', 'in_review=In Review', 'done=Done', 'canceled=none', 'blocked=none'].flatMap((item) => ['--status', item])
const FIELDS = ['priority=issue:Priority', 'estimate=issue:Effort', 'start_date=issue:Start date', 'target_date=issue:Target date'].flatMap((item) => ['--field', item])
const TYPES = ['feature=Feature', 'bug=Bug', 'task=Task', 'chore=none'].flatMap((item) => ['--type-label', item])
const ALL = [...INIT, '--project', 'acme/7', ...STATUS, ...FIELDS, ...TYPES]

test('the first dry run reads the repository and asks only the Project', async () => {
  const context = fresh()
  const result = await cli(context, [...INIT, '--dry-run', '--json'])
  const data = dataOf(result)
  assert.deepEqual(Object.keys(data), ['dryRun', 'tracker', 'host', 'repo', 'project', 'viewer', 'applied', 'questions', 'broken', 'statuses', 'notes', 'files'])
  assert.equal(data.host, 'github.com')
  assert.equal(data.repo, 'acme/widgets')
  assert.equal(data.project, null)
  assert.deepEqual(data.questions.map((q) => q.path), ['tracker.scope.project'])
  assert.deepEqual(data.questions[0].candidates, ['acme/7'])
  assert.deepEqual(data.questions[0].titles, { 'acme/7': 'Roadmap' })
  assert.ok(data.notes.includes('tracker.scope.host github.com and tracker.scope.repo acme/widgets come from the origin remote'))
  assert.deepEqual(operations(result.calls), ['PmkitRepo', 'PmkitLinkedProjects'])
  assert.equal(fs.existsSync(path.join(context.root, '.pmkit', 'config.yaml')), false)
})

test('when the linked Projects need a scope, the Project question offers none with the step', async () => {
  const context = fresh()
  const data = dataOf(await cli(context, [...INIT, '--dry-run', '--json'], standardFixture({ graphql: { PmkitRepo: repoReply(), PmkitLinkedProjects: SCOPE_ERROR } })))
  const question = data.questions[0]
  assert.deepEqual(question.candidates, [])
  assert.equal(question.recommended, 'none')
  assert.match(question.note, /gh auth refresh -s project/)
})

test('with a Project the dry run asks every Status category, the field roles and the types', async () => {
  const context = fresh()
  const result = await cli(context, [...INIT, '--project', 'acme/7', '--dry-run', '--json'])
  const data = dataOf(result)
  assert.deepEqual(data.project, { id: 'acme/7', title: 'Roadmap' })
  const paths = data.questions.map((q) => q.path)
  for (const key of ['backlog', 'todo', 'in_progress', 'in_review', 'done', 'canceled', 'blocked']) assert.ok(paths.includes(`mappings.status.${key}`), key)
  assert.ok(paths.includes('mappings.fields.estimate'))
  assert.ok(paths.includes('mappings.types.feature'))
  assert.equal(data.questions.find((q) => q.path === 'mappings.status.done').required, true)
  assert.deepEqual(operations(result.calls), ['PmkitRepo', 'PmkitProject'])
})

test('a real run with questions left writes nothing', async () => {
  const context = fresh()
  const result = await cli(context, [...INIT, '--project', 'acme/7', '--json'])
  assert.equal(result.code, 2)
  assert.equal(errorOf(result).code, 'INVALID_INPUT')
  assert.match(errorOf(result).message, /unanswered questions: mappings\.status\.backlog/)
  assert.equal(fs.existsSync(path.join(context.root, '.pmkit', 'config.yaml')), false)
})

test('a full answer writes the scope and the mappings, and a second run keeps the file', async () => {
  const context = fresh()
  const data = dataOf(await cli(context, [...ALL, '--json']))
  assert.equal(data.dryRun, false)
  assert.deepEqual(data.questions, [])
  assert.deepEqual(data.files, [{ path: '.pmkit/config.yaml', action: 'create' }])
  const text = read(context)
  assert.match(text, /tracker:\n {2}system: github\n {2}scope:\n {4}host: github\.com\n {4}repo: acme\/widgets\n {4}project: acme\/7\n/)
  assert.match(text, /git_host:\n {2}system: github\n {2}repo: acme\/widgets\n/)
  assert.match(text, /in_progress: In Progress/)
  assert.match(text, /priority: "?issue:Priority"?/)
  assert.match(text, /target_date: "?issue:Target date"?/)
  assert.match(text, /start_date: "?issue:Start date"?/)
  assert.match(text, /types:\n {4}feature: Feature\n {4}bug: Bug\n {4}task: Task\n/)
  assert.deepEqual(data.statuses, [
    { name: 'Backlog', category: 'backlog' }, { name: 'Todo', category: 'todo' }, { name: 'In Progress', category: 'in_progress' },
    { name: 'In Review', category: 'in_review' }, { name: 'Done', category: 'done' },
    { name: 'Open', category: 'todo' }, { name: 'Closed', category: 'done' }, { name: 'Closed as not planned', category: 'canceled' },
  ])
  const again = dataOf(await cli(context, ['init', '--update', '--dry-run', '--json']))
  assert.deepEqual(again.questions, [])
  assert.deepEqual(again.files, [{ path: '.pmkit/config.yaml', action: 'keep' }])

  const discovered = dataOf(await cli(context, ['discover', '--json']))
  assert.deepEqual(discovered.issueTypes.map((type) => type.name), ['Task', 'Bug', 'Feature'])
  assert.ok(discovered.projectFields.some((field) => field.name === 'Story points'))
  assert.equal(discovered.statuses.find((status) => status.name === 'In Review').category, 'in_review')
  const text2 = await cli(context, ['discover'])
  assert.equal(text2.code, 0, text2.stderr)
  assert.match(text2.stdout, /^repository: acme\/widgets on github\.com, viewer octocat$/m)
  assert.match(text2.stdout, /^project: acme\/7 Roadmap$/m)
  assert.match(text2.stdout, /^issue types: Task, Bug, Feature$/m)
  assert.match(text2.stdout, /^ {2}Effort \(NUMBER\)$/m)
  const caps = await cli(context, ['capabilities', '--json'])
  assert.equal(caps.code, 0, caps.stderr)
  assert.equal(JSON.parse(caps.stdout).tracker, 'github')
  const capsText = await cli(context, ['capabilities'])
  assert.match(capsText.stdout, /^repository: acme\/widgets on github\.com$/m)
  assert.match(capsText.stdout, /^project: acme\/7$/m)
})

test('project none asks status labels and writes them as label:<name>', async () => {
  const context = fresh()
  const fixture = () => standardFixture({ graphql: { PmkitRepo: repoReply({ labels: ['bug', 'Doing', 'Review'] }), PmkitLinkedProjects: linkedReply() } })
  const asked = dataOf(await cli(context, [...INIT, '--project', 'none', ...FIELDS, ...TYPES, '--dry-run', '--json'], fixture()))
  assert.deepEqual(asked.questions.map((q) => q.path), ['mappings.status.triage', 'mappings.status.backlog', 'mappings.status.in_progress', 'mappings.status.in_review'])
  const labels = ['triage=none', 'backlog=none', 'in_progress=Doing', 'in_review=label:Review'].flatMap((item) => ['--status', item])
  const data = dataOf(await cli(context, [...INIT, '--project', 'none', ...labels, ...FIELDS, ...TYPES, '--json'], fixture()))
  assert.equal(data.project, null)
  assert.match(read(context), /project: none/)
  assert.match(read(context), /in_progress: "?label:Doing"?/)
  assert.match(read(context), /in_review: "?label:Review"?/)
  assert.deepEqual(data.statuses, [{ name: 'Doing', category: 'in_progress' }, { name: 'Review', category: 'in_review' }, { name: 'Open', category: 'todo' }, { name: 'Closed', category: 'done' }, { name: 'Closed as not planned', category: 'canceled' }])
})

test('project none without issue types writes type labels', async () => {
  const context = fresh()
  const fixture = standardFixture({ graphql: { PmkitRepo: repoReply({ labels: ['bug', 'enhancement', 'Doing'], types: [] }), PmkitLinkedProjects: linkedReply() } })
  const labels = ['triage=none', 'backlog=none', 'in_progress=Doing', 'in_review=none'].flatMap((item) => ['--status', item])
  const types = ['feature=enhancement', 'bug=bug', 'task=none', 'chore=none'].flatMap((item) => ['--type-label', item])
  const data = dataOf(await cli(context, [...INIT, '--project', 'none', ...labels, ...FIELDS, ...types, '--json'], fixture))
  assert.deepEqual(data.questions, [])
  assert.match(read(context), /feature: "?label:enhancement"?/)
  assert.match(read(context), /bug: "?label:bug"?/)
})

test('project none with the fields none takes priority and estimate labels, and an update keeps them (PMK-339)', async () => {
  const context = fresh()
  const fixture = () => standardFixture({ graphql: { PmkitRepo: repoReply({ labels: ['Doing', 'P0', 'P1', 'size: 3'], types: [] }), PmkitLinkedProjects: linkedReply() } })
  const status = ['triage=none', 'backlog=none', 'in_progress=Doing', 'in_review=none'].flatMap((item) => ['--status', item])
  const fields = ['priority=none', 'estimate=none', 'start_date=none', 'target_date=none'].flatMap((item) => ['--field', item])
  const types = ['feature=none', 'bug=none', 'task=none', 'chore=none'].flatMap((item) => ['--type-label', item])
  const base = [...INIT, '--project', 'none', ...status, ...fields, ...types]
  const asked = dataOf(await cli(context, [...base, '--dry-run', '--json'], fixture()))
  assert.deepEqual(asked.questions.map((q) => q.path), ['mappings.priority.urgent', 'mappings.priority.high', 'mappings.priority.medium', 'mappings.priority.low'])
  const priority = ['urgent=P0', 'high=P1', 'medium=none', 'low=none'].flatMap((item) => ['--priority-label', item])
  const data = dataOf(await cli(context, [...base, ...priority, '--estimate-label', '3=size: 3', '--json'], fixture()))
  assert.deepEqual(data.questions, [])
  const text = read(context)
  assert.match(text, /priority:\n\s+urgent: "?label:P0"?\n\s+high: "?label:P1"?/)
  assert.match(text, /estimate:\n\s+"?3"?: "?label:size: 3"?/)
  const again = dataOf(await cli(context, ['init', '--update', '--dry-run', '--json'], fixture()))
  assert.deepEqual(again.questions, [])
  assert.equal(again.files[0].changed ?? false, false)
  const withProject = await cli(fresh(), [...ALL, '--priority-label', 'high=P1', '--json'])
  assert.equal(errorOf(withProject).code, 'INVALID_INPUT')
})

test('an update asks again for a held Project GitHub no longer returns', async () => {
  const context = fresh()
  dataOf(await cli(context, [...ALL, '--json']))
  const gone = standardFixture({ graphql: { PmkitRepo: repoReply(), PmkitProject: { data: { repositoryOwner: { projectV2: null } } }, PmkitLinkedProjects: linkedReply([{ number: 8, title: 'New', owner: 'acme' }]) } })
  const data = dataOf(await cli(context, ['init', '--update', '--dry-run', '--json'], gone))
  assert.deepEqual(data.questions.map((q) => q.path), ['tracker.scope.project'])
  assert.equal(data.questions[0].broken.was, 'acme/7')
  assert.deepEqual(data.broken.map((item) => item.path), ['tracker.scope.project'])
})

test('an update asks again for a Status option the Project lost', async () => {
  const context = fresh()
  dataOf(await cli(context, [...ALL, '--json']))
  const renamed = standardFixture({ graphql: { PmkitRepo: repoReply(), PmkitProject: projectReply({ status: ['Backlog', 'Todo', 'Doing', 'In Review', 'Done'] }) } })
  const data = dataOf(await cli(context, ['init', '--update', '--dry-run', '--json'], renamed))
  assert.deepEqual(data.questions.map((q) => q.path), ['mappings.status.in_progress'])
  assert.equal(data.questions[0].recommended, 'Doing')
  const fixed = dataOf(await cli(context, ['init', '--update', '--status', 'in_progress=Doing', '--json'], renamed))
  assert.equal(fixed.files[0].action, 'change')
  assert.match(read(context), /in_progress: Doing/)
})

test('host and repo come from the flags, and a GHES remote host is used as is', async () => {
  const context = fresh({ remote: 'https://ghes.example.com/acme/widgets.git' })
  const fixture = standardFixture({ meta: { installed_version: '3.21.0' } })
  const data = dataOf(await cli(context, [...INIT, '--dry-run', '--json'], fixture))
  assert.equal(data.host, 'ghes.example.com')
  const flagged = dataOf(await cli(fresh({ remote: null }), [...INIT, '--host', 'acme.ghe.com', '--repo', 'acme/widgets', '--dry-run', '--json']))
  assert.equal(flagged.host, 'acme.ghe.com')
  assert.ok(flagged.notes.includes('tracker.scope.host acme.ghe.com and tracker.scope.repo acme/widgets come from the flags'))
})

test('a repo from a flag and a host from the remote get a note that names both sources', async () => {
  const data = dataOf(await cli(fresh(), [...INIT, '--repo', 'acme/other', '--dry-run', '--json']))
  assert.equal(data.repo, 'acme/other')
  assert.ok(data.notes.includes('tracker.scope.host github.com comes from the origin remote, and tracker.scope.repo acme/other from the flags'))
})

test('ssh.github.com and www.github.com remotes give the host github.com', async () => {
  for (const remote of ['ssh://git@ssh.github.com:443/acme/widgets.git', 'https://www.github.com/acme/widgets']) {
    const data = dataOf(await cli(fresh({ remote }), [...INIT, '--dry-run', '--json']))
    assert.equal(data.host, 'github.com', remote)
    assert.equal(data.repo, 'acme/widgets', remote)
  }
})

test('GHES below 3.19 fails with NOT_SUPPORTED', async () => {
  const context = fresh({ remote: 'https://ghes.example.com/acme/widgets.git' })
  const result = await cli(context, [...INIT, '--dry-run', '--json'], standardFixture({ meta: { installed_version: '3.18.2' } }))
  assert.equal(result.code, 2)
  assert.equal(errorOf(result).code, 'NOT_SUPPORTED')
  assert.match(errorOf(result).message, /3\.18\.2.*3\.19/)
})

test('init refuses a missing repository, bad flags and Linear flags', async () => {
  const none = await cli(fresh({ remote: null }), [...INIT, '--dry-run', '--json'])
  assert.equal(errorOf(none).code, 'INVALID_INPUT')
  assert.match(errorOf(none).nextStep, /--host <host> --repo <owner\/name>/)
  const badRepo = await cli(fresh(), [...INIT, '--repo', 'widgets', '--dry-run', '--json'])
  assert.match(errorOf(badRepo).message, /--repo widgets is not owner\/name/)
  const badHost = await cli(fresh(), [...INIT, '--host', '--jq', '--dry-run', '--json'])
  assert.equal(errorOf(badHost).code, 'INVALID_INPUT')
  const team = await cli(fresh(), [...INIT, '--team', 'ENG', '--dry-run', '--json'])
  assert.match(errorOf(team).message, /--team applies only with --tracker linear/)
  const status = await cli(fresh(), [...INIT, '--project', 'acme/7', '--status', 'todo=Ready', '--dry-run', '--json'])
  assert.match(errorOf(status).message, /todo=Ready/)
  const local = await cli(fresh(), ['init', '--host', 'github.com', '--dry-run', '--json'])
  assert.match(errorOf(local).message, /--host applies only with --tracker github/)
})

test('a cut read on GitHub names GitHub', () => {
  assert.equal(capWarning('history', '12', 'github'), 'GitHub has more history for 12 than the 1000 entries pmkit read; the newest are missing')
  assert.equal(capWarning('comments', '12', 'github'), 'GitHub has more comments for 12 than the 1000 pmkit read')
  assert.equal(capWarning('issues', undefined, 'github'), 'GitHub has more issues than the 1000 pmkit read; the result covers the 1000 most recently updated')
  assert.equal(capWarning('issues', undefined, 'linear'), 'Linear has more issues than the 1000 pmkit read; the result covers the 1000 most recently updated')
})

test('a --status answer may name a label past the first 100 labels', async () => {
  const context = fresh()
  const labels = Array.from({ length: 120 }, (_, index) => `Label ${index + 1}`)
  const fixture = standardFixture({ graphql: { PmkitRepo: repoReply({ labels }), PmkitLinkedProjects: linkedReply() } })
  const answers = ['triage=none', 'backlog=none', 'in_progress=Label 115', 'in_review=none'].flatMap((item) => ['--status', item])
  dataOf(await cli(context, [...INIT, '--project', 'none', ...answers, ...FIELDS, ...TYPES, '--json'], fixture))
  assert.match(read(context), /in_progress: "?label:Label 115"?/)
})

// PMK-81: --git-host bitbucket takes workspace/slug from a bitbucket.org origin and reads the Bitbucket repository once before it writes.
const BB_ANSWERS = ['init', '--tracker', 'github', '--git-host', 'bitbucket', '--host', 'github.com', '--repo', 'acme/widgets', '--project', 'acme/7', ...STATUS, ...FIELDS, ...TYPES]
async function cliBitbucket(context, args, env) {
  const fetch = fakeBitbucketFetch({ [`GET ${BB}`]: { json: { full_name: 'acme/widgets' } } })
  const fake = fakeGhExec(standardFixture())
  const runEnv = { ...context.env, ...env }
  if (env.BITBUCKET_TOKEN === undefined) delete runEnv.BITBUCKET_TOKEN
  const result = await run(args, { cwd: context.root, env: runEnv, fetch, adapters: { ...ADAPTERS, github: githubDescriptor({ exec: fake.exec }) } })
  return { ...result, fetch }
}

test('--git-host bitbucket writes the repo of a bitbucket.org origin as workspace/slug after one repository read', async () => {
  const context = fresh({ remote: 'git@bitbucket.org:acme/widgets.git' })
  const result = await cliBitbucket(context, [...BB_ANSWERS, '--json'], FAKE_BB_ENV)
  assert.deepEqual(dataOf(result).files, [{ path: '.pmkit/config.yaml', action: 'create' }])
  assert.match(read(context), /git_host:\n {2}system: bitbucket\n {2}repo: acme\/widgets\n/)
  assert.deepEqual(result.fetch.calls.map((call) => call.url), ['https://api.bitbucket.org/2.0/repositories/acme/widgets'])
})

test('--git-host bitbucket without BITBUCKET_TOKEN is AUTH and writes nothing', async () => {
  const context = fresh({ remote: 'git@bitbucket.org:acme/widgets.git' })
  const result = await cliBitbucket(context, [...BB_ANSWERS, '--json'], {})
  assert.equal(errorOf(result).code, 'AUTH')
  assert.equal(result.fetch.calls.length, 0)
  assert.equal(fs.existsSync(path.join(context.root, '.pmkit', 'config.yaml')), false)
})
