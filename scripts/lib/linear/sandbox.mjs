// The Linear sandbox helper: the fixed test team, the write guard and the request budget of the live contract run.
// See docs/superpowers/specs/2026-10-28-pmk-39-linear-sandbox-contract-design.md.
//
// Interface (PMK-41 reuses it). Every function takes the caller's client or fetch, so the caller's guard and counter apply.
// Nothing here reads a file or an environment variable except `preflight`, which reads the env it is given.
//
//   TEST_TEAM                                  { name: 'pmkit-test', key: 'PKT', marker: 'pmkit-contract-team' }
//   findOrCreateTestTeam({ client, guard })    { team: { id, key }, created }. Sends no write when the team exists.
//   listTestTeamItems({ client, team, guard }) { issues, projects } the team holds and are not trashed.
//   trashTestTeamItems({ client, team, guard }) Trashes those issues with issueDelete and those projects with projectDelete.
//   createGuardedFetch({ fetch, workspace, allowlist }) { fetch, guard }. The fetch refuses every mutation the allowlist lacks.
//
// The allowlist maps a mutation root field to (variables, context, document) => reason | null. SUITE_ALLOWLIST holds the 14 mutations of
// the contract run. A caller that needs another mutation passes its own allowlist, built with the exported rule helpers.

import { isMutation, operationName } from './client.mjs'

export const TEST_TEAM = Object.freeze({ name: 'pmkit-test', key: 'PKT', marker: 'pmkit-contract-team' })

const NOT_LISTED = (name) => `refusing ${name}: not in the live run's list`
const BUDGET = 'the live run used its request budget'
/** The queries and mutations that clean up. They keep working after the cap, within the reserve. */
const CLEANUP_MUTATIONS = new Set(['issueDelete', 'projectDelete'])
const SANDBOX_QUERY = /^PmkitSandbox/

/** The root fields of a document's operations, read without a full parser. Strings and comments are blanked first. */
export function rootFields(document) {
  const text = document
    .replace(/#[^\n\r]*/g, '')
    .replace(/"""[\s\S]*?"""/g, '""')
    .replace(/"(?:[^"\\\n]|\\.)*"/g, '""')
  const fields = []
  let depth = 0
  let parens = 0
  let aliased = false
  let definitionStart = true
  let fragment = false
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index]
    if (char === '{') depth += 1
    else if (char === '}') {
      depth -= 1
      if (depth === 0) definitionStart = true
    } else if (char === '(') parens += 1
    else if (char === ')') parens -= 1
    else if (depth === 0 && parens === 0 && definitionStart && /[A-Za-z_]/.test(char)) {
      const name = /^[A-Za-z_]\w*/.exec(text.slice(index))[0]
      fragment = name === 'fragment'
      definitionStart = false
      index += name.length - 1
    } else if (depth === 1 && parens === 0 && !fragment && /[A-Za-z_]/.test(char)) {
      const name = /^[A-Za-z_]\w*/.exec(text.slice(index))[0]
      const before = text.slice(0, index).trimEnd().slice(-1)
      const after = text.slice(index + name.length).trimStart()[0]
      index += name.length - 1
      if (before === '@' || before === '.') continue
      if (after === ':') {
        aliased = true
        continue
      }
      aliased = false
      fields.push(name)
    }
  }
  return aliased ? [] : fields
}

const asList = (value) => (Array.isArray(value) ? value : [])

/** The rule helpers: each returns a reason string or null. */
const rules = {
  owns: (ctx, kind, id, what) => (ctx.owned(kind, id) ? null : `${what} ${id} is not one the run owns`),
  /** The first reason among the checks that the ids a create or update input carries belong to the run. */
  issueInput(ctx, input = {}) {
    if (input.teamId !== undefined && input.teamId !== ctx.teamId) return 'the team is not the test team'
    for (const [field, kind] of [['projectId', 'project'], ['parentId', 'issue'], ['cycleId', 'cycle'], ['stateId', 'state']]) {
      if (input[field] !== undefined && input[field] !== null && !ctx.owned(kind, input[field])) return `${field} is not one the run owns`
    }
    for (const id of asList(input.labelIds)) if (!ctx.labelIds.includes(id)) return `label ${id} is not one of the run's type labels`
    if (input.assigneeId !== undefined && input.assigneeId !== null && input.assigneeId !== ctx.viewerId) return 'assigneeId is not the key owner'
    return null
  },
}

/** The 14 mutations of the contract run. */
export const SUITE_ALLOWLIST = Object.freeze({
  teamCreate(variables, ctx) {
    const input = variables.input ?? {}
    if (ctx.teamExists) return 'the test team exists'
    if (input.copySettingsFromTeamId !== undefined || input.parentId !== undefined) return 'the test team copies no settings and has no parent'
    if (input.name !== TEST_TEAM.name || input.key !== TEST_TEAM.key) return 'name and key must be the test team ones'
    if (typeof input.description !== 'string' || !input.description.includes(TEST_TEAM.marker)) return 'the description lacks the marker'
    return null
  },
  workflowStateCreate: (variables, ctx) => (variables.input?.teamId === ctx.teamId ? null : 'the team is not the test team'),
  cycleStartUpcomingCycleToday: (variables, ctx) => rules.owns(ctx, 'cycle', variables.id, 'cycle'),
  issueCreate: (variables, ctx) => rules.issueInput(ctx, variables.input) ?? (variables.input?.teamId === ctx.teamId ? null : 'the team is not the test team'),
  issueUpdate: (variables, ctx) => rules.owns(ctx, 'issue', variables.id, 'issue') ?? rules.issueInput(ctx, variables.input),
  issueArchive: (variables, ctx) => rules.owns(ctx, 'issue', variables.id, 'issue'),
  issueRelationCreate: (variables, ctx) =>
    rules.owns(ctx, 'issue', variables.input?.issueId, 'issue') ?? rules.owns(ctx, 'issue', variables.input?.relatedIssueId, 'issue'),
  issueRelationDelete: (variables, ctx) => rules.owns(ctx, 'relation', variables.id, 'relation'),
  commentCreate: (variables, ctx) =>
    rules.owns(ctx, 'issue', variables.input?.issueId, 'issue') ??
    (variables.input?.parentId === undefined ? null : rules.owns(ctx, 'comment', variables.input.parentId, 'comment')),
  commentResolve: (variables, ctx) => rules.owns(ctx, 'comment', variables.id, 'comment'),
  projectCreate(variables, ctx) {
    const teams = asList(variables.input?.teamIds)
    return teams.length === 1 && teams[0] === ctx.teamId ? null : 'teamIds must be exactly the test team'
  },
  projectUpdateCreate: (variables, ctx) => rules.owns(ctx, 'project', variables.input?.projectId, 'project'),
  issueDelete: (variables, ctx, document) =>
    variables.permanentlyDelete || /permanentlyDelete\s*:\s*true/.test(document)
      ? 'permanentlyDelete is not allowed'
      : rules.owns(ctx, 'issue', variables.id, 'issue'),
  projectDelete: (variables, ctx) => rules.owns(ctx, 'project', variables.id, 'project'),
})

/** Ids a passing create makes the run's own: [rootField, kind, where the id sits]. */
const CREATES = {
  issueCreate: ['issue', (variables) => variables.input?.id],
  projectCreate: ['project', (variables) => variables.input?.id],
  commentCreate: ['comment', (variables) => variables.input?.id],
  issueRelationCreate: ['relation', (variables) => variables.input?.id],
  workflowStateCreate: ['state', (variables) => variables.input?.id],
  teamCreate: ['team', (variables) => variables.input?.id],
}

const number = (value) => {
  const read = Number(value)
  return value === null || value === undefined || value === '' || !Number.isFinite(read) ? null : read
}

/**
 * Wraps `fetch` for every client of the run. Returns { fetch, guard }.
 * `allowlist` lists the mutations the run may send. `cap` is the request budget and `reserve` the extra requests kept for cleanup.
 */
export function createGuardedFetch({ fetch, workspace, allowlist = SUITE_ALLOWLIST, cap = 1200, reserve = 100 }) {
  const owned = new Map()
  const state = { opened: false, stopping: false, teamExists: false, teamId: null, viewerId: null, labelIds: [] }
  const totals = { requests: 0, writes: 0, complexity: 0, refused: [] }
  let rate = {}

  const ctx = {
    get teamExists() { return state.teamExists },
    get teamId() { return state.teamId },
    get viewerId() { return state.viewerId },
    get labelIds() { return state.labelIds },
    owned: (kind, id) => typeof id === 'string' && owned.get(kind)?.has(id) === true,
  }

  const guard = {
    workspace,
    /** Called by preflight when every check passed. `teamId` is the test team's id when it exists. */
    open({ teamExists, teamId = null, viewerId = null, labelIds = [] }) {
      Object.assign(state, { opened: true, teamExists: teamExists === true, teamId, viewerId, labelIds: [...labelIds] })
    },
    /** Adopts an id as the run's own: an id the run chose, or one it read from the test team. */
    own(kind, id) {
      if (typeof id !== 'string') return
      if (!owned.has(kind)) owned.set(kind, new Set())
      owned.get(kind).add(id)
    },
    /** From now on suite mutations are refused; the deletes of owned ids still pass. */
    stop() { state.stopping = true },
    get stopping() { return state.stopping },
    stats: () => ({ requests: totals.requests, writes: totals.writes, complexity: totals.complexity, rate: { ...rate }, refused: [...totals.refused] }),
  }

  function refuse(message) {
    totals.refused.push(message)
    throw new Error(message)
  }

  function recordRate(headers) {
    for (const bucket of ['requests', 'complexity']) {
      for (const part of ['limit', 'remaining', 'reset']) {
        const value = number(headers.get(`x-ratelimit-${bucket}-${part}`))
        if (value !== null) rate[`${bucket}${part[0].toUpperCase()}${part.slice(1)}`] = value
      }
    }
    totals.complexity += number(headers.get('x-complexity')) ?? 0
  }

  async function guarded(url, init) {
    let body
    try {
      body = JSON.parse(init.body)
    } catch {
      return refuse('refusing a request whose body is not JSON')
    }
    const { query, variables = {} } = body
    const name = operationName(query) ?? '(anonymous)'
    const mutation = isMutation(query)
    let root = null
    if (mutation) {
      const fields = rootFields(query)
      root = fields.length === 1 ? fields[0] : null
      if (root === null) refuse(`refusing ${name}: a mutation must have one root field`)
      const cleanup = CLEANUP_MUTATIONS.has(root)
      if (!state.opened || !Object.hasOwn(allowlist, root)) refuse(NOT_LISTED(name))
      if (state.stopping && !cleanup) refuse(`refusing ${name}: the live run is stopping`)
      const reason = allowlist[root](variables, ctx, query)
      if (reason) refuse(`refusing ${name}: ${reason}`)
    }
    const cleanupRequest = mutation ? CLEANUP_MUTATIONS.has(root) : SANDBOX_QUERY.test(name)
    if (totals.requests >= cap && !(cleanupRequest && totals.requests < cap + reserve)) refuse(`refusing ${name}: ${BUDGET}`)
    totals.requests += 1
    if (mutation) totals.writes += 1
    const response = await fetch(url, init)
    recordRate(response.headers)
    if (mutation && CREATES[root]) {
      const [kind, pick] = CREATES[root]
      guard.own(kind, pick(variables))
      if (root === 'teamCreate') {
        state.teamId = variables.input?.id ?? state.teamId
        state.teamExists = true
      }
    }
    return response
  }

  return { fetch: guarded, guard }
}
