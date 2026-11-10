import assert from 'node:assert/strict'
import test from 'node:test'
import { PmkitError } from './lib/errors.mjs'
import { createGithubHost } from './lib/github/host.mjs'
import { blockersText, collectBlockers as collect } from './lib/pr-blockers.mjs'

const OPEN_PR = { number: 7, state: 'OPEN', isDraft: false, title: 'T', url: 'https://x/7' }
const thread = (over = {}) => ({ isResolved: false, isOutdated: false, path: 'a.js', line: 3, url: 'https://x/t', author: 'bob', ...over })
const merge = (over = {}) => ({ mergeable: 'MERGEABLE', mergeStateStatus: 'CLEAN', reviewDecision: '', baseRefName: 'main', ...over })
// The pull request as getPullRequest({ detail: true }) returns it, for the tests that run the real host.
const DETAILED_PR = { ...OPEN_PR, detail: { ...merge(), reviews: [], reviewRequests: [] } }
const RULES = 'api repos/{owner}/{repo}/rules/branches/main?per_page=100&page=1'
const areas = (list) => list.map((item) => item.area)
/** A refused read: the host marks the error with the HTTP status of the gh reply. */
const refusal = (status = 403, message = `gh api failed: HTTP ${status}`) => Object.assign(new PmkitError('UPSTREAM', message, 'x'), { httpStatus: status })

/**
 * A stub host. Each read is the value, or an error that it throws. `reviewData` and `mergeState` are not reads: they are the
 * pull request's `detail`, which getPullRequest({ detail: true }) returns, and the collectBlockers below puts them there.
 */
function stub(over = {}) {
  const calls = []
  const { reviewData = { reviews: [], reviewRequests: [] }, mergeState = merge(), ...rest } = over
  const reads = {
    prChecks: [],
    prThreads: { threads: [] },
    branchProtection: null,
    branchRules: [],
    ...rest,
  }
  const host = { detail: { ...mergeState, ...reviewData } }
  for (const [name, value] of Object.entries(reads)) {
    host[name] = () => {
      calls.push(name)
      if (value instanceof Error) throw value
      return value
    }
  }
  return { host, calls }
}

/** collectBlockers on the pull request as getPullRequest({ detail: true }) returns it, with the stub's reviews and merge state. */
const collectBlockers = (host, pr) => collect(host, host.detail ? { ...pr, detail: host.detail } : pr)

test('the reviews and the merge state come from the pull request, with no gh pr view of their own', () => {
  const keys = []
  const exec = (cmd, args) => {
    keys.push(args.join(' '))
    if (args[1] === 'graphql') return { status: 0, stdout: JSON.stringify({ data: { repository: { pullRequest: { reviewThreads: { pageInfo: { hasNextPage: false }, nodes: [] } } } } }), stderr: '' }
    if (args[0] === 'pr' || args.join(' ') === RULES) return { status: 0, stdout: '[]', stderr: '' }
    return { status: 1, stdout: '', stderr: 'gh: Branch not protected (HTTP 404)\n' }
  }
  const pr = { ...OPEN_PR, detail: { ...merge({ reviewDecision: 'CHANGES_REQUESTED' }), reviews: [{ author: { login: 'ann' }, state: 'CHANGES_REQUESTED' }], reviewRequests: [] } }
  const r = collect(createGithubHost({ root: '.', env: {}, exec }), pr)
  assert.deepEqual(r.reviews.changesRequested, ['ann'])
  assert.equal(r.conflicts.mergeStateStatus, 'CLEAN')
  assert.ok(!keys.some((key) => key.startsWith('pr view')), keys.join('\n'))
})

test('a clean pull request is not blocked and every section is empty', () => {
  const r = collectBlockers(stub().host, OPEN_PR)
  assert.equal(r.blocked, false)
  assert.deepEqual(r.blocking, [])
  assert.deepEqual(r.pending, [])
  assert.deepEqual(r.unknown, [])
  assert.deepEqual(r.checks, { failing: [], pending: [] })
  assert.deepEqual(r.conflicts, { mergeable: 'MERGEABLE', mergeStateStatus: 'CLEAN', conflicting: false, behind: false, unknown: false })
  assert.deepEqual(r.threads, { open: [], outdated: [] })
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
  const r = collectBlockers(stub({ reviewData: { reviews, reviewRequests }, mergeState: merge({ mergeStateStatus: 'BLOCKED', reviewDecision: 'CHANGES_REQUESTED' }) }).host, OPEN_PR)
  assert.deepEqual(r.reviews.changesRequested, ['bob'])
  assert.deepEqual(r.reviews.requested, ['dee'])
  assert.deepEqual(r.reviews.requestedTeams, ['core'])
  assert.equal(r.reviews.decision, 'CHANGES_REQUESTED')
  assert.equal(r.blocked, true)
  assert.ok(r.blocking.some((b) => b.area === 'reviews' && /bob/.test(b.message)))
})

test('a requested reviewer nobody requires is pending, not blocking', () => {
  const reviewData = { reviews: [{ author: { login: 'ann' }, state: 'APPROVED' }, { author: { login: 'bob' }, state: 'APPROVED' }], reviewRequests: [{ __typename: 'User', login: 'cy' }] }
  const r = collectBlockers(stub({ reviewData, branchProtection: { required_pull_request_reviews: { required_approving_review_count: 1 } } }).host, OPEN_PR)
  assert.equal(r.blocked, false)
  assert.deepEqual(r.blocking, [])
  assert.deepEqual(areas(r.pending), ['reviews'])
})

test('conflicts block, and behind blocks only when the protection is strict', () => {
  const state = (over, branchProtection = null) => collectBlockers(stub({ mergeState: merge(over), branchProtection }).host, OPEN_PR)
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
  const r = collectBlockers(stub({ mergeState: merge({ mergeable: 'UNKNOWN', mergeStateStatus: 'UNKNOWN' }) }).host, OPEN_PR)
  assert.equal(r.conflicts.unknown, true)
  assert.equal(r.conflicts.conflicting, false)
  assert.equal(r.unchecked.length, 1)
  assert.equal(r.unchecked[0].area, 'conflicts')
  assert.match(r.unchecked[0].nextStep, /again in a few seconds/)
  assert.equal(r.blocked, null)
  const withBlocker = collectBlockers(stub({ mergeState: merge({ mergeable: 'UNKNOWN', mergeStateStatus: 'UNKNOWN', reviewDecision: 'CHANGES_REQUESTED' }), reviewData: { reviews: [{ author: { login: 'a' }, state: 'CHANGES_REQUESTED' }], reviewRequests: [] } }).host, OPEN_PR)
  assert.equal(withBlocker.blocked, true)
})

test('open and outdated threads are listed apart and resolved ones are dropped', () => {
  const prThreads = { threads: [thread(), thread({ isResolved: true }), thread({ isOutdated: true, path: 'b.js' })] }
  const r = collectBlockers(stub({ prThreads }).host, OPEN_PR)
  assert.equal(r.threads.open.length, 1)
  assert.equal(r.threads.open[0].path, 'a.js')
  assert.deepEqual(r.threads.outdated.map((t) => t.path), ['b.js'])
  assert.equal(r.blocked, false)
  assert.deepEqual(areas(r.pending), ['threads'])
})

test('policies: unmet approvals, unmet required checks and unresolved conversations, outdated ones included', () => {
  const protection = {
    required_pull_request_reviews: { required_approving_review_count: 2 },
    required_status_checks: { contexts: ['build'], checks: [{ context: 'lint' }] },
    required_conversation_resolution: { enabled: true },
  }
  const reviewData = { reviews: [{ author: { login: 'ann' }, state: 'APPROVED' }], reviewRequests: [] }
  const prChecks = [{ name: 'lint', bucket: 'pass' }]
  const prThreads = { threads: [thread(), thread({ isOutdated: true })] }
  const r = collectBlockers(stub({ branchProtection: protection, reviewData, prChecks, prThreads }).host, OPEN_PR)
  assert.equal(r.policies.protected, true)
  assert.equal(r.policies.requiredApprovals, 2)
  assert.equal(r.policies.approvals, 1)
  assert.deepEqual(r.policies.requiredChecks, ['build', 'lint'])
  assert.deepEqual(r.policies.unmet, ['needs 1 more approval (1 of 2)', 'required check build does not pass', 'conversation resolution is required and 2 threads are unresolved'])
  assert.equal(r.blocked, true)
})

test('an outdated thread alone blocks when conversation resolution is required', () => {
  const prThreads = { threads: [thread({ isOutdated: true })] }
  const r = collectBlockers(stub({ prThreads, branchProtection: { required_conversation_resolution: { enabled: true } } }).host, OPEN_PR)
  assert.equal(r.blocked, true)
  assert.deepEqual(r.policies.unmet, ['conversation resolution is required and 1 thread is unresolved'])
})

test('an unprotected branch is a policy read, not an unchecked one', () => {
  const r = collectBlockers(stub().host, OPEN_PR)
  assert.deepEqual(r.policies, { protected: false, rulesets: [], unread: [], requiredApprovals: null, approvals: 0, requiredChecks: [], unmet: [], unreadRule: false, unevaluated: [] })
  assert.deepEqual(r.unchecked, [])
})

test('BLOCKED with nothing else to explain it names a rule the command does not read', () => {
  const r = collectBlockers(stub({ mergeState: merge({ mergeStateStatus: 'BLOCKED' }) }).host, OPEN_PR)
  assert.equal(r.policies.protected, false)
  assert.equal(r.policies.unreadRule, true)
  assert.equal(r.blocked, true)
  assert.equal(r.blocking[0].message, 'GitHub blocks the merge by a rule this command does not evaluate (for example signed commits, a merge queue or required deployments)')
})

test('a draft pull request is its own blocker and does not depend on the protection read', () => {
  const clean = collectBlockers(stub().host, { ...OPEN_PR, isDraft: true })
  assert.equal(clean.draft, true)
  assert.equal(clean.blocked, true)
  assert.deepEqual(clean.blocking.map((b) => b.area), ['draft'])
  assert.equal('draft' in clean.policies, false)
  const refused = collectBlockers(stub({ branchProtection: refusal() }).host, { ...OPEN_PR, isDraft: true })
  assert.equal(refused.policies.protected, null)
  assert.equal(refused.draft, true)
  assert.deepEqual(refused.blocking.map((b) => b.area), ['draft'])
})

test('a refused read gives a null section and one unchecked entry, and the rest still comes back', () => {
  const refused = refusal(403, 'gh api failed: Resource not accessible by integration (HTTP 403)')
  const r = collectBlockers(stub({ prThreads: refused, branchProtection: refused, prChecks: [{ name: 'a', bucket: 'fail' }] }).host, OPEN_PR)
  assert.equal(r.threads, null)
  assert.deepEqual(r.policies.unread, ['branch protection'])
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
    reviewData: { reviews: [], reviewRequests: [{ __typename: 'User', login: 'dee' }] },
    prThreads: { threads: [thread(), thread({ isOutdated: true })] },
  }).host, OPEN_PR)
  assert.deepEqual(r.blocking, [])
  assert.deepEqual(r.pending, [])
  assert.deepEqual(r.unknown.map((u) => u.area), ['checks', 'checks', 'reviews', 'threads'])
  assert.equal(r.blocked, null)
})

test('with the protection unread, BLOCKED says GitHub blocks by a rule the command could not read', () => {
  const r = collectBlockers(stub({ branchProtection: refusal(), mergeState: merge({ mergeStateStatus: 'BLOCKED' }) }).host, OPEN_PR)
  assert.equal(r.blocked, true)
  assert.match(r.blocking[0].message, /GitHub blocks the merge by a rule this command could not read \(branch protection or a ruleset\)/)
  assert.doesNotMatch(r.blocking[0].message, /for example/)
})

test('GitHub reviewDecision blocks even when the protection is unread', () => {
  for (const reviewDecision of ['CHANGES_REQUESTED', 'REVIEW_REQUIRED']) {
    const r = collectBlockers(stub({ branchProtection: refusal(), mergeState: merge({ reviewDecision }) }).host, OPEN_PR)
    assert.equal(r.blocked, true, reviewDecision)
    assert.deepEqual(areas(r.blocking), ['reviews'], reviewDecision)
  }
})

test('changes requested by an author block only when the protection requires reviews or GitHub says so', () => {
  const reviewData = { reviews: [{ author: { login: 'ann' }, state: 'CHANGES_REQUESTED' }], reviewRequests: [] }
  const optional = collectBlockers(stub({ reviewData }).host, OPEN_PR)
  assert.equal(optional.blocked, false)
  assert.deepEqual(areas(optional.pending), ['reviews'])
  const required = collectBlockers(stub({ reviewData, branchProtection: { required_pull_request_reviews: { required_approving_review_count: 1 } } }).host, OPEN_PR)
  assert.equal(required.blocked, true)
  assert.ok(required.blocking.some((b) => /ann/.test(b.message)))
  const unread = collectBlockers(stub({ reviewData, branchProtection: refusal() }).host, OPEN_PR)
  assert.deepEqual(areas(unread.unknown), ['reviews'])
  assert.equal(unread.blocked, null)
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
  const unknown = collectBlockers(stub({ mergeState: merge({ mergeable: 'UNKNOWN', mergeStateStatus: 'UNKNOWN' }) }).host, OPEN_PR)
  const text = blockersText(OPEN_PR, unknown)
  assert.match(text, /conflicts: not checked \(GitHub has not computed the merge state yet\)/)
  assert.doesNotMatch(text, /conflicts: none/)
  assert.match(text, /^nothing known blocks the merge, but part of it could not be checked$/m)
  const pr = { ...OPEN_PR, isDraft: true }
  const draft = blockersText(pr, collectBlockers(stub({ branchProtection: refusal() }).host, pr))
  assert.match(draft, /^blocking: the pull request is a draft$/m)
  assert.match(draft, /^policies: not read: branch protection \(gh api failed: HTTP 403\)$/m)
  assert.match(draft, /^draft: yes/m)
})

test('the text names a rule it does not read instead of saying the branch has no classic protection', () => {
  const found = collectBlockers(stub({ mergeState: merge({ mergeStateStatus: 'BLOCKED' }) }).host, OPEN_PR)
  const text = blockersText(OPEN_PR, found)
  assert.match(text, /^policies: GitHub blocks the merge by a rule this command does not evaluate \(for example signed commits, a merge queue or required deployments\)$/m)
  assert.equal(found.policies.protected, false)
  assert.ok(!text.includes('no classic branch protection'), 'the unread rule line replaces the no protection line')
})

test('GraphQL refusals of checks and threads, as the real host reports them, come back as not checked and do not fail the command', () => {
  const answers = {
    'pr checks 7 --json name,state,bucket,link': { status: 1, stdout: '', stderr: 'GraphQL: Resource not accessible by integration (repository.pullRequest.statusCheckRollup)\n' },
    'api repos/{owner}/{repo}/branches/main/protection': { status: 1, stderr: 'gh: Branch not protected (HTTP 404)\n' },
    [RULES]: { stdout: '[]' },
  }
  const exec = (cmd, args) => {
    const key = args.join(' ')
    const answer = args[1] === 'graphql'
      ? { status: 1, stdout: JSON.stringify({ errors: [{ type: 'FORBIDDEN', message: 'Resource not accessible by integration' }] }), stderr: 'gh: Resource not accessible by integration\n' }
      : answers[key]
    return { status: 0, stdout: '', stderr: '', ...answer }
  }
  const r = collectBlockers(createGithubHost({ root: '.', env: {}, exec }), DETAILED_PR)
  assert.equal(r.checks, null)
  assert.equal(r.threads, null)
  assert.deepEqual(r.unchecked.map((u) => u.area), ['checks', 'threads'])
  assert.equal(r.blocked, null)
})

const requiresOne = { required_pull_request_reviews: { required_approving_review_count: 1 } }
const changeRequest = { reviews: [{ author: { login: 'ann' }, state: 'CHANGES_REQUESTED' }], reviewRequests: [] }

test('a change request is pending when GitHub says APPROVED, and when the protection requires 0 approvals', () => {
  const approved = collectBlockers(stub({ reviewData: { reviews: [...changeRequest.reviews, { author: { login: 'bob' }, state: 'APPROVED' }], reviewRequests: [] }, mergeState: merge({ reviewDecision: 'APPROVED' }), branchProtection: requiresOne }).host, OPEN_PR)
  assert.equal(approved.blocked, false)
  assert.deepEqual(areas(approved.pending), ['reviews'])
  const zero = collectBlockers(stub({ reviewData: changeRequest, branchProtection: { required_pull_request_reviews: { required_approving_review_count: 0 } } }).host, OPEN_PR)
  assert.equal(zero.blocked, false)
  assert.deepEqual(areas(zero.pending), ['reviews'])
  const blocks = collectBlockers(stub({ reviewData: changeRequest, branchProtection: requiresOne }).host, OPEN_PR)
  assert.equal(blocks.blocked, true)
  const unread = collectBlockers(stub({ reviewData: changeRequest, branchProtection: refusal(), mergeState: merge({ reviewDecision: 'APPROVED' }) }).host, OPEN_PR)
  assert.deepEqual(areas(unread.pending), ['reviews'])
})

test('with the checks or threads unread, the policies they feed are unevaluated and the text says not checked', () => {
  const rules = { required_status_checks: { contexts: ['ci'] }, required_conversation_resolution: { enabled: true } }
  const r = collectBlockers(stub({ prChecks: refusal(), prThreads: refusal(), branchProtection: rules }).host, OPEN_PR)
  assert.deepEqual(r.policies.unevaluated, ['required checks', 'conversation resolution'])
  assert.equal(r.blocked, null)
  const text = blockersText(OPEN_PR, r)
  assert.match(text, /^policies: not checked: required checks \(checks unread\), conversation resolution \(threads unread\)$/m)
  assert.doesNotMatch(text, /all met/)
  const unmet = collectBlockers(stub({ prChecks: refusal(), branchProtection: { required_conversation_resolution: { enabled: true } }, prThreads: { threads: [thread()] } }).host, OPEN_PR)
  assert.match(blockersText(OPEN_PR, unmet), /^policies: conversation resolution is required and 1 thread is unresolved; not checked: required checks \(checks unread\)$/m)
})

test('BLOCKED with an unread area names it as a possible cause next to the unread rule', () => {
  const r = collectBlockers(stub({ prChecks: refusal(), branchProtection: { required_status_checks: { contexts: ['ci'] } }, mergeState: merge({ mergeStateStatus: 'BLOCKED' }) }).host, OPEN_PR)
  assert.equal(r.blocked, true)
  assert.match(r.blocking[0].message, /by a rule this command does not evaluate \(for example signed commits, a merge queue or required deployments\), or by required checks, which it could not evaluate because the checks were not read/)
})

test('a SAML or missing-scopes refusal of the real host marks the area unchecked and does not fail the command', () => {
  for (const stderr of ['GraphQL: Resource protected by organization SAML enforcement. You must grant your OAuth token access to this organization.\n', 'GraphQL: Your token has not been granted the required scopes to execute this query. (INSUFFICIENT_SCOPES)\n']) {
    const exec = (cmd, args) => {
      const key = args.join(' ')
      if (key === 'pr checks 7 --json name,state,bucket,link') return { status: 1, stdout: '', stderr }
      if (args[1] === 'graphql') return { status: 1, stdout: JSON.stringify({ errors: [{ type: 'INSUFFICIENT_SCOPES', message: 'x' }] }), stderr: 'gh: x\n' }
      if (key === RULES) return { status: 0, stdout: '[]', stderr: '' }
      return { status: 1, stdout: '', stderr: 'gh: Branch not protected (HTTP 404)\n' }
    }
    const r = collectBlockers(createGithubHost({ root: '.', env: {}, exec }), DETAILED_PR)
    assert.deepEqual(r.unchecked.map((u) => u.area), ['checks', 'threads'])
    assert.equal(r.blocked, null)
  }
})

test('a team named like a user is a team request, never the user', () => {
  const reviewRequests = [{ __typename: 'Team', name: 'fred', slug: 'fred' }]
  const r = collectBlockers(stub({ reviewData: { reviews: [], reviewRequests }, mergeState: merge({}) }).host, OPEN_PR)
  assert.deepEqual(r.reviews.requested, [])
  assert.deepEqual(r.reviews.requestedTeams, ['fred'])
  assert.ok([...r.pending, ...r.unknown].some((o) => o.area === 'reviews' && /team fred/.test(o.message)))
})

test('blockersText points a failing check that has a workflow run to ci logs --run', () => {
  const r = collectBlockers(stub({ prChecks: [{ name: 'build', bucket: 'fail', runId: 123 }, { name: 'ext', bucket: 'fail', runId: null }] }).host, OPEN_PR)
  assert.deepEqual(r.checks.failing.map((c) => c.runId), [123, null])
  assert.match(blockersText(OPEN_PR, r), /checks: failing build \(ci logs --run 123\), ext/)
})

const pullRule = (parameters) => ({ type: 'pull_request', parameters })
const checksRule = (contexts, strict = false) => ({ type: 'required_status_checks', parameters: { required_status_checks: contexts.map((context) => ({ context })), strict_required_status_checks_policy: strict } })

test('a ruleset pull_request rule requires approvals and conversation resolution', () => {
  const r = collectBlockers(stub({
    branchRules: [pullRule({ required_approving_review_count: 2, required_review_thread_resolution: true })],
    reviewData: { reviews: [{ author: { login: 'ann' }, state: 'APPROVED' }], reviewRequests: [] },
    prThreads: { threads: [thread()] },
  }).host, OPEN_PR)
  assert.deepEqual(r.policies.rulesets, ['pull_request'])
  assert.equal(r.policies.protected, false)
  assert.deepEqual(r.policies.unmet, ['needs 1 more approval (1 of 2)', 'conversation resolution is required and 1 thread is unresolved'])
  assert.equal(r.blocked, true)
  assert.deepEqual(r.pending, [], 'the open thread is required, so it is not pending')
})

test('a ruleset required check and strict policy merge with the classic protection', () => {
  const r = collectBlockers(stub({
    branchProtection: { required_status_checks: { contexts: ['lint'] } },
    branchRules: [checksRule(['build'], true)],
    prChecks: [{ name: 'lint', bucket: 'fail' }, { name: 'build', bucket: 'fail' }],
    mergeState: merge({ mergeStateStatus: 'BEHIND' }),
  }).host, OPEN_PR)
  assert.deepEqual(r.policies.requiredChecks, ['lint', 'build'])
  assert.deepEqual(r.policies.unmet, ['required check lint does not pass', 'required check build does not pass'])
  assert.ok(r.blocking.some((b) => b.area === 'conflicts' && /behind/.test(b.message)))
  assert.deepEqual(r.pending, [])
})

test('the largest required approval count of both sources wins', () => {
  const r = collectBlockers(stub({ branchProtection: { required_pull_request_reviews: { required_approving_review_count: 1 } }, branchRules: [pullRule({ required_approving_review_count: 3 })] }).host, OPEN_PR)
  assert.equal(r.policies.requiredApprovals, 3)
  assert.deepEqual(r.policies.unmet, ['needs 3 more approvals (0 of 3)'])
})

test('with the protection refused and the rules read, a known unmet rule blocks and the rest is unknown', () => {
  const r = collectBlockers(stub({
    branchProtection: refusal(),
    branchRules: [checksRule(['build'])],
    prChecks: [{ name: 'build', bucket: 'fail' }],
    reviewData: { reviews: [], reviewRequests: [{ __typename: 'User', login: 'cy' }] },
  }).host, OPEN_PR)
  assert.equal(r.blocked, true)
  assert.deepEqual(r.blocking.map((b) => b.message), ['required check build does not pass'])
  assert.deepEqual(r.unknown.map((u) => u.message), ['waiting for cy'], 'the required check is not listed again as unknown')
  assert.deepEqual(r.pending, [])
  assert.equal(r.policies.protected, null)
  assert.deepEqual(r.policies.unread, ['branch protection'])
  const text = blockersText(OPEN_PR, r)
  assert.match(text, /^policies: required check build does not pass; not read: branch protection \(gh api failed: HTTP 403\)$/m)
  assert.doesNotMatch(text, /all met/)
})

test('with the rules refused and the protection read, nothing open is called not required', () => {
  const r = collectBlockers(stub({ branchRules: refusal(404, 'gh api repos/{owner}/{repo}/rules/branches/main failed: Not Found (HTTP 404)'), prChecks: [{ name: 'lint', bucket: 'fail' }] }).host, OPEN_PR)
  assert.equal(r.blocked, null)
  assert.deepEqual(r.policies.unread, ['rulesets'])
  assert.equal(r.policies.rulesets, null)
  assert.equal(r.policies.protected, false)
  assert.deepEqual(areas(r.unknown), ['checks'])
  assert.match(blockersText(OPEN_PR, r), /^policies: not read: rulesets \(gh api repos\/\{owner\}\/\{repo\}\/rules\/branches\/main failed: Not Found \(HTTP 404\)\)$/m)
})

test('with both policy reads refused, policies is null and both are unchecked', () => {
  const r = collectBlockers(stub({ branchProtection: refusal(403, 'protection refused'), branchRules: refusal(404, 'rules refused') }).host, OPEN_PR)
  assert.equal(r.policies, null)
  assert.deepEqual(r.unchecked.map((u) => [u.area, u.message]), [['policies', 'protection refused'], ['policies', 'rules refused']])
  assert.equal(r.blocked, null)
  assert.match(blockersText(OPEN_PR, r), /^policies: not checked \(protection refused; rules refused\)$/m)
})

test('BLOCKED with both sources read names the active rules it does not evaluate', () => {
  const r = collectBlockers(stub({ branchRules: [{ type: 'required_signatures' }, pullRule({})], mergeState: merge({ mergeStateStatus: 'BLOCKED' }) }).host, OPEN_PR)
  assert.equal(r.blocked, true)
  assert.match(r.blocking[0].message, /does not evaluate .*; active rules it does not evaluate: required_signatures$/)
  assert.equal(r.policies.unreadRule, true)
})

test('the policies text says no protection or ruleset only when both were read and both are empty', () => {
  assert.match(blockersText(OPEN_PR, collectBlockers(stub().host, OPEN_PR)), /^policies: the base branch has no branch protection or ruleset$/m)
  assert.match(blockersText(OPEN_PR, collectBlockers(stub({ branchRules: [pullRule({ required_approving_review_count: 0 })] }).host, OPEN_PR)), /^policies: all met$/m)
  assert.doesNotMatch(blockersText(OPEN_PR, collectBlockers(stub({ branchRules: refusal() }).host, OPEN_PR)), /no branch protection|all met/)
})
