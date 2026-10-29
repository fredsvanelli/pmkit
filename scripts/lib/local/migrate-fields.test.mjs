import test from 'node:test'
import assert from 'node:assert/strict'
import { importTarget, localLabelName, mapImport, memberIdFor, seededRandom } from './migrate-fields.mjs'
import { isId } from '../ids.mjs'

const LOCAL = {
  id_prefix: 'ISS',
  epic_prefix: 'EPC',
  id_style: 'random',
  statuses: { backlog: { category: 'backlog' }, todo: { category: 'todo' }, doing: { category: 'in_progress' }, in_progress: { category: 'in_progress' }, done: { category: 'done' } },
  types: ['feature', 'bug', 'task'],
  priorities: ['urgent', 'high', 'medium', 'low'],
  labels: [],
  estimate: { unit: 'points', scale: [1, 2, 3, 5, 8] },
  members: { ana: { name: 'Ana Souza', email: 'Ana@Example.com', availability: 1 } },
}
const MAPPINGS = { types: { bug: 'Bug' } }

const user = (id, name, email, app = false) => ({ id, name, email, app })
const issue = (id, extra = {}) => ({
  id, title: `title ${id}`, type: null, status: { name: 'Backlog', category: 'backlog' }, priority: null, estimate: null, assignee: null,
  labels: [], labelGroups: [], parent: null, sprint: null, milestone: null, release: null, due: null, branch: `acme-${id}`,
  description: '', acceptanceCriteria: [], archived: false, created: `2026-10-01T10:00:0${id.slice(-1)}Z`, completed: null, events: [], ...extra,
})
const snapshot = (extra = {}) => ({
  system: 'linear', scope: { workspace: 'acme', team: 'ACME' }, read: '2026-10-28T20:00:00Z',
  people: [user('u-ana', 'Ana S.', 'ana@example.com'), user('u-bo', 'Bo', 'bo@example.com')],
  labels: [], epics: [], sprints: [], issues: [], links: [], comments: [], outside: { parents: 0, links: 0 }, ...extra,
})
const map = (snap, local = LOCAL, exportMaps = []) => mapImport(snap, importTarget({ local, mappings: MAPPINGS, exportMaps }), { readRequests: 12 })
const byKey = (records, key) => records.find((record) => record.key === key)
const loss = (mapped, what) => mapped.losses.find((item) => item.what === what)

test('member ids follow the rule', () => {
  const taken = new Set(['fred'])
  const first = memberIdFor(user('u1', 'Ana', 'ana.souza+pm@example.com'), taken)
  assert.equal(first, 'ana-souza-pm')
  taken.add(first)
  assert.equal(memberIdFor(user('u2', 'Ana 2', 'ana.souza+pm@other.example'), taken), 'ana-souza-pm-2')
  assert.equal(memberIdFor(user('u3', 'GitHub Bot', null, true), taken), 'agent:github-bot')
  assert.equal(memberIdFor(user('u4', 'X', '@@x'), taken), 'user')
  taken.add('user')
  assert.equal(memberIdFor(user('u5', 'Y', '@y'), taken), 'user-2')
})

test('a matched user keeps the member id', () => {
  const mapped = map(snapshot({ issues: [issue('ACME-1', { assignee: 'u-ana' })] }))
  assert.equal(byKey(mapped.records.issue, 'ACME-1').fields.assignee, 'ana')
  assert.equal(mapped.records.member.length, 0)
  assert.equal(mapped.people.find((person) => person.id === 'u-ana').note, 'matches member ana')
})

test('each user an imported record names becomes a member record, and others do not', () => {
  const mapped = map(snapshot({
    people: [...snapshot().people, user('u-cy', 'Cy', 'cy@example.com')],
    issues: [issue('ACME-1', { assignee: 'u-bo' })],
  }))
  assert.deepEqual(mapped.records.member.map((record) => [record.key, record.target]), [['u-bo', 'bo']])
  assert.deepEqual(byKey(mapped.records.member, 'u-bo').fields, { name: 'Bo', email: 'bo@example.com' })
  assert.equal(mapped.people.find((person) => person.id === 'u-bo').note, 'new member bo')
  assert.equal(mapped.people.some((person) => person.id === 'u-cy'), false)
})

test('labels follow the Local label rule', () => {
  const mapped = map(snapshot({ labels: ['Needs Review', '!!!'], issues: [issue('ACME-1', { labels: ['Needs Review', 'Bug', '!!!'] })] }))
  const record = byKey(mapped.records.issue, 'ACME-1')
  assert.equal(record.fields.type, 'bug')
  assert.deepEqual(record.fields.labels, ['needs-review'])
  assert.deepEqual(mapped.records.label.map((item) => [item.key, item.target]), [['Needs Review', 'needs-review']])
  assert.ok(loss(mapped, 'labels renamed'))
  assert.equal(mapped.problems.filter((problem) => problem.code === 'bad_label').length, 1)
  assert.equal(localLabelName('Needs Review'), 'needs-review')
  assert.equal(localLabelName('!!!'), null)
  assert.equal(localLabelName('ok_one'), 'ok_one')
})

test('status maps by name, then by category', () => {
  const mapped = map(snapshot({ issues: [
    issue('ACME-1', { status: { name: 'In Progress', category: 'in_progress' } }),
    issue('ACME-2', { status: { name: 'Started', category: 'in_progress' } }),
  ] }))
  assert.equal(byKey(mapped.records.issue, 'ACME-1').fields.status, 'in_progress')
  assert.equal(byKey(mapped.records.issue, 'ACME-2').fields.status, 'doing')
  assert.ok(loss(mapped, 'statuses'))
})

test('an estimate outside the Local scale is dropped', () => {
  const mapped = map(snapshot({ issues: [issue('ACME-1', { estimate: 3 }), issue('ACME-2', { estimate: 21 })] }))
  assert.equal(byKey(mapped.records.issue, 'ACME-1').fields.estimate, 3)
  assert.equal(byKey(mapped.records.issue, 'ACME-2').fields.estimate, undefined)
  assert.deepEqual(loss(mapped, 'estimates').ids, ['ACME-2'])
})

test('round-trip ids come back from a finished export map', () => {
  const exportMap = { direction: 'export', finished: '2026-10-20T00:00:00Z', records: {
    issue: { 'ISS-5N1R': { state: 'done', uuid: 'x', id: 'ACME-12' }, 'OLD-7': { state: 'done', uuid: 'y', id: 'ACME-13' } },
    epic: { 'EPC-2A3B': { state: 'done', uuid: 'z', id: 'P-ACM-3' } },
  } }
  const mapped = map(snapshot({
    epics: [{ id: 'P-ACM-3', title: 'E', status: { name: 'Backlog', category: 'backlog' }, start: null, target: null, description: '', created: '2026-10-01T00:00:00Z', milestones: 0, documents: 0, updates: [] }],
    issues: [issue('ACME-12'), issue('ACME-13')],
  }), LOCAL, [exportMap])
  assert.equal(byKey(mapped.records.issue, 'ACME-12').target, 'ISS-5N1R')
  assert.equal(byKey(mapped.records.epic, 'P-ACM-3').target, 'EPC-2A3B')
  const other = byKey(mapped.records.issue, 'ACME-13').target
  assert.notEqual(other, 'OLD-7')
  assert.ok(isId(other, 'ISS'))
})

test('random ids are the same for the same snapshot', () => {
  const snap = snapshot({ issues: [issue('ACME-1'), issue('ACME-2')] })
  const a = map(snap).records.issue.map((record) => record.target)
  const b = map(structuredClone(snap)).records.issue.map((record) => record.target)
  assert.deepEqual(a, b)
  assert.ok(a.every((id) => isId(id, 'ISS')))
  const draw = seededRandom('d')
  const again = seededRandom('d')
  assert.deepEqual([draw(32), draw(32), draw(32)], [again(32), again(32), again(32)])
})

test('numbered ids follow the creation order', () => {
  const mapped = map(snapshot({ issues: [issue('ACME-2', { created: '2026-10-02T00:00:00Z' }), issue('ACME-1', { created: '2026-10-01T00:00:00Z' })] }), { ...LOCAL, id_style: 'numbered' })
  assert.equal(byKey(mapped.records.issue, 'ACME-1').target, 'ISS-1')
  assert.equal(byKey(mapped.records.issue, 'ACME-2').target, 'ISS-2')
})

test('a comment with an attribution line gets its author back', () => {
  const mapped = map(snapshot({
    issues: [issue('ACME-1')],
    comments: [
      { id: 'c1', issue: 'ACME-1', author: 'u-bo', created: '2026-10-02T10:00:00Z', body: 'Comment by Ana Souza on 2026-09-01 in ISS-5N1R\n\nhello', parent: null, resolved: true },
      { id: 'c2', issue: 'ACME-1', author: 'u-bo', created: '2026-10-02T11:00:00Z', body: 'Comment by Nobody on 2026-09-01 in ISS-5N1R\n\nreply', parent: 'c1', resolved: false },
    ],
  }))
  const root = byKey(mapped.records.comment, 'c1')
  assert.equal(root.fields.author, 'ana')
  assert.equal(root.fields.body, 'hello')
  assert.equal(root.fields.resolved, true)
  assert.equal(root.target, '2026-10-02T10-00-00Z-ana')
  const reply = byKey(mapped.records.comment, 'c2')
  assert.equal(reply.fields.author, 'bo')
  assert.equal(reply.fields.body, 'reply')
  assert.equal(reply.fields.reply_to, root.target)
})

test('a parent issue and a project parent map to Local parent ids', () => {
  const mapped = map(snapshot({
    epics: [{ id: 'P-ACM-1', title: 'E', status: { name: 'Backlog', category: 'backlog' }, start: null, target: null, description: '', created: '2026-10-01T00:00:00Z', milestones: 0, documents: 0, updates: [] }],
    issues: [issue('ACME-1', { parent: 'P-ACM-1' }), issue('ACME-2', { parent: 'ACME-1', milestone: 'Beta' })],
    links: [{ kind: 'blocks', from: 'ACME-1', to: 'ACME-2' }, { kind: 'duplicate', from: 'ACME-2', to: 'ACME-1' }, { kind: 'related', from: 'ACME-1', to: 'ACME-2' }],
  }))
  const epic = byKey(mapped.records.epic, 'P-ACM-1').target
  const one = byKey(mapped.records.issue, 'ACME-1')
  const two = byKey(mapped.records.issue, 'ACME-2')
  assert.equal(one.fields.parent, epic)
  assert.equal(two.fields.parent, one.target)
  assert.deepEqual(two.fields.blocked_by, [one.target])
  assert.deepEqual(two.fields.duplicate_of, [one.target])
  assert.deepEqual(one.fields.related, [two.target])
  assert.deepEqual(two.fields.related, [one.target])
  assert.ok(two.dropped.includes('milestone'))
  assert.deepEqual(loss(mapped, 'milestones').ids, ['ACME-2'])
})

test('two cycles with the same start date are a sprint_clash problem', () => {
  const cycle = (id) => ({ id, name: `Cycle ${id}`, start: '2026-11-02', end: '2026-11-15', goal: '', state: 'planned', closed: null })
  const mapped = map(snapshot({ sprints: [cycle('1'), cycle('2')] }))
  assert.equal(mapped.problems.filter((problem) => problem.code === 'sprint_clash').length, 1)
})

test('events name Local ids and members', () => {
  const mapped = map(snapshot({ issues: [issue('ACME-1', { events: [
    { at: '2026-10-01T10:00:01Z', by: 'u-ana', op: 'create', to: { id: 'ACME-1', title: 't', status: 'Backlog', labels: ['Needs Review'] } },
    { at: '2026-10-02T10:00:00Z', by: 'u-bo', op: 'move', field: 'status', from: 'Backlog', to: 'In Progress' },
  ] })] }))
  const record = byKey(mapped.records.issue, 'ACME-1')
  assert.equal(record.fields.events[0].to.id, record.target)
  assert.equal(record.fields.events[0].by, 'ana')
  assert.deepEqual(record.fields.events[0].to.labels, ['needs-review'])
  assert.equal(record.fields.events[0].to.status, 'backlog')
  assert.equal(record.fields.events[1].to, 'in_progress')
  assert.equal(record.fields.events[1].by, 'bo')
})

test('every import row of "What does not round-trip" appears in losses when its case is present', () => {
  const mapped = map(snapshot({
    labels: ['Needs Review'],
    epics: [{ id: 'P-ACM-1', title: 'E', status: { name: 'Backlog', category: 'backlog' }, start: null, target: null, description: '', created: '2026-10-01T00:00:00Z', milestones: 1, documents: 2, updates: [] }],
    sprints: [{ id: '1', name: 'Cycle 1', start: '2026-11-02', end: '2026-11-15', goal: '', state: 'planned', closed: null }],
    issues: [issue('ACME-1', { labels: ['Needs Review'], labelGroups: ['M'], estimate: 21, status: { name: 'Started', category: 'in_progress' } })],
    outside: { parents: 1, links: 2 },
  }))
  const whats = mapped.losses.map((item) => item.what)
  for (const what of ['milestones', 'documents', 'outside links', 'label groups', 'estimates', 'statuses', 'cycle schedule', 'ids', 'labels renamed']) {
    assert.ok(whats.includes(what), what)
  }
  assert.equal(mapped.readRequests, 12)
})
