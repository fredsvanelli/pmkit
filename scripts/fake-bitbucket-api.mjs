// A fake `fetch` for the Bitbucket Cloud REST API: the Jira fake, whose routes and recorded calls work for any host.
// Its two default routes are Jira paths that no Bitbucket client calls. Route keys are '<METHOD> <path>', for example
// `GET ${BB}/pullrequests`; client tests check call.url for the host, since the fake ignores it.

import { fakeJiraFetch } from './fake-jira-api.mjs'

export const FAKE_BB_TOKEN = 'ATATTBBTESTTOKENTESTTOKEN'
export const FAKE_BB_ENV = Object.freeze({ BITBUCKET_TOKEN: FAKE_BB_TOKEN })
export const BB = '/2.0/repositories/acme/widgets'

export const fakeBitbucketFetch = (routes = {}) => fakeJiraFetch(routes)

const NOW = '2026-11-23T12:00:00.000000+00:00'
const WEB = 'https://bitbucket.org/acme/widgets'
const notFound = (what) => ({ status: 404, json: { type: 'error', error: { message: `${what} not found` } } })

/** A fresh repository: no pull request or pipeline yet, and a deployment to each of two environments. */
function freshState() {
  const environments = [{ type: 'deployment_environment', uuid: '{env-production}', name: 'Production' }, { type: 'deployment_environment', uuid: '{env-staging}', name: 'Staging' }]
  const deployment = (n, env, status, day) => ({
    type: 'deployment', uuid: `{dep-${n}}`, environment: { uuid: env }, state: { name: 'COMPLETED', status: { name: status } },
    release: { name: `#${n}`, url: `${WEB}/pipelines/results/${n}`, created_on: `2026-11-${day}T10:00:00.000Z`, commit: { hash: `release${n}hash` } },
  })
  return {
    nextPr: 1,
    nextBuild: 1,
    pullrequests: [],
    pipelines: [],
    steps: {},
    logs: {},
    environments,
    deployments: [deployment(900, '{env-production}', 'SUCCESSFUL', 20), deployment(901, '{env-staging}', 'FAILED', 22)],
  }
}

/**
 * A stateful fake of one repository, acme/widgets, for the runbook test: pull requests (opened, read, made ready), their build
 * statuses, pipelines with steps and logs, environments and deployments. Opening a pull request runs a pipeline of its source
 * branch whose Test step fails, as a repository with Pipelines would on the push before it. `state` is plain JSON, so a launcher
 * can save it between runs. `diff(source, destination)` and `commit(branch)` answer from a real git repository when given.
 * merge(id) and decline(id) do what a reviewer does on bitbucket.org.
 */
export function fakeBitbucketRepo({ state = freshState(), diff = () => '', commit = () => null, now = NOW } = {}) {
  const prOf = (id) => state.pullrequests.find((pr) => pr.id === Number(id))
  const query = (call) => new URL(call.url).searchParams
  const page = (values) => ({ json: { pagelen: values.length, size: values.length, page: 1, values } })

  function runPipeline(branch) {
    const n = state.nextBuild++
    const uuid = `{pipe-${n}}`
    const hash = commit(branch)
    state.pipelines.push({
      type: 'pipeline', uuid, build_number: n, created_on: now,
      state: { name: 'COMPLETED', result: { name: 'FAILED' } },
      target: { type: 'pipeline_ref_target', ref_type: 'branch', ref_name: branch, selector: { type: 'branches', pattern: branch }, ...(hash ? { commit: { hash } } : {}) },
    })
    state.steps[uuid] = [
      { type: 'pipeline_step', uuid: '{step-build}', name: 'Build', state: { name: 'COMPLETED', result: { name: 'SUCCESSFUL' } } },
      { type: 'pipeline_step', uuid: '{step-test}', name: 'Test', state: { name: 'COMPLETED', result: { name: 'FAILED' } } },
    ]
    state.logs[`${uuid}/{step-test}`] = `+ npm test\nnot ok 1 - retries the sync\n`
  }

  const setState = (id, value) => {
    const pr = prOf(id)
    if (!pr) throw new Error(`fake Bitbucket: no pull request ${id}`)
    pr.state = value
    pr.updated_on = now
  }

  const routes = {
    [`GET ${BB}`]: { json: { type: 'repository', full_name: 'acme/widgets', name: 'widgets', slug: 'widgets', is_private: true, mainbranch: { type: 'branch', name: 'main' } } },
    [`GET ${BB}/pullrequests`]: (call) => {
      const params = query(call)
      const states = params.getAll('state').length > 0 ? params.getAll('state') : ['OPEN']
      const head = /^source\.branch\.name="((?:[^"\\]|\\.)*)"$/.exec(params.get('q') ?? '')?.[1]?.replace(/\\(.)/g, '$1')
      const values = state.pullrequests
        .filter((pr) => states.includes(pr.state) && (head === undefined || pr.source.branch.name === head))
        .sort((a, b) => b.id - a.id)
      return page(values)
    },
    [`POST ${BB}/pullrequests`]: (call) => {
      const sent = JSON.parse(call.body)
      const id = state.nextPr++
      const source = sent.source.branch.name
      const destination = sent.destination.branch.name
      const pr = {
        type: 'pullrequest', id, title: sent.title, description: sent.description ?? '', state: 'OPEN', draft: sent.draft === true,
        links: { html: { href: `${WEB}/pull-requests/${id}` } },
        source: { branch: { name: source }, commit: { hash: commit(source) } },
        destination: { branch: { name: destination }, commit: { hash: commit(destination) } },
        author: { type: 'user', nickname: 'fred', display_name: 'Fred' },
        created_on: now, updated_on: now, participants: [],
      }
      state.pullrequests.push(pr)
      runPipeline(source)
      return { status: 201, json: pr }
    },
    [`GET ${BB}/pullrequests/{id}`]: (call) => {
      const pr = prOf(call.params.id)
      return pr ? { json: pr } : notFound('Pull request')
    },
    [`PUT ${BB}/pullrequests/{id}`]: (call) => {
      const pr = prOf(call.params.id)
      if (!pr) return notFound('Pull request')
      const sent = JSON.parse(call.body)
      for (const key of ['title', 'description', 'draft']) if (sent[key] !== undefined) pr[key] = sent[key]
      pr.updated_on = now
      return { json: pr }
    },
    [`GET ${BB}/pullrequests/{id}/statuses`]: (call) => {
      const pr = prOf(call.params.id)
      if (!pr) return notFound('Pull request')
      const results = { SUCCESSFUL: 'SUCCESSFUL', FAILED: 'FAILED', ERROR: 'FAILED', STOPPED: 'STOPPED' }
      return page(state.pipelines
        .filter((p) => p.target.ref_name === pr.source.branch.name)
        .map((p) => ({ type: 'build', key: `pipeline-${p.build_number}`, name: `Pipeline #${p.build_number}`, state: results[p.state.result?.name] ?? 'INPROGRESS', url: `${WEB}/pipelines/results/${p.build_number}` })))
    },
    [`GET ${BB}/pullrequests/{id}/diff`]: (call) => {
      const pr = prOf(call.params.id)
      return pr ? { text: diff(pr.source.branch.name, pr.destination.branch.name) } : notFound('Pull request')
    },
    [`GET ${BB}/pipelines`]: (call) => {
      const branch = query(call).get('target.branch')
      return page(state.pipelines.filter((p) => branch === null || p.target.ref_name === branch).sort((a, b) => b.build_number - a.build_number))
    },
    [`GET ${BB}/pipelines/{uuid}/steps`]: (call) => (state.steps[call.params.uuid] ? page(state.steps[call.params.uuid]) : notFound('Pipeline')),
    [`GET ${BB}/pipelines/{uuid}/steps/{step}/log`]: (call) => {
      const log = state.logs[`${call.params.uuid}/${call.params.step}`]
      return log === undefined ? notFound('Log') : { text: log }
    },
    [`GET ${BB}/environments`]: () => page(state.environments),
    [`GET ${BB}/deployments`]: () => page(state.deployments),
  }

  return { state, routes, merge: (id) => setState(id, 'MERGED'), decline: (id) => setState(id, 'DECLINED') }
}
