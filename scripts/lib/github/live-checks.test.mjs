// The live checks of the GitHub adapter (scripts/lib/github/live-checks.mjs) against the stateful fake GitHub. Nothing here
// reaches GitHub: every check runs over an injected exec.
import assert from 'node:assert/strict'
import test from 'node:test'
import { fakeGithubIssues } from '../../fake-github-issues.mjs'
import { createGithubClient } from './client.mjs'
import { liveGhExec } from '../../fake-gh-live.mjs'
import { projectReply } from '../../fake-github-api.mjs'
import {
  checkDiscover, checkGhesConversion, checkMissingScope, checkNoLogin, checkOpenCycle, checkNotFound, checkRateHeaders, checkRejectedToken, guardExec, LIVE_DOCUMENTS, liveTargets, MARKER,
  preflightProject, skipReasons,
} from './live-checks.mjs'

const GITHUB = { PMKIT_LIVE: '1', PMKIT_LIVE_GITHUB_REPO: 'acme/widgets', PMKIT_LIVE_GITHUB_PROJECT: 'acme/7' }
const GHES = { PMKIT_LIVE_GHES_HOST: 'ghes.example.com', PMKIT_LIVE_GHES_REPO: 'acme/widgets', PMKIT_LIVE_GHES_PROJECT: 'acme/7' }
const SCOPELESS = `ghp_${'S'.repeat(36)}`

const clientOf = (fake, options = {}) => createGithubClient({ exec: fake.exec, retries: 0, sleep: async () => {}, ...options })

test('without PMKIT_LIVE=1 every group is skipped with one reason, whatever else is set', () => {
  for (const env of [{}, { ...GITHUB, ...GHES, PMKIT_LIVE: undefined, PMKIT_LIVE_GITHUB_SCOPELESS_TOKEN: SCOPELESS }, { ...GITHUB, PMKIT_LIVE: 'yes' }]) {
    assert.deepEqual(Object.values(skipReasons(env)), Array(5).fill('set PMKIT_LIVE=1 to run the live check'))
  }
})

test('each group names the first variable it lacks', () => {
  const reasons = skipReasons({ PMKIT_LIVE: '1' })
  assert.equal(reasons.errors, false)
  assert.equal(reasons.scope, 'set PMKIT_LIVE_GITHUB_SCOPELESS_TOKEN to a classic token without the project scope to check the missing-scope error')
  assert.equal(reasons.discover, 'set PMKIT_LIVE_GITHUB_REPO to owner/name of a github.com repository')
  assert.equal(reasons.openCycle, reasons.discover)
  assert.equal(reasons.ghes, 'no GHES host configured: set PMKIT_LIVE_GHES_HOST, PMKIT_LIVE_GHES_REPO and PMKIT_LIVE_GHES_PROJECT to convert a draft on GHES')
  const noProject = skipReasons({ PMKIT_LIVE: '1', PMKIT_LIVE_GITHUB_REPO: 'acme/widgets' })
  assert.equal(noProject.discover, `set PMKIT_LIVE_GITHUB_PROJECT to owner/number of a throwaway Project whose title starts with ${MARKER}`)
  assert.equal(skipReasons({ PMKIT_LIVE: '1', PMKIT_LIVE_GHES_HOST: 'ghes.example.com' }).ghes, 'set PMKIT_LIVE_GHES_REPO to owner/name of a throwaway repository on the GHES host')
  assert.equal(skipReasons({ PMKIT_LIVE: '1', PMKIT_LIVE_GHES_HOST: 'ghes.example.com', PMKIT_LIVE_GHES_REPO: 'acme/w' }).ghes, `set PMKIT_LIVE_GHES_PROJECT to owner/number of a throwaway Project on the GHES host whose title starts with ${MARKER}`)
  assert.deepEqual(skipReasons({ ...GITHUB, ...GHES, PMKIT_LIVE_GITHUB_SCOPELESS_TOKEN: SCOPELESS }), { errors: false, scope: false, discover: false, openCycle: false, ghes: false })
})

test('a malformed variable is a skip reason that names it, never a request', () => {
  assert.equal(skipReasons({ ...GITHUB, PMKIT_LIVE_GITHUB_REPO: 'acme' }).discover, 'PMKIT_LIVE_GITHUB_REPO must be owner/name, such as acme/widgets')
  assert.equal(skipReasons({ ...GITHUB, PMKIT_LIVE_GITHUB_PROJECT: 'acme/x' }).openCycle, 'PMKIT_LIVE_GITHUB_PROJECT must be owner/number, such as acme/7')
  assert.equal(skipReasons({ ...GITHUB, ...GHES, PMKIT_LIVE_GHES_HOST: 'https://ghes.example.com' }).ghes, 'PMKIT_LIVE_GHES_HOST must be a host name, such as github.example.com')
  assert.equal(skipReasons({ ...GITHUB, ...GHES, PMKIT_LIVE_GHES_HOST: 'github.com' }).ghes, 'PMKIT_LIVE_GHES_HOST must name a GitHub Enterprise Server host, not github.com or GHE.com')
  assert.equal(skipReasons({ ...GITHUB, PMKIT_LIVE_GITHUB_SCOPELESS_TOKEN: ' ' }).scope, 'set PMKIT_LIVE_GITHUB_SCOPELESS_TOKEN to a classic token without the project scope to check the missing-scope error')
})

test('liveTargets reads the checked values', () => {
  assert.deepEqual(liveTargets({ ...GITHUB, ...GHES, PMKIT_LIVE_GITHUB_SCOPELESS_TOKEN: SCOPELESS }), {
    github: { repo: 'acme/widgets', project: 'acme/7', scopeless: SCOPELESS },
    ghes: { host: 'ghes.example.com', repo: 'acme/widgets', project: 'acme/7' },
  })
  assert.deepEqual(liveTargets({ PMKIT_LIVE_GITHUB_REPO: 'acme' }).github, { repo: null, project: null, scopeless: null })
})

test('the guard refuses a mutation it does not allow, one whose check fails, and a REST write, before gh runs', async () => {
  const fake = fakeGithubIssues({ project: { title: `${MARKER} checks` } })
  const runs = []
  const exec = (cmd, args, options) => { runs.push(args); return fake.exec(cmd, args, options) }
  const guarded = guardExec(exec, { PmkitLiveAddDraft: (variables) => variables.input?.projectId === 'PVT_1' })
  const client = clientOf({ exec: guarded })
  await assert.rejects(client.request('mutation PmkitDeleteIssue($input: DeleteIssueInput!) { deleteIssue(input: $input) { repository { id } } }', { input: { issueId: 'I_1' } }), /the live check refused PmkitDeleteIssue/)
  await assert.rejects(client.request(LIVE_DOCUMENTS.ADD_DRAFT, { input: { projectId: 'PVT_9', title: 'x' } }), /the live check refused PmkitLiveAddDraft/)
  await assert.rejects(client.rest('POST', 'repos/acme/widgets/milestones', { title: 'x' }), /the live check refused POST repos\/acme\/widgets\/milestones/)
  assert.deepEqual(runs, [])
  const added = await client.request(LIVE_DOCUMENTS.ADD_DRAFT, { input: { projectId: 'PVT_1', title: 'x' } })
  assert.match(added.addProjectV2DraftIssue.projectItem.id, /^PVTI_/)
  assert.equal((await client.request(LIVE_DOCUMENTS.VIEWER)).viewer.login, 'octocat')
  assert.equal(runs.length, 2)
})

test('the preflight accepts an empty Project whose title starts with the marker, and returns its id', async () => {
  const fake = fakeGithubIssues({ project: { title: `${MARKER} checks` } })
  assert.deepEqual(await preflightProject(clientOf(fake), 'acme/7', 'PMKIT_LIVE_GITHUB_PROJECT'), { id: 'PVT_1', title: `${MARKER} checks` })
})

test('the preflight refuses a missing Project, one without the marker and one with an item, and writes nothing', async () => {
  const cases = [
    [fakeGithubIssues({ project: { title: `${MARKER} checks` } }), 'acme/9', /GitHub has no Project acme\/9, or the gh account cannot see it/],
    [fakeGithubIssues({ project: { title: 'Roadmap' } }), 'acme/7', /the title of the Project acme\/7 does not start with pmkit-live/],
    [(() => { const fake = fakeGithubIssues({ project: { title: `${MARKER} checks` } }); fake.seedDraft({ title: 'left over' }); return fake })(), 'acme/7', /the Project acme\/7 holds 1 item; empty it/],
  ]
  for (const [fake, project, message] of cases) {
    const before = fake.mutations.length
    const error = await preflightProject(clientOf(fake), project, 'PMKIT_LIVE_GITHUB_PROJECT').catch((caught) => caught)
    assert.equal(error.code, 'INVALID_INPUT')
    assert.match(error.message, message)
    assert.match(error.nextStep, /PMKIT_LIVE_GITHUB_PROJECT/)
    assert.equal(fake.mutations.length, before)
  }
})

// Criterion 1: the error shapes.

const errorRun = (extra = {}) => {
  const github = fakeGithubIssues({ project: { title: `${MARKER} checks` } })
  return { github, env: { PATH: process.env.PATH, ...GITHUB, PMKIT_LIVE_GITHUB_SCOPELESS_TOKEN: SCOPELESS, ...extra }, makeExec: liveGhExec({ github, ghes: null }, { scopelessToken: SCOPELESS }) }
}

test('each error shape check passes against a gh that answers as GitHub does, and writes nothing', async () => {
  const { github, env, makeExec } = errorRun({ GH_TOKEN: `ghp_${'U'.repeat(36)}` })
  for (const check of [checkNoLogin, checkRejectedToken, checkNotFound, checkRateHeaders, checkMissingScope]) {
    const { asserted } = await check({ env, makeExec })
    assert.ok(asserted.length > 0, check.name)
  }
  assert.deepEqual(github.mutations, [])
})

test('the no-login check fails when gh answers as logged in, and the rejected-token check when GitHub accepts the token', async () => {
  const { github, env } = errorRun()
  const loggedIn = () => (cmd, args, options) => github.exec(cmd, args, options)
  await assert.rejects(checkNoLogin({ env, makeExec: loggedIn }), /expected AUTH "GitHub CLI is not logged in"/)
  await assert.rejects(checkRejectedToken({ env, makeExec: loggedIn }), /expected AUTH "GitHub rejected the token of the gh login"/)
})

test('the not-found check fails on an answer that is not NOT_FOUND, and the rate check on an answer without the rate headers', async () => {
  const { env } = errorRun()
  const upstream = () => () => ({ status: 1, stdout: 'HTTP/2.0 200 OK\r\n\r\n{"errors":[{"type":"INTERNAL","message":"boom"}]}', stderr: 'gh: boom' })
  await assert.rejects(checkNotFound({ env, makeExec: upstream }), /expected NOT_FOUND, got UPSTREAM/)
  const bare = () => () => ({ status: 0, stdout: 'HTTP/2.0 200 OK\r\n\r\n{"data":{"viewer":{"login":"octocat"}}}', stderr: '' })
  await assert.rejects(checkRateHeaders({ env, makeExec: bare }), /GitHub sent no rate-limit headers/)
})

test('the missing-scope check sends the scopeless token only through GH_TOKEN, and the token is in no output', async () => {
  const { env } = errorRun()
  const seen = []
  const fakeExec = liveGhExec({ github: fakeGithubIssues(), ghes: null }, { scopelessToken: SCOPELESS })
  const makeExec = (childEnv) => (cmd, args, options) => { seen.push({ args, token: childEnv.GH_TOKEN }); return fakeExec(childEnv)(cmd, args, options) }
  const { asserted } = await checkMissingScope({ env, makeExec })
  assert.deepEqual(seen.map((call) => call.token), [SCOPELESS])
  assert.ok(seen.every((call) => !call.args.join(' ').includes(SCOPELESS)))
  assert.ok(!JSON.stringify(asserted).includes(SCOPELESS))
  // A refusal whose text echoes the token fails without printing it.
  const echo = () => () => ({ status: 1, stdout: `HTTP/2.0 200 OK\r\n\r\n${JSON.stringify({ errors: [{ type: 'INSUFFICIENT_SCOPES', message: `token ${SCOPELESS} has the following scopes: ['repo']` }] })}`, stderr: '' })
  const error = await checkMissingScope({ env, makeExec: echo }).catch((caught) => caught)
  assert.match(error.message, /the scopeless token appears in the error/)
  assert.ok(!error.message.includes(SCOPELESS))
})

// Criterion 2: discover against a repository with a Project.

const ITERATIONS = { completed: [{ id: 'IT_0', title: 'Sprint 1', startDate: '2026-11-02', duration: 14 }], iterations: [{ id: 'IT_1', title: 'Sprint 2', startDate: '2026-11-16', duration: 14 }] }

test('the discover check reads the repository and its Project, writes nothing and prints counts only', async () => {
  const github = fakeGithubIssues({ project: { title: `${MARKER} checks`, iterations: ITERATIONS } })
  const lines = []
  const { asserted } = await checkDiscover({ env: { ...GITHUB }, makeExec: liveGhExec({ github, ghes: null }), write: (line) => lines.push(line) })
  assert.ok(asserted.some((line) => /Status options/.test(line)))
  assert.deepEqual(github.mutations, [])
  assert.equal(lines.length, 1)
  assert.match(lines[0], /^issue types \d+, issue fields \d+, Project fields \d+ \(iteration \d+\), Status options \d+, capabilities \d+$/)
})

test('the discover check fails on a Project with no iteration field, and on a Status field with no option', async () => {
  const fields = projectReply().data.repositoryOwner.projectV2.fields.nodes.filter((field) => field.dataType !== 'ITERATION')
  const noIteration = fakeGithubIssues({ project: { title: `${MARKER} checks`, fields } })
  await assert.rejects(checkDiscover({ env: { ...GITHUB }, makeExec: liveGhExec({ github: noIteration, ghes: null }) }), /the Project acme\/7 has no iteration field/)
  const noStatus = fakeGithubIssues({ project: { title: `${MARKER} checks`, iterations: ITERATIONS, statusOptions: [] } })
  await assert.rejects(checkDiscover({ env: { ...GITHUB }, makeExec: liveGhExec({ github: noStatus, ghes: null }) }), /the Project acme\/7 has no Status option/)
})

// Criterion 3: openCycle keeps the iteration of every item.

const NOW = () => new Date('2026-11-17T09:00:00.000Z')
const cycleRun = () => {
  const github = fakeGithubIssues({ project: { title: `${MARKER} checks`, iterations: ITERATIONS } })
  return { github, env: { ...GITHUB }, makeExec: liveGhExec({ github, ghes: null }) }
}
const iterationIds = (github) => {
  const field = github.state.project.fields.find((item) => item.dataType === 'ITERATION')
  return [...field.configuration.completedIterations, ...field.configuration.iterations].map((item) => item.id).sort()
}
const projectItems = (github) => github.state.items.filter((item) => item.projectId === 'PVT_1')

test('the openCycle check passes when GitHub keeps the ids, and leaves the Project empty with its iterations as they were', async () => {
  const { github, env, makeExec } = cycleRun()
  const lines = []
  const { asserted } = await checkOpenCycle({ env, makeExec, write: (line) => lines.push(line), now: NOW })
  assert.ok(asserted.some((line) => /2 items kept their iteration/.test(line)))
  assert.deepEqual(github.mutations.map((call) => call.name), [
    'PmkitLiveAddDraft', 'PmkitSetProjectField', 'PmkitLiveAddDraft', 'PmkitSetProjectField', 'PmkitUpdateIterations',
    'PmkitDeleteProjectItem', 'PmkitDeleteProjectItem', 'PmkitUpdateIterations',
  ])
  const opened = github.mutations[4].input.iterationConfiguration.iterations
  assert.deepEqual(opened.map((item) => [item.id ?? null, item.startDate]), [['IT_0', '2026-11-02'], ['IT_1', '2026-11-16'], [null, '2026-11-30']])
  assert.equal(opened[2].title, `${MARKER} 2026-11-30`)
  assert.deepEqual(projectItems(github), [])
  assert.deepEqual(iterationIds(github), ['IT_0', 'IT_1'])
  assert.ok(lines.some((line) => /restored the 2 iterations of the field Sprint/.test(line)))
})

test('the openCycle check fails, naming the items, when GitHub drops the ids, and still cleans up', async () => {
  const { github, env } = cycleRun()
  let stripped = false
  const makeExec = (child) => (cmd, args, options = {}) => {
    const body = options.input ? JSON.parse(options.input) : null
    if (!stripped && /PmkitUpdateIterations/.test(body?.query ?? '')) {
      stripped = true
      for (const iteration of body.variables.input.iterationConfiguration.iterations) delete iteration.id
      return liveGhExec({ github, ghes: null })(child)(cmd, args, { ...options, input: JSON.stringify(body) })
    }
    return liveGhExec({ github, ghes: null })(child)(cmd, args, options)
  }
  await assert.rejects(checkOpenCycle({ env, makeExec, now: NOW }), /openCycle cleared the iteration of 2 of 2 items: PVTI_1, PVTI_2/)
  assert.deepEqual(projectItems(github), [])
  assert.deepEqual(iterationIds(github), ['IT_0', 'IT_1'])
})

test('the openCycle check deletes its drafts when a write fails in the middle', async () => {
  const { github, env, makeExec } = cycleRun()
  github.failNext('PmkitSetProjectField')
  await assert.rejects(checkOpenCycle({ env, makeExec, now: NOW }), /fake GitHub failed PmkitSetProjectField/)
  assert.deepEqual(projectItems(github), [])
  assert.ok(!github.mutations.some((call) => call.name === 'PmkitUpdateIterations'))
})

test('the openCycle check stops before any write on a Project that is not a throwaway one, or whose iteration field has no iteration', async () => {
  const named = fakeGithubIssues({ project: { title: 'Roadmap', iterations: ITERATIONS } })
  await assert.rejects(checkOpenCycle({ env: { ...GITHUB }, makeExec: liveGhExec({ github: named, ghes: null }), now: NOW }), /does not start with pmkit-live/)
  const empty = fakeGithubIssues({ project: { title: `${MARKER} checks`, iterations: { iterations: [], completed: [] } } })
  await assert.rejects(checkOpenCycle({ env: { ...GITHUB }, makeExec: liveGhExec({ github: empty, ghes: null }), now: NOW }), /the iteration field Sprint of acme\/7 has no iteration/)
  assert.deepEqual([...named.mutations, ...empty.mutations], [])
})

// Criterion 4: converting a draft on GHES.

const ghesRun = (version) => {
  const ghes = fakeGithubIssues({ host: 'ghes.example.com', ghesVersion: version, project: { title: `${MARKER} checks` } })
  return { ghes, env: { PMKIT_LIVE: '1', ...GHES }, makeExec: liveGhExec({ github: null, ghes }) }
}

test('the GHES check converts one draft on 3.19, then removes the item and deletes the issue', async () => {
  const { ghes, env, makeExec } = ghesRun('3.19.0')
  const lines = []
  const { asserted } = await checkGhesConversion({ env, makeExec, write: (line) => lines.push(line) })
  assert.ok(asserted.some((line) => /converted the draft into issue #1/.test(line)))
  assert.deepEqual(ghes.mutations.map((call) => call.name), ['PmkitLiveAddDraft', 'PmkitConvertDraftItem', 'PmkitDeleteProjectItem', 'PmkitDeleteIssue'])
  assert.deepEqual([ghes.state.items, ghes.state.issues], [[], []])
  assert.ok(lines.some((line) => /GitHub Enterprise Server 3\.19\.0/.test(line)))
  assert.ok(!lines.some((line) => /is not 3\.19/.test(line)))
})

test('the GHES check closes the issue as not planned when GitHub refuses the delete, and prints its number and link', async () => {
  const { ghes, env, makeExec } = ghesRun('3.19.0')
  ghes.failNext('PmkitDeleteIssue', { errors: [{ type: 'FORBIDDEN', message: 'octocat does not have the correct permissions to execute `DeleteIssue`' }] })
  const lines = []
  await checkGhesConversion({ env, makeExec, write: (line) => lines.push(line) })
  assert.deepEqual(ghes.state.issues.map((issue) => [issue.number, issue.state, issue.stateReason]), [[1, 'CLOSED', 'NOT_PLANNED']])
  assert.deepEqual(ghes.state.items, [])
  assert.ok(lines.some((line) => line.includes('closed issue #1 as not planned instead: https://ghes.example.com/acme/widgets/issues/1; delete it by hand')))
})

test('the GHES check stops before any write below 3.19, and notes a host that is not 3.19', async () => {
  const old = ghesRun('3.18.2')
  await assert.rejects(checkGhesConversion({ env: old.env, makeExec: old.makeExec }), /older than 3\.19/)
  assert.deepEqual(old.ghes.mutations, [])
  const newer = ghesRun('3.20.1')
  const lines = []
  await checkGhesConversion({ env: newer.env, makeExec: newer.makeExec, write: (line) => lines.push(line) })
  assert.ok(lines.some((line) => line === 'GitHub Enterprise Server 3.20.1 is not 3.19, which the criterion names; the result holds for 3.20.1'))
})

test('the GHES check removes the draft when the conversion fails', async () => {
  const { ghes, env, makeExec } = ghesRun('3.19.0')
  ghes.failNext('PmkitConvertDraftItem')
  await assert.rejects(checkGhesConversion({ env, makeExec }), /fake GitHub failed PmkitConvertDraftItem/)
  assert.deepEqual([ghes.state.items, ghes.state.issues], [[], []])
})
