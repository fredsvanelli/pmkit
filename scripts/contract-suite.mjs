// The tracker contract suite. An adapter test calls runTrackerContract with a setup function
// that returns a fresh tracker; the suite uses contract operations only.
//
// setup() returns { tracker, actor, teardown, today? }. The tracker has every status category,
// at least one member and no issues. `today` is the YYYY-MM-DD date the tracker treats as today
// (default: the real date); the suite opens its cycle on that day so the cycle starts active.

import { describe, test } from 'node:test'
import assert from 'node:assert/strict'
import { assertTracker } from './lib/contract.mjs'

const CATEGORIES = ['triage', 'backlog', 'todo', 'in_progress', 'in_review', 'done', 'canceled']
const DOC_PATH = 'contract/notes.md'

const rejects = (fn, code) => assert.throws(fn, (error) => error.code === code, `expected ${code}`)

/** Registers the contract tests inside describe(name). */
export function runTrackerContract({ name, setup }) {
  const it = (title, body) => test(title, async () => {
    const env = await setup()
    try {
      await body({ ...env, today: env.today ?? new Date().toISOString().slice(0, 10) })
    } finally {
      await env.teardown()
    }
  })

  describe(name, () => {
    it('implements every contract operation', ({ tracker }) => {
      assertTracker(tracker)
    })

    it('discover lists statuses by category, members and the capability manifest has an entry per capability', ({ tracker }) => {
      const found = tracker.discover()
      for (const category of CATEGORIES) {
        assert.ok(found.statuses.some((status) => status.category === category), `a status in ${category}`)
      }
      assert.ok(found.members.length >= 1)
      assert.ok(found.types.length >= 1)
      const manifest = tracker.capabilities()
      assert.ok(manifest.capabilities.length > 0)
      for (const entry of manifest.capabilities) assert.ok(entry.id && entry.path, `capability ${entry.id} has a path`)
    })

    it('creates, gets, updates, moves through every category, assigns and archives an issue', ({ tracker, actor }) => {
      const { statuses, members, types } = tracker.discover()
      const created = tracker.createIssue({ title: 'First', type: types[0] }, actor)
      assert.equal(created.before, null)
      const { id } = created.after
      assert.equal(tracker.getIssue(id).title, 'First')

      const updated = tracker.updateIssue(id, { title: 'Renamed', description: 'Body text' }, actor)
      assert.equal(updated.before.title, 'First')
      assert.equal(tracker.getIssue(id).title, 'Renamed')
      assert.equal(tracker.getIssue(id).description, 'Body text')

      for (const category of CATEGORIES) {
        const status = statuses.find((candidate) => candidate.category === category)
        const moved = tracker.moveToCategory(id, category, actor, { status: status.name })
        assert.equal(moved.after.status.category, category)
        assert.equal(tracker.getIssue(id).status.category, category)
        assert.deepEqual(tracker.searchIssues({ categories: [category] }).issues.map((issue) => issue.id), [id])
      }

      tracker.assign(id, members[0].id, actor)
      assert.equal(tracker.getIssue(id).assignee, members[0].id)
      assert.deepEqual(tracker.searchIssues({ assignee: members[0].id }).issues.map((issue) => issue.id), [id])
      tracker.assign(id, null, actor)
      assert.equal(tracker.getIssue(id).assignee, undefined)

      tracker.archive(id, actor)
      assert.equal(tracker.getIssue(id).archived, true)
      assert.deepEqual(tracker.searchIssues({}).issues, [])
      assert.deepEqual(tracker.searchIssues({ archived: true }).issues.map((issue) => issue.id), [id])
    })

    it('rejects an unknown issue with NOT_FOUND and a bad write with INVALID_INPUT', ({ tracker, actor }) => {
      rejects(() => tracker.getIssue('NOPE-999999'), 'NOT_FOUND')
      rejects(() => tracker.createIssue({ title: '' }, actor), 'INVALID_INPUT')
      rejects(() => tracker.createIssue({ title: 'x' }, 'not-a-member'), 'INVALID_INPUT')
    })

    it('link blocks changes blocked, and unlink restores it', ({ tracker, actor }) => {
      const a = tracker.createIssue({ title: 'Blocker' }, actor).after.id
      const b = tracker.createIssue({ title: 'Blocked' }, actor).after.id
      assert.deepEqual(tracker.searchIssues({ blocked: true }).issues, [])
      tracker.link(a, b, 'blocks', actor)
      assert.deepEqual(tracker.getIssue(b).blockedBy, [a])
      assert.deepEqual(tracker.getIssue(a).blocks, [b])
      assert.deepEqual(tracker.searchIssues({ blocked: true }).issues.map((issue) => issue.id), [b])
      tracker.unlink(a, b, 'blocks', actor)
      assert.deepEqual(tracker.getIssue(b).blockedBy, [])
      assert.deepEqual(tracker.searchIssues({ blocked: true }).issues, [])
    })

    it('links related and duplicate issues', ({ tracker, actor }) => {
      const a = tracker.createIssue({ title: 'A' }, actor).after.id
      const b = tracker.createIssue({ title: 'B' }, actor).after.id
      tracker.link(a, b, 'related', actor)
      assert.deepEqual(tracker.getIssue(a).related, [b])
      assert.deepEqual(tracker.getIssue(b).related, [a])
      tracker.link(a, b, 'duplicate', actor)
      assert.deepEqual(tracker.getIssue(a).duplicateOf, [b])
      rejects(() => tracker.link(a, b, 'sibling', actor), 'INVALID_INPUT')
    })

    it('keeps comments and history in the order the writes happened', ({ tracker, actor }) => {
      const { id } = tracker.createIssue({ title: 'Talked about' }, actor).after
      tracker.updateIssue(id, { title: 'Talked about more' }, actor)
      const comment = tracker.comment(id, 'First thought', actor)
      assert.equal(comment.body, 'First thought')
      tracker.logTime(id, 30, actor)
      assert.deepEqual(tracker.listComments(id).map((entry) => entry.body), ['First thought'])
      const ops = tracker.getHistory(id).map((event) => event.op)
      assert.deepEqual(ops, ['create', 'update', 'comment', 'log_time'])
      const stamps = tracker.getHistory(id).map((event) => event.at)
      assert.deepEqual(stamps, [...stamps].sort())
      rejects(() => tracker.comment(id, '   ', actor), 'INVALID_INPUT')
      rejects(() => tracker.logTime(id, 0, actor), 'INVALID_INPUT')
    })

    it('opens a cycle, adds issues, closes it and lists the unfinished ones', ({ tracker, actor, today }) => {
      const { statuses } = tracker.discover()
      const open = tracker.createIssue({ title: 'Unfinished' }, actor).after.id
      const finished = tracker.createIssue({ title: 'Finished' }, actor).after.id
      const done = statuses.find((status) => status.category === 'done').name
      tracker.moveToCategory(finished, 'done', actor, { status: done })

      const cycle = tracker.openCycle({ start: today }, actor).after
      assert.equal(cycle.state, 'active')
      assert.equal(tracker.currentCycle().id, cycle.id)
      assert.deepEqual(tracker.listCycles({ state: 'active' }).map((entry) => entry.id), [cycle.id])

      tracker.moveToCycle([open, finished], cycle.id, actor)
      assert.deepEqual(tracker.cycleIssues(cycle.id).map((issue) => issue.id).sort(), [open, finished].sort())

      const closed = tracker.closeCycle(cycle.id, actor)
      assert.equal(closed.sprint.state, 'closed')
      assert.deepEqual(closed.unfinished.map((issue) => issue.id), [open])
      assert.equal(tracker.currentCycle(), null)
    })

    it('sets and reads cycle capacity', ({ tracker, actor, today }) => {
      const [member] = tracker.discover().members
      const cycle = tracker.openCycle({ start: today }, actor).after
      tracker.setCapacity(cycle.id, { [member.id]: 8 }, actor)
      assert.deepEqual(tracker.getCapacity(cycle.id), { [member.id]: 8 })
    })

    it('creates an epic, parents an issue and reads progress', ({ tracker, actor }) => {
      const epic = tracker.createDeliverable({ title: 'Launch' }, actor).after
      assert.equal(tracker.getDeliverable(epic.id).title, 'Launch')
      assert.deepEqual(tracker.listDeliverables().map((entry) => entry.id), [epic.id])
      const first = tracker.createIssue({ title: 'Part one' }, actor).after.id
      const second = tracker.createIssue({ title: 'Part two' }, actor).after.id
      tracker.setParent(first, epic.id, actor)
      tracker.setParent(second, epic.id, actor)
      assert.equal(tracker.getIssue(first).parent, epic.id)
      tracker.moveToCategory(first, 'done', actor)
      const progress = tracker.deliverableProgress(epic.id)
      assert.equal(progress.total, 2)
      assert.equal(progress.done, 1)
      tracker.setParent(second, null, actor)
      assert.equal(tracker.deliverableProgress(epic.id).total, 1)
      rejects(() => tracker.getDeliverable('NOPE-999999'), 'NOT_FOUND')
    })

    it('logs time on an issue and shows it in the history and the metric events', ({ tracker, actor }) => {
      const { id } = tracker.createIssue({ title: 'Timed' }, actor).after
      tracker.logTime(id, 45, actor)
      const logged = tracker.getHistory(id).filter((event) => event.op === 'log_time')
      assert.deepEqual(logged.map((event) => event.minutes), [45])
      assert.ok(tracker.metricEvents().some((event) => event.issue === id && event.op === 'log_time'))
    })

    it('archived issues drop out of search', ({ tracker, actor }) => {
      const keep = tracker.createIssue({ title: 'Keep' }, actor).after.id
      const drop = tracker.createIssue({ title: 'Drop' }, actor).after.id
      tracker.archive(drop, actor)
      assert.deepEqual(tracker.searchIssues({}).issues.map((issue) => issue.id), [keep])
      assert.deepEqual(tracker.searchIssues({ text: 'drop' }).issues, [])
    })

    it('creates a document and reads it back, and refuses a second create at the same path', ({ tracker, actor }) => {
      rejects(() => tracker.readDocument(DOC_PATH), 'NOT_FOUND')
      const created = tracker.createDocument(DOC_PATH, '# Notes\n\nHello.\n', actor)
      assert.equal(created.before, null)
      assert.equal(created.after.path, DOC_PATH)
      const read = tracker.readDocument(DOC_PATH)
      assert.equal(read.path, DOC_PATH)
      assert.equal(read.body, '# Notes\n\nHello.\n')
      rejects(() => tracker.createDocument(DOC_PATH, 'again', actor), 'CONFLICT')
      rejects(() => tracker.createDocument('../escape.md', 'x', actor), 'INVALID_INPUT')
    })

    it('every dry run changes nothing that a following read can see', ({ tracker, actor, today }) => {
      const { members } = tracker.discover()
      const a = tracker.createIssue({ title: 'Dry A' }, actor).after.id
      const b = tracker.createIssue({ title: 'Dry B' }, actor).after.id
      const c = tracker.createIssue({ title: 'Dry C' }, actor).after.id
      const epic = tracker.createDeliverable({ title: 'Dry epic' }, actor).after.id
      const cycle = tracker.openCycle({ start: today }, actor).after.id
      tracker.link(b, c, 'blocks', actor)
      tracker.comment(a, 'real comment', actor)
      tracker.createDocument('dry/existing.md', 'kept', actor)

      const snapshot = () => JSON.stringify({
        issues: [a, b, c].map((id) => ({ issue: tracker.getIssue(id), history: tracker.getHistory(id), comments: tracker.listComments(id) })),
        search: tracker.searchIssues({ archived: true }).issues,
        cycles: tracker.listCycles(),
        cycleIssues: tracker.cycleIssues(cycle),
        capacity: tracker.getCapacity(cycle),
        deliverables: tracker.listDeliverables(),
        progress: tracker.deliverableProgress(epic),
        document: tracker.readDocument('dry/existing.md'),
        metrics: tracker.metricEvents(),
      })
      const missing = (path) => {
        try {
          tracker.readDocument(path)
          return false
        } catch (error) {
          return error.code === 'NOT_FOUND'
        }
      }
      const dry = { dryRun: true }
      const before = snapshot()
      const writes = [
        () => tracker.createIssue({ title: 'Never' }, actor, dry),
        () => tracker.updateIssue(a, { title: 'Changed' }, actor, dry),
        () => tracker.moveToCategory(a, 'done', actor, dry),
        () => tracker.assign(a, members[0].id, actor, dry),
        () => tracker.archive(a, actor, dry),
        () => tracker.link(a, b, 'blocks', actor, dry),
        () => tracker.link(a, b, 'related', actor, dry),
        () => tracker.unlink(b, c, 'blocks', actor, dry),
        () => tracker.setParent(a, epic, actor, dry),
        () => tracker.comment(a, 'dry comment', actor, dry),
        () => tracker.logTime(a, 10, actor, dry),
        () => tracker.openCycle({ start: '2099-01-01' }, actor, dry),
        () => tracker.moveToCycle([a], cycle, actor, dry),
        () => tracker.closeCycle(cycle, actor, dry),
        () => tracker.setCapacity(cycle, { [members[0].id]: 3 }, actor, dry),
        () => tracker.createDeliverable({ title: 'Never epic' }, actor, dry),
        () => tracker.publishStatusUpdate({ epic, health: 'on_track', body: 'dry update' }, actor, dry),
        () => tracker.createDocument('dry/new.md', 'never', actor, dry),
      ]
      for (const write of writes) {
        write()
        assert.equal(snapshot(), before, `after ${write.toString()}`)
      }
      assert.ok(missing('dry/new.md'))
      // The snapshot sees real writes, so the equality above is not vacuous.
      tracker.comment(a, 'real again', actor)
      assert.notEqual(snapshot(), before)
      assert.deepEqual(tracker.searchIssues({ text: 'never', archived: true }).issues, [])
    })
  })
}
