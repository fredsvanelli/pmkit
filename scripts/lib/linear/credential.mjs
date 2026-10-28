// The only reader of LINEAR_API_KEY (ADR-0005). The caller passes env in.

import { PmkitError } from '../errors.mjs'

const BARE_KEY = /^[\x21-\x7E]+$/

/** The Authorization header value and its source. Throws AUTH when the key is missing or malformed. */
export function linearCredential(env) {
  const key = env.LINEAR_API_KEY
  if (key === undefined || key === '') {
    throw new PmkitError('AUTH', 'LINEAR_API_KEY is not set', '/pmkit:setup')
  }
  if (typeof key !== 'string' || !BARE_KEY.test(key)) {
    throw new PmkitError(
      'AUTH',
      'LINEAR_API_KEY is not a bare Linear key',
      'Export the key as Linear shows it, with no quotes, spaces or Bearer prefix',
    )
  }
  return { authorization: key, source: 'LINEAR_API_KEY' }
}
