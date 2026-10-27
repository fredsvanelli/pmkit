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
const issueState = async (tracker, issueIds) => JSON.stringify({
  issues: await Promise.all(issueIds.map(async (id) => ({ issue: await tracker.getIssue(id), history: await tracker.getHistory(id) }))),
  all: (await tracker.searchIssues({ archived: true })).issues.map((issue) => issue.id),
  cycles: await tracker.listCycles(),
  metrics: await tracker.metricEvents(),
})

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

    it('createIssue and updateIssue with sprint current store the active sprint id', async ({ tracker, actor, today }) => {
      const sprint = (await tracker.openCycle({ start: today }, actor)).after
      const made = await tracker.createIssue({ title: 'Made current', sprint: 'current' }, actor)
      assert.equal(made.after.sprint, sprint.id)
      assert.equal((await tracker.getIssue(made.after.id)).sprint, sprint.id)

      const plain = (await tracker.createIssue({ title: 'Plain' }, actor)).after.id
      const moved = await tracker.updateIssue(plain, { sprint: 'current' }, actor)
      assert.equal(moved.before.sprint, undefined)
      assert.equal(moved.after.sprint, sprint.id)
      assert.equal((await tracker.getIssue(plain)).sprint, sprint.id)

      assert.deepEqual(ids(await tracker.cycleIssues(sprint.id)).sort(), [made.after.id, plain].sort())
    })

    it('moveToCycle with current moves issues into the active sprint, and null takes issues out of their sprint', async ({ tracker, actor, today }) => {
      const sprint = (await tracker.openCycle({ start: today }, actor)).after
      const a = (await tracker.createIssue({ title: 'A' }, actor)).after.id
      const b = (await tracker.createIssue({ title: 'B' }, actor)).after.id

      const moved = await tracker.moveToCycle([a, b], 'current', actor)
      assert.equal(moved.length, 2)
      for (const entry of moved) assert.equal(entry.after.sprint, sprint.id)
      assert.deepEqual(ids(await tracker.cycleIssues(sprint.id)).sort(), [a, b].sort())

      await tracker.moveToCycle([a], null, actor)
      assert.equal((await tracker.getIssue(a)).sprint, undefined)
      assert.deepEqual(ids(await tracker.cycleIssues(sprint.id)), [b])

      await tracker.updateIssue(b, { sprint: null }, actor)
      assert.equal((await tracker.getIssue(b)).sprint, undefined)
      assert.deepEqual(ids(await tracker.cycleIssues(sprint.id)), [])
    })

    it('sprint current without an active sprint fails with INVALID_INPUT and writes nothing', async ({ tracker, actor, today }) => {
      const a = (await tracker.createIssue({ title: 'A' }, actor)).after.id
      const b = (await tracker.createIssue({ title: 'B' }, actor)).after.id
      const expectNothingWritten = async () => {
        const before = await issueState(tracker, [a, b])
        await rejects(() => tracker.createIssue({ title: 'Never', sprint: 'current' }, actor), 'INVALID_INPUT')
        assert.equal(await issueState(tracker, [a, b]), before)
        await rejects(() => tracker.updateIssue(a, { sprint: 'current' }, actor), 'INVALID_INPUT')
        assert.equal(await issueState(tracker, [a, b]), before)
        await rejects(() => tracker.moveToCycle([a, b], 'current', actor), 'INVALID_INPUT')
        assert.equal(await issueState(tracker, [a, b]), before)
        return before
      }

      await expectNothingWritten()
      await tracker.openCycle({ start: '2099-01-01' }, actor)
      await expectNothingWritten()
      const closing = (await tracker.openCycle({ start: today }, actor)).after
      await tracker.closeCycle(closing.id, actor)
      const last = await expectNothingWritten()

      await tracker.comment(a, 'real', actor)
      assert.notEqual(await issueState(tracker, [a, b]), last)
    })

    it('searchIssues with sprint current returns the active sprint issues and sprint none the issues in no sprint', async ({ tracker, actor, today }) => {
      const active = (await tracker.openCycle({ start: today }, actor)).after
      const planned = (await tracker.openCycle({ start: '2099-01-01' }, actor)).after
      const inActive = (await tracker.createIssue({ title: 'In active', sprint: active.id }, actor)).after.id
      const inPlanned = (await tracker.createIssue({ title: 'In planned', sprint: planned.id }, actor)).after.id
      const free = (await tracker.createIssue({ title: 'Free' }, actor)).after.id

      assert.deepEqual(ids((await tracker.searchIssues({ sprint: 'current' })).issues), [inActive])
      assert.deepEqual(ids((await tracker.searchIssues({ sprint: 'none' })).issues), [free])
      assert.deepEqual(ids((await tracker.searchIssues({ sprint: active.id })).issues), [inActive])
      assert.deepEqual(ids((await tracker.searchIssues({ sprint: planned.id })).issues), [inPlanned])
    })

    it('searchIssues with sprint current returns an empty list without an active sprint', async ({ tracker, actor }) => {
      const planned = (await tracker.openCycle({ start: '2099-01-01' }, actor)).after
      await tracker.createIssue({ title: 'In planned', sprint: planned.id }, actor)
      const free = (await tracker.createIssue({ title: 'Free' }, actor)).after.id

      assert.deepEqual((await tracker.searchIssues({ sprint: 'current' })).issues, [])
      assert.deepEqual(ids((await tracker.searchIssues({ sprint: 'none' })).issues), [free])
    })

    it('sets and reads cycle capacity', async ({ tracker, actor, today }) => {
      const [member] = (await tracker.discover()).members
      const cycle = (await tracker.openCycle({ start: today }, actor)).after
      await tracker.setCapacity(cycle.id, { [member.id]: 8 }, actor)
      assert.deepEqual(await tracker.getCapacity(cycle.id), { [member.id]: 8 })
    })

    it('sets, reads and clears days off', async ({ tracker, actor, today }) => {
      const [member] = (await tracker.discover()).members
      const cycle = (await tracker.openCycle({ start: today }, actor)).after
      const date = new Date(`${today}T00:00:00Z`)
      while (date.getUTCDay() === 0 || date.getUTCDay() === 6) date.setUTCDate(date.getUTCDate() + 1)
      const weekday = date.toISOString().slice(0, 10)
      await tracker.updateCycleCapacity(cycle.id, { daysOff: { [member.id]: [weekday] } }, actor)
      assert.deepEqual(await tracker.getDaysOff(cycle.id), { [member.id]: [weekday] })
      await tracker.updateCycleCapacity(cycle.id, { daysOff: { [member.id]: null } }, actor)
      assert.deepEqual(await tracker.getDaysOff(cycle.id), {})
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

    it('lists no milestones at the start', async ({ tracker }) => {
      assert.deepEqual(await tracker.listMilestones(), [])
    })

    it('creates a milestone that list and get agree on', async ({ tracker, actor }) => {
      const created = await tracker.createMilestone({ id: 'contract-m1', name: 'Contract one', due: '2099-01-31' }, actor)
      assert.equal(created.before, null)
      assert.equal(created.after.id, 'contract-m1')
      assert.equal(created.after.name, 'Contract one')
      assert.equal(created.after.due, '2099-01-31')
      assert.deepEqual(await tracker.listMilestones(), [created.after])
      assert.deepEqual(await tracker.getMilestone('contract-m1'), created.after)
    })

    it('rejects an unknown milestone with NOT_FOUND', async ({ tracker }) => {
      await rejects(() => tracker.getMilestone('no-such-milestone'), 'NOT_FOUND')
    })

    it('a milestone dry run returns after and creates nothing', async ({ tracker, actor }) => {
      const { before, after } = await tracker.createMilestone({ id: 'contract-dry' }, actor, { dryRun: true })
      assert.equal(before, null)
      assert.equal(after.id, 'contract-dry')
      assert.deepEqual(await tracker.listMilestones(), [])
      await rejects(() => tracker.getMilestone('contract-dry'), 'NOT_FOUND')
    })

    it('lists no releases at the start', async ({ tracker }) => {
      assert.deepEqual(await tracker.listReleases(), [])
    })

    it('creates a release that list and get agree on', async ({ tracker, actor }) => {
      const created = await tracker.createRelease({ id: 'contract-1.0', name: 'Contract one', tag: 'v-contract-1.0', target: '2099-01-31' }, actor)
      assert.equal(created.before, null)
      assert.equal(created.after.id, 'contract-1.0')
      assert.equal(created.after.tag, 'v-contract-1.0')
      assert.deepEqual(await tracker.listReleases(), [created.after])
      assert.deepEqual(await tracker.getRelease('contract-1.0'), created.after)
    })

    it('rejects an unknown release with NOT_FOUND', async ({ tracker }) => {
      await rejects(() => tracker.getRelease('no-such-release'), 'NOT_FOUND')
    })

    it('a release dry run returns after and creates nothing', async ({ tracker, actor }) => {
      const { before, after } = await tracker.createRelease({ id: 'contract-dry' }, actor, { dryRun: true })
      assert.equal(before, null)
      assert.equal(after.id, 'contract-dry')
      assert.deepEqual(await tracker.listReleases(), [])
    })

    it('lists the issues of a release and marks it released', async ({ tracker, actor }) => {
      await tracker.createRelease({ id: 'contract-2.0' }, actor)
      const first = (await tracker.createIssue({ title: 'In release one' }, actor)).after
      const second = (await tracker.createIssue({ title: 'In release two' }, actor)).after
      await tracker.updateIssue(first.id, { release: 'contract-2.0' }, actor)
      await tracker.updateIssue(second.id, { release: 'contract-2.0' }, actor)
      await tracker.moveToCategory(first.id, 'done', actor)
      const members = (await tracker.releaseIssues('contract-2.0')).map((issue) => issue.id).sort()
      assert.deepEqual(members, [first.id, second.id].sort())
      await tracker.archive(first.id, actor)
      assert.deepEqual((await tracker.releaseIssues('contract-2.0')).map((issue) => issue.id), [second.id])
      const withArchived = (await tracker.releaseIssues('contract-2.0', { archived: true })).map((issue) => issue.id).sort()
      assert.deepEqual(withArchived, [first.id, second.id].sort())
      const dry = await tracker.markReleased('contract-2.0', actor, { dryRun: true })
      assert.equal(dry.after.state, 'released')
      assert.equal((await tracker.getRelease('contract-2.0')).state, 'planned')
      const marked = await tracker.markReleased('contract-2.0', actor)
      assert.equal(marked.after.state, 'released')
      assert.deepEqual(marked.unfinished.map((issue) => issue.id), [second.id])
      await rejects(() => tracker.releaseIssues('no-such-release'), 'NOT_FOUND')
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
