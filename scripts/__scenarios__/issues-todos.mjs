// /pmkit:issues:todos on the team fixture, in a git repository. Setup writes three files with four comments and an
// issue that already covers one of them. The scan groups "fix the cache", which repeats in two files, into one
// candidate, drops "handle the empty list" because the issue text holds it, and leaves two candidates.
// The approval of step 5 comes after the dry runs of step 4 and before the creates of step 6.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'

const inputs = path.join(import.meta.dirname, '_inputs')
const create = (title, type, file) => ['issues', 'create', '--title', title, '--type', type, '--description-file', path.join(inputs, file)]
const cache = create('fix the cache', 'bug', 'todo-cache.md')
const unique = create('unique work item', 'task', 'todo-unique.md')

export default {
  command: 'issues/todos',
  fixture: 'team',
  git: true,
  async setup({ root, pmkit }) {
    const write = (file, text) => {
      fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true })
      fs.writeFileSync(path.join(root, file), text)
    }
    write('src/a.mjs', 'export const a = 1\n// TODO(ana): fix the cache\n')
    write('src/b.mjs', '/* FIXME fix the cache */\n# TODO: unique work item\n')
    write('src/c.mjs', '// TODO handle the empty list\n')
    await pmkit(['issues', 'create', '--title', 'Export edge cases', '--type', 'task', '--description-file', path.join(inputs, 'todo-existing.md')])
  },
  prompt: '/pmkit:issues:todos',
  answers: ['Yes'],
  steps: [
    { step: '1', read: ['todos', 'scan'] },
    { step: '2', read: ['discover'] },
    { step: '4', dryRun: cache },
    { step: '4', dryRun: unique },
    { confirm: 'Step 5' },
    { step: '6', write: cache, save: 'cache' },
    { step: '6', write: unique, save: 'unique' },
  ],
  skip: {},
  notHit: { 'Step 4': 'no dry run fails, so no corrected value is asked for' },
  expect(repo) {
    assert.equal(repo.issue('ISS-Y8KQ').type, 'bug')
    assert.equal(repo.issue('ISS-DZEF').type, 'task')
    assert.match(repo.file('.issues/issues/ISS-Y8KQ/issue.md'), /Also at: `src\/b\.mjs:1`\n\ntodo-key: 60191fa02c98/)
    assert.match(repo.file('.issues/issues/ISS-DZEF/issue.md'), /todo-key: ee48ce71c74f/)
    assert.equal(repo.file('.issues/issues/ISS-M0GZ/issue.md').includes('todo-key'), false, 'the matched comment gets no issue')
  },
}
