// The CLI over a hosted tracker, run in process with a test registry. No test here touches the network.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { run } from './pmkit.mjs'
import { PmkitError } from './lib/errors.mjs'
import { childEnv } from './golden-helpers.mjs'
import { mirrorLinear, useLinear, withLinear } from './fake-hosted.mjs'
import { hashTree, makeRepo } from './test-helpers.mjs'

// gitUserEmail reads the process environment, so the in-process runs need the same git isolation as childEnv.
process.env.GIT_CONFIG_GLOBAL = os.devNull
process.env.GIT_CONFIG_NOSYSTEM = '1'
process.env.GIT_CEILING_DIRECTORIES = fs.realpathSync(os.tmpdir())

const call = (root, args, { adapters, env = childEnv() } = {}) => run(args, { cwd: root, env, ...(adapters ? { adapters } : {}) })
const errorOf = (result) => JSON.parse(result.stdout).error
const mirrorRepo = (name, extra) => useLinear(makeRepo(name), extra)
const editFile = (file, from, to) => {
  const text = fs.readFileSync(file, 'utf8')
  assert.ok(from.test(text), `${file} matches ${from}`)
  fs.writeFileSync(file, text.replace(from, to))
}

test('run returns a promise of the code and both streams', async () => {
  const pending = run(['--help'])
  assert.ok(pending instanceof Promise)
  const result = await pending
  assert.equal(result.code, 2)
  assert.ok(result.stdout.startsWith('Usage: pmkit.mjs'))
})

test('render, migrate and reindex refuse a hosted tracker', async () => {
  const root = mirrorRepo('team')
  const adapters = withLinear(mirrorLinear())
  editFile(path.join(root, '.issues', 'config.yaml'), /^version: \d+$/m, 'version: 1')
  for (const [name, args] of [['render', ['render', 'board']], ['migrate', ['migrate']], ['reindex', ['reindex']]]) {
    const before = hashTree(root)
    const result = await call(root, [...args, '--json'], { adapters })
    assert.equal(result.code, 2, name)
    assert.deepEqual(errorOf(result), {
      code: 'NOT_SUPPORTED',
      message: `${name} works only with the Local tracker, and tracker.system is "linear"`,
      nextStep: 'node scripts/pmkit.mjs --help',
    }, name)
    assert.equal(hashTree(root), before, `${name} changes no file`)
  }
})

test('a hosted config with a bad mapping warns on a read and refuses a write', async () => {
  const root = mirrorRepo('team', 'mappings:\n  status:\n    reviewing: Review\n')
  const adapters = withLinear(mirrorLinear())
  const list = await call(root, ['issues', 'list'], { adapters })
  assert.equal(list.code, 0, list.stderr)
  assert.ok(list.stderr.startsWith('warning: .pmkit/config.yaml is not valid, so writes are refused: mappings.status.reviewing: reviewing is not a category or blocked; run pmkit validate'), list.stderr)
  const create = await call(root, ['issues', 'create', '--title', 'x', '--json'], { adapters })
  assert.equal(create.code, 2)
  assert.equal(errorOf(create).code, 'INVALID_INPUT')
})

test('jira exits 2 with NOT_SUPPORTED with linear registered', async () => {
  const root = makeRepo('team')
  editFile(path.join(root, '.pmkit', 'config.yaml'), /^ {2}system: local$/m, '  system: jira')
  const result = await call(root, ['issues', 'list', '--json'], { adapters: withLinear(mirrorLinear()) })
  assert.equal(result.code, 2)
  assert.deepEqual(JSON.parse(result.stdout), {
    error: { code: 'NOT_SUPPORTED', message: 'tracker.system "jira" is not supported yet', nextStep: 'Set tracker.system to local in .pmkit/config.yaml' },
  })
})

test('validate with a hosted config checks only .pmkit/config.yaml', async () => {
  const result = await call(mirrorRepo('team'), ['validate', '--json'], { adapters: withLinear(mirrorLinear()) })
  assert.equal(result.code, 0, result.stderr)
  assert.deepEqual(JSON.parse(result.stdout), {
    checked: { issues: 0, epics: 0, sprints: 0, milestones: 0, releases: 0, comments: 0 },
    problems: [],
  })
})

test('a hosted actor that cannot be resolved names PMKIT_USER and pmkit discover', async () => {
  const { PMKIT_USER, ...env } = childEnv()
  const hosted = await call(mirrorRepo('team'), ['issues', 'create', '--title', 'x', '--json'], { adapters: withLinear(mirrorLinear()), env })
  assert.equal(hosted.code, 2)
  assert.deepEqual(errorOf(hosted), { code: 'NOT_CONFIGURED', message: 'cannot tell which member you are', nextStep: 'Set PMKIT_USER to a member id from pmkit discover' })
  const plain = await call(makeRepo('team'), ['issues', 'create', '--title', 'x', '--json'], { env })
  assert.equal(plain.code, 2)
  assert.deepEqual(errorOf(plain), { code: 'NOT_CONFIGURED', message: 'cannot tell which member you are', nextStep: 'Add yourself to members in .issues/config.yaml or set PMKIT_USER' })
})

test('whoami prints a member without availability as before', async () => {
  const root = makeRepo('basic')
  editFile(path.join(root, '.issues', 'config.yaml'), /^ {2}fred: .*$/m, '  fred: { name: Fred Vanelli, email: fred@example.com }')
  const result = await call(root, ['whoami', '--json'])
  assert.equal(result.code, 0, result.stderr)
  assert.equal(result.stdout, `${JSON.stringify({ id: 'fred', member: { name: 'Fred Vanelli', email: 'fred@example.com' } }, null, 2)}\n`)
})

test('milestone create warns about unfiled milestones on the Local tracker only', async () => {
  const withUnfiled = (root) => {
    editFile(path.join(root, '.issues', 'issues', 'ISS-1V9Z', 'issue.md'), /^status: triage$/m, 'status: triage\nmilestone: v9')
    return root
  }
  const args = ['milestone', 'create', 'v2.0', '--name', 'Golden milestone']
  const plain = await call(withUnfiled(makeRepo('no-sprints')), args)
  assert.equal(plain.code, 0, plain.stderr)
  assert.match(plain.stderr, /1 milestone named by issues or epics has no file: v9 \(1\); run \/pmkit:local:doctor/)
  const mirror = await call(withUnfiled(mirrorRepo('no-sprints')), args, { adapters: withLinear(mirrorLinear()) })
  assert.equal(mirror.code, 0, mirror.stderr)
  assert.equal(mirror.stderr, '')
})

test('risks lists an epic whose updates reject, as it does for a throw', async () => {
  const override = { listStatusUpdates: async () => { throw new PmkitError('UPSTREAM', 'updates failed', 'Retry') } }
  const result = await call(mirrorRepo('team'), ['risks', '--json'], { adapters: withLinear(mirrorLinear({ override })) })
  assert.equal(result.code, 0, result.stdout + result.stderr)
  assert.ok(JSON.parse(result.stdout).problems.some((problem) => JSON.stringify(problem) === JSON.stringify({ id: 'EPC-2M9D', code: 'UPSTREAM', message: 'updates failed' })), result.stdout)
})
