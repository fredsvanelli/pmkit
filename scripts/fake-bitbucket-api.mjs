// A fake `fetch` for the Bitbucket Cloud REST API: the Jira fake, whose routes and recorded calls work for any host.
// Its two default routes are Jira paths that no Bitbucket client calls. Route keys are '<METHOD> <path>', for example
// `GET ${BB}/pullrequests`; client tests check call.url for the host, since the fake ignores it.

import { fakeJiraFetch } from './fake-jira-api.mjs'

export const FAKE_BB_TOKEN = 'ATATTBBTESTTOKENTESTTOKEN'
export const FAKE_BB_ENV = Object.freeze({ BITBUCKET_TOKEN: FAKE_BB_TOKEN })
export const BB = '/2.0/repositories/acme/widgets'

export const fakeBitbucketFetch = (routes = {}) => fakeJiraFetch(routes)
