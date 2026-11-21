import assert from 'node:assert/strict'
import test from 'node:test'
import { fakeGithubIssues } from '../../fake-github-issues.mjs'
import { fakeGhExec, linkedReply, projectReply, repoReply, SCOPE_ERROR, standardFixture } from '../../fake-github-api.mjs'
import { createGithubClient } from './client.mjs'
import { checkGhesVersion, discoveryView, fetchDiscovery, fetchLinkedProjects, mappedLabelNames, needsVersionCheck, parseProject, projectQuery, repoQuery } from './discovery.mjs'

const rejectsWith = (promise, code, pattern) =>
  assert.rejects(promise, (error) => {
    assert.equal(error.code, code)
    if (pattern) assert.match(`${error.message} | ${error.nextStep}`, pattern)
    return true
  })

function setup(fixture, host) {
  const fake = fakeGhExec(fixture)
  const client = createGithubClient({ root: '/repo', env: {}, exec: fake.exec, host, sleep: async () => {} })
  return { ...fake, client }
}

test('needsVersionCheck is false for github.com and GHE.com, true for any other host', () => {
  assert.equal(needsVersionCheck('github.com'), false)
  assert.equal(needsVersionCheck('GitHub.com'), false)
  assert.equal(needsVersionCheck('acme.ghe.com'), false)
  assert.equal(needsVersionCheck('ghes.example.com'), true)
  assert.equal(needsVersionCheck(undefined), false)
})

test('checkGhesVersion makes no call on github.com and GHE.com', async () => {
  for (const host of ['github.com', 'acme.ghe.com']) {
    const { exec, calls } = fakeGhExec({ meta: { installed_version: '3.0.0' } })
    assert.equal(await checkGhesVersion({ exec, host }), null)
    assert.equal(calls.length, 0)
  }
})

test('checkGhesVersion reads gh api meta on GHES and accepts 3.19 and later', async () => {
  for (const version of ['3.19.0', '3.21.1', '4.0.0']) {
    const { exec, calls } = fakeGhExec({ meta: { installed_version: version } })
    assert.equal(await checkGhesVersion({ exec, host: 'ghes.example.com' }), version)
    assert.deepEqual(calls[0].args, ['api', '--hostname', 'ghes.example.com', 'meta'])
  }
})

test('checkGhesVersion refuses a version below 3.19 and names both versions', async () => {
  const { exec } = fakeGhExec({ meta: { installed_version: '3.18.4' } })
  await rejectsWith(checkGhesVersion({ exec, host: 'ghes.example.com' }), 'NOT_SUPPORTED', /3\.18\.4.*3\.19/)
})

test('checkGhesVersion fails with UPSTREAM when meta has no installed_version', async () => {
  const { exec } = fakeGhExec({ meta: { verifiable_password_authentication: false } })
  await rejectsWith(checkGhesVersion({ exec, host: 'ghes.example.com' }), 'UPSTREAM', /installed_version/)
})

test('checkGhesVersion maps a missing gh and a missing login', async () => {
  const missing = () => {
    const error = new Error('spawnSync gh ENOENT')
    error.code = 'ENOENT'
    throw error
  }
  await rejectsWith(checkGhesVersion({ exec: missing, host: 'ghes.example.com' }), 'NOT_CONFIGURED', /Install the GitHub CLI/)
  const { exec } = fakeGhExec({ login: false })
  await rejectsWith(checkGhesVersion({ exec, host: 'ghes.example.com' }), 'AUTH', /gh auth login -h ghes\.example\.com/)
})

test('parseProject reads owner/number and none', () => {
  assert.deepEqual(parseProject('acme/7'), { owner: 'acme', number: 7 })
  assert.equal(parseProject('none'), null)
  assert.equal(parseProject(undefined), null)
  assert.equal(parseProject('acme'), undefined)
  assert.equal(parseProject('acme/x'), undefined)
})

test('fetchDiscovery reads the repository and the Project', async () => {
  const { client, calls } = setup(standardFixture(), 'github.com')
  const raw = await fetchDiscovery(client, { host: 'github.com', repo: 'acme/widgets', project: 'acme/7', exec: () => assert.fail('no meta call') })
  const names = calls.map((call) => /query (\w+)/.exec(JSON.parse(call.input).query)[1])
  assert.deepEqual(names, ['PmkitRepo', 'PmkitProject'])
  assert.deepEqual(JSON.parse(calls[0].input).variables, { owner: 'acme', name: 'widgets' })
  assert.deepEqual(JSON.parse(calls[1].input).variables, { owner: 'acme', number: 7 })
  assert.equal(raw.viewer.login, 'octocat')
  assert.deepEqual(raw.issueTypes.map((type) => type.name), ['Task', 'Bug', 'Feature'])
  assert.equal(raw.project.title, 'Roadmap')
  assert.deepEqual(raw.truncated, [])
})

test('fetchDiscovery skips the Project with project none and with no project', async () => {
  for (const project of ['none', undefined]) {
    const { client, calls } = setup(standardFixture(), 'github.com')
    const raw = await fetchDiscovery(client, { host: 'github.com', repo: 'acme/widgets', project })
    assert.equal(calls.length, 1)
    assert.equal(raw.project, null)
  }
})

test('fetchDiscovery leaves issue fields out of the query on GHES 3.19 and 3.20', async () => {
  const fixture = standardFixture({ meta: { installed_version: '3.20.3' }, graphql: { PmkitRepo: repoReply({ fields: null }), PmkitProject: projectReply() } })
  const fake = fakeGhExec(fixture)
  const client = createGithubClient({ root: '/repo', env: {}, exec: fake.exec, host: 'ghes.example.com' })
  const raw = await fetchDiscovery(client, { host: 'ghes.example.com', repo: 'acme/widgets', project: 'acme/7', exec: fake.exec })
  assert.deepEqual(fake.calls[0].args, ['api', '--hostname', 'ghes.example.com', 'meta'])
  assert.doesNotMatch(JSON.parse(fake.calls[1].input).query, /issueFields/)
  assert.doesNotMatch(JSON.parse(fake.calls[2].input).query, /isIssueField/)
  assert.deepEqual(raw.issueFields, [])
  assert.equal(raw.ghesVersion, '3.20.3')
})

test('fetchDiscovery asks for issue fields on GHES 3.22 and not on 3.21, whose Repository has none', async () => {
  for (const [version, asked] of [['3.21.0', false], ['3.22.0', true]]) {
    const fixture = standardFixture({ meta: { installed_version: version } })
    const fake = fakeGhExec(fixture)
    const client = createGithubClient({ root: '/repo', env: {}, exec: fake.exec, host: 'ghes.example.com' })
    await fetchDiscovery(client, { host: 'ghes.example.com', repo: 'acme/widgets', project: 'none', exec: fake.exec })
    assert.equal(/issueFields/.test(JSON.parse(fake.calls[1].input).query), asked, version)
  }
})

test('fetchDiscovery reads the Project of a GHES 3.22 host from the stateful fake', async () => {
  const fake = fakeGithubIssues({ host: 'ghes.example.com', ghesVersion: '3.22.0' })
  const client = createGithubClient({ exec: fake.exec, host: 'ghes.example.com', retries: 0, sleep: async () => {} })
  const raw = await fetchDiscovery(client, { host: 'ghes.example.com', repo: 'acme/widgets', project: 'acme/7', exec: fake.exec })
  assert.equal(raw.project.number, 7)
  assert.ok(raw.issueFields.length > 0)
})

test('fetchDiscovery fails with AUTH and the project scope step when the Project read lacks the scope', async () => {
  const { client } = setup(standardFixture({ graphql: { PmkitRepo: repoReply(), PmkitProject: SCOPE_ERROR } }), 'acme.ghe.com')
  await rejectsWith(fetchDiscovery(client, { host: 'acme.ghe.com', repo: 'acme/widgets', project: 'acme/7' }), 'AUTH', /gh auth refresh -s project -h acme\.ghe\.com/)
})

test('fetchDiscovery fails with NOT_FOUND for a Project the account cannot see', async () => {
  const { client } = setup(standardFixture({ graphql: { PmkitRepo: repoReply(), PmkitProject: { data: { repositoryOwner: { projectV2: null } } } } }), 'github.com')
  await rejectsWith(fetchDiscovery(client, { host: 'github.com', repo: 'acme/widgets', project: 'acme/9' }), 'NOT_FOUND', /acme\/9/)
})

test('fetchDiscovery fails with NOT_FOUND for a repository GitHub does not return', async () => {
  const { client } = setup(standardFixture({ graphql: { PmkitRepo: { data: { viewer: { login: 'o', name: null }, repository: null } } } }), 'github.com')
  await rejectsWith(fetchDiscovery(client, { host: 'github.com', repo: 'acme/gone', project: 'none' }), 'NOT_FOUND', /acme\/gone/)
})

test('fetchDiscovery records a cut list', async () => {
  const { client } = setup(standardFixture({ graphql: { PmkitRepo: repoReply({ typesMore: true, fieldsMore: true }) } }), 'github.com')
  const raw = await fetchDiscovery(client, { host: 'github.com', repo: 'acme/widgets', project: 'none' })
  assert.deepEqual(raw.truncated, ['issue types', 'issue fields'])
})

test('fetchLinkedProjects lists the linked Projects, and AUTH propagates', async () => {
  const ok = setup(standardFixture({ graphql: { PmkitLinkedProjects: linkedReply([{ number: 7, title: 'Roadmap', owner: 'acme' }, { number: 2, title: 'Bugs', owner: 'octocat' }]) } }), 'github.com')
  assert.deepEqual(await fetchLinkedProjects(ok.client, 'acme/widgets'), [{ id: 'acme/7', title: 'Roadmap' }, { id: 'octocat/2', title: 'Bugs' }])
  const denied = setup(standardFixture({ graphql: { PmkitLinkedProjects: SCOPE_ERROR } }), 'github.com')
  await rejectsWith(fetchLinkedProjects(denied.client, 'acme/widgets'), 'AUTH', /gh auth refresh -s project/)
})

test('fetchLinkedProjects lists nothing when GitHub answers without the repository', async () => {
  const empty = setup(standardFixture({ graphql: { PmkitLinkedProjects: { data: { repository: null } } } }), 'github.com')
  assert.deepEqual(await fetchLinkedProjects(empty.client, 'acme/widgets'), [])
})

test('fetchLinkedProjects pages through more than 100 linked Projects', async () => {
  const fake = fakeGithubIssues({ epics: Array.from({ length: 150 }, (_, index) => ({ number: 100 + index })) })
  const client = createGithubClient({ exec: fake.exec, retries: 0, sleep: async () => {} })
  const linked = await fetchLinkedProjects(client, 'acme/widgets')
  assert.equal(linked.length, 151)
  assert.deepEqual([linked[0].id, linked.at(-1).id], ['acme/7', 'acme/249'])
  const reads = fake.reads.filter((call) => call.name === 'PmkitLinkedProjects')
  assert.deepEqual(reads.map((call) => [call.variables.first, call.variables.after]), [[100, null], [100, '99']])
})

async function rawOf(fixture = standardFixture(), project = 'acme/7') {
  const { client } = setup(fixture, 'github.com')
  return fetchDiscovery(client, { host: 'github.com', repo: 'acme/widgets', project })
}

const pmkitWith = (mappings, project = 'acme/7') => ({ tracker: { system: 'github', scope: { host: 'github.com', repo: 'acme/widgets', project } }, mappings })

test('discoveryView returns issue types, issue fields and Project fields', async () => {
  const view = discoveryView(await rawOf(), pmkitWith({}))
  assert.equal(view.host, 'github.com')
  assert.equal(view.repo, 'acme/widgets')
  assert.deepEqual(view.viewer, { id: 'octocat', name: 'The Octocat' })
  assert.deepEqual(view.project, { owner: 'acme', number: 7, title: 'Roadmap', url: 'https://github.com/orgs/acme/projects/7' })
  assert.deepEqual(view.issueTypes, [
    { name: 'Task', description: 'A specific piece of work' },
    { name: 'Bug', description: 'An unexpected problem' },
    { name: 'Feature', description: 'A request' },
  ])
  assert.deepEqual(view.issueFields[0], { name: 'Priority', dataType: 'SINGLE_SELECT', options: ['P0', 'P1'] })
  assert.deepEqual(view.issueFields[1], { name: 'Effort', dataType: 'NUMBER', options: [] })
  assert.deepEqual(view.projectFields.find((field) => field.name === 'Status'), { name: 'Status', dataType: 'SINGLE_SELECT', options: ['Backlog', 'Todo', 'In Progress', 'In Review', 'Done'], issueField: false })
  assert.equal(view.projectFields.find((field) => field.name === 'Priority').issueField, true)
  assert.deepEqual(view.statusOptions, ['Backlog', 'Todo', 'In Progress', 'In Review', 'Done'])
  assert.deepEqual(view.priorities, ['urgent', 'high', 'medium', 'low'])
  assert.deepEqual(view.labels, ['bug', 'documentation'])
  assert.deepEqual(view.members, [{ id: 'octocat', name: 'The Octocat', email: null }])
  assert.ok(!Object.keys(view).includes('raw') && view.raw !== undefined, 'raw is hidden but present')
})

test('discoveryView gives each Status option its mapped category and warns about an unmapped one', async () => {
  const view = discoveryView(await rawOf(), pmkitWith({ status: { backlog: 'Backlog', todo: 'Todo', in_progress: 'In Progress', done: 'Done', in_review: 'none', blocked: 'none' } }))
  assert.deepEqual(view.statuses, [
    { name: 'Backlog', category: 'backlog' },
    { name: 'Todo', category: 'todo' },
    { name: 'In Progress', category: 'in_progress' },
    { name: 'In Review', category: 'in_progress' },
    { name: 'Done', category: 'done' },
    { name: 'Open', category: 'todo' },
    { name: 'Closed', category: 'done' },
    { name: 'Closed as not planned', category: 'canceled' },
  ])
  assert.ok(view.warnings.includes('Status option In Review has no category in mappings.status; issues in it count as in_progress'))
})

test('discoveryView reports open and closed when the repository has no Project', async () => {
  const view = discoveryView(await rawOf(standardFixture(), 'none'), pmkitWith({}, 'none'))
  assert.equal(view.project, null)
  assert.deepEqual(view.projectFields, [])
  assert.deepEqual(view.statusOptions, [])
  assert.deepEqual(view.statuses, [{ name: 'Open', category: 'todo' }, { name: 'Closed', category: 'done' }, { name: 'Closed as not planned', category: 'canceled' }])
  assert.ok(view.warnings.some((warning) => /tracker\.scope\.project is none/.test(warning)))
})

test('mappedLabelNames includes the priority and estimate labels (PMK-339)', () => {
  assert.deepEqual(mappedLabelNames({ mappings: { status: { in_progress: 'label:Doing' }, priority: { high: 'label:P1', low: 'none' }, estimate: { 3: 'label:size: 3' } } }), ['Doing', 'P1', 'size: 3'])
})

test('discoveryView lists the mapped pmkit types and the estimate unit', async () => {
  const raw = await rawOf()
  assert.deepEqual(discoveryView(raw, pmkitWith({ types: { feature: 'Feature', bug: 'Bug' } })).types, ['feature', 'bug'])
  assert.deepEqual(discoveryView(raw, pmkitWith({ fields: { estimate: 'issue:Effort' } })).estimate, { unit: 'points', scale: [] })
  assert.deepEqual(discoveryView(raw, pmkitWith({ fields: { estimate: 'issue:Priority' } })).estimate, { unit: 'sizes', scale: ['P0', 'P1'] })
})

test('discoveryView warns about a mapping that names something GitHub no longer has', async () => {
  const view = discoveryView(await rawOf(), pmkitWith({ status: { todo: 'Ready' }, fields: { priority: 'issue:Urgency', estimate: 'project:Size' }, types: { chore: 'Chore' } }))
  assert.ok(view.warnings.includes('mappings.status.todo names Ready, which the Status field of acme/7 no longer has'))
  assert.ok(view.warnings.includes('mappings.fields.priority names issue field Urgency, which acme/widgets no longer has'))
  assert.ok(view.warnings.includes('mappings.fields.estimate names Project field Size, which acme/7 no longer has'))
  assert.ok(view.warnings.includes('mappings.types.chore names issue type Chore, which acme/widgets does not have enabled'))
})

test('discoveryView warns about the priority options past the fourth, which read as no priority', async () => {
  const raw = await rawOf()
  const priority = raw.issueFields.find((item) => item.name === 'Priority')
  priority.options = ['P0', 'P1', 'P2', 'P3', 'P4', 'P5'].map((name, index) => ({ id: `opt-p${index}`, name }))
  const view = discoveryView(raw, pmkitWith({ fields: { priority: 'issue:Priority' } }))
  assert.ok(view.warnings.includes('the priority field Priority has options that map to no priority (P4, P5); issues in them read with no priority'))
  priority.options = priority.options.slice(0, 4)
  assert.ok(!discoveryView(raw, pmkitWith({ fields: { priority: 'issue:Priority' } })).warnings.some((warning) => /map to no priority/.test(warning)))
})

test('discoveryView warns about cut lists', async () => {
  const view = discoveryView(await rawOf(standardFixture({ graphql: { PmkitRepo: repoReply({ typesMore: true }), PmkitProject: projectReply() } })), pmkitWith({}))
  assert.ok(view.warnings.includes('GitHub has more issue types than discovery reads; it kept the first 50'))
})

test('checkGhesVersion maps a timeout to UPSTREAM', async () => {
  const slow = () => {
    const error = new Error('spawnSync gh ETIMEDOUT')
    error.code = 'ETIMEDOUT'
    throw error
  }
  await rejectsWith(checkGhesVersion({ exec: slow, host: 'ghes.example.com' }), 'UPSTREAM', /did not answer.*ghes\.example\.com/)
})

test('discoveryView warns about a Project without a Status field', async () => {
  const fixture = standardFixture({ graphql: { PmkitRepo: repoReply(), PmkitProject: projectReply({ extra: [{ __typename: 'ProjectV2Field', id: 'P', name: 'Notes', dataType: 'TEXT', isIssueField: false }] }) } })
  const view = discoveryView(await rawOf(fixture), pmkitWith({}))
  assert.deepEqual(view.statuses.map((status) => status.name), ['Open', 'Closed', 'Closed as not planned'])
  assert.ok(view.warnings.includes('GitHub Project acme/7 has no single-select Status field'))
})

test('discoveryView leaves out a state status that a Status option already names', async () => {
  const fixture = standardFixture({ graphql: { PmkitRepo: repoReply(), PmkitProject: projectReply({ status: ['Open', 'Doing', 'Closed'] }) } })
  const view = discoveryView(await rawOf(fixture), pmkitWith({ status: { todo: 'Open', in_progress: 'Doing', done: 'Closed' } }))
  assert.deepEqual(view.statuses, [
    { name: 'Open', category: 'todo' },
    { name: 'Doing', category: 'in_progress' },
    { name: 'Closed', category: 'done' },
    { name: 'Closed as not planned', category: 'canceled' },
  ])
})

/** An exec that answers PmkitAssignableUsers by page from users, two per page, and everything else from the fixture. */
function pagedUsers(users, fixture = standardFixture()) {
  const fake = fakeGhExec(fixture)
  const exec = (cmd, args, options = {}) => {
    const body = args.includes('graphql') ? JSON.parse(options.input) : null
    if (!body?.query.startsWith('query PmkitAssignableUsers(')) return fake.exec(cmd, args, options)
    fake.calls.push({ cmd, args, input: options.input })
    const start = body.variables.after ? Number(body.variables.after) : 0
    const nodes = users.slice(start, start + 2)
    const hasNextPage = start + 2 < users.length
    const reply = { data: { repository: { assignableUsers: { nodes, pageInfo: { hasNextPage, endCursor: hasNextPage ? String(start + 2) : null } } } } }
    return { status: 0, stdout: `HTTP/2.0 200 OK\r\n\r\n${JSON.stringify(reply)}`, stderr: '' }
  }
  return { ...fake, exec, client: createGithubClient({ root: '/repo', env: {}, exec, host: 'github.com', sleep: async () => {} }) }
}

const THREE_USERS = [{ id: 'U_1', login: 'octocat', name: 'The Octocat' }, { id: 'U_2', login: 'hubot', name: 'Hubot' }, { id: 'U_3', login: 'monalisa', name: null }]

test('fetchDiscovery with users reads the ids and pages the assignable users', async () => {
  const { client, calls } = pagedUsers(THREE_USERS)
  const raw = await fetchDiscovery(client, { host: 'github.com', repo: 'acme/widgets', project: 'acme/7', users: true })
  const names = calls.map((call) => /query (\w+)/.exec(JSON.parse(call.input).query)[1])
  assert.deepEqual(names, ['PmkitRepo', 'PmkitAssignableUsers', 'PmkitAssignableUsers', 'PmkitProject'])
  assert.deepEqual(JSON.parse(calls[1].input).variables, { owner: 'acme', name: 'widgets', first: 100, after: null })
  assert.equal(raw.repositoryId, 'R_1')
  assert.deepEqual(raw.viewer, { id: 'U_1', login: 'octocat', name: 'The Octocat' })
  assert.deepEqual(raw.labels, [{ id: 'LA_1', name: 'bug' }, { id: 'LA_2', name: 'documentation' }])
  assert.deepEqual(raw.users, THREE_USERS)
  assert.deepEqual(raw.features, { issueFields: true, relatesTo: true, statusEvents: true, iterationIds: true, itemQuery: true })
  assert.match(JSON.parse(calls[0].input).query, /viewer \{ id login name \}/)
  assert.match(JSON.parse(calls[0].input).query, /labels\(first: 100\) \{ nodes \{ id name \}/)
  const view = discoveryView(raw, pmkitWith({}))
  assert.deepEqual(view.members, [
    { id: 'octocat', name: 'The Octocat', email: null },
    { id: 'hubot', name: 'Hubot', email: null },
    { id: 'monalisa', name: null, email: null },
  ])
  assert.deepEqual(view.labels, ['bug', 'documentation'])
})

test('fetchDiscovery without users sends no user query and keeps users empty', async () => {
  const { client, calls } = setup(standardFixture(), 'github.com')
  const raw = await fetchDiscovery(client, { host: 'github.com', repo: 'acme/widgets', project: 'none' })
  assert.equal(calls.length, 1)
  assert.deepEqual(raw.users, [])
})

test('discoveryView puts the viewer first when the assignable users leave the viewer out', async () => {
  const { client } = pagedUsers(THREE_USERS.slice(1))
  const view = discoveryView(await fetchDiscovery(client, { host: 'github.com', repo: 'acme/widgets', project: 'none', users: true }), pmkitWith({}, 'none'))
  assert.deepEqual(view.members.map((member) => member.id), ['octocat', 'hubot', 'monalisa'])
})

test('discoveryView warns when GitHub has more assignable users than discovery reads', async () => {
  const many = Array.from({ length: 21 }, (_, index) => ({ id: `U_${index}`, login: `user${index}`, name: null }))
  const { client } = pagedUsers(many)
  const raw = await fetchDiscovery(client, { host: 'github.com', repo: 'acme/widgets', project: 'none', users: true })
  assert.equal(raw.users.length, 20)
  assert.ok(discoveryView(raw, pmkitWith({}, 'none')).warnings.includes('GitHub has more assignable users than discovery reads; it kept the first 1000'))
})

test('fetchDiscovery reads mapped labels by name past the first page of labels', async () => {
  const labels = Array.from({ length: 120 }, (_, index) => `Label ${index + 1}`)
  const { client, calls } = setup(standardFixture({ graphql: { PmkitRepo: repoReply({ labels }) } }), 'github.com')
  const raw = await fetchDiscovery(client, { host: 'github.com', repo: 'acme/widgets', project: 'none', labels: ['label 115', 'Label 2', 'Gone'] })
  const body = JSON.parse(calls[0].input)
  assert.match(body.query, /\$l0: String!, \$l1: String!, \$l2: String!/)
  assert.match(body.query, /l0: label\(name: \$l0\) \{ id name \}/)
  assert.deepEqual(body.variables, { owner: 'acme', name: 'widgets', l0: 'label 115', l1: 'Label 2', l2: 'Gone' })
  assert.equal(raw.labels.length, 101)
  assert.deepEqual(raw.labels.at(-1), { id: 'LA_115', name: 'Label 115' })
  assert.deepEqual(raw.truncated, ['labels'])
})

test('discoveryView lists status labels with their categories without a Project', async () => {
  const raw = await rawOf(standardFixture({ graphql: { PmkitRepo: repoReply({ labels: ['Doing', 'Review'] }) } }), 'none')
  const view = discoveryView(raw, pmkitWith({ status: { in_review: 'label:Review', in_progress: 'label:doing', backlog: 'none' } }, 'none'))
  assert.deepEqual(view.statuses, [
    { name: 'Doing', category: 'in_progress' },
    { name: 'Review', category: 'in_review' },
    { name: 'Open', category: 'todo' },
    { name: 'Closed', category: 'done' },
    { name: 'Closed as not planned', category: 'canceled' },
  ])
  assert.ok(!view.warnings.some((warning) => /PMK-89|no status label/.test(warning)))
})

test('discoveryView warns once when no status label is mapped without a Project', async () => {
  const view = discoveryView(await rawOf(standardFixture(), 'none'), pmkitWith({}, 'none'))
  assert.deepEqual(view.warnings.filter((warning) => /tracker\.scope\.project is none/.test(warning)), [
    'tracker.scope.project is none and no status label is mapped; issues read open as todo and closed as done',
  ])
})

test('mappedLabelNames lists each label the config and the answers name, once without case', () => {
  const pmkit = { mappings: { status: { in_progress: 'label:Doing', done: 'Done', backlog: 'none' }, types: { bug: 'label:bug' } } }
  assert.deepEqual(mappedLabelNames(pmkit), ['Doing', 'bug'])
  assert.deepEqual(mappedLabelNames(pmkit, ['doing', 'Label 115', 'label:Review']), ['Doing', 'bug', 'Label 115', 'Review'])
})

test('the repository query selects the owner id and the Project query selects the iteration configuration', () => {
  assert.match(repoQuery({ issueFields: true }), /owner \{ id login __typename \}/)
  const query = projectQuery({ issueFields: true })
  assert.ok(query.includes('... on ProjectV2IterationField { id name dataType isIssueField configuration { duration startDay iterations { id title startDate duration } completedIterations { id title startDate duration } } }'))
  assert.ok(projectQuery({ issueFields: false }).includes('... on ProjectV2IterationField { id name dataType configuration {'))
})

test('the Project query asks for isIssueField and multi-select fields only off GHES, whose schemas have neither', () => {
  const dotcom = projectQuery({ issueFields: true, ghes: false })
  assert.match(dotcom, /isIssueField/)
  assert.match(dotcom, /ProjectV2MultiSelectField/)
  const ghes = projectQuery({ issueFields: true, ghes: true })
  assert.doesNotMatch(ghes, /isIssueField/)
  assert.doesNotMatch(ghes, /ProjectV2MultiSelectField/)
})

test('fetchDiscovery carries ownerId and the configuration of each iteration field', async () => {
  const configuration = { duration: 14, startDay: 1, iterations: [{ id: 'IT_a', title: 'Sprint 1', startDate: '2026-11-16', duration: 14 }], completedIterations: [{ id: 'IT_0', title: 'Sprint 0', startDate: '2026-11-02', duration: 14 }] }
  const nodes = projectReply().data.repositoryOwner.projectV2.fields.nodes.map((node) => (node.dataType === 'ITERATION' ? { ...node, configuration } : node))
  const repo = repoReply()
  repo.data.repository.owner.id = 'O_1'
  const { client } = setup(standardFixture({ graphql: { PmkitRepo: repo, PmkitProject: projectReply({ extra: nodes }) } }), 'github.com')
  const raw = await fetchDiscovery(client, { host: 'github.com', repo: 'acme/widgets', project: 'acme/7' })
  assert.equal(raw.ownerId, 'O_1')
  assert.deepEqual(raw.project.fields.find((item) => item.dataType === 'ITERATION').configuration, configuration)
  assert.equal(raw.project.fields.find((item) => item.name === 'Due').configuration, undefined)
})

test('an iteration field without configuration reads as no iterations, and a repository without owner id as null', async () => {
  const { client } = setup(standardFixture(), 'github.com')
  const raw = await fetchDiscovery(client, { host: 'github.com', repo: 'acme/widgets', project: 'acme/7' })
  assert.equal(raw.ownerId, null)
  assert.deepEqual(raw.project.fields.find((item) => item.dataType === 'ITERATION').configuration, { duration: null, startDay: null, iterations: [], completedIterations: [] })
})
