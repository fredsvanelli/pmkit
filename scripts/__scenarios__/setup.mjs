// /pmkit:setup on a new repository, then on a repository that already has a config.
// Entry 0, first run: an empty git repository with no remote, so step 2 picks the git host `none`. The user answers
// prefix ISS, ID style random (the local tracker recommends it), estimate unit points and one member, Fred.
// Entry 1, existing config: the basic fixture. Setup brings it up to date with `init --update` and then deletes
// `.issues/.gitignore`, so the dry run lists one `create` and no `differs` file, and step 5 asks nothing.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'

const members = 'fred:\n  name: Fred Vanelli\n  email: fred@example.com\n'
const init = ['init', '--git-host', 'none', '--prefix', 'ISS', '--id-style', 'random', '--estimate-unit', 'points', '--members-file', '-']

export default [
  {
    command: 'setup',
    fixture: null,
    git: true,
    prompt: '/pmkit:setup',
    answers: ['ISS', 'random (Recommended)', 'points', 'Fred Vanelli <fred@example.com>', 'Yes'],
    steps: [
      // Step 6: preview with the members file on stdin. Step 7 shows the summary, step 8 writes.
      { step: 'First run 6', dryRun: init, stdin: members, save: 'preview' },
      { confirm: 'First run' },
      { step: 'First run 6', write: init, stdin: members },
      // Step 9: check the new tracker.
      { step: 'First run 9', read: ['validate'], save: 'problems' },
      { step: 'First run 9', read: ['discover'], save: 'discovered' },
      { step: 'First run 9', read: ['capabilities'] },
    ],
    skip: {
      'Existing config 2 validate': 'there is no config, so step 1 takes the first run',
      'Existing config 3 init': 'there is no config, so step 1 takes the first run',
      'Existing config 7 init': 'there is no config, so step 1 takes the first run',
      'Existing config 8 validate': 'there is no config, so step 1 takes the first run',
      'Existing config 8 discover': 'there is no config, so step 1 takes the first run',
      'Existing config 8 capabilities': 'there is no config, so step 1 takes the first run',
    },
    notHit: { 'Existing config': 'there is no config, so step 1 takes the first run' },
    expect(repo, saved) {
      assert.ok(saved.preview.files.every((file) => file.action === 'create'), 'every file is new')
      assert.deepEqual(saved.problems.problems, [])
      assert.deepEqual(saved.discovered.members.map((member) => member.id), ['fred'])
      assert.ok(repo.file('.pmkit/config.yaml'), '.pmkit/config.yaml exists')
      assert.match(repo.file('.issues/config.yaml'), /^id_prefix: ISS$/m)
    },
  },
  {
    command: 'setup',
    fixture: 'basic',
    async setup({ root, pmkit }) {
      await pmkit(['init', '--update'])
      fs.rmSync(path.join(root, '.issues', '.gitignore'))
    },
    prompt: '/pmkit:setup',
    answers: ['Yes'],
    steps: [
      { step: 'Existing config 2', read: ['validate'] },
      // Step 3: no setting changes, so no extra flag. Step 4 lists the one `create` file.
      { step: 'Existing config 3', dryRun: ['init', '--update'], save: 'preview' },
      { confirm: 'Existing config' },
      { step: 'Existing config 7', write: ['init', '--update'] },
      { step: 'Existing config 8', read: ['validate'], save: 'problems' },
      { step: 'Existing config 8', read: ['discover'] },
      { step: 'Existing config 8', read: ['capabilities'] },
    ],
    skip: {
      'First run 6 init': 'the config exists, so step 1 takes the existing config path',
      'First run 9 validate': 'the config exists, so step 1 takes the existing config path',
      'First run 9 discover': 'the config exists, so step 1 takes the existing config path',
      'First run 9 capabilities': 'the config exists, so step 1 takes the existing config path',
    },
    notHit: { 'First run': 'the config exists, so step 1 takes the existing config path' },
    expect(repo, saved) {
      const changed = saved.preview.files.filter((file) => file.action !== 'keep')
      assert.deepEqual(changed, [{ path: '.issues/.gitignore', action: 'create' }])
      assert.deepEqual(saved.problems.problems, [])
      assert.ok(repo.file('.issues/.gitignore'), 'the deleted file is back')
    },
  },
]
