// issues bulk over the Linear adapter with the fake API: the same flow, and the changes Linear does not write.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { run } from './pmkit.mjs'
import { ADAPTERS } from './lib/adapters.mjs'
import { linearDescriptor } from './lib/linear/adapter.mjs'
import { useLinear } from './fake-hosted.mjs'
import { FAKE_KEY, fakeLinearFetch, fakeLinearIssues, fakeWorkspace } from './fake-linear-api.mjs'
import { childEnv } from './golden-helpers.mjs'
import { makeRepo, userStoreEnv } from './test-helpers.mjs'

process.env.GIT_CONFIG_GLOBAL = os.devNull
process.env.GIT_CONFIG_NOSYSTEM = '1'
process.env.GIT_CEILING_DIRECTORIES = fs.realpathSync(os.tmpdir())

function setup() {
  const root = useLinear(makeRepo('basic'))
  const file = path.join(root, '.pmkit', 'config.yaml')
  fs.writeFileSync(file, fs.readFileSync(file, 'utf8').replace('    workspace: acme', '    workspace: acme\n    team: ACME'))
  return { root, env: { ...childEnv(), ...userStoreEnv().env, LINEAR_API_KEY: FAKE_KEY } }
}

function withIssues(titles) {
  const fake = fakeLinearIssues()
  for (const title of titles) fake.seed({ title })
  return { fake, fetch: fakeLinearFetch({ ...fakeWorkspace(), ...fake.routes }) }
}

async function bulk(context, fetch, args) {
  const result = await run(['issues', 'bulk', ...args, '--json'], { cwd: context.root, env: context.env, adapters: { ...ADAPTERS, linear: linearDescriptor({ fetch }) } })
  return { code: result.code, body: JSON.parse(result.stdout) }
}

test('assign previews every issue, then writes them with the digest', async () => {
  const { fake, fetch } = withIssues(['One', 'Two'])
  const context = setup()
  const dry = await bulk(context, fetch, ['assign', 'me', '--category', 'backlog', '--dry-run'])
  assert.equal(dry.code, 0, JSON.stringify(dry.body))
  assert.deepEqual(dry.body.items.map((item) => [item.id, item.state]), [['ACME-1', 'change'], ['ACME-2', 'change']])
  assert.deepEqual(fake.mutations, [])
  const real = await bulk(context, fetch, ['assign', 'me', '--category', 'backlog', '--expect', dry.body.digest])
  assert.equal(real.code, 0, JSON.stringify(real.body))
  assert.deepEqual(real.body.applied, ['ACME-1', 'ACME-2'])
  assert.deepEqual(fake.mutations, ['PmkitIssueUpdate', 'PmkitIssueUpdate'])
})

test('milestone and release are not written on Linear, so the command stops before any write', async () => {
  const { fake, fetch } = withIssues(['One'])
  for (const change of ['milestone', 'release']) {
    const result = await bulk(setup(), fetch, [change, 'x', '--category', 'backlog', '--dry-run'])
    assert.equal(result.code, 2)
    assert.equal(result.body.error.code, 'NOT_SUPPORTED')
  }
  assert.deepEqual(fake.mutations, [])
})

test('a set Linear cut at 1000 issues is refused, never written from', async () => {
  const { fake, fetch } = withIssues([])
  for (let index = 0; index < 1001; index += 1) fake.seed({ title: `Issue ${index}` })
  const result = await bulk(setup(), fetch, ['assign', 'me', '--category', 'backlog', '--dry-run'])
  assert.equal(result.code, 2)
  assert.equal(result.body.error.code, 'INVALID_INPUT')
  assert.match(result.body.error.message, /more matching issues/)
  assert.deepEqual(fake.mutations, [])
})
