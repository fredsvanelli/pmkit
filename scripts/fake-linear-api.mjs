// A fake `fetch` for the Linear GraphQL API. Routes are keyed by GraphQL operation name.
// A route is a response, a list of responses (the Nth call gets item N, the last repeats),
// or a function of the parsed body that returns a response.
// A response is { status, headers, json | text }, { throws: error }, { hang: true } or { textRejects: true }.
import { operationName } from './lib/linear/client.mjs'

export const FAKE_KEY = 'lin_api_TESTKEYTESTKEYTESTKEY'

/** A Relay connection object. */
export function page(nodes, { hasNextPage = false, endCursor = null } = {}) {
  return { pageInfo: { hasNextPage, endCursor }, nodes }
}

/** A route response with `data` as the GraphQL data. */
export function json(data, { status = 200, headers = {} } = {}) {
  return { status, headers, json: { data } }
}

function sessionRoute(workspace, previousUrlKeys) {
  return json({
    viewer: { id: 'user-1', name: 'Test User' },
    organization: { urlKey: workspace, name: workspace === 'acme' ? 'Acme' : workspace, previousUrlKeys },
  })
}

function toResponse(answer) {
  const status = answer.status ?? 200
  const text = answer.text ?? (answer.json === undefined ? '' : JSON.stringify(answer.json))
  return {
    status,
    ok: status >= 200 && status < 300,
    headers: new Headers(answer.headers ?? {}),
    text: async () => {
      if (answer.textRejects) throw new TypeError('terminated')
      return text
    },
  }
}

// AbortSignal.timeout uses an unref'd timer, so a pending promise alone would let the test process exit.
// A ref'd timer keeps the event loop alive until the signal aborts.
function hang(signal) {
  return new Promise((resolve, reject) => {
    if (!signal) return
    if (signal.aborted) return reject(signal.reason)
    const keepAlive = setInterval(() => {}, 1000)
    signal.addEventListener(
      'abort',
      () => {
        clearInterval(keepAlive)
        reject(signal.reason)
      },
      { once: true },
    )
  })
}

export function fakeLinearFetch(routes = {}, { workspace = 'acme', previousUrlKeys = [] } = {}) {
  const table = { PmkitSession: sessionRoute(workspace, previousUrlKeys), ...routes }
  const counts = new Map()
  async function fetch(url, init = {}) {
    const body = JSON.parse(init.body)
    fetch.calls.push({ url, method: init.method, headers: { ...init.headers }, body })
    const name = operationName(body.query) ?? '(anonymous)'
    const route = table[name]
    if (route === undefined) {
      fetch.unrouted.push(name)
      throw new Error(`fake linear: no route for ${name}`)
    }
    const seen = counts.get(name) ?? 0
    counts.set(name, seen + 1)
    const answer = typeof route === 'function' ? route(body) : Array.isArray(route) ? route[Math.min(seen, route.length - 1)] : route
    if (answer.throws) throw answer.throws
    if (answer.hang) return hang(init.signal)
    return toResponse(answer)
  }
  fetch.calls = []
  fetch.unrouted = []
  return fetch
}

export const ACME_TEAM_ID = 'team-acme'

const acmeTeam = {
  id: ACME_TEAM_ID,
  key: 'ACME',
  name: 'Acme',
  parent: null,
  cyclesEnabled: false,
  triageEnabled: false,
  issueEstimationType: 'notUsed',
  issueEstimationAllowZero: false,
  issueEstimationExtended: false,
}

const ACME_STATES = [
  ['Backlog', 'backlog'],
  ['Todo', 'unstarted'],
  ['In Progress', 'started'],
  ['In Review', 'started'],
  ['Code Review', 'started'],
  ['UAT', 'started'],
  ['Ready to ship', 'started'],
  ['Done', 'completed'],
  ['Canceled', 'canceled'],
  ['Duplicate', 'duplicate'],
].map(([name, type], index) => ({ id: `state-${index + 1}`, name, type, position: index, team: { id: ACME_TEAM_ID } }))

const label = (id, name, { team = ACME_TEAM_ID, parent = null, isGroup = false, retiredAt = null } = {}) => ({
  id,
  name,
  isGroup,
  retiredAt,
  team: team === null ? null : { id: team },
  parent,
})

const SIZE = { id: 'label-size', name: 'Size' }
const ACME_LABELS = [
  label('label-bug', 'Bug'),
  label('label-feature', 'Feature'),
  label(SIZE.id, SIZE.name, { isGroup: true }),
  ...['XS', 'S', 'M', 'L', 'XL'].map((name) => label(`label-${name.toLowerCase()}`, name, { parent: SIZE })),
  label('label-docs', 'Docs', { team: null }),
  label('label-old', 'Old', { retiredAt: '2026-01-01T00:00:00.000Z' }),
]

const user = (id, name, extra = {}) => ({
  id,
  name,
  displayName: name.toLowerCase().replace(/\s+/g, '.'),
  email: `${id}@example.com`,
  active: true,
  guest: false,
  app: false,
  teams: { nodes: [{ id: ACME_TEAM_ID }] },
  ...extra,
})

const ACME_USERS = [
  user('user-1', 'Test User'),
  user('user-2', 'Ada Lovelace', { displayName: 'ada', email: 'ada@example.com' }),
  user('user-3', 'Gone', { active: false }),
  user('user-4', 'Linear', { app: true }),
]

const refused = { status: 200, json: { data: null, errors: [{ message: 'Forbidden', extensions: { code: 'FORBIDDEN' } }] } }

/**
 * Routes for the discovery operations over a small workspace, shaped like the sandbox workspace with acme names.
 * Pass them as fakeLinearFetch(fakeWorkspace(options)). Connection routes page by variables.first and variables.after;
 * the cursor is the index of the next node as a string.
 */
export function fakeWorkspace({
  urlKey = 'acme',
  name = 'Acme',
  subscription = null,
  trialEndsAt = null,
  releasesEnabled = false,
  customersEnabled = false,
  integrations = ['githubCodeAccessPersonal'],
  teams = [acmeTeam],
  states = ACME_STATES,
  labels = ACME_LABELS,
  users = ACME_USERS,
  refuse = [],
  endless = [],
} = {}) {
  const connection = (operation, field, nodes) => (body) => {
    const first = body.variables?.first ?? 50
    const start = Number(body.variables?.after ?? 0)
    if (endless.includes(operation)) {
      return json({ [field]: page(nodes.slice(start, start + first), { hasNextPage: true, endCursor: String(start + first) }) })
    }
    const end = start + first
    const hasNextPage = end < nodes.length
    return json({ [field]: page(nodes.slice(start, end), { hasNextPage, endCursor: hasNextPage ? String(end) : null }) })
  }
  const routes = {
    PmkitWorkspace: json({ organization: { urlKey, name, releasesEnabled, customersEnabled, trialEndsAt } }),
    PmkitPlan: json({ organization: { subscription } }),
    PmkitIntegrations: json({ organization: { integrations: { nodes: integrations.map((service) => ({ service })) } } }),
    PmkitTeams: connection('PmkitTeams', 'teams', teams),
    PmkitStates: connection('PmkitStates', 'workflowStates', states),
    PmkitLabels: connection('PmkitLabels', 'issueLabels', labels),
    PmkitUsers: connection('PmkitUsers', 'users', users),
  }
  for (const operation of refuse) routes[operation] = refused
  return routes
}

/**
 * Routes for the triage operations. `responsibility` is the TriageResponsibility node the team has (null for none),
 * `issues` the nodes of the triage inbox query. The mutation routes echo a responsibility built from their variables.
 * Names come from `users`, so the new current person has the name discovery shows.
 */
export function fakeTriage({ responsibility = null, issues = [], users = ACME_USERS } = {}) {
  const person = (id) => {
    const found = users.find((item) => item.id === id)
    return found ? { id: found.id, name: found.name } : null
  }
  const built = (id, input, base = {}) => {
    const selection = input.manualSelection ?? base.manualSelection ?? null
    return {
      id,
      action: input.action ?? base.action ?? 'assign',
      manualSelection: selection,
      timeSchedule: input.timeScheduleId ? { id: input.timeScheduleId, name: 'Schedule', externalUrl: null, integration: null } : (selection ? null : (base.timeSchedule ?? null)),
      currentUser: selection ? person(selection.userIds[selection.assignmentIndex ?? 0]) : (base.currentUser ?? null),
    }
  }
  const mutation = (field, payload) => (body) => json({ [field]: payload(body.variables ?? {}) })
  return {
    PmkitTriageShow: json({ team: { triageResponsibility: responsibility } }),
    PmkitTriageSuggestions: (body) => {
      const first = body.variables?.first ?? 50
      return json({ issues: page(issues.slice(0, first), { hasNextPage: issues.length > first, endCursor: issues.length > first ? String(first) : null }) })
    },
    PmkitTriageCreate: mutation('triageResponsibilityCreate', (v) => ({ success: true, triageResponsibility: built('tr-new', v.input ?? {}) })),
    PmkitTriageUpdate: mutation('triageResponsibilityUpdate', (v) => ({ success: true, triageResponsibility: built(v.id, v.input ?? {}, responsibility ?? {}) })),
    PmkitTriageDelete: mutation('triageResponsibilityDelete', () => ({ success: true })),
  }
}
