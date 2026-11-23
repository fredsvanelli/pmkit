// Tests of the jira ideas text (PMK-83).
import assert from 'node:assert/strict'
import test from 'node:test'
import { connectText, listText } from './ideas-text.mjs'

const SITE = 'acme.atlassian.net'
const idea = (overrides) => ({ id: 'IDEA-1', title: 'Bulk export', status: 'Discovery', votes: [{ field: 'Votes', value: 7 }], insights: null, epics: ['ENG-1'], ...overrides })

test('a site with no JPD project says Jira Product Discovery is not available', () => {
  assert.equal(listText({ available: false, site: SITE, enableHint: 'hint', ideas: [], hasMore: false }), `Jira Product Discovery is not available on ${SITE}: hint`)
})

test('a list line shows votes, unread insights and the connected epics', () => {
  const result = { available: true, site: SITE, project: { key: 'IDEA', name: 'Ideas' }, ideas: [idea(), idea({ id: 'IDEA-2', votes: [{ field: 'Votes', value: null }], epics: [] })], hasMore: false }
  assert.equal(listText(result), 'IDEA-1  Bulk export  (Discovery)  votes 7  insights unread  delivery ENG-1\nIDEA-2  Bulk export  (Discovery)  votes unread  insights unread  delivery none')
})

test('an empty or cut list says so', () => {
  assert.equal(listText({ available: true, site: SITE, project: { key: 'IDEA', name: 'Ideas' }, ideas: [], hasMore: false }), `no ideas in IDEA on ${SITE}`)
  assert.equal(listText({ available: true, site: SITE, project: { key: 'IDEA', name: 'Ideas' }, ideas: [idea()], hasMore: true }), 'IDEA-1  Bulk export  (Discovery)  votes 7  insights unread  delivery ENG-1\nmore ideas match; pass --limit to read more')
})

test('connectText says would connect, connected, or already connected', () => {
  const result = { idea: 'IDEA-1', epic: 'ENG-1', linkType: 'Polaris work item link', before: { epics: [] }, after: { epics: ['ENG-1'] } }
  assert.equal(connectText(result, true), 'would connect IDEA-1 to ENG-1\ndry run: nothing was written')
  assert.equal(connectText(result, false), 'connected IDEA-1 to ENG-1')
  assert.equal(connectText({ ...result, before: { epics: ['ENG-1'] } }, false), 'IDEA-1 is already connected to ENG-1')
})

test('a list line names each votes field when an idea has several', () => {
  const result = { available: true, site: SITE, project: { key: 'IDEA', name: 'Ideas' }, ideas: [idea({ votes: [{ field: 'Votes', value: 7 }, { field: 'Impact', value: null }] })], hasMore: false }
  assert.equal(listText(result), 'IDEA-1  Bulk export  (Discovery)  votes Votes 7, Impact unread  insights unread  delivery ENG-1')
})
