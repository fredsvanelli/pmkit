// The Linear GraphQL client. See docs/superpowers/specs/2026-10-27-pmk-30-linear-api-client-design.md.

import { PmkitError } from '../errors.mjs'
import { isCredentialKey, isCredentialString } from '../user-store.mjs'
import { linearCredential } from './credential.mjs'

export const LINEAR_ENDPOINT = 'https://api.linear.app/graphql'

const stripComments = (document) => document.replace(/#[^\n]*/g, '').trim()

/** True when the document is a mutation. Comments and leading whitespace do not count. */
export function isMutation(document) {
  return /^mutation\b/i.test(stripComments(document))
}

/** The operation name of a document, or null when it is anonymous. */
export function operationName(document) {
  const match = /^(?:query|mutation|subscription)\s+([A-Za-z_]\w*)/.exec(stripComments(document))
  return match ? match[1] : null
}

/** The paths of secret-like keys and values in the tracker block, sorted. Values are never included. */
export function secretKeyPaths(tracker) {
  const paths = []
  const walk = (value, label) => {
    if (typeof value === 'string') {
      if (isCredentialString(value)) paths.push(label)
    } else if (Array.isArray(value)) {
      value.forEach((item, index) => walk(item, `${label}[${index}]`))
    } else if (value !== null && typeof value === 'object') {
      for (const [key, item] of Object.entries(value)) {
        if (isCredentialKey(key)) paths.push(`${label}.${key}`)
        else walk(item, `${label}.${key}`)
      }
    }
  }
  walk(tracker, 'tracker')
  return paths.sort()
}

const SESSION_QUERY = 'query PmkitSession { viewer { id name } organization { urlKey name previousUrlKeys } }'
const RETRY_STEP = 'Retry, and check status.linear.app if it keeps failing'

const codesOf = (errors) => errors.map((error) => error?.extensions?.code)

/** The first error's message as one line of at most 200 characters. */
function linearMessage(errors) {
  const first = errors[0] ?? {}
  const raw = first.userPresentableMessage ?? first.extensions?.userPresentableMessage ?? first.message
  const text = typeof raw === 'string' ? raw.replace(/\s+/g, ' ').trim().slice(0, 200) : ''
  return text === '' ? 'no message' : text
}

function linearDetails(status, errors) {
  return {
    linear: {
      status,
      errors: errors.map((error) => ({
        code: error?.extensions?.code ?? null,
        type: error?.extensions?.type ?? null,
        path: error?.path ?? null,
        userError: error?.extensions?.userError ?? null,
      })),
    },
  }
}

/** The reset time of a rate-limit bucket as an ISO string, or null when the header is missing or unreadable. */
function resetTime(headers, bucket) {
  const raw = headers.get(`x-ratelimit-${bucket}-reset`)
  if (raw === null || raw.trim() === '') return null
  const date = new Date(Number(raw))
  return Number.isNaN(date.getTime()) ? null : date.toISOString()
}

function rateLimitError(bucket, resetAt, details) {
  return new PmkitError(
    'RATE_LIMITED',
    `Linear's ${bucket} limit for this key is used up`,
    resetAt ? `Wait until ${resetAt} and retry` : 'Wait a few minutes and retry',
    details,
  )
}

/** The bucket a rate-limited answer ran out of: complexity only when requests are not the empty one. */
function rateLimited(headers, details) {
  const empty = (bucket) => headers.get(`x-ratelimit-${bucket}-remaining`)?.trim() === '0'
  const bucket = !empty('requests') && empty('complexity') ? 'complexity' : 'requests'
  return rateLimitError(bucket, resetTime(headers, bucket), details)
}

const number = (raw) => {
  if (raw === null || raw.trim() === '') return null
  const value = Number(raw)
  return Number.isFinite(value) ? value : null
}

const BUCKETS = ['requests', 'complexity']

/** Reads the rate-limit headers. Returns null when the response has none. */
function readRateHeaders(headers) {
  const names = [...BUCKETS.flatMap((bucket) => ['limit', 'remaining', 'reset'].map((part) => `x-ratelimit-${bucket}-${part}`)), 'x-complexity']
  if (names.every((name) => headers.get(name) === null)) return null
  const state = { lastComplexity: number(headers.get('x-complexity')) }
  for (const bucket of BUCKETS) {
    const resetMs = number(headers.get(`x-ratelimit-${bucket}-reset`))
    const date = resetMs === null ? null : new Date(resetMs)
    state[bucket] = {
      limit: number(headers.get(`x-ratelimit-${bucket}-limit`)),
      remaining: number(headers.get(`x-ratelimit-${bucket}-remaining`)),
      resetMs: date && !Number.isNaN(date.getTime()) ? resetMs : null,
    }
  }
  return state
}

/** A failure where the answer never came: retryable for a query, a hand-off to the user for a mutation. */
function unconfirmed(reason, mutation, details) {
  if (mutation) {
    const error = new PmkitError(
      'UPSTREAM',
      `Linear did not confirm the change: ${reason}`,
      'Check in Linear whether the change was applied before you retry',
      details,
    )
    return { error, retry: false }
  }
  return { error: new PmkitError('UPSTREAM', `Linear did not answer: ${reason}`, RETRY_STEP, details), retry: true }
}

/**
 * Reads one HTTP answer. Returns { data } on success, or { error, retry } where retry says
 * whether a query may be sent again. Rows are checked in the order of the spec's error table.
 */
function classify(status, headers, text, mutation) {
  let body
  try {
    body = JSON.parse(text)
  } catch {
    body = undefined
  }
  const isObject = body !== null && typeof body === 'object' && !Array.isArray(body)
  const errors = isObject && Array.isArray(body.errors) ? body.errors : []
  const codes = codesOf(errors)
  const details = linearDetails(status, errors)
  const fail = (code, message, nextStep, retry = false) => ({ error: new PmkitError(code, message, nextStep, details), retry })

  if (status === 401 || codes.includes('AUTHENTICATION_ERROR')) {
    return fail('AUTH', 'Linear rejected LINEAR_API_KEY', 'Create a key in Linear, Settings, Security & access, and export it as LINEAR_API_KEY')
  }
  if (status === 403 || codes.includes('FORBIDDEN')) {
    return fail('AUTH', 'Linear refused the request for this key', "Check the key's permissions in Linear, Settings, Security & access")
  }
  if (status === 429 || codes.includes('RATELIMITED')) return { error: rateLimited(headers, details), retry: false }
  const ok = status >= 200 && status < 300
  const hasEnvelope = isObject && (body.data !== undefined || body.errors !== undefined)
  const dataIsObject = isObject && body.data !== null && typeof body.data === 'object'
  const serverError = status >= 500
  // A 2xx answer with no errors must carry data to be a success.
  if (!hasEnvelope || (ok && errors.length === 0 && !dataIsObject)) {
    return fail('UPSTREAM', `Linear returned an unreadable answer (HTTP ${status})`, RETRY_STEP, serverError)
  }
  if (serverError) return unconfirmed(`HTTP ${status}`, mutation, details)
  if (codes.includes('GRAPHQL_VALIDATION_FAILED') || codes.includes('GRAPHQL_PARSE_FAILED')) {
    return fail('UPSTREAM', `Linear rejected pmkit's query: ${linearMessage(errors)}`, 'Update pmkit; if it still fails, report the query error')
  }
  if (errors.length > 0) {
    return fail('UPSTREAM', `Linear answered with an error: ${linearMessage(errors)}`, "Check the request against Linear's message")
  }
  if (!ok) return fail('UPSTREAM', `Linear answered HTTP ${status}`, RETRY_STEP)
  return { data: body.data }
}

export function createLinearClient({
  env,
  tracker,
  requireWorkspace = true,
  fetch = globalThis.fetch,
  timeoutMs = 30_000,
  retries = 2,
  sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  now = () => Date.now(),
}) {
  const secrets = secretKeyPaths(tracker ?? {})
  if (secrets.length > 0) {
    throw new PmkitError(
      'INVALID_INPUT',
      `.pmkit/config.yaml holds a secret-like key at ${secrets.join(', ')}`,
      'Remove it from .pmkit/config.yaml and keep the Linear key in LINEAR_API_KEY',
    )
  }
  const workspace = tracker?.scope?.workspace
  if (requireWorkspace && !workspace) {
    throw new PmkitError('NOT_CONFIGURED', 'tracker.scope.workspace is not set', '/pmkit:setup')
  }
  const key = linearCredential(env).authorization
  const headers = { 'Content-Type': 'application/json', Authorization: key }

  const delays = [500, 2000]
  let rate = null

  function recordRate(responseHeaders) {
    const read = readRateHeaders(responseHeaders)
    if (read) rate = read
  }

  /** Throws RATE_LIMITED, with no request, when the last response said a bucket is empty until a future time. */
  function assertRoom() {
    for (const bucket of BUCKETS) {
      const state = rate?.[bucket]
      if (state?.remaining === 0 && state.resetMs !== null && state.resetMs > now()) {
        throw rateLimitError(bucket, new Date(state.resetMs).toISOString())
      }
    }
  }

  /** The reason a request failed without an answer. It never copies the fetch error's message, which can quote a header. */
  function reasonOf(error, signal) {
    if (error?.name === 'TimeoutError' || signal.reason?.name === 'TimeoutError') return `timed out after ${timeoutMs / 1000} s`
    const code = error?.cause?.code
    return typeof code === 'string' && /^[A-Z][A-Z0-9_]*$/.test(code) ? code : 'network error'
  }

  async function attempt(query, variables, mutation) {
    const signal = AbortSignal.timeout(timeoutMs)
    let response
    let text
    try {
      response = await fetch(LINEAR_ENDPOINT, { method: 'POST', headers, body: JSON.stringify({ query, variables }), signal })
      recordRate(response.headers)
      text = await response.text()
    } catch (error) {
      return unconfirmed(reasonOf(error, signal), mutation)
    }
    return classify(response.status, response.headers, text, mutation)
  }

  // One logical call. A query is sent again after a network failure, a timeout or HTTP 5xx.
  async function send(query, variables) {
    const mutation = isMutation(query)
    const attempts = mutation ? 1 : retries + 1
    for (let index = 0; ; index += 1) {
      assertRoom()
      const result = await attempt(query, variables, mutation)
      if (!result.error) return result.data
      if (!result.retry || index + 1 >= attempts) throw result.error
      await sleep(delays[Math.min(index, 1)])
    }
  }

  let sessionPromise
  function session() {
    sessionPromise ??= loadSession()
    return sessionPromise
  }

  async function loadSession() {
    const data = await send(SESSION_QUERY, {})
    const organization = data?.organization
    if (!organization) throw new PmkitError('UPSTREAM', 'Linear returned no organization for this key', RETRY_STEP)
    const viewer = { id: data.viewer?.id, name: data.viewer?.name }
    const found = { urlKey: organization.urlKey, name: organization.name }
    const warnings = []
    if (workspace && organization.urlKey !== workspace) {
      if (organization.previousUrlKeys?.includes(workspace)) {
        warnings.push(
          `Linear renamed workspace ${workspace} to ${organization.urlKey}; set tracker.scope.workspace to ${organization.urlKey} in .pmkit/config.yaml`,
        )
      } else {
        throw new PmkitError(
          'AUTH',
          `LINEAR_API_KEY belongs to workspace ${organization.urlKey}, and .pmkit/config.yaml names ${workspace}`,
          `Export a LINEAR_API_KEY created in the ${workspace} workspace`,
        )
      }
    }
    return { source: 'LINEAR_API_KEY', viewer, workspace: found, pinned: Boolean(workspace), warnings }
  }

  async function request(document, variables = {}) {
    await session()
    return send(document, variables)
  }

  const positiveInteger = (value) => Number.isInteger(value) && value >= 1

  async function paginate(document, variables = {}, options = {}) {
    const { select, pageSize = 100, limit, maxPages } = options
    if (typeof select !== 'function') throw new TypeError('paginate needs a select function')
    if (!positiveInteger(pageSize) || pageSize > 250) throw new TypeError('pageSize must be an integer from 1 to 250')
    if (maxPages !== undefined && !positiveInteger(maxPages)) throw new TypeError('maxPages must be an integer of at least 1')
    if (limit !== undefined && !positiveInteger(limit)) throw new TypeError('limit must be an integer of at least 1')
    const cap = maxPages ?? (limit === undefined ? 10 : Infinity)
    const broken = () =>
      new PmkitError('UPSTREAM', `Linear returned a broken page for ${operationName(document) ?? 'an anonymous query'}`, RETRY_STEP)
    const nodes = []
    let after = null
    for (let pages = 1; ; pages += 1) {
      const first = limit === undefined ? pageSize : Math.min(pageSize, limit - nodes.length)
      const data = await request(document, { ...variables, first, after })
      let connection
      try {
        connection = select(data)
      } catch {
        throw broken()
      }
      if (!Array.isArray(connection?.nodes) || connection.pageInfo === null || typeof connection.pageInfo !== 'object') throw broken()
      nodes.push(...connection.nodes)
      if (connection.pageInfo.hasNextPage !== true) return { nodes: nodes.slice(0, limit), hasMore: false }
      const cursor = connection.pageInfo.endCursor
      if (typeof cursor !== 'string' || cursor === '' || cursor === after) throw broken()
      if ((limit !== undefined && nodes.length >= limit) || pages >= cap) return { nodes: nodes.slice(0, limit), hasMore: true }
      after = cursor
    }
  }
  function rateLimit() {
    if (!rate) return null
    const bucket = (state) => ({
      limit: state.limit,
      remaining: state.remaining,
      resetAt: state.resetMs === null ? null : new Date(state.resetMs).toISOString(),
    })
    return { requests: bucket(rate.requests), complexity: bucket(rate.complexity), lastComplexity: rate.lastComplexity }
  }

  return Object.freeze({ request, paginate, session, rateLimit })
}
