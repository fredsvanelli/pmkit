import assert from 'node:assert/strict'
import test from 'node:test'
import { PmkitError } from './lib/errors.mjs'
import { createGithubHost } from './lib/github/host.mjs'
import { blockersText, collectBlockers } from './lib/pr-blockers.mjs'

const OPEN_PR = { number: 7, state: 'OPEN', isDraft: false, title: 'T', url: 'https://x/7' }
const thread = (over = {}) => ({ isResolved: false, isOutdated: false, path: 'a.js', line: 3, url: 'https://x/t', author: 'bob', body: 'fix', ...over })
const merge = (over = {}) => ({ mergeable: 'MERGEABLE', mergeStateStatus: 'CLEAN', reviewDecision: '', baseRefName: 'main', ...over })
const areas = (list) => list.map((item) => item.area)
/** A refused read: the host marks the error with the HTTP status of the gh reply. */
const refusal = (status = 403, message = `gh api failed: HTTP ${status}`) => Object.assign(new PmkitError('UPSTREAM', message, 'x'), { httpStatus: status })

/** A stub host. Each read is the value, or an error that it throws. */
function stub(over = {}) {
  const calls = []
  const reads = {
    prChecks: [],
    prReviews: { reviews: [], reviewRequests: [] },
    prMergeState: merge(),
    prThreads: { threads: [], incomplete: false },
    branchProtection: null,
    ...over,
  }
  const host = {}
  for (const [name, value] of Object.entries(reads)) {
    host[name] = () => {
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
  assert.deepEqual(r.blocking, [])
  assert.deepEqual(r.pending, [])
  assert.deepEqual(r.unknown, [])
  assert.deepEqual(r.checks, { failing: [], pending: [] })
  assert.deepEqual(r.conflicts, { mergeable: 'MERGEABLE', mergeStateStatus: 'CLEAN', conflicting: false, behind: false, unknown: false })
  assert.deepEqual(r.threads, { open: [], outdated: [], incomplete: false })
  assert.deepEqual(r.unchecked, [])
})

test('failing, cancelled and pending checks are told apart', () => {
  const prChecks = [{ name: 'a', bucket: 'fail' }, { name: 'b', bucket: 'cancel' }, { name: 'c', bucket: 'pending' }, { name: 'd', bucket: 'pass' }]
  const r = collectBlockers(stub({ prChecks }).host, OPEN_PR)
  assert.deepEqual(r.checks.failing.map((c) => c.name), ['a', 'b'])
  assert.deepEqual(r.checks.pending.map((c) => c.name), ['c'])
})

test('checks the protection does not require are pending, and required ones block', () => {
  const prChecks = [{ name: 'lint', bucket: 'fail' }, { name: 'build', bucket: 'pending' }]
  const optional = collectBlockers(stub({ prChecks, branchProtection: { required_status_checks: { contexts: [] } } }).host, OPEN_PR)
  assert.equal(optional.blocked, false)
  assert.deepEqual(areas(optional.pending), ['checks', 'checks'])
  const required = collectBlockers(stub({ prChecks, branchProtection: { required_status_checks: { contexts: ['build'] } } }).host, OPEN_PR)
  assert.equal(required.blocked, true)
  assert.deepEqual(required.blocking.map((b) => b.message), ['required check build does not pass'])
  assert.deepEqual(areas(required.pending), ['checks'])
})

test('only the latest review of each author counts for changes requested, and a dismissal clears it', () => {
  const reviews = [
    { author: { login: 'ann' }, state: 'CHANGES_REQUESTED' }, { author: { login: 'ann' }, state: 'APPROVED' },
    { author: { login: 'bob' }, state: 'CHANGES_REQUESTED' }, { author: { login: 'bob' }, state: 'COMMENTED' },
    { author: { login: 'cy' }, state: 'CHANGES_REQUESTED' }, { author: { login: 'cy' }, state: 'DISMISSED' },
  ]
  const reviewRequests = [{ __typename: 'User', login: 'dee' }, { __typename: 'Team', name: 'core', slug: 'core' }]
  const r = collectBlockers(stub({ prReviews: { reviews, reviewRequests }, prMergeState: merge({ mergeStateStatus: 'BLOCKED', reviewDecision: 'CHANGES_REQUESTED' }) }).host, OPEN_PR)
  assert.deepEqual(r.reviews.changesRequested, ['bob'])
  assert.deepEqual(r.reviews.requested, ['dee', 'core'])
  assert.equal(r.reviews.decision, 'CHANGES_REQUESTED')
  assert.equal(r.blocked, true)
  assert.ok(r.blocking.some((b) => b.area === 'reviews' && /bob/.test(b.message)))
})

test('a requested reviewer nobody requires is pending, not blocking', () => {
  const prReviews = { reviews: [{ author: { login: 'ann' }, state: 'APPROVED' }, { author: { login: 'bob' }, state: 'APPROVED' }], reviewRequests: [{ __typename: 'User', login: 'cy' }] }
  const r = collectBlockers(stub({ prReviews, branchProtection: { required_pull_request_reviews: { required_approving_review_count: 1 } } }).host, OPEN_PR)
  assert.equal(r.blocked, false)
  assert.deepEqual(r.blocking, [])
  assert.deepEqual(areas(r.pending), ['reviews'])
})

test('conflicts block, and behind blocks only when the protection is strict', () => {
  const state = (over, branchProtection = null) => collectBlockers(stub({ prMergeState: merge(over), branchProtection }).host, OPEN_PR)
  const conflict = state({ mergeable: 'CONFLICTING', mergeStateStatus: 'DIRTY' })
  assert.equal(conflict.conflicts.conflicting, true)
  assert.equal(conflict.blocked, true)
  const loose = state({ mergeStateStatus: 'BEHIND' })
  assert.equal(loose.conflicts.behind, true)
  assert.equal(loose.blocked, false)
  assert.deepEqual(areas(loose.pending), ['conflicts'])
  const strict = state({ mergeStateStatus: 'BEHIND' }, { required_status_checks: { strict: true, contexts: [] } })
  assert.equal(strict.blocked, true)
  assert.deepEqual(areas(strict.blocking), ['conflicts'])
})

test('UNKNOWN merge state is not computed yet: not checked, and never blocked false', () => {
  const r = collectBlockers(stub({ prMergeState: merge({ mergeable: 'UNKNOWN', mergeStateStatus: 'UNKNOWN' }) }).host, OPEN_PR)
  assert.equal(r.conflicts.unknown, true)
  assert.equal(r.conflicts.conflicting, false)
  assert.equal(r.unchecked.length, 1)
  assert.equal(r.unchecked[0].area, 'conflicts')
  assert.match(r.unchecked[0].nextStep, /again in a few seconds/)
  assert.equal(r.blocked, null)
  const withBlocker = collectBlockers(stub({ prMergeState: merge({ mergeable: 'UNKNOWN', mergeStateStatus: 'UNKNOWN', reviewDecision: 'CHANGES_REQUESTED' }), prReviews: { reviews: [{ author: { login: 'a' }, state: 'CHANGES_REQUESTED' }], reviewRequests: [] } }).host, OPEN_PR)
  assert.equal(withBlocker.blocked, true)
})

test('open and outdated threads are listed apart and resolved ones are dropped', () => {
  const prThreads = { threads: [thread(), thread({ isResolved: true }), thread({ isOutdated: true, path: 'b.js' })], incomplete: true }
  const r = collectBlockers(stub({ prThreads }).host, OPEN_PR)
  assert.equal(r.threads.open.length, 1)
  assert.equal(r.threads.open[0].path, 'a.js')
  assert.deepEqual(r.threads.outdated.map((t) => t.path), ['b.js'])
  assert.equal(r.threads.incomplete, true)
  assert.equal(r.blocked, false)
  assert.deepEqual(areas(r.pending), ['threads'])
})

test('policies: unmet approvals, unmet required checks and unresolved conversations, outdated ones included', () => {
  const protection = {
    required_pull_request_reviews: { required_approving_review_count: 2 },
    required_status_checks: { contexts: ['build'], checks: [{ context: 'lint' }] },
    required_conversation_resolution: { enabled: true },
  }
  const prReviews = { reviews: [{ author: { login: 'ann' }, state: 'APPROVED' }], reviewRequests: [] }
  const prChecks = [{ name: 'lint', bucket: 'pass' }]
  const prThreads = { threads: [thread(), thread({ isOutdated: true })], incomplete: false }
  const r = collectBlockers(stub({ branchProtection: protection, prReviews, prChecks, prThreads }).host, OPEN_PR)
  assert.equal(r.policies.protected, true)
  assert.equal(r.policies.requiredApprovals, 2)
  assert.equal(r.policies.approvals, 1)
  assert.deepEqual(r.policies.requiredChecks, ['build', 'lint'])
  assert.deepEqual(r.policies.unmet, ['needs 1 more approval (1 of 2)', 'required check build does not pass', 'conversation resolution is required and 2 threads are unresolved'])
  assert.equal(r.blocked, true)
})

test('an outdated thread alone blocks when conversation resolution is required', () => {
  const prThreads = { threads: [thread({ isOutdated: true })], incomplete: false }
  const r = collectBlockers(stub({ prThreads, branchProtection: { required_conversation_resolution: { enabled: true } } }).host, OPEN_PR)
  assert.equal(r.blocked, true)
  assert.deepEqual(r.policies.unmet, ['conversation resolution is required and 1 thread is unresolved'])
})

test('an unprotected branch is a policy read, not an unchecked one', () => {
  const r = collectBlockers(stub().host, OPEN_PR)
  assert.deepEqual(r.policies, { protected: false, requiredApprovals: null, approvals: 0, requiredChecks: [], unmet: [], unreadRule: false })
  assert.deepEqual(r.unchecked, [])
})

test('BLOCKED with nothing else to explain it names a rule the command does not read', () => {
  const r = collectBlockers(stub({ prMergeState: merge({ mergeStateStatus: 'BLOCKED' }) }).host, OPEN_PR)
  assert.equal(r.policies.protected, false)
  assert.equal(r.policies.unreadRule, true)
  assert.equal(r.blocked, true)
  assert.match(r.blocking[0].message, /rule this command does not read.*ruleset/)
})

test('a draft pull request is its own blocker and does not depend on the protection read', () => {
  const clean = collectBlockers(stub().host, { ...OPEN_PR, isDraft: true })
  assert.equal(clean.draft, true)
  assert.equal(clean.blocked, true)
  assert.deepEqual(clean.blocking.map((b) => b.area), ['draft'])
  assert.equal('draft' in clean.policies, false)
  const refused = collectBlockers(stub({ branchProtection: refusal() }).host, { ...OPEN_PR, isDraft: true })
  assert.equal(refused.policies, null)
  assert.equal(refused.draft, true)
  assert.deepEqual(refused.blocking.map((b) => b.area), ['draft'])
})

test('a refused read gives a null section and one unchecked entry, and the rest still comes back', () => {
  const refused = refusal(403, 'gh api failed: Resource not accessible by integration (HTTP 403)')
  const r = collectBlockers(stub({ prThreads: refused, branchProtection: refused, prChecks: [{ name: 'a', bucket: 'fail' }] }).host, OPEN_PR)
  assert.equal(r.threads, null)
  assert.equal(r.policies, null)
  assert.deepEqual(r.unchecked.map((u) => [u.area, u.code]), [['threads', 'UPSTREAM'], ['policies', 'UPSTREAM']])
  assert.equal(r.checks.failing.length, 1)
  assert.deepEqual(r.pending, [], 'with the protection unread, nothing can be called not required')
  assert.deepEqual(r.unknown.map((u) => u.area), ['checks'])
  assert.equal(r.blocked, null)
})

test('with the protection unread, failing checks, requested reviewers and unresolved threads may block', () => {
  const r = collectBlockers(stub({
    branchProtection: refusal(),
    prChecks: [{ name: 'a', bucket: 'fail' }, { name: 'b', bucket: 'pending' }],
    prReviews: { reviews: [], reviewRequests: [{ __typename: 'User', login: 'dee' }] },
    prThreads: { threads: [thread(), thread({ isOutdated: true })], incomplete: false },
  }).host, OPEN_PR)
  assert.deepEqual(r.blocking, [])
  assert.deepEqual(r.pending, [])
  assert.deepEqual(r.unknown.map((u) => u.area), ['checks', 'checks', 'reviews', 'threads'])
  assert.equal(r.blocked, null)
})

test('with the protection unread, BLOCKED says GitHub blocks by a rule the command could not read', () => {
  const r = collectBlockers(stub({ branchProtection: refusal(), prMergeState: merge({ mergeStateStatus: 'BLOCKED' }) }).host, OPEN_PR)
  assert.equal(r.blocked, true)
  assert.match(r.blocking[0].message, /GitHub blocks the merge by a rule this command could not read \(branch protection or a ruleset\)/)
  assert.doesNotMatch(r.blocking[0].message, /for example/)
})

test('GitHub reviewDecision blocks even when the protection is unread', () => {
  for (const reviewDecision of ['CHANGES_REQUESTED', 'REVIEW_REQUIRED']) {
    const r = collectBlockers(stub({ branchProtection: refusal(), prMergeState: merge({ reviewDecision }) }).host, OPEN_PR)
    assert.equal(r.blocked, true, reviewDecision)
    assert.deepEqual(areas(r.blocking), ['reviews'], reviewDecision)
  }
})

test('changes requested by an author block only when the protection requires reviews or GitHub says so', () => {
  const prReviews = { reviews: [{ author: { login: 'ann' }, state: 'CHANGES_REQUESTED' }], reviewRequests: [] }
  const optional = collectBlockers(stub({ prReviews }).host, OPEN_PR)
  assert.equal(optional.blocked, false)
  assert.deepEqual(areas(optional.pending), ['reviews'])
  const required = collectBlockers(stub({ prReviews, branchProtection: { required_pull_request_reviews: { required_approving_review_count: 1 } } }).host, OPEN_PR)
  assert.equal(required.blocked, true)
  assert.ok(required.blocking.some((b) => /ann/.test(b.message)))
  const unread = collectBlockers(stub({ prReviews, branchProtection: refusal() }).host, OPEN_PR)
  assert.deepEqual(areas(unread.unknown), ['reviews'])
  assert.equal(unread.blocked, null)
})

test('more than 100 threads with conversation resolution required leave the verdict unknown', () => {
  const r = collectBlockers(stub({ prThreads: { threads: [], incomplete: true }, branchProtection: { required_conversation_resolution: { enabled: true } } }).host, OPEN_PR)
  assert.deepEqual(areas(r.unknown), ['threads'])
  assert.equal(r.blocked, null)
})

test('a message that mentions 404 is not a refusal unless the host marked the HTTP status', () => {
  const lookalike = new PmkitError('UPSTREAM', 'gh api failed: error connecting to api.github.com for branches/fix-404/protection', 'x')
  assert.throws(() => collectBlockers(stub({ branchProtection: lookalike }).host, OPEN_PR), (e) => e === lookalike)
  assert.throws(() => collectBlockers(stub({ branchProtection: refusal(502, 'gh api failed: Server Error (HTTP 502)') }).host, OPEN_PR), (e) => e.httpStatus === 502)
})

test('a 404 from a read counts as a refusal too', () => {
  const notFound = refusal(404, 'gh api failed: Not Found (HTTP 404)')
  const r = collectBlockers(stub({ branchProtection: notFound }).host, OPEN_PR)
  assert.deepEqual(r.unchecked.map((u) => u.area), ['policies'])
})

test('a network error or a 5xx fails the whole read instead of being listed as not checked', () => {
  for (const message of ['gh api failed: error connecting to api.github.com', 'gh api failed: Server Error (HTTP 502)']) {
    assert.throws(() => collectBlockers(stub({ prThreads: new PmkitError('UPSTREAM', message, 'x') }).host, OPEN_PR), (e) => e.code === 'UPSTREAM' && e.message === message)
  }
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
    assert.deepEqual(r.blocking, [])
  }
})

test('the text says not checked for an UNKNOWN merge state and names a draft when the protection read is refused', () => {
  const unknown = collectBlockers(stub({ prMergeState: merge({ mergeable: 'UNKNOWN', mergeStateStatus: 'UNKNOWN' }) }).host, OPEN_PR)
  const text = blockersText(OPEN_PR, unknown)
  assert.match(text, /conflicts: not checked \(GitHub has not computed the merge state yet\)/)
  assert.doesNotMatch(text, /conflicts: none/)
  assert.match(text, /^nothing known blocks the merge, but part of it could not be checked$/m)
  const pr = { ...OPEN_PR, isDraft: true }
  const draft = blockersText(pr, collectBlockers(stub({ branchProtection: refusal() }).host, pr))
  assert.match(draft, /^blocking: the pull request is a draft$/m)
  assert.match(draft, /^policies: not checked/m)
  assert.match(draft, /^draft: yes/m)
})

test('the text names a rule it does not read instead of saying the branch has no classic protection', () => {
  const found = collectBlockers(stub({ prMergeState: merge({ mergeStateStatus: 'BLOCKED' }) }).host, OPEN_PR)
  const text = blockersText(OPEN_PR, found)
  assert.match(text, /^policies: GitHub blocks the merge by a rule this command does not read \(for example a ruleset\)$/m)
  assert.equal(found.policies.protected, false)
  assert.ok(!text.includes('no classic branch protection'), 'the unread rule line replaces the no protection line')
})

test('GraphQL refusals of checks and threads, as the real host reports them, come back as not checked and do not fail the command', () => {
  const answers = {
    'pr checks 7 --json name,state,bucket': { status: 1, stdout: '', stderr: 'GraphQL: Resource not accessible by integration (repository.pullRequest.statusCheckRollup)\n' },
    'pr view 7 --json mergeable,mergeStateStatus,reviewDecision,baseRefName': { stdout: JSON.stringify(merge()) },
    'pr view 7 --json reviews,reviewRequests': { stdout: JSON.stringify({ reviews: [], reviewRequests: [] }) },
    'api repos/{owner}/{repo}/branches/main/protection': { status: 1, stderr: 'gh: Branch not protected (HTTP 404)\n' },
  }
  const exec = (cmd, args) => {
    const key = args.join(' ')
    const answer = args[1] === 'graphql'
      ? { status: 1, stdout: JSON.stringify({ errors: [{ type: 'FORBIDDEN', message: 'Resource not accessible by integration' }] }), stderr: 'gh: Resource not accessible by integration\n' }
      : answers[key]
    return { status: 0, stdout: '', stderr: '', ...answer }
  }
  const r = collectBlockers(createGithubHost({ root: '.', env: {}, exec }), OPEN_PR)
  assert.equal(r.checks, null)
  assert.equal(r.threads, null)
  assert.deepEqual(r.unchecked.map((u) => u.area), ['checks', 'threads'])
  assert.equal(r.blocked, null)
})
