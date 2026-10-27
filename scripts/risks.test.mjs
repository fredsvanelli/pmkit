import { test } from 'node:test'
import assert from 'node:assert/strict'
import { blockedIssues, epicRisks, failingPullRequests, failingWorkflows, needsPrLookup, prsByBranch, risksText, stalledIssues, stalledPullRequests } from './lib/risks.mjs'

const TODAY = '2026-10-26' // a Monday
const issue = (id, category, extra = {}) => ({
  id, title: `Title ${id}`, status: { name: category, category }, blockedBy: [], archived: false,
  created: '2026-10-01T00:00:00Z', updated: '2026-10-01T00:00:00Z', ...extra,
})
const ev = (at) => ({ at, by: 'fred', op: 'update' })
const byIdOf = (list) => new Map(list.map((item) => [item.id, item]))
const stalledOpts = (extra = {}) => ({ eventsByIssue: {}, openPrsByBranch: {}, closedPrsByBranch: {}, today: TODAY, stuckBusinessDays: 3, ...extra })
const epic = (id, category, extra = {}) => ({ id, title: `Epic ${id}`, status: { name: category, category }, ...extra })
const update = (at, health = 'on_track') => ({ at, health })
const epicOpts = (updatesByEpic) => ({ updatesByEpic, today: TODAY, windowDays: 14 })
const baseReport = (extra = {}) => ({
  today: '2026-10-23',
  thresholds: { stuckBusinessDays: 3, statusUpdateWindowDays: 14 },
  gitHost: { system: 'github', available: true },
  blocked: [], stalledIssues: [], stalledPullRequests: [], epics: [],
  ci: { defaultBranch: { branch: 'main', workflows: 2, failing: [] }, pullRequests: [] },
  problems: [],
  ...extra,
})
const blockedOpts = (list, extra = {}) => ({ byId: byIdOf(list), problemsById: new Map(), activeSprintId: null, ...extra })

test('blockedIssues names each open blocker, a missing one and an unreadable one', () => {
  const list = [
    issue('A', 'in_progress', { blockedBy: ['B', 'C', 'D', 'E'], assignee: 'fred', estimate: 3 }),
    issue('B', 'todo'),
    issue('C', 'done'),
  ]
  const result = blockedIssues(list, blockedOpts(list, { problemsById: new Map([['E', 'CONFLICT']]) }))
  assert.deepEqual(result, [{
    id: 'A', title: 'Title A', status: 'in_progress', assignee: 'fred', estimate: 3,
    blockers: [{ id: 'B', category: 'todo' }, { id: 'D', error: 'NOT_FOUND' }, { id: 'E', error: 'CONFLICT' }],
  }])
})

test('blockedIssues keeps a backlog issue only when it is in the active sprint', () => {
  const list = [
    issue('F', 'backlog', { sprint: 'S1', blockedBy: ['B'] }),
    issue('G', 'backlog', { blockedBy: ['B'] }),
    issue('B', 'todo'),
  ]
  assert.deepEqual(blockedIssues(list, blockedOpts(list, { activeSprintId: 'S1' })).map((row) => row.id), ['F'])
  assert.deepEqual(blockedIssues(list, blockedOpts(list, { activeSprintId: null })).map((row) => row.id), [])
})

test('blockedIssues leaves out a done, an archived and a fully unblocked issue', () => {
  const list = [
    issue('H', 'done', { blockedBy: ['B'] }),
    issue('I', 'in_progress', { archived: true, blockedBy: ['B'] }),
    issue('J', 'in_progress', { blockedBy: ['C'] }),
    issue('B', 'todo'),
    issue('C', 'canceled'),
  ]
  assert.deepEqual(blockedIssues(list, blockedOpts(list)), [])
  const withK = [...list, issue('K', 'todo', { blockedBy: ['B'] })]
  const [row] = blockedIssues(withK, blockedOpts(withK))
  assert.equal(row.id, 'K')
  assert.equal(row.assignee, null)
  assert.equal(row.estimate, null)
})

test('stalledIssues lists an issue idle for more than N business days and not one idle for N', () => {
  const list = [issue('S', 'in_progress'), issue('T', 'in_review')]
  const eventsByIssue = { S: [ev('2026-10-20T10:00:00Z')], T: [ev('2026-10-21T10:00:00Z')] }
  assert.deepEqual(stalledIssues(list, stalledOpts({ eventsByIssue })), [{
    id: 'S', title: 'Title S', status: 'in_progress', assignee: null, estimate: null,
    lastActivity: '2026-10-20T10:00:00Z', idleBusinessDays: 4, reason: 'idle', pr: null,
  }])
})

test('stalledIssues counts across a weekend', () => {
  const list = [issue('U', 'in_progress')]
  assert.deepEqual(stalledIssues(list, stalledOpts({ eventsByIssue: { U: [ev('2026-10-23T18:00:00Z')] } })), [])
})

test('stalledIssues counts the open pull request of the branch as activity', () => {
  const list = [issue('V', 'in_progress', { branch: 'feat-v' })]
  const eventsByIssue = { V: [ev('2026-10-14T10:00:00Z')] }
  const recent = { 'feat-v': { number: 5, updatedAt: '2026-10-23T10:00:00Z' } }
  assert.deepEqual(stalledIssues(list, stalledOpts({ eventsByIssue, openPrsByBranch: recent })), [])
  const old = { 'feat-v': { number: 5, updatedAt: '2026-10-15T10:00:00Z' } }
  const [row] = stalledIssues(list, stalledOpts({ eventsByIssue, openPrsByBranch: old }))
  assert.equal(row.lastActivity, '2026-10-15T10:00:00Z')
  assert.equal(row.idleBusinessDays, 7)
  assert.equal(row.pr, 5)
})

test('stalledIssues lists pr_merged and pr_closed whatever the idle days', () => {
  const list = [issue('M', 'in_review', { branch: 'm' }), issue('C2', 'in_review', { branch: 'c' }), issue('P', 'in_progress', { branch: 'p' })]
  const recent = [ev('2026-10-26T09:00:00Z')]
  const eventsByIssue = { M: recent, C2: recent, P: recent }
  const closedPrsByBranch = {
    m: { number: 7, state: 'MERGED', mergedAt: '2026-10-25T10:00:00Z' },
    c: { number: 8, state: 'CLOSED', mergedAt: null },
    p: { number: 9, state: 'MERGED', mergedAt: '2026-10-25T10:00:00Z' },
  }
  const rows = stalledIssues(list, stalledOpts({ eventsByIssue, closedPrsByBranch }))
  assert.deepEqual(rows.map((row) => [row.id, row.reason, row.pr, row.idleBusinessDays]), [['M', 'pr_merged', 7, 0], ['C2', 'pr_closed', 8, 0]])
})

test('stalledIssues uses updated when an issue has no events', () => {
  const list = [issue('W', 'in_progress', { updated: '2026-10-20T00:00:00Z' })]
  const [row] = stalledIssues(list, stalledOpts())
  assert.equal(row.lastActivity, '2026-10-20T00:00:00Z')
  assert.equal(row.idleBusinessDays, 4)
})

test('stalledIssues takes the newest event by instant, not the last line', () => {
  const list = [issue('X', 'in_progress')]
  const eventsByIssue = { X: [ev('2026-10-23T10:00:00Z'), ev('2026-10-14T10:00:00Z')] }
  assert.deepEqual(stalledIssues(list, stalledOpts({ eventsByIssue })), [])
})

test('stalledIssues leaves out todo, done and archived issues', () => {
  const list = [issue('Y1', 'todo'), issue('Y2', 'done'), issue('Y3', 'in_progress', { archived: true })]
  const old = [ev('2026-10-01T10:00:00Z')]
  assert.deepEqual(stalledIssues(list, stalledOpts({ eventsByIssue: { Y1: old, Y2: old, Y3: old } })), [])
})

test('prsByBranch keeps the newest pull request of a branch', () => {
  const map = prsByBranch([
    { number: 1, headRefName: 'b', updatedAt: '2026-10-20T10:00:00Z' },
    { number: 2, headRefName: 'b', updatedAt: '2026-10-22T10:00:00Z' },
    { number: 3, headRefName: 'c', updatedAt: '2026-10-01T10:00:00Z' },
  ])
  assert.equal(map.b.number, 2)
  assert.equal(map.c.number, 3)
  const reversed = prsByBranch([
    { number: 2, headRefName: 'b', updatedAt: '2026-10-22T10:00:00Z' },
    { number: 1, headRefName: 'b', updatedAt: '2026-10-20T10:00:00Z' },
  ])
  assert.equal(reversed.b.number, 2)
})

test('needsPrLookup returns idle in_review issues with a branch and no open pull request', () => {
  const old = [ev('2026-10-20T10:00:00Z')]
  const list = [
    issue('R1', 'in_review', { branch: 'r1' }),
    issue('R2', 'in_review', { branch: 'r2' }),
    issue('R3', 'in_review'),
    issue('R4', 'in_review', { branch: 'r4' }),
    issue('R5', 'in_progress', { branch: 'r5' }),
  ]
  const eventsByIssue = { R1: old, R2: old, R3: old, R4: [ev('2026-10-26T10:00:00Z')], R5: old }
  const openPrsByBranch = { r2: { number: 2, headRefName: 'r2', updatedAt: '2026-10-01T10:00:00Z' } }
  const result = needsPrLookup(list, { eventsByIssue, openPrsByBranch, today: TODAY, stuckBusinessDays: 3 })
  assert.deepEqual(result.map((item) => item.id), ['R1'])
})

test('stalledPullRequests lists idle pull requests by number, drafts included, with the linked issue', () => {
  const prs = [
    { number: 12, title: 'Old', url: 'u12', headRefName: 'feat-x', isDraft: false, updatedAt: '2026-10-15T10:00:00Z' },
    { number: 3, title: 'Fresh', url: 'u3', headRefName: 'feat-y', isDraft: false, updatedAt: '2026-10-23T10:00:00Z' },
    { number: 7, title: 'Draft', url: 'u7', headRefName: 'feat-z', isDraft: true, updatedAt: '2026-10-20T10:00:00Z' },
  ]
  const result = stalledPullRequests(prs, { issuesByBranch: { 'feat-x': 'ISS-3' }, today: TODAY, stuckBusinessDays: 3 })
  assert.deepEqual(result, [
    { number: 7, title: 'Draft', url: 'u7', branch: 'feat-z', isDraft: true, updatedAt: '2026-10-20T10:00:00Z', idleBusinessDays: 4, issue: null },
    { number: 12, title: 'Old', url: 'u12', branch: 'feat-x', isDraft: false, updatedAt: '2026-10-15T10:00:00Z', idleBusinessDays: 7, issue: 'ISS-3' },
  ])
})

test('epicRisks flags a target before today and not one on today', () => {
  const epics = [epic('E1', 'in_progress', { target: '2026-10-25' }), epic('E2', 'in_progress', { target: '2026-10-26' })]
  const recent = [update('2026-10-20T10:00:00Z')]
  assert.deepEqual(epicRisks(epics, epicOpts({ E1: recent, E2: recent })), [{
    id: 'E1', title: 'Epic E1', status: 'in_progress', target: '2026-10-25',
    lastUpdate: { at: '2026-10-20T10:00:00Z', health: 'on_track' }, reasons: ['late'],
  }])
})

test('epicRisks lists the health of the newest update', () => {
  const epics = [epic('E3', 'in_progress'), epic('E4', 'in_progress', { target: '2026-10-01' })]
  const updatesByEpic = {
    E3: [update('2026-10-20T10:00:00Z', 'off_track'), update('2026-10-10T10:00:00Z', 'at_risk')],
    E4: [update('2026-10-20T10:00:00Z', 'at_risk')],
  }
  assert.deepEqual(epicRisks(epics, epicOpts(updatesByEpic)).map((row) => [row.id, row.reasons]), [['E3', ['off_track']], ['E4', ['late', 'at_risk']]])
})

test('epicRisks flags an update older than W days and not one W days old', () => {
  const epics = [epic('E5', 'in_progress'), epic('E6', 'in_progress')]
  const updatesByEpic = { E5: [update('2026-10-11T10:00:00Z')], E6: [update('2026-10-12T10:00:00Z')] }
  assert.deepEqual(epicRisks(epics, epicOpts(updatesByEpic)).map((row) => [row.id, row.reasons]), [['E5', ['no_recent_update']]])
})

test('epicRisks gives a new in_progress epic W days to report', () => {
  const epics = [
    epic('N1', 'in_progress', { start: '2026-10-20' }),
    epic('N2', 'in_progress', { start: '2026-10-12' }),
    epic('N3', 'in_progress', { start: '2026-10-11' }),
    epic('N4', 'in_progress'),
  ]
  const rows = epicRisks(epics, epicOpts({}))
  assert.deepEqual(rows.map((row) => [row.id, row.reasons]), [['N3', ['no_recent_update']], ['N4', ['no_recent_update']]])
  assert.equal(rows[1].lastUpdate, null)
})

test('epicRisks checks an epic in another open category only when it started more than W days ago', () => {
  const epics = [epic('O1', 'todo', { start: '2026-10-01' }), epic('O2', 'todo', { start: '2026-10-20' }), epic('O3', 'todo')]
  assert.deepEqual(epicRisks(epics, epicOpts({})).map((row) => [row.id, row.reasons]), [['O1', ['no_recent_update']]])
})

test('epicRisks leaves out done and canceled epics, and one with no reason', () => {
  const epics = [
    epic('D1', 'done', { target: '2026-10-01' }),
    epic('D2', 'canceled', { target: '2026-10-01' }),
    epic('D3', 'in_progress'),
    epic('D4', 'in_progress'),
  ]
  const rows = epicRisks(epics, epicOpts({ D3: [update('2026-10-20T10:00:00Z')], D4: [update('2026-10-20T10:00:00Z', 'at_risk')] }))
  assert.deepEqual(rows.map((row) => row.id), ['D4'])
  assert.equal(rows[0].target, null)
})

test('failingWorkflows takes the newest completed run of each workflow', () => {
  const testNew = { workflowName: 'test', status: 'completed', conclusion: 'success', createdAt: '2026-10-22T10:00:00Z' }
  const testOld = { workflowName: 'test', status: 'completed', conclusion: 'failure', createdAt: '2026-10-21T10:00:00Z' }
  const rest = [
    { workflowName: 'lint', status: 'in_progress', conclusion: '', createdAt: '2026-10-23T10:00:00Z' },
    { workflowName: 'lint', status: 'completed', conclusion: 'timed_out', createdAt: '2026-10-20T10:00:00Z', url: 'ul', headSha: 'abc' },
    { workflowName: 'deploy', status: 'completed', conclusion: 'cancelled', createdAt: '2026-10-20T10:00:00Z' },
  ]
  const expected = { workflows: 3, failing: [{ workflow: 'lint', conclusion: 'timed_out', url: 'ul', createdAt: '2026-10-20T10:00:00Z', headSha: 'abc' }] }
  assert.deepEqual(failingWorkflows([testNew, testOld, ...rest]), expected)
  assert.deepEqual(failingWorkflows([testOld, testNew, ...rest]), expected)
})

test('failingWorkflows counts startup_failure and returns zero workflows for no runs', () => {
  assert.deepEqual(failingWorkflows([]), { workflows: 0, failing: [] })
  const run = { workflowName: 'ci', status: 'completed', conclusion: 'startup_failure', createdAt: '2026-10-20T10:00:00Z', url: 'u', headSha: 's' }
  assert.deepEqual(failingWorkflows([run]).failing.map((row) => row.workflow), ['ci'])
})

test('failingPullRequests names failing check runs and status contexts', () => {
  const prs = [
    { number: 14, title: 'T14', url: 'u14', statusCheckRollup: [
      { __typename: 'CheckRun', name: 'lint', status: 'COMPLETED', conclusion: 'FAILURE' },
      { __typename: 'StatusContext', context: 'ci/legacy', state: 'ERROR' },
      { __typename: 'CheckRun', name: 'test', status: 'COMPLETED', conclusion: 'SUCCESS' },
      { __typename: 'CheckRun', name: 'lint', status: 'COMPLETED', conclusion: 'FAILURE' },
    ] },
    { number: 2, title: 'T2', url: 'u2', statusCheckRollup: [{ name: 'e2e', conclusion: 'ACTION_REQUIRED' }] },
    { number: 5, title: 'T5', url: 'u5', statusCheckRollup: null },
    { number: 6, title: 'T6', url: 'u6', statusCheckRollup: [{ context: 'ok', state: 'SUCCESS' }, { name: 'slow', status: 'IN_PROGRESS', conclusion: '' }] },
  ]
  assert.deepEqual(failingPullRequests(prs), [
    { number: 2, title: 'T2', url: 'u2', failing: ['e2e'] },
    { number: 14, title: 'T14', url: 'u14', failing: ['lint', 'ci/legacy'] },
  ])
})

test('risksText starts with the date, the thresholds and the git host', () => {
  const lines = risksText(baseReport()).split('\n')
  assert.equal(lines[0], 'risks on 2026-10-23: stalled after 3 business days without activity, status updates due every 14 days')
  assert.equal(lines[1], 'git host: github')
})

test('risksText says none for an empty list', () => {
  const text = risksText(baseReport())
  assert.ok(text.includes('\n\nblocked issues\nnone\n\nstalled issues\nnone\n\nstalled pull requests\nnone\n\nepics at risk\nnone\n\nfailing CI on main\nnone\n\npull requests with failing checks\nnone'), text)
  assert.ok(!text.endsWith('\n'))
})

test('risksText without a git host says why and marks the host lists as not checked', () => {
  const reason = { code: 'NOT_SUPPORTED', message: 'this repository has no git host configured', nextStep: 'x' }
  const text = risksText(baseReport({ gitHost: { system: 'none', available: false, reason }, stalledPullRequests: null, ci: null }))
  assert.equal(text.split('\n')[1], 'git host: none, so issues are stalled by tracker activity only and PRs and CI are not checked')
  assert.ok(text.includes('stalled pull requests\nnot checked: this repository has no git host configured'), text)
  assert.ok(text.includes('failing CI on default branch\nnot checked: this repository has no git host configured'), text)
  assert.ok(text.includes('pull requests with failing checks\nnot checked: this repository has no git host configured'), text)
})

test('risksText names an unavailable host and its reason', () => {
  const reason = { code: 'AUTH', message: 'GitHub CLI is not logged in', nextStep: 'gh auth login' }
  const text = risksText(baseReport({ gitHost: { system: 'github', available: false, reason }, stalledPullRequests: null, ci: null }))
  assert.equal(text.split('\n')[1], 'git host: github is not available (GitHub CLI is not logged in), so issues are stalled by tracker activity only and PRs and CI are not checked')
})

test('risksText shows a failed list with its error', () => {
  const failed = risksText(baseReport({ ci: { defaultBranch: { branch: 'main', error: { code: 'UPSTREAM', message: 'gh run list failed: boom' } }, pullRequests: [] } }))
  assert.ok(failed.includes('failing CI on main\nnot checked: gh run list failed: boom'), failed)
  const empty = risksText(baseReport({ ci: { defaultBranch: { branch: 'main', workflows: 0, failing: [] }, pullRequests: [] } }))
  assert.ok(empty.includes('failing CI on main\nnone, no workflow runs on main'), empty)
})

test('risksText prints a table with a count for a list with rows', () => {
  const blocked = [{ id: 'ISS-1', title: 'T', status: 'in_progress', assignee: null, estimate: 3, blockers: [{ id: 'ISS-2', category: 'todo' }, { id: 'ISS-9', error: 'NOT_FOUND' }] }]
  const text = risksText(baseReport({ blocked }))
  const block = text.split('\n\n').find((part) => part.startsWith('blocked issues'))
  assert.ok(block.startsWith('blocked issues (1)\nID '), block)
  assert.equal(block.split('\n')[1].replace(/ +/g, ' '), 'ID | Title | Status | Assignee | Estimate | Blocked by')
  assert.ok(text.includes('ISS-2 (todo), ISS-9 (NOT_FOUND)'), text)
})

test('risksText adds the pr sync note under a pr_merged row', () => {
  const row = (reason, pr) => ({ id: 'ISS-1', title: 'T', status: 'in_review', assignee: 'ana', estimate: 2, lastActivity: '2026-10-19T10:00:00Z', idleBusinessDays: 4, reason, pr })
  const merged = risksText(baseReport({ stalledIssues: [row('pr_merged', 9)] }))
  assert.ok(merged.includes('#9'), merged)
  assert.ok(merged.split('\n').includes('pr_merged: the pull request is merged; pmkit pr sync moves the issue to done'), merged)
  const idle = risksText(baseReport({ stalledIssues: [row('idle', null)] }))
  assert.ok(!idle.includes('pr_merged:'), idle)
})
