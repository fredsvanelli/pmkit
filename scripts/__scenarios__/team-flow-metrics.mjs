// /pmkit:team:flow-metrics on the team fixture. The period is 2026-10-06 to 2026-10-08 and the previous period is
// 2026-10-03 to 2026-10-05. The command only reads, so no event is appended.
import assert from 'node:assert/strict'

const PERIOD = ['--since', '2026-10-06', '--until', '2026-10-08']
const PREVIOUS = ['--since', '2026-10-03', '--until', '2026-10-05']

export default {
  command: 'team/flow-metrics',
  fixture: 'team',
  prompt: '/pmkit:team:flow-metrics since 2026-10-06 until 2026-10-08',
  answers: [],
  steps: [
    { step: '1', read: ['capabilities'], save: 'caps' },
    { step: '3', read: ['metrics', 'cycle-time', ...PERIOD], save: 'cycle' },
    { step: '3', read: ['metrics', 'lead-time', ...PERIOD], save: 'lead' },
    { step: '3', read: ['metrics', 'throughput', ...PERIOD], save: 'through' },
    { step: '3', read: ['metrics', 'aging', '--until', '2026-10-08'], save: 'aging' },
    { step: '4', read: ['metrics', 'cycle-time', ...PREVIOUS], save: 'prevCycle' },
    { step: '4', read: ['metrics', 'lead-time', ...PREVIOUS], save: 'prevLead' },
    { step: '4', read: ['metrics', 'throughput', ...PREVIOUS], save: 'prevThrough' },
    { step: '4', read: ['metrics', 'aging', '--until', '2026-10-05'], save: 'prevAging' },
  ],
  skip: {},
  notHit: {},
  expect(repo, saved) {
    const metrics = saved.caps.capabilities.find((c) => c.id === 'native_metrics')
    assert.equal(metrics.path, 'derived')
    assert.equal(metrics.detail.source, 'events')
    assert.equal(saved.through.count, 2)
    assert.equal(saved.through.byType.bug, 1)
    assert.equal(saved.prevThrough.count, 1)
    assert.equal(saved.prevThrough.byType.bug, 1)
    assert.equal(saved.cycle.median, 7.8)
    assert.equal(saved.prevCycle.median, 4.3)
    assert.equal(saved.lead.median, 11.3)
    assert.equal(saved.prevLead.median, 8.3)
    assert.equal(saved.aging.count, 0)
    assert.equal(saved.aging.median, null)
    assert.equal(saved.prevAging.count, 2)
    assert.equal(saved.prevAging.median, 6.1)
    const ids = new Set([...saved.cycle.issues, ...saved.prevCycle.issues, ...saved.prevAging.issues].map((i) => i.id ?? i))
    for (const id of ids) assert.deepEqual(repo.newEvents(id), [], `a read-only command appends no event to ${id}`)
  },
}
