// A fake `fetch` for the Jira Cloud REST API. Routes are keyed by '<METHOD> <path>', without the query string.
// A route is a response, a list of responses (the Nth call gets item N, the last repeats),
// or a function of the recorded call that returns a response. A path segment written {name} matches any one segment,
// and the function route then finds the decoded segments in call.params; an exact key wins over a template.
// A response is { status, headers, json | text }, { throws: error } or { hang: true }.

export const FAKE_EMAIL = 'pmkit-test@example.com'
export const FAKE_TOKEN = 'ATATTTESTTOKENTESTTOKENTESTTOKEN'
export const FAKE_ENV = Object.freeze({ JIRA_EMAIL: FAKE_EMAIL, JIRA_API_TOKEN: FAKE_TOKEN })
export const FAKE_HEADER = `Basic ${Buffer.from(`${FAKE_EMAIL}:${FAKE_TOKEN}`, 'utf8').toString('base64')}`
export const TRACKER = Object.freeze({ system: 'jira', scope: Object.freeze({ site: 'acme.atlassian.net', space: 'ENG' }) })

const DEFAULTS = {
  'GET /rest/api/3/serverInfo': { json: { baseUrl: 'https://acme.atlassian.net', deploymentType: 'Cloud', version: '1001.0.0-SNAPSHOT' } },
  'GET /rest/api/3/myself': { json: { accountId: 'acc-1', displayName: 'Test User', emailAddress: FAKE_EMAIL, active: true } },
}

function lowerHeaders(headers = {}) {
  return Object.fromEntries(Object.entries(headers).map(([name, value]) => [name.toLowerCase(), value]))
}

/** The route key that answers `key`, exact first, then the first template key whose segments match, with its params. */
function routeOf(all, key) {
  if (all[key] !== undefined) return { name: key, params: {} }
  for (const name of Object.keys(all).filter((candidate) => candidate.includes('{'))) {
    const names = []
    const pattern = name.replace(/[.*+?^$()|[\]\\]/g, '\\$&').replace(/\{(\w+)\}/g, (_, param) => {
      names.push(param)
      return '([^/]+)'
    })
    const match = new RegExp(`^${pattern}$`).exec(key)
    if (match) return { name, params: Object.fromEntries(names.map((param, index) => [param, decodeURIComponent(match[index + 1])])) }
  }
  return null
}

function toResponse(answer, signal) {
  if (answer.throws) return Promise.reject(answer.throws)
  if (answer.hang) {
    return new Promise((_, reject) => {
      if (!signal) return
      if (signal.aborted) return reject(signal.reason)
      // AbortSignal.timeout does not keep the process alive, so the fake does until the signal fires.
      const keepAlive = setInterval(() => {}, 1000)
      signal.addEventListener('abort', () => {
        clearInterval(keepAlive)
        reject(signal.reason)
      }, { once: true })
    })
  }
  const status = answer.status ?? 200
  const empty = status === 204 || status === 304
  const text = empty ? null : answer.json !== undefined ? JSON.stringify(answer.json) : (answer.text ?? '')
  const headers = { ...(answer.json !== undefined ? { 'content-type': 'application/json' } : {}), ...answer.headers }
  return Promise.resolve(new Response(text, { status, headers }))
}

/** A fetch that answers from routes and records every call in `.calls`. A call with no route rejects with an Error that fails the test. */
export function fakeJiraFetch(routes = {}) {
  const all = { ...DEFAULTS, ...routes }
  const counts = new Map()
  const calls = []
  async function fetch(url, init = {}) {
    const parsed = new URL(url)
    const method = init.method ?? 'GET'
    const call = { url: String(url), method, headers: lowerHeaders(init.headers), body: init.body, redirect: init.redirect }
    calls.push(call)
    const key = `${method} ${parsed.pathname}`
    const found = routeOf(all, key)
    if (!found) throw new Error(`fake Jira: no route for ${key}`)
    call.params = found.params
    const route = all[found.name]
    const index = counts.get(found.name) ?? 0
    counts.set(found.name, index + 1)
    const answer = typeof route === 'function' ? route(call) : Array.isArray(route) ? route[Math.min(index, route.length - 1)] : route
    return toResponse(answer, init.signal)
  }
  fetch.calls = calls
  return fetch
}

// The discovery routes of a Jira site (PMK-76) whose configured space is ENG, a software space with a Scrum board.
// style 'team-managed' gives ENG next-gen work types and a scoped estimate field, plus another space's same-named field.
const STATUS = {
  todo: { id: '1', name: 'To Do', statusCategory: { key: 'new', name: 'To Do' } },
  doing: { id: '3', name: 'In Progress', statusCategory: { key: 'indeterminate', name: 'In Progress' } },
  review: { id: '4', name: 'Review', statusCategory: { key: 'indeterminate', name: 'In Progress' } },
  done: { id: '5', name: 'Done', statusCategory: { key: 'done', name: 'Done' } },
}

export function jiraSiteRoutes({ style = 'company-managed' } = {}) {
  const team = style === 'team-managed'
  const scope = (id) => (team ? { scope: { type: 'PROJECT', project: { id } } } : {})
  const workTypes = [
    { id: '10000', name: 'Epic', subtask: false, hierarchyLevel: 1, ...scope('10001') },
    { id: '10001', name: 'Story', subtask: false, hierarchyLevel: 0, ...scope('10001') },
    { id: '10002', name: 'Bug', subtask: false, hierarchyLevel: 0, ...scope('10001') },
    { id: '10003', name: 'Sub-task', subtask: true, hierarchyLevel: -1, ...scope('10001') },
  ]
  const estimate = team
    ? [
        { id: 'customfield_10016', name: 'Story point estimate', custom: true, schema: { type: 'number', custom: 'com.pyxis.greenhopper.jira:jsw-story-points', customId: 10016 }, scope: { type: 'PROJECT', project: { id: '10001' } } },
        { id: 'customfield_10099', name: 'Story point estimate', custom: true, schema: { type: 'number', custom: 'com.pyxis.greenhopper.jira:jsw-story-points', customId: 10099 }, scope: { type: 'PROJECT', project: { id: '10002' } } },
      ]
    : [{ id: 'customfield_10016', name: 'Story Points', custom: true, schema: { type: 'number', custom: 'com.atlassian.jira.plugin.system.customfieldtypes:float', customId: 10016 } }]
  return {
    'GET /rest/api/3/project/search': {
      json: {
        startAt: 0, maxResults: 50, total: 2, isLast: true,
        values: [
          { id: '10001', key: 'ENG', name: 'Engineering', projectTypeKey: 'software', style: team ? 'next-gen' : 'classic', simplified: team },
          { id: '10002', key: 'OPS', name: 'Operations', projectTypeKey: 'business', style: 'next-gen', simplified: true },
        ],
      },
    },
    'GET /rest/api/3/project/ENG': {
      json: { id: '10001', key: 'ENG', name: 'Engineering', projectTypeKey: 'software', style: team ? 'next-gen' : 'classic', simplified: team, issueTypes: workTypes },
    },
    'GET /rest/api/3/project/ENG/statuses': {
      json: [
        { id: '10000', name: 'Epic', subtask: false, statuses: [STATUS.todo, STATUS.doing, STATUS.done] },
        { id: '10001', name: 'Story', subtask: false, statuses: [STATUS.todo, STATUS.doing, STATUS.review, STATUS.done] },
        { id: '10002', name: 'Bug', subtask: false, statuses: [STATUS.todo, STATUS.doing, STATUS.done] },
        { id: '10003', name: 'Sub-task', subtask: true, statuses: [STATUS.todo, STATUS.done] },
      ],
    },
    'GET /rest/api/3/field': {
      json: [
        { id: 'summary', name: 'Summary', custom: false, schema: { type: 'string', system: 'summary' } },
        { id: 'priority', name: 'Priority', custom: false, schema: { type: 'priority', system: 'priority' } },
        { id: 'duedate', name: 'Due date', custom: false, schema: { type: 'date', system: 'duedate' } },
        { id: 'assignee', name: 'Assignee', custom: false, schema: { type: 'user', system: 'assignee' } },
        { id: 'timespent', name: 'Time Spent', custom: false, schema: { type: 'number', system: 'timespent' } },
        { id: 'timeoriginalestimate', name: 'Original estimate', custom: false, schema: { type: 'number', system: 'timeoriginalestimate' } },
        { id: 'customfield_10015', name: 'Start date', custom: true, schema: { type: 'date', custom: 'com.atlassian.jira.plugin.system.customfieldtypes:datepicker', customId: 10015 } },
        { id: 'customfield_10020', name: 'Sprint', custom: true, schema: { type: 'array', items: 'json', custom: 'com.pyxis.greenhopper.jira:gh-sprint', customId: 10020 } },
        ...estimate,
      ],
    },
    'GET /rest/api/3/label': { json: { startAt: 0, maxResults: 100, total: 2, isLast: true, values: ['backend', 'frontend'] } },
    'GET /rest/api/3/instance/license': { json: { applications: [{ id: 'jira-software', plan: 'PAID' }] } },
    'GET /rest/api/3/configuration': { json: { issueLinkingEnabled: true, subTasksEnabled: true, timeTrackingEnabled: true, timeTrackingConfiguration: { defaultUnit: 'hour' } } },
    'GET /rest/api/3/user/assignable/search': {
      json: [
        { accountId: 'acc-1', displayName: 'Test User', accountType: 'atlassian' },
        { accountId: 'acc-2', displayName: 'Second User', accountType: 'atlassian' },
        { accountId: 'app-1', displayName: 'Bot', accountType: 'app' },
      ],
    },
    'GET /rest/api/3/priority': {
      json: [
        { id: '1', name: 'Highest' },
        { id: '2', name: 'High' },
        { id: '3', name: 'Medium' },
        { id: '4', name: 'Low' },
        { id: '5', name: 'Lowest' },
      ],
    },
    'GET /rest/api/3/issueLinkType': {
      json: {
        issueLinkTypes: [
          { id: '10000', name: 'Blocks', inward: 'is blocked by', outward: 'blocks' },
          { id: '10002', name: 'Duplicate', inward: 'is duplicated by', outward: 'duplicates' },
          { id: '10003', name: 'Relates', inward: 'relates to', outward: 'relates to' },
        ],
      },
    },
    'GET /rest/agile/1.0/board': { json: { startAt: 0, maxResults: 50, total: 2, isLast: true, values: [{ id: 2, name: 'ENG kanban', type: 'kanban' }, { id: 1, name: 'ENG board', type: 'scrum' }] } },
    'GET /rest/agile/1.0/board/1/configuration': { json: { id: 1, name: 'ENG board', estimation: { type: 'field', field: { fieldId: 'customfield_10016', displayName: 'Story Points' } } } },
  }
}
