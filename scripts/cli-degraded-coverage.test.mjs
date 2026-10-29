// PMK-40: the commands whose capability a Linear workspace lacks refuse offline with NOT_SUPPORTED, and every command that a capability names is accounted for. The per-command note tests are in cli-degraded.test.mjs.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { run } from './pmkit.mjs'
import { ADAPTERS } from './lib/adapters.mjs'
import { SERVED_BY } from './lib/capabilities.mjs'
import { linearDescriptor } from './lib/linear/adapter.mjs'
import { isMutation } from './lib/linear/client.mjs'
import { useLinear } from './fake-hosted.mjs'
import { FAKE_KEY, fakeLinearFetch, fakeLinearIssues, fakeWorkspace } from './fake-linear-api.mjs'
import { childEnv } from './golden-helpers.mjs'
import { makeRepo, tempDir, userStoreEnv } from './test-helpers.mjs'

process.env.GIT_CONFIG_GLOBAL = os.devNull
process.env.GIT_CONFIG_NOSYSTEM = '1'
process.env.GIT_CEILING_DIRECTORIES = fs.realpathSync(os.tmpdir())

function freeWorkspace() {
  const root = useLinear(makeRepo('basic'))
  const file = path.join(root, '.pmkit', 'config.yaml')
  fs.writeFileSync(file, fs.readFileSync(file, 'utf8').replace('    workspace: acme', '    workspace: acme\n    team: ACME'))
  const env = { ...childEnv(), ...userStoreEnv().env, LINEAR_API_KEY: FAKE_KEY }
  const fake = fakeLinearIssues()
  const fetch = fakeLinearFetch({ ...fakeWorkspace(), ...fake.routes })
  return { fetch, run: (args) => run(args, { cwd: root, env, adapters: { ...ADAPTERS, linear: linearDescriptor({ fetch }) } }) }
}

const BODY = path.join(tempDir('pmkit-degraded-'), 'body.md')
fs.writeFileSync(BODY, 'text\n')

// A write the Free plan cannot do refuses with NOT_SUPPORTED and sends no mutation.
const REFUSALS = [
  ['cycle', 'open', '--start', '2026-11-02'],
  ['cycle', 'close', '1'],
  ['milestone', 'create', 'm1'],
  ['docs', 'create', 'a.md', '--body-file', BODY],
  ['release', 'create', '1.0'],
  ['release', 'mark-released', '1.0'],
  ['issues', 'log-time', 'ACME-1', '5'],
]

for (const args of REFUSALS) {
  test(`${args.slice(0, 2).join(' ')} refuses on a Free Linear workspace and sends no mutation`, async () => {
    const world = freeWorkspace()
    const result = await world.run([...args, '--json'])
    assert.equal(result.code, 2, result.stdout + result.stderr)
    assert.equal(JSON.parse(result.stdout).error.code, 'NOT_SUPPORTED', result.stdout)
    assert.ok(!world.fetch.calls.some((call) => isMutation(call.body.query)))
  })
}

// Each command a capability names is covered by a path test elsewhere, or exempt with a reason. A new command in SERVED_BY fails here until it is listed.
const COVERED = {
  'cycle list': 'cli-linear.test.mjs or cli-degraded.test.mjs', 'cycle current': 'cli-linear.test.mjs or cli-degraded.test.mjs', 'cycle issues': 'cli-linear.test.mjs or cli-degraded.test.mjs', 'cycle open': 'REFUSALS', 'cycle close': 'REFUSALS',
  'cycle add': 'native write, PMK-39', 'cycle capacity': 'cli-linear.test.mjs or cli-degraded.test.mjs', 'release-notes': 'cli-linear.test.mjs or cli-degraded.test.mjs',
  'issues create': 'native write, PMK-39', 'issues update': 'native write, PMK-39', 'issues parent': 'native write, PMK-39', 'issues link': 'native write, PMK-39',
  'issues dependencies': 'cli-linear.test.mjs or cli-degraded.test.mjs', 'issues move': 'native write, PMK-39', 'issues branch': 'cli-linear.test.mjs or cli-degraded.test.mjs', 'issues log-time': 'REFUSALS',
  'epic list': 'cli-linear.test.mjs or cli-degraded.test.mjs', 'epic get': 'cli-linear.test.mjs or cli-degraded.test.mjs', 'epic create': 'native write, PMK-39', 'epic progress': 'cli-linear.test.mjs or cli-degraded.test.mjs',
  'epic update-status': 'native write, PMK-39', 'epic updates': 'cli-linear.test.mjs or cli-degraded.test.mjs',
  'release list': 'cli-linear.test.mjs or cli-degraded.test.mjs', 'release get': 'cli-linear.test.mjs or cli-degraded.test.mjs', 'release issues': 'cli-linear.test.mjs or cli-degraded.test.mjs', 'release create': 'REFUSALS', 'release mark-released': 'REFUSALS',
  'metrics velocity': 'cli-linear.test.mjs or cli-degraded.test.mjs', 'metrics cycle-time': 'cli-linear.test.mjs or cli-degraded.test.mjs', 'metrics lead-time': 'cli-linear.test.mjs or cli-degraded.test.mjs', 'metrics throughput': 'cli-linear.test.mjs or cli-degraded.test.mjs', 'metrics aging': 'cli-linear.test.mjs or cli-degraded.test.mjs', events: 'cli-linear.test.mjs or cli-degraded.test.mjs',
  'docs read': 'cli-linear.test.mjs or cli-degraded.test.mjs', 'docs create': 'REFUSALS',
  'pr open': 'native write, PMK-39', 'pr ready': 'native write, PMK-39', 'pr status': 'cli-linear.test.mjs or cli-degraded.test.mjs', 'pr sync': 'native write, PMK-39',
}

test('every command a capability names has a degraded-path case or an exemption', () => {
  const named = [...new Set(Object.values(SERVED_BY).flat())]
  assert.deepEqual(named.filter((command) => !(command in COVERED)), [])
  const refusals = new Set(REFUSALS.map((args) => args.slice(0, 2).join(' ')))
  for (const [command, where] of Object.entries(COVERED)) {
    if (where === 'REFUSALS') assert.ok(refusals.has(command), `${command} is listed as a refusal case but REFUSALS lacks it`)
  }
})
