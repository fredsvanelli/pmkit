// /pmkit:issues:run-view in-progress on the team fixture, with the view in-progress added by setup.
// The view holds `categories: [in_progress]`, so the run lists the in-progress issues and writes nothing.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'

export default {
  command: 'issues/run-view',
  fixture: 'team',
  setup({ root }) {
    const dir = path.join(root, '.issues', 'views')
    fs.mkdirSync(dir, { recursive: true })
    fs.writeFileSync(path.join(dir, 'in-progress.yaml'), 'filter:\n  categories: [in_progress]\n')
  },
  prompt: '/pmkit:issues:run-view in-progress',
  answers: [],
  steps: [
    { step: '1', read: ['capabilities'] },
    { step: '3', read: ['views', 'run', 'in-progress'], save: 'run' },
  ],
  skip: { '2 views list': 'the prompt names the view, so the list of views is not needed' },
  notHit: { 'Step 2': 'the prompt names the view, so the list of views is not asked for' },
  expect(repo, saved) {
    assert.deepEqual(saved.run.issues.map((issue) => issue.id), ['ISS-2X6D', 'ISS-5N1R'], 'the two issues in progress')
  },
}
