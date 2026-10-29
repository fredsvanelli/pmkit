import test from 'node:test'
import assert from 'node:assert/strict'
import { PmkitError } from '../errors.mjs'
import { tempDir } from '../../test-helpers.mjs'
import { createMapStore, newMap, readMap } from './id-map.mjs'
import { planMigration } from './plan.mjs'
import { checkExpect, reconcile, resolveFields, runPlan } from './run.mjs'

const FILE = '.pmkit/migrations/2026-10-28-export-linear.yaml'
const SNAPSHOT = { system: 'local', people: [], labels: [], epics: [], sprints: [], issues: [], links: [], comments: [] }
const now = () => '2026-10-28T20:00:09Z'

const record = (key, refs = {}) => ({ key, source: { id: key }, target: null, fields: { title: key }, refs, dropped: [] })

function planOf(records, map = null, known = {}) {
  return planMigration({
    direction: 'export', source: { system: 'local', path: '.issues' }, target: { system: 'linear', workspace: 'acme', team: 'ACME' },
    snapshot: SNAPSHOT, mapped: { records, losses: [], problems: [], people: [], readRequests: 10 }, map, known,
  })
}

function storeOf(root = tempDir()) {
  const map = newMap({ direction: 'export', started: '2026-10-28T20:00:00Z', source: { system: 'local', path: '.issues' }, target: { system: 'linear', workspace: 'acme', team: 'ACME' } })
  return { root, store: createMapStore(root, FILE, map) }
}

/** A writer that records each call. `failAt` and `unconfirmed.at` count creates from 1. */
function fakeWriter({ failAt, unconfirmed, existing = new Map(), rates = [null], onCreate, prefix = 'uuid' } = {}) {
  const calls = []
  let creates = 0
  let budgets = 0
  let next = 0
  return {
    calls,
    existing,
    system: 'linear',
    chooseId: () => `${prefix}-${++next}`,
    async exists(kind, entries) {
      calls.push({ op: 'exists', kind, keys: entries.map((entry) => entry.key) })
      const found = new Map()
      for (const entry of entries) if (existing.has(entry.uuid)) found.set(entry.key, { id: existing.get(entry.uuid) })
      return found
    },
    async create(kind, rec, chosenId, fields) {
      creates++
      calls.push({ op: 'create', kind, key: rec.key, chosenId, fields })
      onCreate?.(rec, chosenId)
      if (creates === failAt) throw new PmkitError('UPSTREAM', `Linear refused ${rec.key}`, 'Try again')
      if (creates === unconfirmed?.at) {
        if (unconfirmed.applied) existing.set(chosenId, `ACME-${creates}`)
        const error = new PmkitError('UPSTREAM', 'Linear did not confirm the change', 'Check Linear')
        error.unconfirmed = true
        throw error
      }
      existing.set(chosenId, `ACME-${creates}`)
      return { id: `ACME-${creates}` }
    },
    async remove() {},
    budget: () => rates[Math.min(budgets++, rates.length - 1)],
    isUnconfirmed: (error) => error.unconfirmed === true,
  }
}

const creates = (writer) => writer.calls.filter((call) => call.op === 'create')
const three = () => ({ issue: [record('ISS-1'), record('ISS-2'), record('ISS-3')] })

test('a failure at record k stops with k-1 done and one failed', async () => {
  const { root, store } = storeOf()
  const writer = fakeWriter({ failAt: 2 })
  await assert.rejects(runPlan({ plan: planOf(three()), store, writer, known: {}, now }), (error) => {
    assert.equal(error.code, 'UPSTREAM')
    assert.equal(error.message, 'Linear refused ISS-2')
    assert.deepEqual(error.written, { done: 1, total: 3 })
    assert.equal(error.nextStep, 'Fix the cause and run pmkit local-migrate export again to resume')
    return true
  })
  assert.equal(creates(writer).length, 2)
  const map = readMap(root, FILE)
  assert.equal(map.records.issue['ISS-1'].state, 'done')
  assert.deepEqual(map.records.issue['ISS-2'].error, { code: 'UPSTREAM', message: 'Linear refused ISS-2' })
  assert.equal(map.records.issue['ISS-2'].state, 'failed')
  assert.equal(map.records.issue['ISS-3'], undefined)
  assert.equal(map.finished, null)
})

test('a rerun resumes and sends each record once', async () => {
  const { root, store } = storeOf()
  const first = fakeWriter({ failAt: 2 })
  await assert.rejects(runPlan({ plan: planOf(three()), store, writer: first, known: {}, now }))
  const second = fakeWriter({ existing: first.existing, prefix: 'second' })
  const resumed = { file: FILE, map: readMap(root, FILE) }
  const store2 = createMapStore(root, FILE, resumed.map)
  await reconcile(store2, second, { now })
  const result = await runPlan({ plan: planOf(three(), resumed), store: store2, writer: second, known: {}, now })
  assert.deepEqual(result, { done: 3, total: 3 })
  const keys = [...creates(first), ...creates(second)].filter((call, i, all) => all.findIndex((other) => other.chosenId === call.chosenId) === i).map((call) => call.key)
  assert.deepEqual(keys.sort(), ['ISS-1', 'ISS-2', 'ISS-3'])
  assert.deepEqual(creates(second).map((call) => call.key), ['ISS-2', 'ISS-3'])
  assert.equal(creates(second)[0].chosenId, creates(first)[1].chosenId)
})

test('a sent entry that Linear lacks is sent again with the same UUID', async () => {
  const { store } = storeOf()
  store.set('issue', 'ISS-1', { state: 'sent', uuid: 'u1' })
  const writer = fakeWriter()
  assert.deepEqual(await reconcile(store, writer, { now }), { found: 0, missing: 1 })
  await runPlan({ plan: planOf({ issue: [record('ISS-1')] }, { file: FILE, map: store.map }), store, writer, known: {}, now })
  assert.deepEqual(creates(writer).map((call) => call.chosenId), ['u1'])
})

test('a sent entry that exists becomes done with no create', async () => {
  const { store } = storeOf()
  store.set('issue', 'ISS-1', { state: 'sent', uuid: 'u1' })
  const writer = fakeWriter({ existing: new Map([['u1', 'ACME-7']]) })
  assert.deepEqual(await reconcile(store, writer, { now }), { found: 1, missing: 0 })
  assert.deepEqual(store.entry('issue', 'ISS-1'), { state: 'done', uuid: 'u1', id: 'ACME-7', at: now() })
  await runPlan({ plan: planOf({ issue: [record('ISS-1')] }, { file: FILE, map: store.map }), store, writer, known: {}, now })
  assert.equal(creates(writer).length, 0)
})

test('an unconfirmed create found by UUID counts as done', async () => {
  const { store } = storeOf()
  const writer = fakeWriter({ unconfirmed: { at: 1, applied: true } })
  const result = await runPlan({ plan: planOf(three()), store, writer, known: {}, now })
  assert.deepEqual(result, { done: 3, total: 3 })
  assert.equal(store.entry('issue', 'ISS-1').state, 'done')
  assert.equal(store.entry('issue', 'ISS-1').id, 'ACME-1')
  assert.deepEqual(writer.calls.filter((call) => call.op === 'exists').map((call) => call.keys), [['ISS-1']])
})

test('an unconfirmed create not found is failed', async () => {
  const { store } = storeOf()
  const writer = fakeWriter({ unconfirmed: { at: 1, applied: false } })
  await assert.rejects(runPlan({ plan: planOf(three()), store, writer, known: {}, now }), /did not confirm/)
  assert.equal(store.entry('issue', 'ISS-1').state, 'failed')
  assert.equal(creates(writer).length, 1)
})

test('the map says sent before the create goes out', async () => {
  const { root, store } = storeOf()
  const seen = []
  const writer = fakeWriter({ onCreate: (rec, chosenId) => seen.push([readMap(root, FILE).records.issue[rec.key], chosenId]) })
  await runPlan({ plan: planOf({ issue: [record('ISS-1')] }), store, writer, known: {}, now })
  assert.deepEqual(seen, [[{ state: 'sent', uuid: 'uuid-1' }, 'uuid-1']])
})

test('a label the export creates says created in its sent entry and keeps it when the lookup confirms it', async () => {
  const { root, store } = storeOf()
  const seen = []
  const writer = fakeWriter({ unconfirmed: { at: 1, applied: true }, onCreate: (rec) => seen.push(readMap(root, FILE).records.label[rec.key]) })
  await runPlan({ plan: planOf({ label: [record('type:bug')] }), store, writer, known: {}, now })
  assert.deepEqual(seen, [{ state: 'sent', uuid: 'uuid-1', created: true }])
  assert.equal(store.entry('label', 'type:bug').state, 'done')
  assert.equal(store.entry('label', 'type:bug').created, true)
})

test('the reserve stops the run before a write', async () => {
  const reset = '2026-10-28T21:06:00Z'
  for (const rates of [
    [{ requests: { remaining: 101, resetAt: reset } }, { requests: { remaining: 100, resetAt: reset } }],
    [{ requests: { remaining: 2000, resetAt: reset }, complexity: { remaining: 10001 } }, { requests: { remaining: 2000, resetAt: reset }, complexity: { remaining: 10000 } }],
  ]) {
    const { root, store } = storeOf()
    const writer = fakeWriter({ rates })
    await assert.rejects(runPlan({ plan: planOf(three()), store, writer, known: {}, now }), (error) => {
      assert.equal(error.code, 'RATE_LIMITED')
      assert.equal(error.message, "stopped before Linear's request limit: 1 of 3 records are done")
      assert.equal(error.nextStep, `Run the same command again after ${reset} to resume`)
      assert.deepEqual(error.written, { done: 1, total: 3 })
      return true
    })
    assert.equal(creates(writer).length, 1)
    assert.equal(readMap(root, FILE).records.issue['ISS-1'].state, 'done')
    assert.equal(readMap(root, FILE).records.issue['ISS-2'], undefined)
  }
})

test('no headers means no reserve stop', async () => {
  const { store } = storeOf()
  const writer = fakeWriter({ rates: [null] })
  assert.deepEqual(await runPlan({ plan: planOf(three()), store, writer, known: {}, now }), { done: 3, total: 3 })
  assert.equal(creates(writer).length, 3)
})

test('checkExpect refuses a changed plan before any write', () => {
  const plan = planOf(three())
  assert.doesNotThrow(() => checkExpect(plan, plan.digest))
  assert.doesNotThrow(() => checkExpect(plan, undefined))
  assert.throws(() => checkExpect(plan, 'sha256:0000'), (error) => {
    assert.equal(error.code, 'CONFLICT')
    assert.equal(error.message, 'the plan changed since the preview')
    assert.equal(error.nextStep, 'Run the dry run again and confirm the new preview')
    return true
  })
})

test('finish sets finished when every record is done', async () => {
  const { root, store } = storeOf()
  await runPlan({ plan: planOf(three()), store, writer: fakeWriter(), known: {}, now })
  assert.equal(readMap(root, FILE).finished, now())
})

test('refs resolve to the UUID of the parent created earlier in the run', async () => {
  const { store } = storeOf()
  const writer = fakeWriter()
  const records = {
    epic: [record('EPC-1')],
    issue: [record('ISS-1', { projectId: { kind: 'epic', key: 'EPC-1' } }), record('ISS-2', { parentId: { kind: 'issue', key: 'ISS-1' }, labelIds: [{ kind: 'label', key: 'x' }] })],
    label: [record('x')],
  }
  await runPlan({ plan: planOf(records), store, writer, known: {}, now })
  const byKey = Object.fromEntries(creates(writer).map((call) => [`${call.kind} ${call.key}`, call]))
  assert.equal(byKey['issue ISS-1'].fields.projectId, byKey['epic EPC-1'].chosenId)
  assert.equal(byKey['issue ISS-2'].fields.parentId, byKey['issue ISS-1'].chosenId)
  assert.deepEqual(byKey['issue ISS-2'].fields.labelIds, [byKey['label x'].chosenId])
})

test('resolveFields adds resolved refs to ids the fields already hold, and reads finished maps', () => {
  const { store } = storeOf()
  const known = { label: { old: { uuid: 'u-old', id: 'u-old' } }, issue: { 'ISS-1': { uuid: 'u-iss', id: 'ACME-1' } } }
  const fields = resolveFields({ key: 'ISS-9', fields: { labelIds: ['team-label'] }, refs: { labelIds: [{ kind: 'label', key: 'old' }], parentId: { kind: 'issue', key: 'ISS-1' } } }, store, known)
  assert.deepEqual(fields, { labelIds: ['team-label', 'u-old'], parentId: 'u-iss' })
})
