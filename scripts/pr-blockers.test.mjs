import assert from 'node:assert/strict'
import test from 'node:test'
import { PmkitError } from './lib/errors.mjs'
import { collectBlockers } from './lib/pr-blockers.mjs'

const OPEN_PR = { number: 7, state: 'OPEN', isDraft: false, title: 'T', url: 'https://x/7' }
const thread = (over = {}) => ({ isResolved: false, isOutdated: false, path: 'a.js', line: 3, url: 'https://x/t', author: 'bob', body: 'fix', ...over })

/** A stub host. Each read is the value, or a function that throws. */
function stub(over = {}) {
  const calls = []
  const reads = {
    prChecks: [],
    prReviews: { reviews: [], reviewRequests: [] },
    prMergeState: { mergeable: 'MERGEABLE', mergeStateStatus: 'CLEAN', reviewDecision: '', baseRefName: 'main' },
    prThreads: { threads: [], incomplete: false },
    branchProtection: null,
    ...over,
  }
  const host = {}
  for (const [name, value] of Object.entries(reads)) {
    host[name] = (...args) => {
      calls.push(name)
      if (value instanceof Error) throw value
      return value
    }
  }
  return { host, calls }
}

test('a clean pull request is not blocked and every section is empty', () => {
  const r = collectBlockers(stub().host, OPEN_PR)
  assert.equal(r.blocked, false)
  assert.deepEqual(r.checks, { failing: [], pending: [] })
  assert.deepEqual(r.conflicts, { mergeable: 'MERGEABLE', mergeStateStatus: 'CLEAN', conflicting: false, behind: false })
  assert.deepEqual(r.threads, { open: [], incomplete: false })
  assert.deepEqual(r.unchecked, [])
})

test('failing, cancelled and pending checks are told apart', () => {
  const prChecks = [{ name: 'a', bucket: 'fail' }, { name: 'b', bucket: 'cancel' }, { name: 'c', bucket: 'pending' }, { name: 'd', bucket: 'pass' }]
  const r = collectBlockers(stub({ prChecks }).host, OPEN_PR)
  assert.deepEqual(r.checks.failing.map((c) => c.name), ['a', 'b'])
  assert.deepEqual(r.checks.pending.map((c) => c.name), ['c'])
  assert.equal(r.blocked, true)
})

test('only the latest review of each author counts for changes requested, and a dismissal clears it', () => {
  const reviews = [
    { author: { login: 'ann' }, state: 'CHANGES_REQUESTED' }, { author: { login: 'ann' }, state: 'APPROVED' },
    { author: { login: 'bob' }, state: 'CHANGES_REQUESTED' }, { author: { login: 'bob' }, state: 'COMMENTED' },
    { author: { login: 'cy' }, state: 'CHANGES_REQUESTED' }, { author: { login: 'cy' }, state: 'DISMISSED' },
  ]
  const reviewRequests = [{ __typename: 'User', login: 'dee' }, { __typename: 'Team', name: 'core', slug: 'core' }]
  const r = collectBlockers(stub({ prReviews: { reviews, reviewRequests }, prMergeState: { mergeable: 'MERGEABLE', mergeStateStatus: 'BLOCKED', reviewDecision: 'CHANGES_REQUESTED', baseRefName: 'main' } }).host, OPEN_PR)
  assert.deepEqual(r.reviews.changesRequested, ['bob'])
  assert.deepEqual(r.reviews.requested, ['dee', 'core'])
  assert.equal(r.reviews.decision, 'CHANGES_REQUESTED')
  assert.equal(r.blocked, true)
})

test('conflicting and behind are conflicts', () => {
  const state = (mergeable, mergeStateStatus) => collectBlockers(stub({ prMergeState: { mergeable, mergeStateStatus, reviewDecision: '', baseRefName: 'main' } }).host, OPEN_PR).conflicts
  assert.equal(state('CONFLICTING', 'DIRTY').conflicting, true)
  assert.equal(state('MERGEABLE', 'BEHIND').behind, true)
  assert.equal(state('UNKNOWN', 'UNKNOWN').conflicting, false)
})

test('open threads skip resolved and outdated ones and keep the page flag', () => {
  const prThreads = { threads: [thread(), thread({ isResolved: true }), thread({ isOutdated: true })], incomplete: true }
  const r = collectBlockers(stub({ prThreads }).host, OPEN_PR)
  assert.equal(r.threads.open.length, 1)
  assert.equal(r.threads.open[0].path, 'a.js')
  assert.equal(r.threads.incomplete, true)
  assert.equal(r.blocked, true)
})

test('policies: unmet approvals, unmet required checks and open conversations', () => {
  const protection = {
    required_pull_request_reviews: { required_approving_review_count: 2 },
    required_status_checks: { contexts: ['build'], checks: [{ context: 'lint' }] },
    required_conversation_resolution: { enabled: true },
  }
  const prReviews = { reviews: [{ author: { login: 'ann' }, state: 'APPROVED' }], reviewRequests: [] }
  const prChecks = [{ name: 'lint', bucket: 'pass' }]
  const r = collectBlockers(stub({ branchProtection: protection, prReviews, prChecks, prThreads: { threads: [thread()], incomplete: false } }).host, OPEN_PR)
  assert.equal(r.policies.protected, true)
  assert.equal(r.policies.requiredApprovals, 2)
  assert.equal(r.policies.approvals, 1)
  assert.deepEqual(r.policies.requiredChecks, ['build', 'lint'])
  assert.deepEqual(r.policies.unmet, ['needs 1 more approval (1 of 2)', 'required check build does not pass', 'conversation resolution is required and 1 thread is open'])
})

test('an unprotected branch is a policy read, not an unchecked one', () => {
  const r = collectBlockers(stub().host, OPEN_PR)
  assert.deepEqual(r.policies, { protected: false, requiredApprovals: null, approvals: 0, requiredChecks: [], unmet: [], draft: false })
  assert.deepEqual(r.unchecked, [])
})

test('a draft pull request is a policy blocker', () => {
  const r = collectBlockers(stub().host, { ...OPEN_PR, isDraft: true })
  assert.equal(r.policies.draft, true)
  assert.equal(r.blocked, true)
})

test('a refused read gives a null section and one unchecked entry, and the rest still comes back', () => {
  const refused = new PmkitError('UPSTREAM', 'gh api failed: HTTP 403', 'Check the token')
  const r = collectBlockers(stub({ prThreads: refused, branchProtection: refused, prChecks: [{ name: 'a', bucket: 'fail' }] }).host, OPEN_PR)
  assert.equal(r.threads, null)
  assert.equal(r.policies, null)
  assert.deepEqual(r.unchecked.map((u) => [u.area, u.code]), [['threads', 'UPSTREAM'], ['policies', 'UPSTREAM']])
  assert.equal(r.unchecked[0].message, 'gh api failed: HTTP 403')
  assert.equal(r.checks.failing.length, 1)
  assert.equal(r.blocked, true)
})

test('AUTH and RATE_LIMITED still fail the whole read', () => {
  for (const code of ['AUTH', 'RATE_LIMITED', 'NOT_CONFIGURED']) {
    assert.throws(() => collectBlockers(stub({ prThreads: new PmkitError(code, 'x', 'y') }).host, OPEN_PR), (e) => e.code === code)
  }
})

test('a merged or closed pull request makes no read and is not blocked', () => {
  for (const state of ['MERGED', 'CLOSED']) {
    const { host, calls } = stub()
    const r = collectBlockers(host, { ...OPEN_PR, state })
    assert.equal(r.blocked, false)
    assert.equal(r.state, state)
    assert.deepEqual(calls, [])
    assert.equal(r.checks, null)
  }
})
