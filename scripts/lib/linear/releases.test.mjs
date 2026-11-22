import assert from 'node:assert/strict'
import test from 'node:test'
import { issueReleaseFields, releaseOperations, toRelease } from './releases.mjs'

const node = (id, extra = {}) => ({ id, name: `R ${id}`, version: null, description: null, targetDate: null, completedAt: null, stage: { type: 'planned' }, pipeline: { id: 'p' }, ...extra })

test('toRelease maps a completed release to released and a planned one to planned', () => {
  assert.deepEqual(toRelease(node('a', { completedAt: '2026-10-01T00:00:00.000Z', stage: { type: 'completed' }, description: 'Notes' })), {
    id: 'a', name: 'R a', released: '2026-10-01T00:00:00.000Z', state: 'released', description: 'Notes',
  })
  assert.deepEqual(toRelease(node('b', { targetDate: '2026-12-01', stage: { type: 'started' } })), { id: 'b', name: 'R b', target: '2026-12-01', state: 'planned', description: '' })
})

test('issueReleaseFields ignores canceled releases and lists two or more as releases', () => {
  const canceled = node('z', { stage: { type: 'canceled' } })
  assert.deepEqual(issueReleaseFields([]), {})
  assert.deepEqual(issueReleaseFields([canceled]), {})
  assert.deepEqual(issueReleaseFields([canceled, node('a')]), { release: 'a' })
  assert.deepEqual(issueReleaseFields([node('b'), canceled, node('a')]), { releases: ['a', 'b'] })
})

// PMK-266: without a scope team the pipeline filter would be { eq: undefined }, which matches every team's releases.
test('the release reads refuse with NOT_CONFIGURED before any request when tracker.scope.team is unset', async () => {
  const sent = []
  const client = { request: async (...args) => { sent.push(args) }, paginate: async (...args) => { sent.push(args); return { nodes: [], hasMore: false } } }
  const ops = releaseOperations({ client, config: { pmkit: { tracker: { system: 'linear', scope: { workspace: 'acme' } } } } })
  await assert.rejects(ops.listReleases(), { code: 'NOT_CONFIGURED', message: 'tracker.scope.team is not set', nextStep: '/pmkit:setup' })
  await assert.rejects(ops.resolveRelease('00000000-0000-4000-8000-0000000000b1'), { code: 'NOT_CONFIGURED' })
  assert.deepEqual(sent, [])
})
