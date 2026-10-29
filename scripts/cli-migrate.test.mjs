// local-migrate over the CLI with a fake fetch. No test here touches the network or the real user store.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { run } from './pmkit.mjs'
import { ADAPTERS } from './lib/adapters.mjs'
import { linearDescriptor } from './lib/linear/adapter.mjs'
import { fakeLinear, useLinear } from './fake-hosted.mjs'
import { FAKE_KEY, fakeLinearFetch, fakeWorkspace } from './fake-linear-api.mjs'
import { childEnv } from './golden-helpers.mjs'
import { buildMigrationFixture, commitAll } from './migrate-fixture.mjs'
import { makeRepo, userStoreEnv } from './test-helpers.mjs'

// gitUserEmail reads the process environment, so the in-process runs need the same git isolation as childEnv.
process.env.GIT_CONFIG_GLOBAL = os.devNull
process.env.GIT_CONFIG_NOSYSTEM = '1'
process.env.GIT_CEILING_DIRECTORIES = fs.realpathSync(os.tmpdir())

const outputs = []

function setup({ fixture = true } = {}) {
  const root = makeRepo('basic')
  if (fixture) buildMigrationFixture(root)
  const env = { ...childEnv(), ...userStoreEnv().env, LINEAR_API_KEY: FAKE_KEY }
  return { root, env }
}

async function cli(context, args, { fetch = fakeLinearFetch(fakeWorkspace()), adapters = {} } = {}) {
  const result = await run(args, { cwd: context.root, env: context.env, adapters: { ...ADAPTERS, linear: linearDescriptor({ fetch }), ...adapters } })
  outputs.push(result.stdout, result.stderr)
  return result
}

const errorOf = (result) => JSON.parse(result.stdout).error
const edit = (root, file, from, to) => {
  const full = path.join(root, file)
  const text = fs.readFileSync(full, 'utf8')
  assert.match(text, from)
  fs.writeFileSync(full, text.replace(from, to))
}
const EXPORT = ['local-migrate', 'export', '--workspace', 'acme', '--team', 'ACME', '--json']

test('export refuses another tracker', async () => {
  const context = setup({ fixture: false })
  edit(context.root, '.pmkit/config.yaml', /^ {2}system: local$/m, '  system: jira')
  const result = await cli(context, EXPORT, { adapters: { jira: fakeLinear({ system: 'jira' }) } })
  assert.equal(result.code, 2)
  assert.deepEqual(errorOf(result), {
    code: 'NOT_SUPPORTED',
    message: '`local-migrate export` works only with the Local or Linear tracker, and tracker.system is "jira"',
    nextStep: 'node scripts/pmkit.mjs --help',
  })
})

test('export refuses outside git', async () => {
  const result = await cli(setup({ fixture: false }), EXPORT)
  assert.equal(result.code, 2)
  const error = errorOf(result)
  assert.equal(error.code, 'NOT_CONFIGURED')
  assert.equal(error.message, 'this folder is not a git repository, or git is not installed')
})

test('export refuses uncommitted tracker changes', async () => {
  const context = setup()
  fs.appendFileSync(path.join(context.root, '.issues', 'config.yaml'), '# edited\n')
  const result = await cli(context, EXPORT)
  assert.equal(result.code, 2)
  const error = errorOf(result)
  assert.equal(error.code, 'CONFLICT')
  assert.equal(error.message, 'there are uncommitted changes under .issues')
})

test('export refuses an older format', async () => {
  const context = setup()
  edit(context.root, '.issues/config.yaml', /^version: 2$/m, 'version: 1')
  commitAll(context.root, 'old format')
  const result = await cli(context, EXPORT)
  assert.equal(result.code, 2)
  assert.deepEqual(errorOf(result), {
    code: 'NOT_SUPPORTED',
    message: 'this repository uses tracker format 1, this pmkit writes format 2',
    nextStep: '/pmkit:upgrade',
  })
})

test('export from a Linear repository reads the Local side at --path', async () => {
  const context = setup()
  useLinear(context.root)
  commitAll(context.root, 'linear')
  const result = await cli(context, ['local-migrate', 'export', '--path', 'tracker', '--json'])
  assert.equal(result.code, 2)
  const error = errorOf(result)
  assert.equal(error.code, 'NOT_CONFIGURED')
  assert.equal(error.message, `no config.yaml in ${path.join(fs.realpathSync(context.root), 'tracker')}`)
})

test('export without a Linear side asks for the workspace and the team', async () => {
  const result = await cli(setup(), ['local-migrate', 'export', '--json'])
  assert.equal(result.code, 2)
  const error = errorOf(result)
  assert.equal(error.code, 'NOT_CONFIGURED')
  assert.equal(error.message, 'local-migrate export needs the Linear workspace and team')
  assert.equal(error.nextStep, 'Pass --workspace <key> --team <KEY>, or run it from a repository whose tracker.scope names them')
})

test('no output holds the key', () => {
  assert.ok(outputs.length > 0)
  for (const text of outputs) assert.doesNotMatch(text, new RegExp(FAKE_KEY))
})
