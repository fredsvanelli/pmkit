// The tracker contract suite against the GitHub adapter over the stateful fake. Only the families the adapter implements run.
import { runTrackerContract } from '../../contract-suite.mjs'
import { fakeGithubIssues } from '../../fake-github-issues.mjs'
import { tempDir, userStoreEnv } from '../../test-helpers.mjs'
import { createGithubTracker } from './tracker.mjs'

const STATUS_OPTIONS = ['Triage', 'Backlog', 'Todo', 'In Progress', 'In Review', 'Done', 'Canceled']
const STATUS = { triage: 'Triage', backlog: 'Backlog', todo: 'Todo', in_progress: 'In Progress', in_review: 'In Review', done: 'Done', canceled: 'Canceled' }

// A Project with a Status option per category, every category mapped, three types and the issue fields of the fake repository.
function githubContract() {
  const fake = fakeGithubIssues({ project: { statusOptions: STATUS_OPTIONS, iterations: { fieldName: 'Sprint' } } })
  const root = tempDir()
  const { env } = userStoreEnv()
  const config = {
    root,
    pmkit: {
      version: 1,
      tracker: { system: 'github', scope: { host: 'github.com', repo: 'acme/widgets', project: 'acme/7' } },
      git_host: { system: 'github' },
      mappings: {
        status: STATUS,
        types: { feature: 'Feature', bug: 'Bug', task: 'Task' },
        fields: { priority: 'issue:Priority', estimate: 'issue:Effort', target_date: 'issue:Target date', start_date: 'none', sprint: 'project:Sprint' },
      },
    },
  }
  const tracker = createGithubTracker(config, { env, exec: fake.exec, now: () => new Date('2026-11-16T12:00:00Z') })
  return { tracker, env, fake, root, today: '2026-11-16', actor: 'octocat', teardown: () => {} }
}

// GitHub comments have no threads, and documents, time, agents and releases wait for later issues.
runTrackerContract({
  name: 'GitHub tracker contract over the fake',
  families: ['discovery', 'issues', 'relations', 'history', 'cycles', 'deliverables', 'deliverable-writes', 'milestones', 'milestone-writes'],
  setup: githubContract,
})
