// /pmkit:report:release-readiness on the no-sprints fixture with the GitHub host: the planned release 1.0.0 has ISS-3M8D open
// (its branch has an open PR) and ISS-6R3N done. The command only reads, so it asks nothing.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'

const PR_LIST = 'pr list --state open --limit 200 --json number,url,title,headRefName,isDraft,updatedAt,author,statusCheckRollup'
const DEPLOYMENTS = 'api repos/{owner}/{repo}/deployments?per_page=20'
const pr = (number, branch) => ({ number, url: `https://github.com/o/r/pull/${number}`, title: `PR ${number}`, headRefName: branch, isDraft: false, updatedAt: '2026-10-20T10:00:00Z', author: { login: 'ana' }, statusCheckRollup: [] })

export default {
  command: 'report/release-readiness',
  fixture: 'no-sprints',
  github: true,
  gh: {
    [PR_LIST]: { stdout: JSON.stringify([pr(21, 'feat-export'), pr(22, 'unrelated')]) },
    [DEPLOYMENTS]: { stdout: JSON.stringify([{ id: 5, node_id: 'N5', environment: 'staging', ref: 'main', sha: 'abcdef1234', created_at: '2026-10-22T10:00:00Z' }]) },
    'api graphql -f query=query($ids: [ID!]!) { nodes(ids: $ids) { ... on Deployment { latestStatus { state logUrl environmentUrl } } } } -f ids[]=N5': { stdout: JSON.stringify({ data: { nodes: [{ latestStatus: { state: 'SUCCESS' } }] } }) },
  },
  async setup({ root }) {
    const file = path.join(root, '.issues/issues/ISS-3M8D/issue.md')
    fs.writeFileSync(file, fs.readFileSync(file, 'utf8').replace('\ncreated: ', '\nbranch: feat-export\ncreated: '))
  },
  prompt: '/pmkit:report:release-readiness',
  answers: [],
  steps: [
    { step: '1', read: ['release-readiness'], save: 'readiness' },
  ],
  skip: {},
  notHit: {},
  expect(repo, saved) {
    const { readiness } = saved
    assert.deepEqual(repo.ghCalls().slice(0, 2), [PR_LIST, DEPLOYMENTS])
    assert.deepEqual([readiness.basis, readiness.reason, readiness.source.id], ['release', 'next_planned', '1.0.0'])
    assert.deepEqual(readiness.issues.open.map((row) => row.id), ['ISS-3M8D'])
    assert.deepEqual(readiness.pullRequests.map((row) => [row.number, row.issue]), [[21, 'ISS-3M8D']])
    assert.equal(readiness.deploys.length, 1)
    assert.equal(readiness.ready, false)
  },
}
