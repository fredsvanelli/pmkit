// A fake `fetch` for the Jira Cloud REST API. Routes are keyed by '<METHOD> <path>', without the query string.
// A route is a response, a list of responses (the Nth call gets item N, the last repeats),
// or a function of the recorded call that returns a response.
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
    const route = all[key]
    if (route === undefined) throw new Error(`fake Jira: no route for ${key}`)
    const index = counts.get(key) ?? 0
    counts.set(key, index + 1)
    const answer = typeof route === 'function' ? route(call) : Array.isArray(route) ? route[Math.min(index, route.length - 1)] : route
    return toResponse(answer, init.signal)
  }
  fetch.calls = calls
  return fetch
}
