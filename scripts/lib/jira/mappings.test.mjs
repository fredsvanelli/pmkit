import assert from 'node:assert/strict'
import test from 'node:test'
import { FAKE_ENV, TRACKER, fakeJiraFetch, jiraSiteRoutes } from '../../fake-jira-api.mjs'
import { createJiraClient } from './client.mjs'
import { fetchDiscovery } from './discovery.mjs'
import { brokenJiraMappings } from './mappings.mjs'

async function rawOf() {
  const client = createJiraClient({ env: FAKE_ENV, tracker: TRACKER, fetch: fakeJiraFetch(jiraSiteRoutes()), sleep: async () => {} })
  return fetchDiscovery(client, { space: 'ENG' })
}

const check = async (mappings) => brokenJiraMappings(await rawOf(), { mappings })

test('a valid config has no broken mapping', async () => {
  assert.deepEqual(await check({ status: { in_review: 'Review', blocked: 'none' }, types: { bug: 'Bug' }, fields: { estimate: 'customfield_10016', sprint: 'none' } }), [])
})

test('a status the space lacks is broken', async () => {
  const items = await check({ status: { in_review: 'Nope' } })
  assert.equal(items.length, 1)
  assert.equal(items[0].key, 'mappings.status.in_review')
  assert.equal(items[0].value, 'Nope')
  assert.match(items[0].problem, /Nope/)
})

test('a work type the space lacks is broken', async () => {
  const items = await check({ types: { bug: 'Defect' } })
  assert.deepEqual(items.map((i) => i.key), ['mappings.types.bug'])
})

test('a field id the site lacks is broken', async () => {
  const items = await check({ fields: { estimate: 'customfield_9' } })
  assert.deepEqual(items.map((i) => i.key), ['mappings.fields.estimate'])
})

test('blocked and none never break', async () => {
  assert.deepEqual(await check({ status: { blocked: 'Whatever', done: 'none' }, types: { bug: 'none' }, fields: { estimate: 'none' } }), [])
})
