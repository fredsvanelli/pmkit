// What blocks a pull request from merging. Reads through the git host and classifies the answers.
// The pull request comes with its reviews and merge state in `pr.detail` (getPullRequest with `detail`), so they need no read here.
// The policies are the classic branch protection and the active ruleset rules of the base branch, merged.
// `blocking` holds what stops the merge: what the policies require, merge conflicts, a draft and requested changes.
// `pending` holds what is open but that nothing requires, such as a reviewer nobody needs or a check that is not required.
// `unknown` holds what may block, but the command cannot tell because the protection or the rules could not be read.
// A read that GitHub refuses with HTTP 403 or 404 leaves its section null and adds an `unchecked` entry.
// Any other failure, such as a network error or a 5xx, fails the read.

import { PmkitError } from './errors.mjs'

const FAILING = new Set(['fail', 'cancel'])
const PASSING = new Set(['pass', 'skipping'])
const UNREAD_RULE = 'GitHub blocks the merge by a rule this command does not evaluate (for example signed commits, a merge queue or required deployments)'
// The ruleset rule types the command evaluates. GitHub's mergeStateStatus covers the others.
const EVALUATED_RULES = new Set(['pull_request', 'required_status_checks'])
// Marks a protection read that was refused, apart from null, which is a branch without classic protection.
const REFUSED = Symbol('refused')
// A rule the command evaluates from another read, and the read it needs.
const NEEDS = { 'required checks': 'checks', 'conversation resolution': 'threads' }
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

/** Why GitHub blocks when nothing read explains it, with the active rule types the command does not evaluate. */
function ruleText(policies) {
  const others = (policies?.rulesets ?? []).filter((type) => !EVALUATED_RULES.has(type))
  return others.length > 0 ? `${UNREAD_RULE}; active rules it does not evaluate: ${others.join(', ')}` : UNREAD_RULE
}

const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`
const names = (items, label = (i) => i) => items.map(label).join(', ')
// A review request is a user (`login`) or a team (`slug`). Teams are kept apart so a team named like a user never matches the user.
const isTeam = (r) => r.__typename === 'Team' || (r.login === undefined && r.slug !== undefined)
/** Who is asked for a review, as text: users by login, teams as `team <slug>`. */
const anyRequested = (reviews) => (reviews?.requested.length ?? 0) + (reviews?.requestedTeams.length ?? 0) > 0
const waitingFor = (reviews) => [...reviews.requested, ...reviews.requestedTeams.map((t) => `team ${t}`)].join(', ')

/**
 * Reads checks, review threads and branch protection of `pr`, takes its reviews and merge state from `pr.detail`, and returns
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
  const attempt = (area, read, refused = null) => {
    try {
      return read()
    } catch (error) {
      if (!(error instanceof PmkitError) || error.code !== 'UPSTREAM' || ![403, 404].includes(error.httpStatus)) throw error
      unchecked.push({ area, code: error.code, message: error.message, nextStep: error.nextStep })
      return refused
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

  const mergeState = pr.detail
  // GitHub answers UNKNOWN while it computes the merge, for example right after a push.
  const notComputed = (mergeState.mergeable === 'UNKNOWN' || mergeState.mergeStateStatus === 'UNKNOWN') && mergeState.mergeable !== 'CONFLICTING' && mergeState.mergeStateStatus !== 'DIRTY'
  const conflicts = {
    mergeable: mergeState.mergeable,
    mergeStateStatus: mergeState.mergeStateStatus,
    conflicting: mergeState.mergeable === 'CONFLICTING' || mergeState.mergeStateStatus === 'DIRTY',
    behind: mergeState.mergeStateStatus === 'BEHIND',
    unknown: notComputed,
  }
  if (notComputed) unchecked.push({ area: 'conflicts', code: 'NOT_READY', message: 'GitHub has not computed the merge state yet', nextStep: 'Run the command again in a few seconds' })

  const verdicts = latestVerdicts(mergeState.reviews ?? [])
  const reviews = {
    decision: mergeState.reviewDecision || null,
    changesRequested: [...verdicts].filter(([, state]) => state === 'CHANGES_REQUESTED').map(([login]) => login),
    requested: (mergeState.reviewRequests ?? []).filter((r) => !isTeam(r)).map((r) => r.login ?? r.name),
    requestedTeams: (mergeState.reviewRequests ?? []).filter(isTeam).map((r) => r.slug ?? r.name),
  }

  const threadData = attempt('threads', () => host.prThreads(pr.number))
  const unresolved = threadData ? threadData.threads.filter((t) => !t.isResolved) : []
  const threads = threadData && { open: unresolved.filter((t) => !t.isOutdated), outdated: unresolved.filter((t) => t.isOutdated) }

  const read = attempt('policies', () => host.branchProtection(mergeState.baseRefName), REFUSED)
  const protection = read === REFUSED ? null : read
  const rules = attempt('policies', () => host.branchRules(mergeState.baseRefName))
  const unread = [read === REFUSED && 'branch protection', rules === null && 'rulesets'].filter(Boolean)
  // Only with both read can the command say that something open is not required.
  const policiesKnown = unread.length === 0
  // What the two sources require, merged: the largest approval count, every required check, and either one's strict or conversation rule.
  const pullRules = (rules ?? []).filter((r) => r.type === 'pull_request').map((r) => r.parameters ?? {})
  const checkRules = (rules ?? []).filter((r) => r.type === 'required_status_checks').map((r) => r.parameters ?? {})
  const statusChecks = protection?.required_status_checks
  const requiredChecks = [...new Set([...(statusChecks?.contexts ?? []), ...(statusChecks?.checks ?? []).map((c) => c.context), ...checkRules.flatMap((p) => (p.required_status_checks ?? []).map((c) => c.context))])]
  const strict = statusChecks?.strict === true || checkRules.some((p) => p.strict_required_status_checks_policy === true)
  const conversationRequired = protection?.required_conversation_resolution?.enabled === true || pullRules.some((p) => p.required_review_thread_resolution === true)
  const counts = [protection?.required_pull_request_reviews?.required_approving_review_count, ...pullRules.map((p) => p.required_approving_review_count)].filter(Number.isInteger)
  let policies = null
  if (unread.length < 2) {
    const requiredApprovals = counts.length > 0 ? Math.max(...counts) : null
    const approvals = [...verdicts.values()].filter((state) => state === 'APPROVED').length
    const unmet = []
    if (requiredApprovals !== null && approvals < requiredApprovals) {
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
    // A rule whose input read was refused did not run, so it is neither met nor unmet.
    const unevaluated = []
    if (!checkList) unevaluated.push('required checks')
    if (conversationRequired && !threads) unevaluated.push('conversation resolution')
    const rulesets = rules === null ? null : [...new Set(rules.map((r) => r.type))]
    policies = { protected: read === REFUSED ? null : protection !== null, rulesets, unread, requiredApprovals, approvals, requiredChecks, unmet, unreadRule: false, unevaluated }
  }

  // What blocks.
  if (draft) blocking.push({ area: 'draft', message: 'the pull request is a draft' })
  if (conflicts.conflicting) blocking.push({ area: 'conflicts', message: 'merge conflicts with the base branch' })
  if (conflicts.behind && strict) blocking.push({ area: 'conflicts', message: 'the branch is behind the base branch and the protection requires it to be up to date' })
  // GitHub reviewDecision is the word of GitHub, so it blocks without the protection.
  if (reviews.decision === 'CHANGES_REQUESTED') blocking.push({ area: 'reviews', message: reviews.changesRequested.length > 0 ? `changes requested by ${names(reviews.changesRequested)}` : 'changes are requested' })
  else if (reviews.changesRequested.length > 0) {
    const message = `changes requested by ${names(reviews.changesRequested)}`
    // A protection that requires 0 approvals does not require reviews, and GitHub APPROVED outranks one author's request.
    if (reviews.decision === 'APPROVED') pending.push({ area: 'reviews', message })
    else if (policies?.requiredApprovals > 0) blocking.push({ area: 'reviews', message })
    else if (policiesKnown) pending.push({ area: 'reviews', message })
    else unknown.push({ area: 'reviews', message })
  }
  for (const message of policies?.unmet ?? []) blocking.push({ area: 'policies', message })
  if (reviews.decision === 'REVIEW_REQUIRED' && !(policies?.unmet ?? []).some((m) => m.startsWith('needs '))) blocking.push({ area: 'reviews', message: 'a review is required' })
  if (mergeState.mergeStateStatus === 'BLOCKED' && blocking.length === 0) {
    const unevaluated = policies?.unevaluated ?? []
    const unread = [...new Set(unevaluated.map((u) => NEEDS[u]))]
    const reads = [...new Set(unevaluated.map((u) => NEEDS[u]))]
    const rule = ruleText(policies)
    const cause = unevaluated.length > 0 ? `${rule}, or by ${names(unevaluated)}, which it could not evaluate because the ${reads.join(' and ')} were not read` : rule
    blocking.push({ area: 'policies', message: policiesKnown ? cause : UNREAD_PROTECTION })
    if (policies) policies.unreadRule = true
  }

  // What is open. With both policy sources read, what they do not require is pending. Without one, the command cannot tell.
  // A check known to be required is already in blocking, so it is never listed again.
  const open = policiesKnown ? pending : unknown
  if (checks) {
    const optional = (c) => !requiredChecks.includes(c.name)
    const failing = checks.failing.filter(optional)
    const waiting = checks.pending.filter(optional)
    if (failing.length > 0) open.push({ area: 'checks', message: `failing ${names(failing, (c) => c.name)}` })
    if (waiting.length > 0) open.push({ area: 'checks', message: `pending ${names(waiting, (c) => c.name)}` })
  }
  if (anyRequested(reviews)) open.push({ area: 'reviews', message: `waiting for ${waitingFor(reviews)}` })
  if (conflicts.behind && !strict) open.push({ area: 'conflicts', message: 'the branch is behind the base branch' })
  if (threads && unresolved.length > 0 && !conversationRequired) {
    open.push({ area: 'threads', message: `${plural(threads.open.length, 'open thread')}${threads.outdated.length > 0 ? ` and ${plural(threads.outdated.length, 'outdated thread')}` : ''}` })
  }

  const blocked = blocking.length > 0 ? true : unchecked.length > 0 || unknown.length > 0 ? null : false
  return { blocked, blocking, pending, unknown, state: pr.state, draft, checks, reviews, conflicts, threads, policies, unchecked }
}

/** The text of `pr blockers`: the pull request line, the verdict, what blocks, what is pending, then one line per area. */
export function blockersText(pr, found) {
  const head = `#${pr.number} ${pr.title} (${pr.state}${pr.isDraft ? ', draft' : ''})`
  if (found.state !== 'OPEN') return `${head}\nnothing to unblock`
  const notChecked = (area) => `${area}: not checked (${found.unchecked.filter((u) => u.area === area).map((u) => u.message).join('; ') || 'no data'})`
  const verdict = found.blocked === true ? 'blocked' : found.blocked === false ? 'nothing blocks the merge' : 'nothing known blocks the merge, but part of it could not be checked'
  const lines = [head, pr.url, verdict]
  if (found.blocking.length > 0) lines.push(`blocking: ${found.blocking.map((b) => b.message).join('; ')}`)
  if (found.pending.length > 0) lines.push(`pending: ${found.pending.map((p) => p.message).join('; ')}`)
  if (found.unknown.length > 0) lines.push(`may block (the protection could not be read or a read is incomplete): ${found.unknown.map((u) => u.message).join('; ')}`)
  const { checks, reviews, conflicts, threads, policies } = found
  if (checks === null) lines.push(notChecked('checks'))
  else if (checks.failing.length + checks.pending.length === 0) lines.push('checks: none failing or pending')
  else lines.push(`checks: ${[checks.failing.length > 0 && `failing ${names(checks.failing, (c) => (c.runId ? `${c.name} (ci logs --run ${c.runId})` : c.name))}`, checks.pending.length > 0 && `pending ${names(checks.pending, (c) => c.name)}`].filter(Boolean).join('; ')}`)
  {
    const parts = []
    if (reviews.changesRequested.length > 0) parts.push(`changes requested by ${names(reviews.changesRequested)}`)
    if (anyRequested(reviews)) parts.push(`waiting for ${waitingFor(reviews)}`)
    if (parts.length === 0 && reviews.decision === 'REVIEW_REQUIRED') parts.push('a review is required')
    lines.push(`reviews: ${parts.length > 0 ? parts.join('; ') : 'nothing pending'}`)
  }
  if (conflicts.unknown) lines.push(notChecked('conflicts'))
  else lines.push(`conflicts: ${conflicts.conflicting ? 'merge conflicts with the base branch' : conflicts.behind ? 'the branch is behind the base branch' : 'none'}`)
  if (threads === null) lines.push(notChecked('threads'))
  else if (threads.open.length + threads.outdated.length === 0) lines.push('threads: none unresolved')
  else {
    lines.push(`threads: ${threads.open.length} open, ${threads.outdated.length} outdated`)
    for (const t of [...threads.open, ...threads.outdated]) lines.push(`  ${t.path ?? '(no file)'}${t.line ? `:${t.line}` : ''} ${t.author ?? ''} ${t.url ?? ''}`.trimEnd())
  }
  if (policies === null) lines.push(notChecked('policies'))
  else {
    const parts = [...policies.unmet]
    if (policies.unreadRule && parts.length === 0) parts.push(ruleText(policies))
    if (policies.unevaluated.length > 0) parts.push(`not checked: ${names(policies.unevaluated, (u) => `${u} (${NEEDS[u]} unread)`)}`)
    // The refused policy reads are the policies entries of unchecked, in the order of `unread` (protection first).
    const refusals = found.unchecked.filter((u) => u.area === 'policies')
    policies.unread.forEach((source, i) => parts.push(`not read: ${source} (${refusals[i]?.message ?? 'no data'})`))
    const none = policies.protected === false && policies.rulesets?.length === 0
    lines.push(`policies: ${parts.length > 0 ? parts.join('; ') : none ? 'the base branch has no branch protection or ruleset' : 'all met'}`)
  }
  if (found.draft) lines.push('draft: yes, mark it ready for review to merge')
  return lines.join('\n')
}
