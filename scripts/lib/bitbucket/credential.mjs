// The only reader of BITBUCKET_TOKEN (ADR 0018). The caller passes env in.

import { PmkitError } from '../errors.mjs'

const BARE = /^[\x21-\x7E]+$/
const BARE_STEP = 'Export the token as Atlassian shows it, with no quotes, spaces or Bearer prefix'

/** The Authorization header value and its source. Throws AUTH when the variable is missing or malformed. */
export function bitbucketCredential(env) {
  const token = env.BITBUCKET_TOKEN
  if (token === undefined || token === '') throw new PmkitError('AUTH', 'BITBUCKET_TOKEN is not set', '/pmkit:setup')
  // A token never holds a space or a quote, so "Bearer <token>" and a quoted value fail here too.
  if (typeof token !== 'string' || !BARE.test(token) || /["']/.test(token)) {
    throw new PmkitError('AUTH', 'BITBUCKET_TOKEN is not a bare Bitbucket token', BARE_STEP)
  }
  return { authorization: `Bearer ${token}`, source: 'BITBUCKET_TOKEN' }
}
