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
  const unfinished = () => {
    throw new Error('not implemented')
  }
  void [key, fetch, timeoutMs, retries, sleep, now]
  return Object.freeze({ request: unfinished, paginate: unfinished, session: unfinished, rateLimit: unfinished })
}
