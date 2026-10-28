// The tracker contract suite against the Linear adapter over the stateful fake. Only the families PMK-35 implements run.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import { runTrackerContract } from '../../contract-suite.mjs'
import { ACME_STATES, ACME_TEAM, FAKE_KEY, fakeLinearFetch, fakeLinearIssues, fakeWorkspace } from '../../fake-linear-api.mjs'
import { tempDir, userStoreEnv } from '../../test-helpers.mjs'
import { createLinearTracker } from './tracker.mjs'

// Triage on, a Triage state, in_review mapped and two types, so every category and at least one type exist.
function linearContract() {
  const teams = [{ ...ACME_TEAM, triageEnabled: true }]
  const states = [{ id: 'state-triage', name: 'Triage', type: 'triage', position: -1, team: { id: ACME_TEAM.id } }, ...ACME_STATES]
  const fake = fakeLinearIssues({ teams, states })
  const fetch = fakeLinearFetch({ ...fakeWorkspace({ teams, states }), ...fake.routes })
  const root = tempDir()
  const { env } = userStoreEnv()
  const config = {
    root,
    pmkit: {
      tracker: { system: 'linear', scope: { workspace: 'acme', team: 'ACME' } },
      git_host: { system: 'github' },
      mappings: { status: { in_review: 'In Review' }, types: { bug: 'Bug', feature: 'Feature' } },
    },
  }
  const tracker = createLinearTracker(config, { env: { ...env, LINEAR_API_KEY: FAKE_KEY }, fetch })
  return { tracker, env, fake, actor: 'user-1', teardown: () => fs.rmSync(root, { recursive: true, force: true }) }
}

runTrackerContract({ name: 'Linear tracker contract over the fake', families: ['discovery', 'issues', 'relations'], setup: linearContract })

test('no file under PMKIT_HOME holds the key after a create', async () => {
  const { tracker, env, actor, teardown } = linearContract()
  try {
    await tracker.createIssue({ title: 'Keyless' }, actor)
    const files = fs.readdirSync(env.PMKIT_HOME, { recursive: true, withFileTypes: true }).filter((entry) => entry.isFile())
    assert.ok(files.length > 0)
    for (const entry of files) assert.ok(!fs.readFileSync(path.join(entry.parentPath, entry.name), 'utf8').includes(FAKE_KEY), entry.name)
  } finally {
    teardown()
  }
})
