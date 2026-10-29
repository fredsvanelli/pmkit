import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { makeRepo } from '../../test-helpers.mjs'
import { loadConfig, validateLocalConfig } from '../config.mjs'
import { parseYaml } from '../yaml.mjs'
import { driftEvents, readEvents } from './events.mjs'
import { toFrontmatter } from './issue-file.mjs'
import { createLocalWriter } from './migrate-writer.mjs'
import { issuePaths } from './store.mjs'
import { createLocalTracker } from './tracker.mjs'

const NOW = '2026-10-28T20:00:00Z'

function setup() {
  const root = makeRepo('basic')
  const writer = () => createLocalWriter({ root, config: loadConfig(root), actor: 'fred', now: () => new Date(NOW) })
  const tracker = () => createLocalTracker(root, { now: () => new Date(NOW), index: false })
  return { root, writer, tracker }
}
const create = (writer, kind, record) => writer.create(kind, record, writer.chooseId(kind, record), record.fields)

const sprint = { key: '1', target: '2026-11-02', fields: { name: 'Cycle 1', start: '2026-11-02', end: '2026-11-15', goal: '', state: 'planned' } }
const epic = { key: 'P-ACM-1', target: 'EPC-1', fields: { id: 'EPC-1', title: 'Launch', status: 'todo', start: '2026-11-01', target: null, description: 'The launch.', created: '2026-10-01T09:00:00Z' } }
const issueRecord = (id, extra = {}, events = []) => ({
  key: `ACME-${id}`,
  target: `ISS-${id}`,
  fields: {
    id: `ISS-${id}`, title: `Issue ${id}`, type: 'bug', status: 'todo', labels: [], created: '2026-10-02T10:00:00Z',
    description: 'Some text.', acceptanceCriteria: [{ text: 'works', done: false }], events, ...extra,
  },
})
const createEvent = (id, to = {}) => ({ at: '2026-10-02T10:00:00Z', by: 'fred', op: 'create', to: { id: `ISS-${id}`, title: `Issue ${id}`, type: 'bug', status: 'todo', created: '2026-10-02T10:00:00Z', ...to } })

test('an imported issue reads back with its fields', async () => {
  const { writer, tracker } = setup()
  const w = writer()
  await create(w, 'sprint', sprint)
  await create(w, 'epic', epic)
  await create(w, 'issue', issueRecord(1, { parent: 'EPC-1' }, [createEvent(1, { parent: 'EPC-1' })]))
  await create(w, 'issue', issueRecord(2, { parent: 'ISS-1', blocked_by: ['ISS-1'], sprint: '2026-11-02', labels: [], priority: 'high' }))
  const issue = tracker().getIssue('ISS-2')
  assert.equal(issue.status.name, 'todo')
  assert.equal(issue.type, 'bug')
  assert.equal(issue.parent, 'ISS-1')
  assert.deepEqual(issue.blockedBy, ['ISS-1'])
  assert.equal(issue.sprint, '2026-11-02')
  assert.equal(issue.priority, 'high')
  assert.equal(issue.created, '2026-10-02T10:00:00Z')
  assert.equal(issue.description, 'Some text.')
})

test('history replays with no drift', async () => {
  const { root, writer } = setup()
  const record = issueRecord(1, {}, [createEvent(1)])
  await create(writer(), 'issue', record)
  const file = issuePaths(path.join(root, '.issues'), 'ISS-1')
  const { events } = readEvents(file.events)
  assert.equal(events.length, 1)
  const frontmatter = toFrontmatter(createLocalTracker(root, { index: false }).getIssue('ISS-1'))
  assert.deepEqual(driftEvents(frontmatter, events, { at: NOW, by: 'fred' }), [])
})

test('drift is settled with synthetic events by the actor', async () => {
  const { root, writer } = setup()
  await create(writer(), 'issue', issueRecord(1, { status: 'done' }, [createEvent(1)]))
  const { events } = readEvents(issuePaths(path.join(root, '.issues'), 'ISS-1').events)
  const synthetic = events.filter((event) => event.synthetic)
  assert.equal(synthetic.length, 1)
  assert.deepEqual([synthetic[0].op, synthetic[0].field, synthetic[0].to, synthetic[0].by, synthetic[0].at], ['move', 'status', 'done', 'fred', NOW])
})

test('comments keep their date, author, reply and resolution', async () => {
  const { writer, tracker } = setup()
  const w = writer()
  await create(w, 'issue', issueRecord(1, {}, [createEvent(1)]))
  await create(w, 'comment', { key: 'c1', target: '2026-10-03T10-00-00Z-fred', fields: { issue: 'ISS-1', author: 'fred', created: '2026-10-03T10:00:00Z', body: 'root', resolved: true } })
  await create(w, 'comment', { key: 'c2', target: '2026-10-03T11-00-00Z-fred', fields: { issue: 'ISS-1', author: 'fred', created: '2026-10-03T11:00:00Z', body: 'reply', reply_to: '2026-10-03T10-00-00Z-fred' } })
  const comments = tracker().listComments('ISS-1')
  const root = comments.find((comment) => comment.id === '2026-10-03T10-00-00Z-fred')
  assert.equal(root.author, 'fred')
  assert.equal(root.created, '2026-10-03T10:00:00Z')
  assert.equal(root.body, 'root')
  assert.deepEqual(root.resolved, { at: NOW, by: 'fred' })
  const reply = comments.find((comment) => comment.id === '2026-10-03T11-00-00Z-fred')
  assert.equal(reply.parent, root.id)
})

test('a new member and a new label land in .issues/config.yaml', async () => {
  const { root, writer } = setup()
  const w = writer()
  await create(w, 'member', { key: 'u-ana', target: 'ana', fields: { name: 'Ana Souza', email: 'ana@example.com' } })
  await create(w, 'member', { key: 'bot', target: 'agent:github-bot', fields: { name: 'GitHub Bot' } })
  await create(w, 'label', { key: 'Needs Review', target: 'needs-review', fields: { name: 'needs-review' } })
  const config = parseYaml(fs.readFileSync(path.join(root, '.issues', 'config.yaml'), 'utf8'))
  assert.deepEqual(config.members.ana, { name: 'Ana Souza', email: 'ana@example.com', availability: 1 })
  assert.deepEqual(config.members['agent:github-bot'], { name: 'GitHub Bot', availability: 1 })
  assert.deepEqual(config.labels, ['needs-review'])
  assert.deepEqual(validateLocalConfig(config), [])
})

test('epics and updates keep their dates', async () => {
  const { root, writer, tracker } = setup()
  const w = writer()
  await create(w, 'epic', epic)
  await create(w, 'update', { key: 'u1', target: '2026-10-05-fred', fields: { epic: 'EPC-1', at: '2026-10-05T12:00:00Z', author: 'fred', health: 'at_risk', body: 'Slow.' } })
  const created = readEvents(path.join(root, '.issues', 'epics', 'EPC-1', 'events.jsonl')).events[0]
  assert.equal(created.at, '2026-10-01T09:00:00Z')
  const [update] = tracker().listStatusUpdates('EPC-1')
  assert.equal(update.at, '2026-10-05T12:00:00Z')
  assert.equal(update.health, 'at_risk')
  assert.equal(update.author, 'fred')
})

test('exists finds what create wrote', async () => {
  const { writer } = setup()
  const w = writer()
  await create(w, 'sprint', sprint)
  await create(w, 'epic', epic)
  await create(w, 'issue', issueRecord(1, {}, [createEvent(1)]))
  await create(w, 'comment', { key: 'c1', target: '2026-10-03T10-00-00Z-fred', fields: { issue: 'ISS-1', author: 'fred', created: '2026-10-03T10:00:00Z', body: 'root' } })
  await create(w, 'update', { key: 'u1', target: '2026-10-05-fred', fields: { epic: 'EPC-1', at: '2026-10-05T12:00:00Z', author: 'fred', health: 'on_track', body: 'Ok.' } })
  await create(w, 'member', { key: 'u-ana', target: 'ana', fields: { name: 'Ana', email: 'ana@example.com' } })
  await create(w, 'label', { key: 'x', target: 'x', fields: { name: 'x' } })
  const cases = [['sprint', '2026-11-02'], ['epic', 'EPC-1'], ['issue', 'ISS-1'], ['comment', '2026-10-03T10-00-00Z-fred'], ['update', '2026-10-05-fred'], ['member', 'ana'], ['label', 'x']]
  for (const [kind, id] of cases) {
    const found = await w.exists(kind, [{ key: 'k', uuid: id }, { key: 'missing', uuid: 'ISS-ZZZZ' }])
    assert.deepEqual([...found.keys()], ['k'], kind)
  }
  assert.equal(w.budget(), null)
  assert.equal(w.isUnconfirmed(new Error('x')), false)
  await assert.rejects(() => w.remove('issue', {}), { code: 'NOT_SUPPORTED' })
})
