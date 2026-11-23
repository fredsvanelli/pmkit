// Tests of the Jira Product Discovery ideas reader and connector (PMK-83): one JPD project's ideas with votes,
// unread insights and connected epics, and the delivery link from an idea to an epic of the configured space.
import assert from 'node:assert/strict'
import test from 'node:test'
import { FAKE_ENV, TRACKER, fakeJiraFetch } from '../../fake-jira-api.mjs'
import { fakeJiraIssues } from '../../fake-jira-issues.mjs'
import { PmkitError } from '../errors.mjs'
import { createJiraClient } from './client.mjs'
import { fetchDiscovery } from './discovery.mjs'
import { IDEAS_HINT, INSIGHTS_UNREAD, ideaOperations } from './ideas.mjs'

const SITE = TRACKER.scope.site
const LAB = { id: '10004', key: 'LAB', name: 'Lab', style: 'team-managed', type: 'product_discovery' }
const REVERSED = { id: '10010', name: 'Polaris work item link', inward: 'implements', outward: 'is implemented by' }

/**
 * The ideas operations over the stateful fake with JPD, and `edit(raw)` to change the discovery before the test reads it.
 * `cached(raw)` gives the discovery read from the cache (fresh: false); a refresh reads `raw`. `fields(list)` edits Jira's fields.
 */
async function setup({ edit = (raw) => raw, cached, fields = (list) => list, ...options } = {}) {
  const fake = fakeJiraIssues({ discovery: true, ...options })
  const fetch = fakeJiraFetch({ ...fake.routes, 'GET /rest/api/3/field': { json: fields(fake.routes['GET /rest/api/3/field'].json) } })
  const client = createJiraClient({ env: FAKE_ENV, tracker: TRACKER, fetch })
  const raw = edit(await fetchDiscovery(client, { space: 'ENG' }))
  const reads = []
  const discovery = async ({ refresh = false } = {}) => {
    reads.push(refresh)
    return cached && !refresh ? { raw: cached(raw), fresh: false } : { raw, fresh: true }
  }
  const epics = {
    async getDeliverable(id) {
      if (String(id).toUpperCase() === 'ENG-1') return { id: 'ENG-1' }
      throw new PmkitError('NOT_FOUND', `No epic ${id}`, 'Check the id')
    },
  }
  const requireActor = async (actor) => {
    if (actor !== 'acc-1') throw new PmkitError('INVALID_INPUT', 'Jira records every write as the owner of JIRA_API_TOKEN (Test User)')
  }
  const ideas = ideaOperations({ client, site: SITE, discovery, epics, requireActor })
  const epic = async (summary) => (await client.request('POST', '/rest/api/3/issue', { body: { fields: { project: { key: 'ENG' }, issuetype: { name: 'Epic' }, summary } } })).key
  const link = (name, inward, outward) => client.request('POST', '/rest/api/3/issueLink', { body: { type: { name }, inwardIssue: { key: inward }, outwardIssue: { key: outward } } })
  return { fake, fetch, ideas, epic, link, reads, calls: () => fetch.calls.length }
}
const searches = (fetch) => fetch.calls.filter((call) => new URL(call.url).pathname === '/rest/api/3/search/jql')
const posts = (fake) => fake.writes().filter((write) => write.path === '/rest/api/3/issueLink')

test('list reads the only JPD project\'s ideas, newest first, with votes and unread insights', async () => {
  const { fetch, ideas } = await setup()
  const result = await ideas.list()
  assert.equal(result.available, true)
  assert.equal(result.site, SITE)
  assert.deepEqual(result.project, { key: 'IDEA', name: 'Ideas' })
  assert.deepEqual(result.ideas.map((idea) => idea.id), ['IDEA-2', 'IDEA-1'])
  const first = result.ideas.find((idea) => idea.id === 'IDEA-1')
  assert.deepEqual(first, { id: 'IDEA-1', title: 'Bulk export', status: 'Discovery', votes: [{ field: 'Votes', value: 7 }], insights: null, epics: [] })
  assert.deepEqual(result.ideas.find((idea) => idea.id === 'IDEA-2').votes, [{ field: 'Votes', value: null }])
  assert.ok(result.ideas.every((idea) => idea.insights === null))
  assert.ok(result.warnings.includes(INSIGHTS_UNREAD))
  assert.ok(result.warnings.includes('Jira did not return the votes of 1 ideas'))
  assert.equal(result.hasMore, false)
  const query = new URL(searches(fetch)[0].url).searchParams
  assert.equal(query.get('jql'), 'project = "IDEA" ORDER BY created DESC, key DESC')
  assert.equal(query.get('fields'), 'summary,status,issuelinks,customfield_10101')
})

test('list matches --project case-insensitively, and an unknown or non-JPD key is NOT_FOUND', async () => {
  const { ideas } = await setup()
  assert.deepEqual((await ideas.list({ project: 'idea' })).project, { key: 'IDEA', name: 'Ideas' })
  await assert.rejects(ideas.list({ project: 'ENG' }), { code: 'NOT_FOUND' })
  await assert.rejects(ideas.list({ project: 'NOPE' }), { code: 'NOT_FOUND' })
})

test('list with several JPD projects and no --project is INVALID_INPUT naming the keys', async () => {
  const { ideas } = await setup({ edit: (raw) => ({ ...raw, spaces: [...raw.spaces, LAB] }) })
  await assert.rejects(ideas.list(), (error) => error.code === 'INVALID_INPUT' && error.message.includes('IDEA, LAB'))
  assert.deepEqual((await ideas.list({ project: 'LAB' })).project, { key: 'LAB', name: 'Lab' })
})

test('list answers available false when the site has no JPD project', async () => {
  const { fetch, ideas } = await setup({ edit: (raw) => ({ ...raw, spaces: raw.spaces.filter((space) => space.type !== 'product_discovery') }) })
  const result = await ideas.list()
  assert.deepEqual(result, { available: false, reason: 'no_discovery_project', enableHint: IDEAS_HINT(SITE), site: SITE, ideas: [], hasMore: false })
  assert.match(IDEAS_HINT(SITE), /acme\.atlassian\.net/)
  assert.equal(searches(fetch).length, 0)
})

test('list shows the epics connected by the delivery link, either direction', async () => {
  const { ideas, epic, link } = await setup()
  const one = await epic('Exports')
  const two = await epic('Themes')
  await link('Polaris work item link', one, 'IDEA-1')
  await link('Polaris work item link', 'IDEA-1', two)
  await link('Blocks', two, 'IDEA-2')
  const result = await ideas.list()
  assert.deepEqual(result.ideas.find((idea) => idea.id === 'IDEA-1').epics, [one, two])
  assert.deepEqual(result.ideas.find((idea) => idea.id === 'IDEA-2').epics, [])
})

test('list passes --limit and reports hasMore', async () => {
  const { fetch, ideas } = await setup()
  const result = await ideas.list({ limit: 1 })
  assert.deepEqual(result.ideas.map((idea) => idea.id), ['IDEA-2'])
  assert.equal(result.hasMore, true)
  assert.equal(new URL(searches(fetch)[0].url).searchParams.get('maxResults'), '1')
})

test('connect links the epic as the implementing side', async () => {
  const { fake, ideas, epic } = await setup()
  await epic('Exports')
  const result = await ideas.connect('idea-1', 'ENG-1', 'acc-1')
  assert.deepEqual(result, { idea: 'IDEA-1', epic: 'ENG-1', linkType: 'Polaris work item link', before: { epics: [] }, after: { epics: ['ENG-1'] } })
  assert.ok(fake.state.links.some((entry) => entry.typeId === '10010' && entry.inward === 'ENG-1' && entry.outward === 'IDEA-1'))
})

test('connect dry run writes nothing', async () => {
  const { fake, ideas, epic } = await setup()
  await epic('Exports')
  const result = await ideas.connect('IDEA-1', 'ENG-1', 'acc-1', { dryRun: true })
  assert.deepEqual(result.after, { epics: ['ENG-1'] })
  assert.deepEqual(result.before, { epics: [] })
  assert.equal(posts(fake).length, 0)
})

test('connect is a no-op when already connected', async () => {
  const { fake, ideas, epic, link } = await setup()
  await epic('Exports')
  await link('Polaris work item link', 'ENG-1', 'IDEA-1')
  const written = posts(fake).length
  const result = await ideas.connect('IDEA-1', 'ENG-1', 'acc-1')
  assert.deepEqual(result.before, result.after)
  assert.deepEqual(result.after, { epics: ['ENG-1'] })
  assert.equal(posts(fake).length, written)
})

test('connect follows a reversed link type', async () => {
  const { fake, ideas, epic } = await setup({ edit: (raw) => ({ ...raw, linkTypes: [...raw.linkTypes.filter((type) => type.id !== '10010'), REVERSED] }) })
  await epic('Exports')
  await ideas.connect('IDEA-1', 'ENG-1', 'acc-1')
  const [post] = posts(fake)
  assert.deepEqual(post.body, { type: { name: 'Polaris work item link' }, inwardIssue: { key: 'IDEA-1' }, outwardIssue: { key: 'ENG-1' } })
})

test('connect refuses an idea that is not in a JPD project', async () => {
  const { fake, ideas, epic } = await setup()
  await epic('Exports')
  await assert.rejects(ideas.connect('ENG-1', 'ENG-1', 'acc-1'), (error) => error.code === 'NOT_FOUND' && error.message.includes('ENG-1'))
  await assert.rejects(ideas.connect('IDEA-99', 'ENG-1', 'acc-1'), { code: 'NOT_FOUND' })
  assert.equal(posts(fake).length, 0)
})

test('connect refuses an epic getDeliverable does not know', async () => {
  const { fake, ideas } = await setup()
  await assert.rejects(ideas.connect('IDEA-1', 'ENG-7', 'acc-1'), { code: 'NOT_FOUND' })
  assert.equal(posts(fake).length, 0)
})

test('connect refuses a site with no delivery link type', async () => {
  const { fake, ideas, epic } = await setup({ edit: (raw) => ({ ...raw, linkTypes: raw.linkTypes.filter((type) => type.id !== '10010') }) })
  await epic('Exports')
  await assert.rejects(ideas.connect('IDEA-1', 'ENG-1', 'acc-1'), (error) => error.code === 'NOT_SUPPORTED' && error.message.includes('delivery link type is missing'))
  assert.equal(posts(fake).length, 0)
})

test('connect refuses another actor', async () => {
  const { fake, ideas, epic, calls } = await setup()
  await epic('Exports')
  const before = calls()
  await assert.rejects(ideas.connect('IDEA-1', 'ENG-1', 'acc-2'), { code: 'INVALID_INPUT', message: /JIRA_API_TOKEN/ })
  assert.equal(calls(), before)
  assert.equal(posts(fake).length, 0)
})

test('connect refuses a delivery link type where neither side says implements', async () => {
  const VAGUE = { id: '10010', name: 'Polaris work item link', inward: 'relates to', outward: 'relates to' }
  const { fake, ideas, epic } = await setup({ edit: (raw) => ({ ...raw, linkTypes: [...raw.linkTypes.filter((type) => type.id !== '10010'), VAGUE] }) })
  await epic('Exports')
  await assert.rejects(ideas.connect('IDEA-1', 'ENG-1', 'acc-1'), {
    code: 'NOT_SUPPORTED',
    message: "Jira Product Discovery's delivery link type Polaris work item link does not say which side implements the idea",
  })
  assert.equal(posts(fake).length, 0)
})

const noJpd = (raw) => ({ ...raw, spaces: raw.spaces.filter((space) => space.type !== 'product_discovery') })

test('list reads Jira again once when the cached discovery has no JPD project or lacks the named one', async () => {
  const none = await setup({ cached: noJpd })
  assert.equal((await none.ideas.list()).available, true)
  assert.deepEqual(none.reads, [false, true])
  const named = await setup({ cached: (raw) => raw, edit: (raw) => ({ ...raw, spaces: [...raw.spaces, LAB] }) })
  const lab = await setup({ cached: (raw) => ({ ...raw, spaces: raw.spaces.filter((space) => space.key !== 'LAB') }), edit: (raw) => ({ ...raw, spaces: [...raw.spaces, LAB] }) })
  assert.deepEqual((await lab.ideas.list({ project: 'LAB' })).project, { key: 'LAB', name: 'Lab' })
  assert.deepEqual(lab.reads, [false, true])
  await named.ideas.list({ project: 'IDEA' })
  assert.deepEqual(named.reads, [false], 'a cached discovery that has the project is not read again')
})

test('list does not read Jira again when the discovery is fresh', async () => {
  const { ideas, reads } = await setup({ edit: noJpd })
  assert.equal((await ideas.list()).available, false)
  assert.deepEqual(reads, [false])
})

test('connect reads Jira again once when the cached discovery lacks the idea\'s project or the delivery link type', async () => {
  const project = await setup({ cached: noJpd })
  await project.epic('Exports')
  assert.deepEqual((await project.ideas.connect('IDEA-1', 'ENG-1', 'acc-1')).after, { epics: ['ENG-1'] })
  assert.deepEqual(project.reads, [false, true])
  const type = await setup({ cached: (raw) => ({ ...raw, linkTypes: raw.linkTypes.filter((entry) => entry.id !== '10010') }) })
  await type.epic('Exports')
  assert.deepEqual((await type.ideas.connect('IDEA-1', 'ENG-1', 'acc-1')).after, { epics: ['ENG-1'] })
  assert.deepEqual(type.reads, [false, true])
})

test('connect is not a no-op when the only link has the idea on the implementing side', async () => {
  const { fake, ideas, epic, link } = await setup()
  await epic('Exports')
  await link('Polaris work item link', 'IDEA-1', 'ENG-1')
  const written = posts(fake).length
  const result = await ideas.connect('IDEA-1', 'ENG-1', 'acc-1')
  assert.deepEqual(result.before, { epics: [] })
  assert.deepEqual(result.after, { epics: ['ENG-1'] })
  assert.equal(posts(fake).length, written + 1)
  assert.deepEqual(posts(fake).at(-1).body.inwardIssue, { key: 'ENG-1' })
})

test('list with --project on a site with no JPD project is NOT_FOUND', async () => {
  const { ideas } = await setup({ edit: noJpd })
  await assert.rejects(ideas.list({ project: 'IDEA' }), (error) => error.code === 'NOT_FOUND' && error.message === `${SITE} has no Jira Product Discovery project IDEA` && error.nextStep === IDEAS_HINT(SITE))
})

test('connect says the link types could not be read when discovery has none', async () => {
  const { fake, ideas, epic } = await setup({ edit: (raw) => ({ ...raw, linkTypes: null }) })
  await epic('Exports')
  await assert.rejects(ideas.connect('IDEA-1', 'ENG-1', 'acc-1'), {
    code: 'NOT_SUPPORTED',
    message: `Jira's link types could not be read on ${SITE}, so pmkit cannot find Jira Product Discovery's delivery link type`,
  })
  assert.equal(posts(fake).length, 0)
})

test('list warns when the project has no votes field', async () => {
  const { ideas } = await setup({ fields: (list) => list.filter((field) => field.schema?.custom !== 'jira.polaris:votes') })
  const result = await ideas.list()
  assert.ok(result.ideas.every((idea) => idea.votes.length === 0))
  assert.ok(result.warnings.includes('IDEA has no votes field, so votes are unread'))
})
