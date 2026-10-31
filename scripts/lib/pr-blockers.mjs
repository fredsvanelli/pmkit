// What blocks a pull request from merging. Reads through the git host and classifies the answers.
// `blocking` holds what stops the merge: what the branch protection requires, merge conflicts, a draft and requested changes.
// `pending` holds what is open but that nothing requires, such as a reviewer nobody needs or a check that is not required.
// `unknown` holds what may block, but the command cannot tell because the branch protection could not be read.
// A read that GitHub refuses with HTTP 403 or 404 leaves its section null and adds an `unchecked` entry.
// Any other failure, such as a network error or a 5xx, fails the read.

import { PmkitError } from './errors.mjs'

const FAILING = new Set(['fail', 'cancel'])
const PASSING = new Set(['pass', 'skipping'])
const UNREAD_RULE = 'GitHub blocks the merge by a rule this command does not read (for example a ruleset)'
const UNREAD_PROTECTION = 'GitHub blocks the merge by a rule this command could not read (branch protection or a ruleset)'

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
const names = (items, label = (i) => i) => items.map(label).join(', ')

/**
 * Reads checks, reviews, merge state, review threads and branch protection of `pr` and returns
 * { blocked, blocking, pending, unknown, state, draft, checks, reviews, conflicts, threads, policies, unchecked }.
 * `blocked` is true when something is in `blocking`, false when nothing is blocking and every read worked, and null when
 * nothing is blocking but `unknown` has items, a read is missing or the merge state is not computed yet.
 * A merged or closed pull request has nothing to unblock: it returns blocked false and reads nothing.
 */
export function collectBlockers(host, pr) {
  const unchecked = []
  const blocking = []
  const pending = []
  const unknown = []
  const attempt = (area, read) => {
    try {
      return read()
    } catch (error) {
      if (!(error instanceof PmkitError) || error.code !== 'UPSTREAM' || ![403, 404].includes(error.httpStatus)) throw error
      unchecked.push({ area, code: error.code, message: error.message, nextStep: error.nextStep })
      return null
    }
  }
  if (pr.state !== 'OPEN') {
    return { blocked: false, blocking, pending, unknown, state: pr.state, draft: false, checks: null, reviews: null, conflicts: null, threads: null, policies: null, unchecked }
  }
  const draft = pr.isDraft === true

  const checkList = attempt('checks', () => host.prChecks(pr.number))
  const checks = checkList && {
    failing: checkList.filter((c) => FAILING.has(c.bucket)),
    pending: checkList.filter((c) => c.bucket === 'pending'),
  }

  const mergeState = attempt('conflicts', () => host.prMergeState(pr.number))
  // GitHub answers UNKNOWN while it computes the merge, for example right after a push.
  const notComputed = mergeState !== null && (mergeState.mergeable === 'UNKNOWN' || mergeState.mergeStateStatus === 'UNKNOWN') && mergeState.mergeable !== 'CONFLICTING' && mergeState.mergeStateStatus !== 'DIRTY'
  const conflicts = mergeState && {
    mergeable: mergeState.mergeable,
    mergeStateStatus: mergeState.mergeStateStatus,
    conflicting: mergeState.mergeable === 'CONFLICTING' || mergeState.mergeStateStatus === 'DIRTY',
    behind: mergeState.mergeStateStatus === 'BEHIND',
    unknown: notComputed,
  }
  if (notComputed) unchecked.push({ area: 'conflicts', code: 'NOT_READY', message: 'GitHub has not computed the merge state yet', nextStep: 'Run the command again in a few seconds' })

  const reviewData = attempt('reviews', () => host.prReviews(pr.number))
  const verdicts = reviewData ? latestVerdicts(reviewData.reviews ?? []) : new Map()
  const reviews = reviewData && {
    decision: mergeState?.reviewDecision || null,
    changesRequested: [...verdicts].filter(([, state]) => state === 'CHANGES_REQUESTED').map(([login]) => login),
    requested: (reviewData.reviewRequests ?? []).map((r) => r.login ?? r.name ?? r.slug),
  }

  const threadData = attempt('threads', () => host.prThreads(pr.number))
  const unresolved = threadData ? threadData.threads.filter((t) => !t.isResolved) : []
  const threads = threadData && { open: unresolved.filter((t) => !t.isOutdated), outdated: unresolved.filter((t) => t.isOutdated), incomplete: threadData.incomplete }

  const base = mergeState?.baseRefName
  const protection = base === undefined ? undefined : attempt('policies', () => host.branchProtection(base))
  if (base === undefined && mergeState === null) {
    unchecked.push({ area: 'policies', code: 'NOT_READY', message: 'the base branch is unknown because the merge state was not read', nextStep: 'Run the command again' })
  }
  const policiesRead = protection !== undefined && !unchecked.some((u) => u.area === 'policies')
  const statusChecks = protection?.required_status_checks
  const requiredChecks = [...new Set([...(statusChecks?.contexts ?? []), ...(statusChecks?.checks ?? []).map((c) => c.context)])]
  const conversationRequired = policiesRead && protection?.required_conversation_resolution?.enabled === true
  let policies = null
  if (policiesRead) {
    const requiredApprovals = protection?.required_pull_request_reviews?.required_approving_review_count ?? null
    const approvals = [...verdicts.values()].filter((state) => state === 'APPROVED').length
    const unmet = []
    if (requiredApprovals !== null && reviewData && approvals < requiredApprovals) {
      unmet.push(`needs ${plural(requiredApprovals - approvals, 'more approval')} (${approvals} of ${requiredApprovals})`)
    }
    if (checkList) {
      for (const name of requiredChecks) {
        if (!checkList.some((c) => c.name === name && PASSING.has(c.bucket))) unmet.push(`required check ${name} does not pass`)
      }
    }
    // The GitHub rule counts every unresolved thread, outdated ones too.
    if (conversationRequired && threads && unresolved.length > 0) {
      unmet.push(`conversation resolution is required and ${plural(unresolved.length, 'thread')} ${unresolved.length === 1 ? 'is' : 'are'} unresolved`)
    }
    policies = { protected: protection !== null, requiredApprovals, approvals, requiredChecks, unmet, unreadRule: false }
  }

  // What blocks.
  const protectionKnown = policiesRead
  if (draft) blocking.push({ area: 'draft', message: 'the pull request is a draft' })
  if (conflicts?.conflicting) blocking.push({ area: 'conflicts', message: 'merge conflicts with the base branch' })
  if (conflicts?.behind && statusChecks?.strict === true) blocking.push({ area: 'conflicts', message: 'the branch is behind the base branch and the protection requires it to be up to date' })
  // GitHub reviewDecision is the word of GitHub, so it blocks without the protection.
  if (reviews?.decision === 'CHANGES_REQUESTED') blocking.push({ area: 'reviews', message: reviews.changesRequested.length > 0 ? `changes requested by ${names(reviews.changesRequested)}` : 'changes are requested' })
  else if (reviews?.changesRequested.length > 0) {
    const message = `changes requested by ${names(reviews.changesRequested)}`
    if (policies?.requiredApprovals != null) blocking.push({ area: 'reviews', message })
    else if (protectionKnown) pending.push({ area: 'reviews', message })
    else unknown.push({ area: 'reviews', message })
  }
  for (const message of policies?.unmet ?? []) blocking.push({ area: 'policies', message })
  if (reviews?.decision === 'REVIEW_REQUIRED' && !(policies?.unmet ?? []).some((m) => m.startsWith('needs '))) blocking.push({ area: 'reviews', message: 'a review is required' })
  if (mergeState?.mergeStateStatus === 'BLOCKED' && blocking.length === 0) {
    blocking.push({ area: 'policies', message: protectionKnown ? UNREAD_RULE : UNREAD_PROTECTION })
    if (policies) policies.unreadRule = true
  }

  // What is open. With the protection read, what it does not require is pending. Without it, the command cannot tell.
  const open = protectionKnown ? pending : unknown
  if (checks) {
    const optional = (c) => !protectionKnown || !requiredChecks.includes(c.name)
    const failing = checks.failing.filter(optional)
    const waiting = checks.pending.filter(optional)
    if (failing.length > 0) open.push({ area: 'checks', message: `failing ${names(failing, (c) => c.name)}` })
    if (waiting.length > 0) open.push({ area: 'checks', message: `pending ${names(waiting, (c) => c.name)}` })
  }
  if (reviews?.requested.length > 0) open.push({ area: 'reviews', message: `waiting for ${names(reviews.requested)}` })
  if (conflicts?.behind && statusChecks?.strict !== true) open.push({ area: 'conflicts', message: 'the branch is behind the base branch' })
  if (threads && unresolved.length > 0 && !conversationRequired) {
    open.push({ area: 'threads', message: `${plural(threads.open.length, 'open thread')}${threads.outdated.length > 0 ? ` and ${plural(threads.outdated.length, 'outdated thread')}` : ''}` })
  }
  // Past 100 threads the conversation rule cannot be checked against the whole list.
  if (conversationRequired && threads?.incomplete) unknown.push({ area: 'threads', message: 'only the first 100 threads were read and conversation resolution is required' })

  const blocked = blocking.length > 0 ? true : unchecked.length > 0 || unknown.length > 0 ? null : false
  return { blocked, blocking, pending, unknown, state: pr.state, draft, checks, reviews, conflicts, threads, policies, unchecked }
}

/** The text of `pr blockers`: the pull request line, the verdict, what blocks, what is pending, then one line per area. */
export function blockersText(pr, found) {
  const head = `#${pr.number} ${pr.title} (${pr.state}${pr.isDraft ? ', draft' : ''})`
  if (found.state !== 'OPEN') return `${head}\nnothing to unblock`
  const notChecked = (area) => `${area}: not checked (${found.unchecked.find((u) => u.area === area)?.message ?? 'no data'})`
  const verdict = found.blocked === true ? 'blocked' : found.blocked === false ? 'nothing blocks the merge' : 'nothing known blocks the merge, but part of it could not be checked'
  const lines = [head, pr.url, verdict]
  if (found.blocking.length > 0) lines.push(`blocking: ${found.blocking.map((b) => b.message).join('; ')}`)
  if (found.pending.length > 0) lines.push(`pending: ${found.pending.map((p) => p.message).join('; ')}`)
  if (found.unknown.length > 0) lines.push(`may block (the protection could not be read or a read is incomplete): ${found.unknown.map((u) => u.message).join('; ')}`)
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
  if (conflicts === null || conflicts.unknown) lines.push(notChecked('conflicts'))
  else lines.push(`conflicts: ${conflicts.conflicting ? 'merge conflicts with the base branch' : conflicts.behind ? 'the branch is behind the base branch' : 'none'}`)
  if (threads === null) lines.push(notChecked('threads'))
  else if (threads.open.length + threads.outdated.length === 0) lines.push(`threads: none unresolved${threads.incomplete ? ' in the first 100' : ''}`)
  else {
    lines.push(`threads: ${threads.open.length} open, ${threads.outdated.length} outdated${threads.incomplete ? ' (first 100 read)' : ''}`)
    for (const t of [...threads.open, ...threads.outdated]) lines.push(`  ${t.path ?? '(no file)'}${t.line ? `:${t.line}` : ''} ${t.author ?? ''} ${t.url ?? ''}`.trimEnd())
  }
  if (policies === null) lines.push(notChecked('policies'))
  else if (policies.unmet.length > 0) lines.push(`policies: ${policies.unmet.join('; ')}`)
  else if (policies.unreadRule) lines.push(`policies: ${UNREAD_RULE}`)
  else lines.push(`policies: ${policies.protected ? 'all met' : 'the base branch has no classic branch protection'}`)
  if (found.draft) lines.push('draft: yes, mark it ready for review to merge')
  return lines.join('\n')
}
