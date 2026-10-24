// The tracker contract suite. An adapter test calls runTrackerContract with a setup function
// that returns a fresh tracker; the suite uses contract operations only.
//
// setup() returns { tracker, actor, teardown, today? }. The tracker has every status category,
// at least one member and no issues. `today` is the YYYY-MM-DD date the tracker treats as today
// (default: the real date); the suite opens its cycle on that day so the cycle starts active.
// The suite awaits every operation, so an adapter may return values or promises.

import { describe, test } from 'node:test'
import assert from 'node:assert/strict'
import { assertTracker } from './lib/contract.mjs'

const CATEGORIES = ['triage', 'backlog', 'todo', 'in_progress', 'in_review', 'done', 'canceled']
const DOC_PATH = 'contract/notes.md'

const rejects = (fn, code) => assert.rejects(async () => fn(), (error) => error.code === code, `expected ${code}`)
const ids = (issues) => issues.map((issue) => issue.id)

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
    it('implements every contract operation', async ({ tracker }) => {
      assertTracker(tracker)
    })

    it('discover lists statuses by category, members and the capability manifest has an entry per capability', async ({ tracker }) => {
      const found = await tracker.discover()
      for (const category of CATEGORIES) {
        assert.ok(found.statuses.some((status) => status.category === category), `a status in ${category}`)
      }
      assert.ok(found.members.length >= 1)
      assert.ok(found.types.length >= 1)
      const manifest = await tracker.capabilities()
      assert.ok(manifest.capabilities.length > 0)
      for (const entry of manifest.capabilities) assert.ok(entry.id && entry.path, `capability ${entry.id} has a path`)
    })

    it('creates, gets, updates, moves through every category, assigns and archives an issue', async ({ tracker, actor }) => {
      const { statuses, members, types } = await tracker.discover()
      const created = await tracker.createIssue({ title: 'First', type: types[0] }, actor)
      assert.equal(created.before, null)
      const { id } = created.after
      assert.equal((await tracker.getIssue(id)).title, 'First')

      const updated = await tracker.updateIssue(id, { title: 'Renamed', description: 'Body text' }, actor)
      assert.equal(updated.before.title, 'First')
      assert.equal((await tracker.getIssue(id)).title, 'Renamed')
      assert.equal((await tracker.getIssue(id)).description, 'Body text')

      for (const category of CATEGORIES) {
        const status = statuses.find((candidate) => candidate.category === category)
        const moved = await tracker.moveToCategory(id, category, actor, { status: status.name })
        assert.equal(moved.after.status.category, category)
        assert.equal((await tracker.getIssue(id)).status.category, category)
        assert.deepEqual(ids((await tracker.searchIssues({ categories: [category] })).issues), [id])
      }

      await tracker.assign(id, members[0].id, actor)
      assert.equal((await tracker.getIssue(id)).assignee, members[0].id)
      assert.deepEqual(ids((await tracker.searchIssues({ assignee: members[0].id })).issues), [id])
      await tracker.assign(id, null, actor)
      assert.equal((await tracker.getIssue(id)).assignee, undefined)

      await tracker.archive(id, actor)
      assert.equal((await tracker.getIssue(id)).archived, true)
      assert.deepEqual((await tracker.searchIssues({})).issues, [])
      assert.deepEqual(ids((await tracker.searchIssues({ archived: true })).issues), [id])
    })

    it('rejects an unknown issue with NOT_FOUND and a bad write with INVALID_INPUT', async ({ tracker, actor }) => {
      await rejects(() => tracker.getIssue('NOPE-999999'), 'NOT_FOUND')
      await rejects(() => tracker.createIssue({ title: '' }, actor), 'INVALID_INPUT')
      await rejects(() => tracker.createIssue({ title: 'x' }, 'not-a-member'), 'INVALID_INPUT')
    })

    it('link blocks changes blocked, and unlink restores it', async ({ tracker, actor }) => {
      const a = (await tracker.createIssue({ title: 'Blocker' }, actor)).after.id
      const b = (await tracker.createIssue({ title: 'Blocked' }, actor)).after.id
      assert.deepEqual((await tracker.searchIssues({ blocked: true })).issues, [])
      await tracker.link(a, b, 'blocks', actor)
      assert.deepEqual((await tracker.getIssue(b)).blockedBy, [a])
      assert.deepEqual((await tracker.getIssue(a)).blocks, [b])
      assert.deepEqual(ids((await tracker.searchIssues({ blocked: true })).issues), [b])
      await tracker.unlink(a, b, 'blocks', actor)
      assert.deepEqual((await tracker.getIssue(b)).blockedBy, [])
      assert.deepEqual((await tracker.searchIssues({ blocked: true })).issues, [])
    })

    it('links related and duplicate issues', async ({ tracker, actor }) => {
      const a = (await tracker.createIssue({ title: 'A' }, actor)).after.id
      const b = (await tracker.createIssue({ title: 'B' }, actor)).after.id
      await tracker.link(a, b, 'related', actor)
      assert.deepEqual((await tracker.getIssue(a)).related, [b])
      assert.deepEqual((await tracker.getIssue(b)).related, [a])
      await tracker.link(a, b, 'duplicate', actor)
      assert.deepEqual((await tracker.getIssue(a)).duplicateOf, [b])
      await rejects(() => tracker.link(a, b, 'sibling', actor), 'INVALID_INPUT')
    })

    it('keeps comments and history in the order the writes happened', async ({ tracker, actor }) => {
      const { id } = (await tracker.createIssue({ title: 'Talked about' }, actor)).after
      await tracker.updateIssue(id, { title: 'Talked about more' }, actor)
      const comment = await tracker.comment(id, 'First thought', actor)
      assert.equal(comment.body, 'First thought')
      await tracker.logTime(id, 30, actor)
      assert.deepEqual((await tracker.listComments(id)).map((entry) => entry.body), ['First thought'])
      const history = await tracker.getHistory(id)
      assert.deepEqual(history.map((event) => event.op), ['create', 'update', 'comment', 'log_time'])
      const stamps = history.map((event) => event.at)
      assert.deepEqual(stamps, [...stamps].sort())
      await rejects(() => tracker.comment(id, '   ', actor), 'INVALID_INPUT')
      await rejects(() => tracker.logTime(id, 0, actor), 'INVALID_INPUT')
    })

    it('opens a cycle, adds issues, closes it and lists the unfinished ones', async ({ tracker, actor, today }) => {
      const { statuses } = await tracker.discover()
      const open = (await tracker.createIssue({ title: 'Unfinished' }, actor)).after.id
      const finished = (await tracker.createIssue({ title: 'Finished' }, actor)).after.id
      const done = statuses.find((status) => status.category === 'done').name
      await tracker.moveToCategory(finished, 'done', actor, { status: done })

      const cycle = (await tracker.openCycle({ start: today }, actor)).after
      assert.equal(cycle.state, 'active')
      assert.equal((await tracker.currentCycle()).id, cycle.id)
      assert.deepEqual(ids(await tracker.listCycles({ state: 'active' })), [cycle.id])

      await tracker.moveToCycle([open, finished], cycle.id, actor)
      assert.deepEqual(ids(await tracker.cycleIssues(cycle.id)).sort(), [open, finished].sort())

      const closed = await tracker.closeCycle(cycle.id, actor)
      assert.equal(closed.sprint.state, 'closed')
      assert.deepEqual(ids(closed.unfinished), [open])
      assert.equal(await tracker.currentCycle(), null)
    })

    it('sets and reads cycle capacity', async ({ tracker, actor, today }) => {
      const [member] = (await tracker.discover()).members
      const cycle = (await tracker.openCycle({ start: today }, actor)).after
      await tracker.setCapacity(cycle.id, { [member.id]: 8 }, actor)
      assert.deepEqual(await tracker.getCapacity(cycle.id), { [member.id]: 8 })
    })

    it('creates an epic, parents an issue and reads progress', async ({ tracker, actor }) => {
      const epic = (await tracker.createDeliverable({ title: 'Launch' }, actor)).after
      assert.equal((await tracker.getDeliverable(epic.id)).title, 'Launch')
      assert.deepEqual(ids(await tracker.listDeliverables()), [epic.id])
      const first = (await tracker.createIssue({ title: 'Part one' }, actor)).after.id
      const second = (await tracker.createIssue({ title: 'Part two' }, actor)).after.id
      await tracker.setParent(first, epic.id, actor)
      await tracker.setParent(second, epic.id, actor)
      assert.equal((await tracker.getIssue(first)).parent, epic.id)
      await tracker.moveToCategory(first, 'done', actor)
      const progress = await tracker.deliverableProgress(epic.id)
      assert.equal(progress.total, 2)
      assert.equal(progress.done, 1)
      await tracker.setParent(second, null, actor)
      assert.equal((await tracker.deliverableProgress(epic.id)).total, 1)
      await rejects(() => tracker.getDeliverable('NOPE-999999'), 'NOT_FOUND')
    })

    it('logs time on an issue and shows it in the history and the metric events', async ({ tracker, actor }) => {
      const { id } = (await tracker.createIssue({ title: 'Timed' }, actor)).after
      await tracker.logTime(id, 45, actor)
      const logged = (await tracker.getHistory(id)).filter((event) => event.op === 'log_time')
      assert.deepEqual(logged.map((event) => event.minutes), [45])
      assert.ok((await tracker.metricEvents()).some((event) => event.issue === id && event.op === 'log_time'))
    })

    it('archived issues drop out of search', async ({ tracker, actor }) => {
      const keep = (await tracker.createIssue({ title: 'Keep' }, actor)).after.id
      const drop = (await tracker.createIssue({ title: 'Drop' }, actor)).after.id
      await tracker.archive(drop, actor)
      assert.deepEqual(ids((await tracker.searchIssues({})).issues), [keep])
      assert.deepEqual((await tracker.searchIssues({ text: 'drop' })).issues, [])
    })

    it('creates a document and reads it back, and refuses a second create at the same path', async ({ tracker, actor }) => {
      await rejects(() => tracker.readDocument(DOC_PATH), 'NOT_FOUND')
      const created = await tracker.createDocument(DOC_PATH, '# Notes\n\nHello.\n', actor)
      assert.equal(created.before, null)
      assert.equal(created.after.path, DOC_PATH)
      const read = await tracker.readDocument(DOC_PATH)
      assert.equal(read.path, DOC_PATH)
      assert.equal(read.body, '# Notes\n\nHello.\n')
      await rejects(() => tracker.createDocument(DOC_PATH, 'again', actor), 'CONFLICT')
      await rejects(() => tracker.createDocument('../escape.md', 'x', actor), 'INVALID_INPUT')
    })

    it('every dry run changes nothing that a following read can see', async ({ tracker, actor, today }) => {
      const { members } = await tracker.discover()
      const a = (await tracker.createIssue({ title: 'Dry A' }, actor)).after.id
      const b = (await tracker.createIssue({ title: 'Dry B' }, actor)).after.id
      const c = (await tracker.createIssue({ title: 'Dry C' }, actor)).after.id
      const epic = (await tracker.createDeliverable({ title: 'Dry epic' }, actor)).after.id
      const cycle = (await tracker.openCycle({ start: today }, actor)).after.id
      await tracker.link(b, c, 'blocks', actor)
      await tracker.comment(a, 'real comment', actor)
      await tracker.createDocument('dry/existing.md', 'kept', actor)

      const snapshot = async () => {
        const issues = []
        for (const id of [a, b, c]) {
          issues.push({ issue: await tracker.getIssue(id), history: await tracker.getHistory(id), comments: await tracker.listComments(id) })
        }
        return JSON.stringify({
          issues,
          search: (await tracker.searchIssues({ archived: true })).issues,
          cycles: await tracker.listCycles(),
          cycleIssues: await tracker.cycleIssues(cycle),
          capacity: await tracker.getCapacity(cycle),
          deliverables: await tracker.listDeliverables(),
          progress: await tracker.deliverableProgress(epic),
          document: await tracker.readDocument('dry/existing.md'),
          metrics: await tracker.metricEvents(),
        })
      }
      const missing = async (path) => {
        try {
          await tracker.readDocument(path)
          return false
        } catch (error) {
          return error.code === 'NOT_FOUND'
        }
      }
      const dry = { dryRun: true }
      const before = await snapshot()
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
        await write()
        assert.equal(await snapshot(), before, `after ${write.toString()}`)
      }
      assert.ok(await missing('dry/new.md'))
      // The snapshot sees real writes, so the equality above is not vacuous.
      await tracker.comment(a, 'real again', actor)
      assert.notEqual(await snapshot(), before)
      assert.deepEqual((await tracker.searchIssues({ text: 'never', archived: true })).issues, [])
    })
  })
}
