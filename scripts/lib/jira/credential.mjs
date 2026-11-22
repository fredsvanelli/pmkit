// The only reader of JIRA_EMAIL and JIRA_API_TOKEN (ADR 0013). The caller passes env in.

import { PmkitError } from '../errors.mjs'

const BARE = /^[\x21-\x7E]+$/
const BARE_STEP = 'Export the value as Atlassian shows it, with no quotes, spaces or Basic prefix'

/** The Authorization header value and its source. Throws AUTH when a variable is missing or malformed. */
export function jiraCredential(env) {
  const email = env.JIRA_EMAIL
  const token = env.JIRA_API_TOKEN
  if (email === undefined || email === '') throw new PmkitError('AUTH', 'JIRA_EMAIL is not set', '/pmkit:setup')
  if (token === undefined || token === '') throw new PmkitError('AUTH', 'JIRA_API_TOKEN is not set', '/pmkit:setup')
  if (typeof email !== 'string' || !BARE.test(email) || !email.includes('@')) {
    throw new PmkitError('AUTH', 'JIRA_EMAIL is not a bare email address', BARE_STEP)
  }
  // A token never holds a space, so "Basic <token>" fails here too.
  if (typeof token !== 'string' || !BARE.test(token)) {
    throw new PmkitError('AUTH', 'JIRA_API_TOKEN is not a bare Jira API token', BARE_STEP)
  }
  return { authorization: `Basic ${Buffer.from(`${email}:${token}`, 'utf8').toString('base64')}`, source: 'JIRA_API_TOKEN' }
}
