// /pmkit:link-repo on the basic fixture, which has the git host `none`, in a git repository whose origin is
// git@github.com:acme/app.git. The user passes no flag, so step 1 infers the host and the repository from the remote. The dry
// run shows none -> github with acme/app, the user confirms step 6, and step 7 runs the same call without --dry-run, which
// writes the two lines. The fixture is a Local tracker, so no team is asked.
import assert from 'node:assert/strict'

export default {
  command: 'link-repo',
  fixture: 'basic',
  prompt: '/pmkit:link-repo',
  answers: ['Yes'],
  git: true,
  setup: ({ git }) => git('remote', 'add', 'origin', 'git@github.com:acme/app.git'),
  steps: [
    { step: '1', dryRun: ['link-repo'] },
    { confirm: 'Step 6' },
    { step: '1', write: ['link-repo'] },
    { step: '8', read: ['validate'] },
    { step: '8', read: ['capabilities'] },
  ],
  skip: {},
  notHit: {},
  expect(repo) {
    assert.match(repo.file('.pmkit/config.yaml'), /git_host:\n {2}system: github\n {2}repo: acme\/app\n/)
    assert.deepEqual(repo.newEvents('ISS-3F7H'), [])
  },
}
