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
// the contract run. A caller that needs another mutation passes its own allowlist with rules of the same shape.
// Before any rule runs, readMutation refuses a document whose root field takes anything but `id: $id` and/or `input: $input`.
// Each suite rule also refuses an input key off SUITE_INPUT_KEYS, so an id the rules do not check never reaches Linear.

import { randomUUID } from 'node:crypto'

import { PmkitError } from '../errors.mjs'
import { isMutation, operationName } from './client.mjs'
import { linearCredential } from './credential.mjs'

export const TEST_TEAM = Object.freeze({ name: 'pmkit-test', key: 'PKT', marker: 'pmkit-contract-team' })

const NOT_LISTED = (name) => `refusing ${name}: not in the live run's list`
const BUDGET = 'the live run used its request budget'
/** The queries and mutations that clean up. They keep working after the cap, within the reserve. */
const CLEANUP_MUTATIONS = new Set(['issueDelete', 'projectDelete'])
const SANDBOX_QUERY = /^PmkitSandbox/

const TOKEN = /[\s,\uFEFF]+|#[^\n\r]*|"""(?:[^"\\]|\\[\s\S]|"(?!""))*"""|"(?:[^"\\\n\r]|\\.)*"|\.\.\.|[!$&():=@[\]{|}]|-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?|[A-Za-z_]\w*/y

/** The tokens of a GraphQL document, without blanks, commas and comments. Null when a character fits no token. */
function tokenize(document) {
  const tokens = []
  TOKEN.lastIndex = 0
  while (TOKEN.lastIndex < document.length) {
    const match = TOKEN.exec(document)
    if (!match) return null
    const text = match[0]
    if (/^[\s,\uFEFF#]/.test(text)) continue
    tokens.push(text)
  }
  return tokens
}

const NAME = /^[A-Za-z_]\w*$/
/** The only arguments a mutation's root field may take, each bound to the variable of the same name. */
const ROOT_ARGUMENTS = new Set(['id', 'input'])

class Unread extends Error {}

/**
 * Reads a mutation document for the guard. Returns { root, variables, reason }: `root` the one root field, `variables` the names the
 * operation defines, `reason` why the guard refuses the shape, or null. The accepted shape is one mutation operation whose root
 * selection is one unaliased field with no directive, whose arguments are `id: $id` and/or `input: $input`, and whose variables are
 * `$id` and/or `$input` with no default. The root selection holds no fragment, and no fragment is defined on Mutation; fragments
 * below the root field stay allowed.
 */
export function readMutation(document) {
  const tokens = typeof document === 'string' ? tokenize(document) : null
  if (tokens === null) return { root: null, variables: [], reason: 'the document cannot be read' }
  let at = 0
  const peek = () => tokens[at]
  const next = () => {
    if (at >= tokens.length) throw new Unread('the document ends early')
    return tokens[at++]
  }
  const expect = (token) => {
    if (next() !== token) throw new Unread(`expected ${token}`)
  }
  const name = () => {
    const token = next()
    if (!NAME.test(token)) throw new Unread(`expected a name, found ${token}`)
    return token
  }
  /** Skips a balanced group that opens at the current token. */
  const skipGroup = () => {
    const open = next()
    const close = { '{': '}', '(': ')', '[': ']' }[open]
    if (!close) throw new Unread(`expected a group, found ${open}`)
    for (let depth = 1; depth > 0;) {
      const token = next()
      if (token === open) depth += 1
      else if (token === close) depth -= 1
    }
  }
  const skipType = () => {
    if (peek() === '[') skipGroup()
    else name()
    if (peek() === '!') next()
  }

  const operations = []
  try {
    while (at < tokens.length) {
      if (peek() === '{') throw new Unread('a query shorthand in a mutation document')
      const keyword = name()
      if (keyword === 'fragment') {
        name()
        expect('on')
        if (name() === 'Mutation') throw new Unread('a fragment is defined on Mutation')
        while (peek() !== '{') next()
        skipGroup()
        continue
      }
      if (!['query', 'mutation', 'subscription'].includes(keyword)) throw new Unread(`unknown definition ${keyword}`)
      const operation = { keyword, variables: [], fields: [] }
      operations.push(operation)
      if (NAME.test(peek())) name()
      if (peek() === '(') {
        next()
        while (peek() !== ')') {
          expect('$')
          operation.variables.push(name())
          expect(':')
          skipType()
          if (peek() === '=') throw new Unread(`the variable $${operation.variables.at(-1)} has a default`)
          if (peek() === '@') throw new Unread('a variable has a directive')
        }
        next()
      }
      if (peek() === '@') throw new Unread('the operation has a directive')
      expect('{')
      while (peek() !== '}') {
        // A spread or an inline fragment here could add a second root field the guard never sees.
        if (peek() === '...') throw new Unread('the root selection holds a fragment')
        const field = { name: name(), args: [] }
        if (peek() === ':') throw new Unread('the root field has an alias')
        if (peek() === '(') {
          next()
          while (peek() !== ')') {
            const argument = name()
            expect(':')
            if (next() !== '$') throw new Unread(`the argument ${argument} is not a variable`)
            field.args.push([argument, name()])
          }
          next()
        }
        if (peek() === '@') throw new Unread('the root field has a directive')
        if (peek() === '{') skipGroup()
        operation.fields.push(field)
      }
      next()
    }
  } catch (error) {
    if (error instanceof Unread) return { root: null, variables: [], reason: error.message }
    throw error
  }

  const refused = (reason) => ({ root: null, variables: [], reason })
  if (operations.length !== 1 || operations[0].keyword !== 'mutation') return refused('the document must hold one mutation and no other operation')
  const [{ variables, fields }] = operations
  if (fields.length !== 1) return refused('a mutation must have one root field')
  const [field] = fields
  for (const variable of variables) {
    if (!ROOT_ARGUMENTS.has(variable)) return refused(`the variable $${variable} is not $id or $input`)
  }
  if (new Set(variables).size !== variables.length) return refused('a variable is defined twice')
  const seen = new Set()
  for (const [argument, variable] of field.args) {
    if (!ROOT_ARGUMENTS.has(argument) || argument !== variable) return refused(`the argument ${argument}: $${variable} is not id: $id or input: $input`)
    if (seen.has(argument)) return refused(`the argument ${argument} is given twice`)
    if (!variables.includes(variable)) return refused(`the variable $${variable} is not defined`)
    seen.add(argument)
  }
  return { root: field.name, variables, reason: null }
}

const asList = (value) => (Array.isArray(value) ? value : [])

/**
 * Reads a document that is not a mutation. Returns { subscription, fields, reason }: `subscription` is true when any operation is a
 * subscription, `fields` the root field names of every operation, `reason` why the document cannot be read, or null. Arguments and
 * variable defaults may hold literals here, since a query takes them. A fragment spread in a root selection cannot be read.
 */
function readRoots(document) {
  const tokens = typeof document === 'string' ? tokenize(document) : null
  if (tokens === null) return { subscription: false, fields: [], reason: 'the document cannot be read' }
  let at = 0
  const next = () => {
    if (at >= tokens.length) throw new Unread('the document ends early')
    return tokens[at++]
  }
  const skipGroup = () => {
    const open = next()
    const close = { '{': '}', '(': ')', '[': ']' }[open]
    if (!close) throw new Unread(`expected a group, found ${open}`)
    for (let depth = 1; depth > 0;) {
      const token = next()
      if (token === open) depth += 1
      else if (token === close) depth -= 1
    }
  }
  const skipDirectives = () => {
    while (tokens[at] === '@') {
      next()
      next()
      if (tokens[at] === '(') skipGroup()
    }
  }
  const fields = []
  let subscription = false
  try {
    while (at < tokens.length) {
      const keyword = tokens[at] === '{' ? 'query' : next()
      if (keyword === 'fragment') {
        next()
        next()
        if (next() === 'Mutation') throw new Unread('a fragment is defined on Mutation')
        skipDirectives()
        skipGroup()
        continue
      }
      if (!['query', 'mutation', 'subscription'].includes(keyword)) throw new Unread(`unknown definition ${keyword}`)
      if (keyword === 'subscription') subscription = true
      if (NAME.test(tokens[at] ?? '')) next()
      if (tokens[at] === '(') skipGroup()
      skipDirectives()
      if (tokens[at] !== '{') throw new Unread('expected a selection')
      next()
      while (tokens[at] !== '}') {
        if (at >= tokens.length) throw new Unread('the document ends early')
        if (tokens[at] === '...') throw new Unread('the root selection holds a fragment')
        let name = next()
        if (!NAME.test(name)) throw new Unread(`expected a name, found ${name}`)
        if (tokens[at] === ':') {
          next()
          fields.push(name)
          name = next()
        }
        fields.push(name)
        if (tokens[at] === '(') skipGroup()
        skipDirectives()
        if (tokens[at] === '{') skipGroup()
      }
      next()
    }
  } catch (error) {
    if (error instanceof Unread) return { subscription, fields, reason: error.message }
    throw error
  }
  return { subscription, fields, reason: null }
}

const MUTATION_NAME = /(Create|Update|Delete|Archive|Unarchive)$/
const isMutationName = (name, allowlist) => Object.hasOwn(allowlist, name) || Object.hasOwn(SUITE_INPUT_KEYS, name) || MUTATION_NAME.test(name)

/** The rule helpers: each returns a reason string or null. */
const rules = {
  /** A string equal to the test team's id. A null id never matches, even while the team does not exist yet. */
  team: (ctx, id) => (typeof id === 'string' && id === ctx.teamId ? null : 'the team is not the test team'),
  owns: (ctx, kind, id, what) => (ctx.owned(kind, id) ? null : `${what} ${id} is not one the run owns`),
  /** The first reason among the checks that the ids a create or update input carries belong to the run. */
  issueInput(ctx, input = {}) {
    if (input.teamId !== undefined && rules.team(ctx, input.teamId)) return 'the team is not the test team'
    for (const [field, kind] of [['projectId', 'project'], ['parentId', 'issue'], ['cycleId', 'cycle'], ['stateId', 'state']]) {
      if (input[field] !== undefined && input[field] !== null && !ctx.owned(kind, input[field])) return `${field} is not one the run owns`
    }
    if (input.labelIds !== undefined && !Array.isArray(input.labelIds)) return 'labelIds is not a list'
    for (const id of asList(input.labelIds)) if (!ctx.labelIds.includes(id)) return `label ${id} is not one of the run's type labels`
    if (input.assigneeId !== undefined && input.assigneeId !== null && input.assigneeId !== ctx.viewerId) return 'assigneeId is not the key owner'
    return null
  },
}

/** The fields of an issue input the adapter sends (writes.mjs toInput). Every id among them is checked by rules.issueInput. */
const ISSUE_KEYS = ['title', 'description', 'priority', 'estimate', 'dueDate', 'stateId', 'labelIds', 'assigneeId', 'parentId', 'projectId', 'cycleId']

/**
 * The input keys each mutation may carry: the ones the adapter and the run send. A key off the list is refused, so an id the guard
 * does not check never reaches Linear. `id` is the id the run chooses for a new node.
 */
export const SUITE_INPUT_KEYS = Object.freeze({
  teamCreate: ['id', 'name', 'key', 'description', 'timezone', 'triageEnabled', 'cyclesEnabled', 'cycleDuration', 'cycleCooldownTime', 'cycleStartDay',
    'upcomingCycleCount', 'cycleIssueAutoAssignStarted', 'cycleIssueAutoAssignCompleted', 'groupIssueHistory'],
  workflowStateCreate: ['id', 'teamId', 'type', 'name', 'color'],
  issueCreate: ['id', 'teamId', ...ISSUE_KEYS],
  issueUpdate: ISSUE_KEYS,
  issueRelationCreate: ['id', 'type', 'issueId', 'relatedIssueId'],
  commentCreate: ['id', 'issueId', 'body', 'parentId'],
  projectCreate: ['id', 'name', 'startDate', 'targetDate', 'content', 'teamIds'],
  projectUpdateCreate: ['id', 'projectId', 'body', 'health'],
})

/** Wraps a rule so it first refuses an input that is not an object or holds a key off the mutation's list, or any input when the list is absent. */
function checked(root, rule) {
  const keys = SUITE_INPUT_KEYS[root]
  return (variables, ctx, document) => {
    const { input } = variables
    if (!keys) return input === undefined ? rule(variables, ctx, document) : `${root} takes no input`
    if (input === null || typeof input !== 'object' || Array.isArray(input)) return 'the input is not an object'
    const extra = Object.keys(input).find((key) => !keys.includes(key))
    return extra === undefined ? rule(variables, ctx, document) : `the input key ${extra} is not one ${root} may carry`
  }
}

const SUITE_RULES = {
  teamCreate(variables, ctx) {
    const input = variables.input ?? {}
    if (ctx.teamExists) return 'the test team exists'
    if (input.copySettingsFromTeamId !== undefined || input.parentId !== undefined) return 'the test team copies no settings and has no parent'
    if (input.name !== TEST_TEAM.name || input.key !== TEST_TEAM.key) return 'name and key must be the test team ones'
    if (typeof input.description !== 'string' || !input.description.includes(TEST_TEAM.marker)) return 'the description lacks the marker'
    return null
  },
  workflowStateCreate: (variables, ctx) => rules.team(ctx, variables.input?.teamId),
  cycleStartUpcomingCycleToday: (variables, ctx) => rules.owns(ctx, 'cycle', variables.id, 'cycle'),
  issueCreate: (variables, ctx) => rules.issueInput(ctx, variables.input) ?? rules.team(ctx, variables.input?.teamId),
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
    return teams.length === 1 && rules.team(ctx, teams[0]) === null ? null : 'teamIds must be exactly the test team'
  },
  projectUpdateCreate: (variables, ctx) => rules.owns(ctx, 'project', variables.input?.projectId, 'project'),
  // readMutation lets through no argument but id, so permanentlyDelete cannot be sent.
  issueDelete: (variables, ctx) => rules.owns(ctx, 'issue', variables.id, 'issue'),
  projectDelete: (variables, ctx) => rules.owns(ctx, 'project', variables.id, 'project'),
}

/** The 14 mutations of the contract run, each behind its input-key check. */
export const SUITE_ALLOWLIST = Object.freeze(Object.fromEntries(Object.entries(SUITE_RULES).map(([root, rule]) => [root, checked(root, rule)])))

/** The kind of id a create makes the run's own, and the payload field of its answer that carries the new node. */
const CREATES = {
  issueCreate: ['issue', 'issue'],
  projectCreate: ['project', 'project'],
  commentCreate: ['comment', 'comment'],
  issueRelationCreate: ['relation', 'issueRelation'],
  workflowStateCreate: ['state', 'workflowState'],
  teamCreate: ['team', 'team'],
}

/** The id of the node a create answer reports, or null unless the answer says success: true and carries a string id. */
function createdId(text, root) {
  let payload
  try {
    payload = JSON.parse(text)?.data?.[root]
  } catch {
    return null
  }
  const id = payload?.[CREATES[root][1]]?.id
  return payload?.success === true && typeof id === 'string' ? id : null
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
    // Linear runs each entry of an array body, and the checks below read one operation, so a batch never passes.
    if (Array.isArray(body)) return refuse('refusing a batch request')
    if (typeof body?.query !== 'string') return refuse('refusing a request whose query is not a string')
    const { query, variables = {} } = body
    const name = operationName(query) ?? '(anonymous)'
    const mutation = isMutation(query)
    let root = null
    if (!mutation) {
      const read = readRoots(query)
      if (read.reason) refuse(`refusing ${name}: ${read.reason}`)
      if (read.subscription) refuse(`refusing ${name}: a subscription is not sent`)
      const field = read.fields.find((candidate) => isMutationName(candidate, allowlist))
      if (field !== undefined) refuse(`refusing ${name}: the query names the mutation field ${field}`)
    }
    if (mutation) {
      const read = readMutation(query)
      if (read.reason) refuse(`refusing ${name}: ${read.reason}`)
      root = read.root
      if (variables === null || typeof variables !== 'object' || Array.isArray(variables)) refuse(`refusing ${name}: the variables are not an object`)
      const extra = Object.keys(variables).find((key) => !read.variables.includes(key))
      if (extra !== undefined) refuse(`refusing ${name}: the variable ${extra} is not one the document defines`)
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
    if (!mutation || !CREATES[root]) return response
    // The guard reads the answer once and hands the client a copy, so the client can still read the text.
    let text
    try {
      text = await response.text()
    } catch (error) {
      return { status: response.status, ok: response.ok, headers: response.headers, text: async () => { throw error } }
    }
    const id = createdId(text, root)
    if (id !== null) {
      guard.own(CREATES[root][0], id)
      if (root === 'teamCreate') Object.assign(state, { teamId: id, teamExists: true })
    }
    return { status: response.status, ok: response.ok, headers: response.headers, text: async () => text }
  }

  return { fetch: guarded, guard }
}

const PAGE_INFO = 'pageInfo { hasNextPage endCursor }'
const TEAM_FIELDS = 'id key name description archivedAt cyclesEnabled triageEnabled'

export const TEAMS_QUERY = `query PmkitSandboxTeams { organization { subscription { id } } teams(includeArchived: true, first: 100) { nodes { ${TEAM_FIELDS} } } }`
export const TEAM_ISSUES_QUERY = `query PmkitSandboxIssues($id: ID!, $first: Int!, $after: String) {
  issues(filter: { team: { id: { eq: $id } } }, includeArchived: true, first: $first, after: $after) { nodes { id identifier trashed archivedAt } ${PAGE_INFO} }
}`
export const TEAM_PROJECTS_QUERY = `query PmkitSandboxProjects($id: ID!, $first: Int!, $after: String) {
  projects(filter: { accessibleTeams: { some: { id: { eq: $id } } } }, includeArchived: true, first: $first, after: $after) { nodes { id name trashed archivedAt teams { nodes { id } } } ${PAGE_INFO} }
}`
export const LABELS_QUERY = `query PmkitSandboxLabels($first: Int!, $after: String) {
  issueLabels(first: $first, after: $after) { nodes { id name isGroup retiredAt team { id } } ${PAGE_INFO} }
}`

const TYPE_LABELS = [['bug', 'Bug'], ['feature', 'Feature']]
const MIN_REQUESTS = 1700
const MIN_COMPLEXITY = 1_500_000

/**
 * The reason a team node is not the test team, or null when it is. The run never edits the team, so a mismatch stops it.
 * The name is the lookup key, so only key, marker, archive date, cycles and triage are checked here.
 */
export function checkTestTeam(node) {
  if (node.key !== TEST_TEAM.key) return `the test team ${TEST_TEAM.name} has the key ${node.key}, not ${TEST_TEAM.key}`
  if (typeof node.description !== 'string' || !node.description.includes(TEST_TEAM.marker)) {
    return `the test team ${TEST_TEAM.name} has no ${TEST_TEAM.marker} marker in its description`
  }
  if (node.archivedAt) return `the test team ${TEST_TEAM.name} is archived`
  if (node.cyclesEnabled !== true) return `the test team ${TEST_TEAM.name} has cycles turned off`
  if (node.triageEnabled !== true) return `the test team ${TEST_TEAM.name} has triage turned off`
  return null
}

const stop = (code, message, nextStep) => new PmkitError(code, message, nextStep)

/** The issues of the team that are not trashed, archived ones included. */
async function teamIssues(client, team) {
  const { nodes } = await client.paginate(TEAM_ISSUES_QUERY, { id: team.id }, { select: (data) => data.issues, pageSize: 100, maxPages: 20 })
  return nodes.filter((node) => node.trashed !== true)
}

/** The open projects of the team: not trashed, not archived. */
async function teamProjects(client, team) {
  const { nodes } = await client.paginate(TEAM_PROJECTS_QUERY, { id: team.id }, { select: (data) => data.projects, pageSize: 100, maxPages: 20 })
  return nodes.filter((node) => node.trashed !== true && !node.archivedAt)
}

/**
 * The checks that run before the first write. Sends queries only. Returns { team: null | { id, key }, viewer, labels }
 * and opens the guard. With requireEmpty false (the cleanup command) a team that holds items passes.
 */
export async function preflight({ client, env, workspace, guard, requireEmpty = true }) {
  if (env.PMKIT_LIVE !== '1') throw stop('NOT_CONFIGURED', 'set PMKIT_LIVE=1 to run the live check', 'Export PMKIT_LIVE=1')
  if (!workspace) throw stop('NOT_CONFIGURED', 'set PMKIT_LIVE_WORKSPACE to the sandbox workspace URL key', 'Export PMKIT_LIVE_WORKSPACE')
  try {
    linearCredential(env)
  } catch (error) {
    throw stop('AUTH', `LINEAR_API_KEY is not usable: ${error.message}`, 'Export LINEAR_API_KEY')
  }
  const notSandbox = () => stop('AUTH', 'the key does not belong to the sandbox workspace named by PMKIT_LIVE_WORKSPACE', 'Export a key created in the sandbox workspace')
  let session
  try {
    session = await client.session()
  } catch (error) {
    if (error?.code === 'AUTH' && /belongs to workspace/.test(error.message)) throw notSandbox()
    throw error
  }
  if (session.workspace.urlKey !== workspace || session.warnings.length > 0) throw notSandbox()

  const { teams, plan } = await readTeams(client)
  const found = teams.find((node) => node.name === TEST_TEAM.name)
  if (found) {
    const reason = checkTestTeam(found)
    if (reason) throw stop('INVALID_INPUT', reason, 'Fix the team in Linear, or delete it, then run again')
  } else {
    const keyed = teams.find((node) => node.key === TEST_TEAM.key)
    if (keyed) throw stop('INVALID_INPUT', `a team that is not ${TEST_TEAM.name} uses the key ${TEST_TEAM.key}`, 'Rename or delete that team in Linear')
    if (plan === null && teams.length >= 2) {
      throw stop('INVALID_INPUT', 'the Free plan allows two teams, the workspace has two, and the test team does not exist', 'Delete a team in Linear, or upgrade the plan')
    }
  }
  if (found && requireEmpty) {
    const [issues, projects] = [await teamIssues(client, found), await teamProjects(client, found)]
    if (issues.length > 0 || projects.length > 0) {
      throw stop('CONFLICT', 'the test team holds items from an earlier run; run contract-live.mjs cleanup', 'node scripts/lib/linear/contract-live.mjs cleanup')
    }
  }

  const { nodes: labelNodes } = await client.paginate(LABELS_QUERY, {}, { select: (data) => data.issueLabels, pageSize: 100 })
  const labels = {}
  for (const [key, name] of TYPE_LABELS) {
    const match = labelNodes.find((node) => node.name === name && !node.team && !node.isGroup && !node.retiredAt)
    if (!match) throw stop('INVALID_INPUT', `the workspace has no label named ${name}`, `Create a ${name} label in Linear`)
    labels[key] = match.id
  }

  const rate = client.rateLimit()
  if (!rate) throw stop('UPSTREAM', 'Linear sent no rate-limit headers', 'Run again; if it keeps failing, check status.linear.app')
  for (const [bucket, minimum] of [['requests', MIN_REQUESTS], ['complexity', MIN_COMPLEXITY]]) {
    const left = rate[bucket].remaining
    if (left !== null && left < minimum) {
      const reset = rate[bucket].resetAt ?? 'the window resets'
      throw stop('RATE_LIMITED', `only ${left} ${bucket} are left, the live run needs ${minimum}; the window resets at ${reset}`, `Wait until ${reset} and run again`)
    }
  }

  const team = found ? { id: found.id, key: found.key } : null
  guard.open({ teamExists: Boolean(found), teamId: team?.id ?? null, viewerId: session.viewer.id, labelIds: Object.values(labels) })
  return { team, viewer: session.viewer, labels }
}

async function readTeams(client) {
  const data = await client.request(TEAMS_QUERY)
  return { teams: data.teams.nodes, plan: data.organization?.subscription ?? null }
}

export const TEAM_BY_NAME_QUERY = `query PmkitSandboxTeam($name: String!) { teams(filter: { name: { eq: $name } }, includeArchived: true, first: 5) { nodes { ${TEAM_FIELDS} } } }`
export const TEAM_BY_ID_QUERY = `query PmkitSandboxTeamById($id: ID!) { teams(filter: { id: { eq: $id } }, includeArchived: true, first: 1) { nodes { ${TEAM_FIELDS} } } }`
export const TEAM_CREATE = 'mutation PmkitSandboxTeamCreate($input: TeamCreateInput!) { teamCreate(input: $input) { success team { id key } } }'
export const STATES_QUERY = 'query PmkitSandboxStates($id: String!) { team(id: $id) { states(first: 100) { nodes { id name type } } } }'
export const STATE_CREATE = 'mutation PmkitSandboxStateCreate($input: WorkflowStateCreateInput!) { workflowStateCreate(input: $input) { success workflowState { id } } }'

const DESCRIPTION = `Test team for the pmkit contract tests (marker: ${TEST_TEAM.marker}). They create and trash items here. Do not use it for real work.`
const REVIEW_STATE = { type: 'started', name: 'In Review', color: '#f2c94c' }

/** The teamCreate input of the spec's table. The first cycle starts today (UTC weekday) and two cycles follow. */
export function teamCreateInput({ id, now }) {
  return {
    id, name: TEST_TEAM.name, key: TEST_TEAM.key, description: DESCRIPTION, timezone: 'Etc/UTC', triageEnabled: true,
    cyclesEnabled: true, cycleDuration: 1, cycleCooldownTime: 0, cycleStartDay: now.getUTCDay(), upcomingCycleCount: 2,
    cycleIssueAutoAssignStarted: false, cycleIssueAutoAssignCompleted: false, groupIssueHistory: false,
  }
}

async function lookup(client, document, variables) {
  const [node] = (await client.request(document, variables)).teams.nodes
  return node
}

/**
 * Finds the test team by name or creates it once, then makes sure it has a triage state and an "In Review" started state.
 * Returns { team: { id, key }, created }. Sends no write when the team and both states exist.
 */
export async function findOrCreateTestTeam({ client, guard, now = () => new Date(), uuid = randomUUID }) {
  let node = await lookup(client, TEAM_BY_NAME_QUERY, { name: TEST_TEAM.name })
  let created = false
  if (node) {
    const reason = checkTestTeam(node)
    if (reason) throw stop('INVALID_INPUT', reason, 'Fix the team in Linear, or delete it, then run again')
  } else {
    const id = uuid()
    try {
      await client.request(TEAM_CREATE, { input: teamCreateInput({ id, now: now() }) })
    } catch (error) {
      // The run chose the id, so it can tell whether Linear applied a create whose answer never came.
      node = await lookup(client, TEAM_BY_ID_QUERY, { id }).catch(() => undefined)
      if (!node) throw error
    }
    node ??= { id, key: TEST_TEAM.key }
    created = true
  }
  const team = { id: node.id, key: node.key }
  await ensureStates(client, team, guard)
  return { team, created }
}

async function ensureStates(client, team, guard) {
  const states = (await client.request(STATES_QUERY, { id: team.id })).team.states.nodes
  for (const state of states) guard?.own('state', state.id)
  if (!states.some((state) => state.type === 'triage')) throw stop('INVALID_INPUT', 'the test team has no triage state', 'Turn on triage in the test team in Linear')
  if (states.some((state) => state.type === 'started' && state.name === REVIEW_STATE.name)) return
  await client.request(STATE_CREATE, { input: { id: randomUUID(), teamId: team.id, ...REVIEW_STATE } })
}

export const CYCLES_QUERY = 'query PmkitSandboxCycles($id: String!) { team(id: $id) { cycles(first: 10) { nodes { id number startsAt endsAt isActive isFuture isPast completedAt } } } }'
export const CYCLE_START = 'mutation PmkitSandboxCycleStart($id: String!) { cycleStartUpcomingCycleToday(id: $id) { success } }'

const defaultSleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

/**
 * Waits until the test team has an active and a planned cycle. The team's schedule makes them. When a planned cycle exists and none
 * is active after the reads, it sends one cycleStartUpcomingCycleToday with the next cycle's id and reads again.
 * Returns { active, planned } as the cycle nodes. Fails with the missing state.
 */
export async function waitForCycles({ client, team, guard, sleep = defaultSleep, reads = 10, intervalMs = 2000 }) {
  async function readUntilBoth() {
    let latest = {}
    for (let read = 0; read < reads; read += 1) {
      const nodes = (await client.request(CYCLES_QUERY, { id: team.id })).team.cycles.nodes
      for (const node of nodes) guard?.own('cycle', node.id)
      const planned = nodes.filter((node) => node.isFuture === true).sort((a, b) => Date.parse(a.startsAt) - Date.parse(b.startsAt))
      latest = { active: nodes.find((node) => node.isActive === true), planned: planned[0] }
      if (latest.active && latest.planned) return latest
      if (read + 1 < reads) await sleep(intervalMs)
    }
    return latest
  }
  let found = await readUntilBoth()
  if (!found.active && found.planned) {
    await client.request(CYCLE_START, { id: found.planned.id })
    found = await readUntilBoth()
  }
  for (const state of ['active', 'planned']) {
    if (!found[state]) throw stop('INVALID_INPUT', `the test team has no ${state} cycle`, 'Check the cycle settings of the test team in Linear')
  }
  return found
}

export const ISSUE_DELETE = 'mutation PmkitSandboxIssueDelete($id: String!) { issueDelete(id: $id) { success } }'
export const PROJECT_DELETE = 'mutation PmkitSandboxProjectDelete($id: String!) { projectDelete(id: $id) { success } }'

/**
 * What the test team holds: { issues, projects }. Issues are those not trashed, archived ones included. Projects are the open
 * ones whose only team is the test team. The ids are adopted by the guard, so the deletes below pass it.
 */
export async function listTestTeamItems({ client, team, guard }) {
  const issues = await teamIssues(client, team)
  const projects = (await teamProjects(client, team)).filter((project) => {
    const owners = project.teams?.nodes ?? []
    return owners.length === 1 && owners[0].id === team.id
  })
  for (const issue of issues) guard?.own('issue', issue.id)
  for (const project of projects) guard?.own('project', project.id)
  return { issues, projects }
}

/** Trashes the items listTestTeamItems returns: issueDelete without permanentlyDelete, then projectDelete. Returns the counts. */
export async function trashTestTeamItems({ client, team, guard }) {
  const { issues, projects } = await listTestTeamItems({ client, team, guard })
  for (const issue of issues) await client.request(ISSUE_DELETE, { id: issue.id })
  for (const project of projects) await client.request(PROJECT_DELETE, { id: project.id })
  return { issues: issues.length, projects: projects.length }
}
