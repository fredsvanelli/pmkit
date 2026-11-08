import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildReadiness, chooseReadinessBasis } from './release-readiness.mjs'

const rel = (id, state = 'planned', tag) => ({ id, state, tag })
const ms = (id, due) => ({ id, name: id, due })
const base = { selector: null, releases: null, milestones: [], openMilestones: new Set(), activeSprint: null }

test('a selector wins and is requested', () => {
  const choice = chooseReadinessBasis({ ...base, selector: { milestone: ms('beta') } })
  assert.deepEqual([choice.basis, choice.reason, choice.skipped], ['milestone', 'requested', []])
})

test('the first planned release is the next one', () => {
  const choice = chooseReadinessBasis({ ...base, releases: [rel('1.0', 'released'), rel('1.1'), rel('1.2')] })
  assert.deepEqual([choice.basis, choice.reason, choice.source.id], ['release', 'next_planned', '1.1'])
})

test('without releases it takes the milestone due first that has an open issue, and says why', () => {
  const choice = chooseReadinessBasis({ ...base, milestones: [ms('late', '2026-12-01'), ms('none'), ms('done', '2026-01-01'), ms('soon', '2026-11-01')], openMilestones: new Set(['late', 'none', 'soon']) })
  assert.deepEqual([choice.basis, choice.reason, choice.source.id], ['milestone', 'earliest_due_milestone', 'soon'])
  assert.deepEqual(choice.skipped, [{ basis: 'release', reason: 'releases_absent' }])
})

test('planned releases all released: skip with no_planned_release; undated milestone sorts last', () => {
  const choice = chooseReadinessBasis({ ...base, releases: [rel('1.0', 'released')], milestones: [ms('a'), ms('b', '2026-12-01')], openMilestones: new Set(['a', 'b']) })
  assert.equal(choice.source.id, 'b')
  assert.deepEqual(choice.skipped, [{ basis: 'release', reason: 'no_planned_release' }])
})

test('then the active sprint, and null when nothing is left', () => {
  const sprint = { id: 's1' }
  const choice = chooseReadinessBasis({ ...base, activeSprint: sprint })
  assert.deepEqual([choice.basis, choice.reason], ['sprint', 'active_sprint'])
  assert.deepEqual(choice.skipped.map((s) => [s.basis, s.reason]), [['release', 'releases_absent'], ['milestone', 'no_open_milestone']])
  const none = chooseReadinessBasis(base)
  assert.equal(none.basis, null)
  assert.equal(none.skipped.at(-1).basis, 'sprint')
})

const issue = (id, category, branch) => ({ id, title: id, status: { name: category, category }, assignee: null, estimate: null, branch, archived: false })
const pr = (number, headRefName, extra = {}) => ({ number, title: `PR ${number}`, url: `u${number}`, isDraft: false, headRefName, updatedAt: '2026-10-01T00:00:00Z', statusCheckRollup: [], ...extra })
const choice = { basis: 'release', reason: 'next_planned', source: { id: '1.1', tag: 'v1.1' }, skipped: [] }
const host = { system: 'github', available: true }
const build = (over) => buildReadiness({ choice, issues: [], prs: [], prsIncomplete: false, deploys: [], gitHost: host, problems: [], ...over })

test('lists open issues, the PRs of basis issues and flags deploys of the release tag', () => {
  const data = build({
    issues: [issue('A-1', 'in_review', 'a1'), issue('A-2', 'done', 'a2'), issue('A-3', 'canceled')],
    prs: [pr(1, 'a1'), pr(2, 'other')],
    deploys: [{ ref: 'v1.1', environment: 'prod', state: 'success' }, { ref: 'main', environment: 'stage', state: 'success' }],
  })
  assert.deepEqual(data.issues.open.map((i) => i.id), ['A-1'])
  assert.deepEqual(data.issues.counts, { open: 1, done: 1, canceled: 1, total: 3 })
  assert.deepEqual(data.pullRequests.map((p) => [p.number, p.issue]), [[1, 'A-1']])
  assert.deepEqual(data.deploys.map((d) => d.matchesRelease), [true, false])
  assert.equal(data.ready, false)
})

test('ready is true only when nothing is open and everything was read', () => {
  assert.equal(build({ issues: [issue('A-1', 'done')] }).ready, true)
  assert.equal(build({ issues: [issue('A-1', 'done')], problems: [{ id: 'X' }] }).ready, null)
  assert.equal(build({ issues: [issue('A-1', 'done')], problems: [{ id: 'X' }] }).complete, false)
  assert.equal(build({ issues: [issue('A-1', 'done')], prsIncomplete: true }).ready, null)
})

test('no host: pull requests and deploys are null, ready is null, not true', () => {
  const data = build({ issues: [], prs: null, deploys: null, gitHost: { system: 'none', available: false } })
  assert.equal(data.pullRequests, null)
  assert.equal(data.deploys, null)
  assert.equal(data.ready, null)
})

test('a failed PR read is an error value, a failed deploy read does not block ready', () => {
  const data = build({ prs: { error: { code: 'UPSTREAM' } }, deploys: { error: { code: 'UPSTREAM' } } })
  assert.deepEqual(data.pullRequests, { error: { code: 'UPSTREAM' } })
  assert.equal(data.ready, null)
})

test('an open PR on a done issue still blocks', () => {
  const data = build({ issues: [issue('A-1', 'done', 'a1')], prs: [pr(1, 'a1')] })
  assert.equal(data.ready, false)
})

test('milestone basis never matches a deploy', () => {
  const data = build({ choice: { ...choice, basis: 'milestone', source: { id: 'beta' } }, deploys: [{ ref: 'v1.1' }] })
  assert.equal(data.deploys[0].matchesRelease, false)
})
