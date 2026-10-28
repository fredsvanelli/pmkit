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

function rateLimited(headers, details) {
  const bucket = headers.get('x-ratelimit-requests-remaining')?.trim() !== '0' && headers.get('x-ratelimit-complexity-remaining')?.trim() === '0' ? 'complexity' : 'requests'
  const resetAt = resetTime(headers, bucket)
  return new PmkitError(
    'RATE_LIMITED',
    `Linear's ${bucket} limit for this key is used up`,
    resetAt ? `Wait until ${resetAt} and retry` : 'Wait a few minutes and retry',
    details,
  )
}

/**
 * Reads one HTTP answer. Returns { data } on success, or { error, retry } where retry says
 * whether a query may be sent again. Rows are checked in the order of the spec's error table.
 */
function classify(status, headers, text) {
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
  if (serverError) return fail('UPSTREAM', `Linear did not answer: HTTP ${status}`, RETRY_STEP, true)
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

  // One logical call: a single attempt here. Tasks 5 and 6 add error mapping and retries.
  async function send(query, variables) {
    const response = await fetch(LINEAR_ENDPOINT, {
      method: 'POST',
      headers,
      body: JSON.stringify({ query, variables }),
      signal: AbortSignal.timeout(timeoutMs),
    })
    const result = classify(response.status, response.headers, await response.text())
    if (result.error) throw result.error
    return result.data
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

  const unfinished = () => {
    throw new Error('not implemented')
  }
  void [retries, sleep, now]
  return Object.freeze({ request, paginate: unfinished, session, rateLimit: unfinished })
}
