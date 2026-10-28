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
