// The tracker contract suite against the Jira adapter over the stateful fake. Only the families the adapter implements run.
import { runTrackerContract } from '../../contract-suite.mjs'
import { FAKE_ENV, TRACKER, fakeJiraFetch } from '../../fake-jira-api.mjs'
import { fakeJiraIssues } from '../../fake-jira-issues.mjs'
import { tempDir, userStoreEnv } from '../../test-helpers.mjs'
import { createJiraTracker } from './tracker.mjs'

const STATUS = { triage: 'Triage', backlog: 'Backlog', todo: 'To Do', in_progress: 'In Progress', in_review: 'Review', done: 'Done', canceled: 'Canceled' }

// A space with a status in every category, every category mapped, two types and no Resolution screen; the viewer acts.
function jiraContract() {
  const fake = fakeJiraIssues({ requireResolution: false, extraStatuses: true })
  const config = {
    root: tempDir(),
    pmkit: { version: 1, tracker: TRACKER, git_host: { system: 'github' }, mappings: { status: STATUS, types: { feature: 'Story', bug: 'Bug' } } },
  }
  const tracker = createJiraTracker(config, { env: { ...FAKE_ENV, ...userStoreEnv().env }, now: () => new Date('2026-11-22T12:00:00Z'), fetch: fakeJiraFetch(fake.routes) })
  return { tracker, fake, today: '2026-11-22', actor: 'acc-1', teardown: () => {} }
}

// Jira archives work items only on Premium, so archive is out; threads, time and the rest wait for later issues.
runTrackerContract({
  name: 'Jira tracker contract over the fake',
  families: ['discovery', 'issues', 'relations', 'history', 'cycles', 'cycle-lifecycle', 'deliverables', 'deliverable-writes'],
  setup: jiraContract,
})
