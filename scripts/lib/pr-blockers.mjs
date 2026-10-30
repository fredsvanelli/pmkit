// What blocks a pull request from merging. Reads through the git host and classifies the answers.
// A read that GitHub refuses (UPSTREAM) leaves its section null and adds an `unchecked` entry. Other errors fail the read.

import { PmkitError } from './errors.mjs'

const FAILING = new Set(['fail', 'cancel'])
const PASSING = new Set(['pass', 'skipping'])

/** The latest review of each author, in the order gh lists them. COMMENTED and PENDING do not change a verdict. */
function latestVerdicts(reviews) {
  const byAuthor = new Map()
  for (const review of reviews) {
    const login = review.author?.login
    if (!login || review.state === 'COMMENTED' || review.state === 'PENDING') continue
    if (review.state === 'DISMISSED') byAuthor.delete(login)
    else byAuthor.set(login, review.state)
  }
  return byAuthor
}

const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`

/**
 * Reads checks, reviews, merge state, review threads and branch protection of `pr` and returns
 * { blocked, state, draft, checks, reviews, conflicts, threads, policies, unchecked }.
 * A merged or closed pull request has nothing to unblock: it returns blocked false and reads nothing.
 */
export function collectBlockers(host, pr) {
  const unchecked = []
  const attempt = (area, read) => {
    try {
      return read()
    } catch (error) {
      if (!(error instanceof PmkitError) || error.code !== 'UPSTREAM') throw error
      unchecked.push({ area, code: error.code, message: error.message, nextStep: error.nextStep })
      return null
    }
  }
  if (pr.state !== 'OPEN') {
    return { blocked: false, state: pr.state, draft: false, checks: null, reviews: null, conflicts: null, threads: null, policies: null, unchecked }
  }

  const checkList = attempt('checks', () => host.prChecks(pr.number))
  const checks = checkList && {
    failing: checkList.filter((c) => FAILING.has(c.bucket)),
    pending: checkList.filter((c) => c.bucket === 'pending'),
  }

  const mergeState = attempt('conflicts', () => host.prMergeState(pr.number))
  const conflicts = mergeState && {
    mergeable: mergeState.mergeable,
    mergeStateStatus: mergeState.mergeStateStatus,
    conflicting: mergeState.mergeable === 'CONFLICTING' || mergeState.mergeStateStatus === 'DIRTY',
    behind: mergeState.mergeStateStatus === 'BEHIND',
  }

  const reviewData = attempt('reviews', () => host.prReviews(pr.number))
  const verdicts = reviewData ? latestVerdicts(reviewData.reviews ?? []) : new Map()
  const reviews = reviewData && {
    decision: mergeState?.reviewDecision || null,
    changesRequested: [...verdicts].filter(([, state]) => state === 'CHANGES_REQUESTED').map(([login]) => login),
    requested: (reviewData.reviewRequests ?? []).map((r) => r.login ?? r.name ?? r.slug),
  }

  const threadData = attempt('threads', () => host.prThreads(pr.number))
  const threads = threadData && { open: threadData.threads.filter((t) => !t.isResolved && !t.isOutdated), incomplete: threadData.incomplete }

  const base = mergeState?.baseRefName
  const protection = base === undefined ? undefined : attempt('policies', () => host.branchProtection(base))
  if (base === undefined && mergeState === null) {
    // Without the merge state the base branch is unknown, so the policies cannot be read.
    unchecked.push({ area: 'policies', code: 'UPSTREAM', message: 'the base branch is unknown because the merge state was not read', nextStep: 'Retry the command' })
  }
  let policies = null
  if (protection !== undefined && !unchecked.some((u) => u.area === 'policies')) {
    const requiredApprovals = protection?.required_pull_request_reviews?.required_approving_review_count ?? null
    const approvals = [...verdicts.values()].filter((state) => state === 'APPROVED').length
    const statusChecks = protection?.required_status_checks
    const requiredChecks = [...new Set([...(statusChecks?.contexts ?? []), ...(statusChecks?.checks ?? []).map((c) => c.context)])]
    const unmet = []
    if (requiredApprovals !== null && reviewData && approvals < requiredApprovals) {
      unmet.push(`needs ${plural(requiredApprovals - approvals, 'more approval')} (${approvals} of ${requiredApprovals})`)
    }
    if (checkList) {
      for (const name of requiredChecks) {
        if (!checkList.some((c) => c.name === name && PASSING.has(c.bucket))) unmet.push(`required check ${name} does not pass`)
      }
    }
    if (protection?.required_conversation_resolution?.enabled === true && threads && threads.open.length > 0) {
      unmet.push(`conversation resolution is required and ${plural(threads.open.length, 'thread')} ${threads.open.length === 1 ? 'is' : 'are'} open`)
    }
    policies = { protected: protection !== null, requiredApprovals, approvals, requiredChecks, unmet, draft: pr.isDraft === true }
  }

  const blocked =
    (checks?.failing.length ?? 0) + (checks?.pending.length ?? 0) > 0 ||
    (reviews !== null && (reviews.changesRequested.length > 0 || reviews.requested.length > 0 || ['CHANGES_REQUESTED', 'REVIEW_REQUIRED'].includes(reviews.decision))) ||
    conflicts?.conflicting === true || conflicts?.behind === true ||
    (threads?.open.length ?? 0) > 0 ||
    (policies !== null && (policies.unmet.length > 0 || policies.draft)) ||
    pr.isDraft === true

  return { blocked, state: pr.state, draft: pr.isDraft === true, checks, reviews, conflicts, threads, policies, unchecked }
}

const names = (items, label = (i) => i) => items.map(label).join(', ')

/** The text of `pr blockers`: the pull request line, then one line per area. */
export function blockersText(pr, found) {
  const head = `#${pr.number} ${pr.title} (${pr.state}${pr.isDraft ? ', draft' : ''})`
  if (found.state !== 'OPEN') return `${head}\nnothing to unblock`
  const notChecked = (area) => `${area}: not checked (${found.unchecked.find((u) => u.area === area)?.message ?? 'no data'})`
  const lines = [head, pr.url]
  const { checks, reviews, conflicts, threads, policies } = found
  if (checks === null) lines.push(notChecked('checks'))
  else if (checks.failing.length + checks.pending.length === 0) lines.push('checks: none failing or pending')
  else lines.push(`checks: ${[checks.failing.length > 0 && `failing ${names(checks.failing, (c) => c.name)}`, checks.pending.length > 0 && `pending ${names(checks.pending, (c) => c.name)}`].filter(Boolean).join('; ')}`)
  if (reviews === null) lines.push(notChecked('reviews'))
  else {
    const parts = []
    if (reviews.changesRequested.length > 0) parts.push(`changes requested by ${names(reviews.changesRequested)}`)
    if (reviews.requested.length > 0) parts.push(`waiting for ${names(reviews.requested)}`)
    if (parts.length === 0 && reviews.decision === 'REVIEW_REQUIRED') parts.push('a review is required')
    lines.push(`reviews: ${parts.length > 0 ? parts.join('; ') : 'nothing pending'}`)
  }
  if (conflicts === null) lines.push(notChecked('conflicts'))
  else lines.push(`conflicts: ${conflicts.conflicting ? 'merge conflicts with the base branch' : conflicts.behind ? 'the branch is behind the base branch' : 'none'}`)
  if (threads === null) lines.push(notChecked('threads'))
  else if (threads.open.length === 0) lines.push(`threads: none open${threads.incomplete ? ' in the first 100' : ''}`)
  else {
    lines.push(`threads: ${threads.open.length} open${threads.incomplete ? ' in the first 100' : ''}`)
    for (const t of threads.open) lines.push(`  ${t.path ?? '(no file)'}${t.line ? `:${t.line}` : ''} ${t.author ?? ''} ${t.url ?? ''}`.trimEnd())
  }
  if (policies === null) lines.push(notChecked('policies'))
  else {
    const parts = [...policies.unmet, ...(policies.draft ? ['the pull request is a draft'] : [])]
    lines.push(`policies: ${parts.length > 0 ? parts.join('; ') : policies.protected ? 'all met' : 'the base branch has no protection'}`)
  }
  return lines.join('\n')
}
