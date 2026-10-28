// The tracker contract suite against the Linear adapter over the stateful fake. Only the families the adapter implements run.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import { runTrackerContract } from '../../contract-suite.mjs'
import { ACME_STATES, ACME_TEAM, FAKE_KEY, fakeLinearFetch, fakeLinearIssues, fakeWorkspace } from '../../fake-linear-api.mjs'
import { tempDir, userStoreEnv } from '../../test-helpers.mjs'
import { createLinearTracker } from './tracker.mjs'

// The fake's clock is 2026-10-27T12:00Z. Cycle 1 is active on that day and cycle 2 is next.
const TODAY = '2026-10-27'
const ACTIVE = { number: 1, startsAt: '2026-10-19T00:00:00.000Z', endsAt: '2026-11-02T00:00:00.000Z' }
const PLANNED = { number: 2, startsAt: '2026-11-02T00:00:00.000Z', endsAt: '2026-11-16T00:00:00.000Z' }

// Triage on, cycles on, a Triage state, in_review mapped and two types, so every category and at least one type exist.
function linearContract({ cycles = [ACTIVE, PLANNED] } = {}) {
  const teams = [{ ...ACME_TEAM, triageEnabled: true, cyclesEnabled: true }]
  const states = [{ id: 'state-triage', name: 'Triage', type: 'triage', position: -1, team: { id: ACME_TEAM.id } }, ...ACME_STATES]
  const fake = fakeLinearIssues({ teams, states, cycles })
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
  // PMK-39 supplies a provider that reads its test team through listCycles. A team with no active or no planned cycle makes the
  // tests that need one skip with a reason, so a green run with skips never reads as full coverage.
  const pick = (state) => async () => {
    const [found] = (await tracker.listCycles({ state })).slice(0, 1)
    return found ? { id: found.id, start: found.start, end: found.end } : null
  }
  return {
    tracker, env, fake, root, today: TODAY, actor: 'user-1', cycles: { active: pick('active'), planned: pick('planned') },
    teardown: () => fs.rmSync(root, { recursive: true, force: true }),
  }
}

// The cycle-lifecycle family stays out: Linear has no call that opens or closes a cycle.
runTrackerContract({ name: 'Linear tracker contract over the fake', families: ['discovery', 'issues', 'relations', 'history', 'cycles'], setup: linearContract })

test('openCycle and closeCycle answer NOT_SUPPORTED and name the schedule of Linear', async () => {
  const { tracker, actor, teardown } = linearContract()
  try {
    await assert.rejects(tracker.openCycle({ start: TODAY }, actor), { code: 'NOT_SUPPORTED', message: /schedule/ })
    await assert.rejects(tracker.closeCycle('1', actor), { code: 'NOT_SUPPORTED', message: /end date/ })
  } finally {
    teardown()
  }
})

test('with no active cycle, sprint current fails on create and writes nothing, and a search is empty', async () => {
  const { tracker, fake, actor, teardown } = linearContract({ cycles: [PLANNED] })
  try {
    const a = (await tracker.createIssue({ title: 'A' }, actor)).after.id
    const written = fake.mutations.length
    await assert.rejects(tracker.createIssue({ title: 'Never', sprint: 'current' }, actor), { code: 'INVALID_INPUT', message: 'there is no active sprint' })
    await assert.rejects(tracker.updateIssue(a, { sprint: 'current' }, actor), { code: 'INVALID_INPUT' })
    await assert.rejects(tracker.moveToCycle([a], 'current', actor), { code: 'INVALID_INPUT' })
    assert.equal(fake.mutations.length, written)
    assert.deepEqual((await tracker.searchIssues({ sprint: 'current' })).issues, [])
    assert.equal(await tracker.currentCycle(), null)
  } finally {
    teardown()
  }
})

test('no file under PMKIT_HOME or .pmkit/ holds the key after a capacity write', async () => {
  const { tracker, env, root, actor, teardown } = linearContract()
  try {
    const [member] = (await tracker.discover()).members
    await tracker.setCapacity('1', { [member.id]: 8 }, actor)
    const files = [env.PMKIT_HOME, path.join(root, '.pmkit')].flatMap((dir) =>
      fs.readdirSync(dir, { recursive: true, withFileTypes: true }).filter((entry) => entry.isFile()).map((entry) => path.join(entry.parentPath, entry.name)))
    assert.ok(files.some((file) => file.endsWith('capacity.yaml')))
    for (const file of files) assert.ok(!fs.readFileSync(file, 'utf8').includes(FAKE_KEY), file)
  } finally {
    teardown()
  }
})

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
