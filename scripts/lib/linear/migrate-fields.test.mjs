import test from 'node:test'
import assert from 'node:assert/strict'
import { ACME_TEAM, PROJECT_STATUS_NODES } from '../../fake-linear-api.mjs'
import { fakeRaw } from '../../fake-linear-nodes.mjs'
import { discoveryView } from './discovery.mjs'
import { EXPORT_LOSSES, PROJECT_TYPE_OF_CATEGORY, exportTarget, mapExport } from './migrate-fields.mjs'

const PMKIT = {
  tracker: { system: 'linear', scope: { workspace: 'acme', team: 'ACME' } },
  mappings: { status: { in_review: 'In Review' }, types: { feature: 'Feature', bug: 'Bug', task: 'Task' }, fields: { estimate: 'native' } },
}
const CYCLES = [
  { id: 'cycle-1', number: 1, name: null, description: null, startsAt: '2026-11-02T00:00:00.000Z', endsAt: '2026-11-16T00:00:00.000Z', completedAt: null, isActive: false, isFuture: true, isPast: false },
]

async function target(pmkit = PMKIT, teamOverrides = {}) {
  const raw = await fakeRaw({ teams: [{ ...ACME_TEAM, cyclesEnabled: true, issueEstimationType: 'fibonacci', ...teamOverrides }] })
  return exportTarget({ raw, view: discoveryView(raw, pmkit), pmkit, teamKey: 'ACME', projectStatuses: PROJECT_STATUS_NODES, cycles: CYCLES })
}

const status = (name, category = name) => ({ name, category })
function issue(id, overrides = {}) {
  return {
    id, title: `Title of ${id}`, type: 'feature', status: status('todo'), priority: null, estimate: null, assignee: null, labels: [], parent: null,
    sprint: null, milestone: null, release: null, due: null, branch: null, description: '', acceptanceCriteria: [], archived: false,
    created: '2026-10-20T10:00:00.000Z', completed: null, ...overrides,
  }
}
function snapshot(overrides = {}) {
  return {
    system: 'local', scope: { path: '.issues' }, commit: 'abc1234',
    people: [{ id: 'fred', name: 'Fred', email: 'User-1@Example.com', app: false }, { id: 'ana', name: 'Ana Souza', email: 'ana@example.com', app: false }],
    labels: [], epics: [], sprints: [], issues: [], links: [], comments: [],
    outOfScope: { releases: 0, timeLogs: 0, documents: 0, milestones: 0 },
    ...overrides,
  }
}
const recordOf = (mapped, kind, key) => mapped.records[kind].find((record) => record.key === key)

test('an issue maps every field of step 3', async () => {
  const t = await target()
  const mapped = mapExport(snapshot({
    sprints: [{ id: '2026-11-02', name: 'Sprint', start: '2026-11-02', end: '2026-11-15', goal: '', state: 'planned', closed: null }],
    issues: [issue('ISS-1', {
      status: status('done'), priority: 'high', estimate: 3, assignee: 'fred', due: '2026-11-30', sprint: '2026-11-02', labels: ['bug'],
      description: 'Body', acceptanceCriteria: [{ text: 'Works', done: true }], completed: '2026-10-21T10:00:00.000Z',
    })],
  }), t)
  const record = recordOf(mapped, 'issue', 'ISS-1')
  assert.deepEqual(record.fields, {
    teamId: 'team-acme', title: 'Title of ISS-1', description: 'Body\n\n## Acceptance criteria\n\n- [x] Works', stateId: 'state-8',
    labelIds: ['label-feature', 'label-bug'], priority: 2, estimate: 3, assigneeId: 'user-1', dueDate: '2026-11-30',
    createdAt: '2026-10-20T10:00:00.000Z', completedAt: '2026-10-21T10:00:00.000Z', cycleId: 'cycle-1',
  })
  assert.deepEqual(record.refs, {})
  assert.deepEqual(record.dropped, [])
  assert.equal(mapped.readRequests, 10)
})

test('completedAt is set only for a done issue', async () => {
  const mapped = mapExport(snapshot({ issues: [issue('ISS-1', { status: status('canceled'), completed: '2026-10-21T10:00:00.000Z' })] }), await target())
  assert.equal(recordOf(mapped, 'issue', 'ISS-1').fields.completedAt, undefined)
})

test('an issue parent gives parentId and an epic parent gives projectId', async () => {
  const mapped = mapExport(snapshot({
    epics: [{ id: 'EPC-1', title: 'Epic', status: status('in_review'), start: null, target: null, milestone: null, description: '', created: '2026-10-20T09:00:00Z', updates: [] }],
    issues: [issue('ISS-1', { parent: 'EPC-1' }), issue('ISS-2', { parent: 'ISS-1' }), issue('ISS-3', { parent: 'ISS-2' })],
  }), await target())
  assert.deepEqual(recordOf(mapped, 'issue', 'ISS-1').refs, { projectId: { kind: 'epic', key: 'EPC-1' } })
  assert.deepEqual(recordOf(mapped, 'issue', 'ISS-3').refs, { parentId: { kind: 'issue', key: 'ISS-2' }, projectId: { kind: 'epic', key: 'EPC-1' } })
})

test('the status uses the state of the same name and category, else the mapping', async () => {
  const mapped = mapExport(snapshot({ issues: [issue('ISS-1', { status: status('in_review') }), issue('ISS-2', { status: status('qa', 'in_progress') }), issue('ISS-3', { status: status('In Progress', 'in_progress') })] }), await target())
  assert.equal(recordOf(mapped, 'issue', 'ISS-1').fields.stateId, 'state-4')
  assert.equal(recordOf(mapped, 'issue', 'ISS-2').fields.stateId, 'state-3')
  assert.equal(recordOf(mapped, 'issue', 'ISS-3').fields.stateId, 'state-3')
  assert.equal(recordOf(mapped, 'issue', 'ISS-1').source.summary, 'In Review')
})

test('a category with no state and no mapping is a problem', async () => {
  const mapped = mapExport(snapshot({ issues: [issue('ISS-1', { status: status('triage') })] }), await target())
  assert.deepEqual(mapped.problems, [{ kind: 'issue', key: 'ISS-1', code: 'no_state', message: 'team ACME has no state in the triage category for ISS-1 (status triage); set mappings.status.triage' }])
})

test('a type with no label mapping is a problem', async () => {
  const mapped = mapExport(snapshot({ issues: [issue('ISS-1', { type: 'chore' })] }), await target())
  assert.deepEqual(mapped.problems.map((problem) => [problem.code, problem.key]), [['no_type_label', 'ISS-1']])
})

test('a label the team lacks becomes a label record and a ref', async () => {
  const mapped = mapExport(snapshot({ labels: ['needs-criteria', 'docs'], issues: [issue('ISS-1', { labels: ['needs-criteria', 'docs'], type: 'task' })] }), await target())
  assert.deepEqual(mapped.records.label.map((record) => [record.key, record.fields]), [
    ['Task', { name: 'Task', teamId: 'team-acme' }],
    ['needs-criteria', { name: 'needs-criteria', teamId: 'team-acme' }],
  ])
  const record = recordOf(mapped, 'issue', 'ISS-1')
  assert.deepEqual(record.fields.labelIds, ['label-docs'])
  assert.deepEqual(record.refs.labelIds, [{ kind: 'label', key: 'Task' }, { kind: 'label', key: 'needs-criteria' }])
})

test('the assignee matches by email, ignoring case, and a member with no Linear user is unassigned and listed', async () => {
  const mapped = mapExport(snapshot({
    people: [{ id: 'fred', name: 'Fred', email: 'USER-1@example.com', app: false }, { id: 'bea', name: 'Bea', email: 'bea@example.com', app: false }],
    issues: [issue('ISS-1', { assignee: 'fred' }), issue('ISS-2', { assignee: 'bea' })],
  }), await target())
  assert.equal(recordOf(mapped, 'issue', 'ISS-1').fields.assigneeId, 'user-1')
  assert.equal(recordOf(mapped, 'issue', 'ISS-2').fields.assigneeId, undefined)
  assert.deepEqual(recordOf(mapped, 'issue', 'ISS-2').dropped, ['assignee'])
  const loss = mapped.losses.find((item) => item.what === 'members')
  assert.deepEqual([loss.count, loss.ids], [1, ['ISS-2']])
  assert.deepEqual(mapped.people, [
    { id: 'bea', name: 'Bea', email: 'bea@example.com', note: 'no Linear user', user: null },
    { id: 'fred', name: 'Fred', email: 'USER-1@example.com', note: 'matches Linear user Test User', user: 'user-1' },
  ])
})

test('an estimate outside the scale is dropped', async () => {
  const mapped = mapExport(snapshot({ issues: [issue('ISS-1', { estimate: 13 }), issue('ISS-2', { estimate: 5 })] }), await target())
  assert.deepEqual(recordOf(mapped, 'issue', 'ISS-1').dropped, ['estimate'])
  assert.equal(recordOf(mapped, 'issue', 'ISS-2').fields.estimate, 5)
  assert.equal(mapped.losses.find((item) => item.what === 'estimates').count, 1)
})

test('estimates are dropped when the mapping is none', async () => {
  const mapped = mapExport(snapshot({ issues: [issue('ISS-1', { estimate: 3 })] }), await target({ ...PMKIT, mappings: { ...PMKIT.mappings, fields: { estimate: 'none' } } }))
  assert.deepEqual(recordOf(mapped, 'issue', 'ISS-1').dropped, ['estimate'])
})

test('a sprint matches a cycle by start and end, else no cycle and a loss', async () => {
  const mapped = mapExport(snapshot({
    sprints: [
      { id: '2026-11-02', name: 'A', start: '2026-11-02', end: '2026-11-15', goal: '', state: 'planned', closed: null },
      { id: '2026-10-12', name: 'B', start: '2026-10-12', end: '2026-10-25', goal: '', state: 'closed', closed: null },
    ],
    issues: [issue('ISS-1', { sprint: '2026-11-02' }), issue('ISS-2', { sprint: '2026-10-12' })],
  }), await target())
  assert.equal(recordOf(mapped, 'issue', 'ISS-1').fields.cycleId, 'cycle-1')
  assert.equal(recordOf(mapped, 'issue', 'ISS-2').fields.cycleId, undefined)
  assert.equal(recordOf(mapped, 'issue', 'ISS-2').source.summary, 'Todo, sprint 2026-10-12 has no cycle')
  const loss = mapped.losses.find((item) => item.what === 'sprints')
  assert.equal(loss.why, '1 sprint has no Linear cycle with the same dates; 1 issue will have no cycle')
})

test('a comment body starts with the attribution line', async () => {
  const mapped = mapExport(snapshot({
    issues: [issue('ISS-5N1R')],
    comments: [
      { id: 'ISS-5N1R/a', issue: 'ISS-5N1R', author: 'ana', created: '2026-10-28T18:11:19Z', body: 'Looks good.', parent: null, resolved: true },
      { id: 'ISS-5N1R/b', issue: 'ISS-5N1R', author: 'agent:bot', created: '2026-10-28T18:12:00Z', body: 'Thanks.', parent: 'ISS-5N1R/a', resolved: false },
    ],
  }), await target())
  const root = recordOf(mapped, 'comment', 'ISS-5N1R/a')
  assert.deepEqual(root.fields, { body: 'Comment by Ana Souza on 2026-10-28 in ISS-5N1R\n\nLooks good.', createdAt: '2026-10-28T18:11:19Z' })
  assert.deepEqual(root.refs, { issueId: { kind: 'issue', key: 'ISS-5N1R' } })
  const reply = recordOf(mapped, 'comment', 'ISS-5N1R/b')
  assert.match(reply.fields.body, /^Comment by agent:bot on 2026-10-28 in ISS-5N1R\n\nThanks\.$/)
  assert.deepEqual(reply.refs.parentId, { kind: 'comment', key: 'ISS-5N1R/a' })
  assert.deepEqual(mapped.records.thread.map((record) => [record.key, record.refs]), [['ISS-5N1R/a', { commentId: { kind: 'comment', key: 'ISS-5N1R/a' } }]])
})

test('an epic maps to a project with the status of its category', async () => {
  const mapped = mapExport(snapshot({
    epics: [{
      id: 'EPC-1', title: 'Epic', status: status('in_review'), start: '2026-10-01', target: '2026-12-01', milestone: 'v1', description: 'Body', created: '2026-10-20T09:00:00Z',
      updates: [{ id: 'EPC-1/2026-10-21-fred', at: '2026-10-21T10:00:00Z', author: 'fred', health: 'at_risk', body: 'Late.' }],
    }],
  }), await target())
  assert.equal(PROJECT_TYPE_OF_CATEGORY.in_review, 'started')
  const epic = recordOf(mapped, 'epic', 'EPC-1')
  assert.deepEqual(epic.fields, { name: 'Epic', teamIds: ['team-acme'], content: 'Body', startDate: '2026-10-01', targetDate: '2026-12-01', statusId: 'project-status-started' })
  assert.deepEqual(epic.dropped, ['milestone'])
  const update = recordOf(mapped, 'update', 'EPC-1/2026-10-21-fred')
  assert.deepEqual([update.fields, update.refs], [{ body: 'Late.', health: 'atRisk' }, { projectId: { kind: 'epic', key: 'EPC-1' } }])
})

test('archived issues get an archive record', async () => {
  const mapped = mapExport(snapshot({ issues: [issue('ISS-1', { archived: true }), issue('ISS-2')] }), await target())
  assert.deepEqual(mapped.records.archive.map((record) => [record.key, record.refs]), [['ISS-1', { issueId: { kind: 'issue', key: 'ISS-1' } }]])
})

test('links with a missing end are dropped and listed', async () => {
  const mapped = mapExport(snapshot({
    issues: [issue('ISS-1'), issue('ISS-2')],
    links: [{ kind: 'blocks', from: 'ISS-1', to: 'ISS-2' }, { kind: 'related', from: 'ISS-1', to: 'ISS-9' }],
  }), await target())
  assert.deepEqual(mapped.records.link.map((record) => [record.key, record.fields, record.refs]), [
    ['blocks ISS-1 ISS-2', { type: 'blocks' }, { issueId: { kind: 'issue', key: 'ISS-1' }, relatedIssueId: { kind: 'issue', key: 'ISS-2' } }],
  ])
  assert.deepEqual(mapped.losses.find((item) => item.what === 'links').ids, ['related ISS-1 ISS-9'])
})

test('every export row of "What does not round-trip" appears in losses when its case is present', async () => {
  const mapped = mapExport(snapshot({
    people: [{ id: 'bea', name: 'Bea', email: 'bea@example.com', app: false }],
    sprints: [{ id: '2026-10-12', name: 'B', start: '2026-10-12', end: '2026-10-25', goal: '', state: 'closed', closed: null }],
    epics: [{ id: 'EPC-1', title: 'Epic', status: status('todo'), start: null, target: null, milestone: null, description: '', created: null, updates: [{ id: 'EPC-1/u', at: '2026-10-21T10:00:00Z', author: 'bea', health: 'on_track', body: 'x' }] }],
    issues: [issue('ISS-1', { sprint: '2026-10-12', milestone: 'v1', release: '1.0', branch: 'iss-1-x', estimate: 21, assignee: 'bea' })],
    links: [{ kind: 'blocks', from: 'ISS-1', to: 'ISS-9' }],
    comments: [{ id: 'ISS-1/a', issue: 'ISS-1', author: 'bea', created: '2026-10-28T18:11:19Z', body: 'x', parent: null, resolved: false }],
    outOfScope: { releases: 1, timeLogs: 2, documents: 3, milestones: 1 },
  }), await target())
  assert.deepEqual(mapped.losses.map((loss) => loss.what).sort(), [...EXPORT_LOSSES].sort())
  for (const loss of mapped.losses) {
    assert.ok(loss.count > 0, loss.what)
    assert.ok(loss.why.length > 0, loss.what)
  }
})

test('an empty tracker has no losses, and only the type labels the team lacks to create', async () => {
  const mapped = mapExport(snapshot({ people: [] }), await target())
  assert.deepEqual(mapped.losses, [])
  assert.deepEqual(mapped.records.label.map((record) => record.key), ['Task'])
  assert.ok(Object.entries(mapped.records).every(([kind, list]) => kind === 'label' || list.length === 0))
})
