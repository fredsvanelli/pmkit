// /pmkit:local:render "board as html" on the team fixture: one render call with --save, which writes
// .issues/.cache/render/board.html. Reads and the snapshot skip .issues/.cache, and git ignores it,
// so the snapshot shows no file change. ISS-3Q6T has conflict markers, so the result lists it in problems.
import assert from 'node:assert/strict'

export default {
  command: 'local/render',
  fixture: 'team',
  prompt: '/pmkit:local:render board as html',
  answers: [],
  steps: [
    { step: '3', read: ['render', 'board', '--format', 'html', '--save'], save: 'board' },
  ],
  skip: {},
  notHit: {},
  expect(repo, saved) {
    assert.equal(saved.board.path, '.issues/.cache/render/board.html')
    assert.equal(saved.board.overwrote, false)
    assert.deepEqual(saved.board.problems.map((p) => p.id), ['ISS-3Q6T'])
    assert.match(repo.file('.issues/.cache/render/board.html'), /^<!doctype html>\n<!-- pmkit render board:/)
  },
}
