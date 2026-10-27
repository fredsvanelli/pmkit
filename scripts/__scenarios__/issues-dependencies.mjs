// /pmkit:issues:dependencies for an epic with a blocker outside it (team, EPC-2M9D)
// and for an epic with no blocker links (no-sprints, EPC-4H7V). The command only reads.
import assert from 'node:assert/strict'

export default [
  {
    command: 'issues/dependencies',
    fixture: 'team',
    git: true,
    prompt: '/pmkit:issues:dependencies EPC-2M9D',
    answers: [],
    steps: [{ step: '1', read: ['issues', 'dependencies', 'EPC-2M9D'], save: 'map' }],
    skip: {},
    notHit: {},
    expect(repo, saved) {
      assert.equal(saved.map.basis, 'blockers')
      assert.deepEqual(saved.map.criticalPath.ids, ['ISS-5N1R', 'ISS-2X6D'])
      assert.deepEqual(saved.map.nodes.filter((node) => node.critical).map((node) => node.id), ['ISS-2X6D', 'ISS-5N1R'])
      for (const id of ['ISS-2X6D', 'ISS-5N1R', 'ISS-8C4W', 'ISS-4M2S']) assert.deepEqual(repo.newEvents(id), [])
      assert.equal(repo.git('status', '--porcelain'), '')
    },
  },
  {
    command: 'issues/dependencies',
    fixture: 'no-sprints',
    git: true,
    prompt: '/pmkit:issues:dependencies EPC-4H7V',
    answers: [],
    steps: [{ step: '1', read: ['issues', 'dependencies', 'EPC-4H7V'], save: 'map' }],
    skip: {},
    notHit: {},
    expect(repo, saved) {
      assert.equal(saved.map.basis, 'hierarchy')
      assert.equal(saved.map.reason, 'none')
      assert.equal(saved.map.criticalPath, null)
      assert.equal(repo.git('status', '--porcelain'), '')
    },
  },
]
