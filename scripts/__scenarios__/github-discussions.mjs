// /pmkit:github:discussions. The first entry runs on a Local tracker, where step 1 reads the manifest and the command stops. The
// second runs on a GitHub Issues tracker over the stateful fake GitHub (githubTracker, PMK-340): it lists, reads, creates the issue
// and comments back on the discussion.
import assert from 'node:assert/strict'
import path from 'node:path'

const inputs = path.join(import.meta.dirname, '_inputs')
const create = ['issues', 'create', '--title-file', path.join(inputs, 'discussion-issue-title.txt'), '--description-file', path.join(inputs, 'discussion-issue-description.md'),
  '--criteria-file', path.join(inputs, 'discussion-issue-criteria.md')]
const comment = ['github', 'discussions', 'comment', '1', '--body-file', path.join(inputs, 'discussion-comment.txt')]
const seed = (github) => github.seedDiscussion({
  title: 'RFC: offline mode', body: 'Should the app work without a network?', category: 'Ideas', author: 'hubot', upvotes: 4, updatedAt: '2026-11-10T00:00:00.000Z',
  comments: [{ author: 'octocat', body: 'Yes, read-only first', upvotes: 2, replies: [{ author: 'hubot', body: 'And writes later?' }] }, { author: 'hubot', body: 'Sync conflicts worry me' }],
})

const SKIPPED = 'the Local tracker stops at step 1; the GitHub entry below covers it'
const skip = {
  '2 github discussions list': SKIPPED,
  '3 github discussions get': SKIPPED,
  '5 issues create': SKIPPED,
  '6 issues create': SKIPPED,
  '7 github discussions comment': SKIPPED,
  '8 github discussions comment': SKIPPED,
}
const notHit = {
  'Step 2': 'the command stops at step 1 on this tracker, before it lists the discussions',
  'Step 4': 'the command stops at step 1 on this tracker, before it asks what to do',
  'Step 5': 'the command stops at step 1 on this tracker, before it previews an issue',
  'Step 7': 'the command stops at step 1 on this tracker, before it previews a comment',
}

export default [
  {
    command: 'github/discussions',
    fixture: 'team',
    git: true,
    prompt: '/pmkit:github:discussions',
    answers: [],
    steps: [{ step: '1', read: ['capabilities'], save: 'capabilities' }],
    skip,
    notHit,
    expect(repo, saved) {
      assert.equal(saved.capabilities.tracker, 'local')
    },
  },
  {
    command: 'github/discussions',
    fixture: null,
    githubTracker: { seed },
    prompt: '/pmkit:github:discussions',
    answers: ['#1 RFC: offline mode', 'Turn it into an issue', 'Create it', 'Post it'],
    steps: [
      { step: '1', read: ['capabilities'], save: 'capabilities' },
      { step: '2', read: ['github', 'discussions', 'list'], save: 'list' },
      { confirm: 'Step 2' },
      { step: '3', read: ['github', 'discussions', 'get', '1'], save: 'discussion' },
      { confirm: 'Step 4' },
      { step: '5', dryRun: create },
      { confirm: 'Step 5' },
      { step: '6', write: create, save: 'created' },
      { step: '7', dryRun: comment },
      { confirm: 'Step 7' },
      { step: '8', write: comment, save: 'commented' },
    ],
    skip: {},
    notHit: {},
    expect(repo, saved) {
      assert.equal(saved.capabilities.tracker, 'github')
      assert.deepEqual(saved.list.discussions.map((item) => item.title), ['RFC: offline mode'])
      assert.equal(saved.discussion.discussion.commentsTotal, 2)
      assert.equal(saved.created.after.title, 'Add an offline mode')
      assert.equal(saved.commented.url !== null, true)
      const posted = repo.github().discussions[0].comments.at(-1)
      assert.equal(posted.body, 'Tracked in #1')
    },
  },
]
