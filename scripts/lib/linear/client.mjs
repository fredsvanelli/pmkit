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
    const body = JSON.parse(await response.text())
    return body.data
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
