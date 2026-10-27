// /pmkit:team:risk-radar on the team fixture with the GitHub host, on 2026-10-23. The setup writes branches into two issue
// files by hand, so no event is appended. ISS-2X6D is blocked and idle even with its draft PR, PR 9 is stalled with a
// failing check, and the test workflow fails on main.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'

const PR_LIST = 'pr list --state open --limit 200 --json number,url,title,headRefName,isDraft,updatedAt,author,statusCheckRollup'
const RUN_LIST = 'run list --branch main --limit 50 --json databaseId,workflowName,status,conclusion,url,createdAt,headSha'
const pr = (number, branch, isDraft, updatedAt, conclusion) => ({
  number, url: `https://github.com/o/r/pull/${number}`, title: `PR ${number}`, headRefName: branch, isDraft, updatedAt, author: { login: 'ana' },
  statusCheckRollup: [{ __typename: 'CheckRun', name: 'test', status: 'COMPLETED', conclusion }],
})
const run = (id, workflowName, status, conclusion, createdAt) => ({ databaseId: id, workflowName, status, conclusion, url: `https://github.com/o/r/actions/runs/${id}`, createdAt, headSha: `sha${id}` })

export default {
  command: 'team/risk-radar',
  fixture: 'team',
  github: true,
  gh: {
    [PR_LIST]: { stdout: JSON.stringify([pr(9, 'feat-dlq', false, '2026-10-15T10:00:00Z', 'FAILURE'), pr(11, 'feat-csv', true, '2026-10-16T10:00:00Z', 'SUCCESS')]) },
    [RUN_LIST]: { stdout: JSON.stringify([
      run(4, 'lint', 'in_progress', '', '2026-10-23T09:00:00Z'),
      run(3, 'test', 'completed', 'failure', '2026-10-22T10:00:00Z'),
      run(2, 'lint', 'completed', 'success', '2026-10-22T09:00:00Z'),
      run(1, 'test', 'completed', 'success', '2026-10-21T10:00:00Z'),
    ]) },
  },
  async setup({ root }) {
    for (const [id, branch] of [['ISS-2X6D', 'feat-csv'], ['ISS-8C4W', 'feat-dlq']]) {
      const file = path.join(root, '.issues/issues', id, 'issue.md')
      fs.writeFileSync(file, fs.readFileSync(file, 'utf8').replace('\ncreated: ', `\nbranch: ${branch}\ncreated: `))
    }
  },
  prompt: '/pmkit:team:risk-radar',
  answers: [],
  steps: [
    { step: '1', read: ['risks'], save: 'risks' },
  ],
  skip: {},
  notHit: {},
  expect(repo, saved) {
    const { risks } = saved
    for (const id of ['ISS-2X6D', 'ISS-5N1R', 'ISS-8C4W']) assert.deepEqual(repo.newEvents(id), [], `${id}: a read-only command appends no event`)
    assert.deepEqual(repo.ghCalls(), [PR_LIST, RUN_LIST], 'only the two list calls, and no write')
    assert.equal(risks.gitHost.available, true)
    assert.deepEqual(risks.blocked.map((row) => row.id), ['ISS-2X6D'])
    assert.deepEqual(risks.stalledIssues.map((row) => [row.id, row.reason, row.idleBusinessDays, row.pr]), [['ISS-2X6D', 'idle', 5, 11]])
    assert.deepEqual(risks.stalledPullRequests.map((row) => [row.number, row.isDraft, row.idleBusinessDays, row.issue]), [[9, false, 6, 'ISS-8C4W'], [11, true, 5, 'ISS-2X6D']])
    assert.deepEqual(risks.epics.map((row) => [row.id, row.reasons]), [['EPC-2M9D', ['no_recent_update']]])
    assert.deepEqual(risks.ci.defaultBranch.failing.map((row) => [row.workflow, row.conclusion]), [['test', 'failure']])
    assert.equal(risks.ci.defaultBranch.workflows, 2)
    assert.deepEqual(risks.ci.pullRequests.map((row) => [row.number, row.failing]), [[9, ['test']]])
  },
}
