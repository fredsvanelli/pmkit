import { test } from 'node:test'
import assert from 'node:assert/strict'
import { chooseRemote, inferHost, parseRemoteUrl } from './lib/git-remote.mjs'

const parsed = (url) => parseRemoteUrl(url)

test('parseRemoteUrl reads the https forms', () => {
  assert.deepEqual(parsed('https://github.com/owner/repo.git'), { host: 'github.com', owner: 'owner', name: 'repo' })
  assert.deepEqual(parsed('https://github.com/owner/repo'), { host: 'github.com', owner: 'owner', name: 'repo' })
  assert.deepEqual(parsed('https://github.com/owner/repo/'), { host: 'github.com', owner: 'owner', name: 'repo' })
  assert.deepEqual(parsed('https://user:token@github.com/owner/repo.git'), { host: 'github.com', owner: 'owner', name: 'repo' })
  assert.deepEqual(parsed('https://GitHub.com:443/owner/my.repo.git'), { host: 'github.com', owner: 'owner', name: 'my.repo' })
  assert.deepEqual(parsed('http://github.com/owner/repo'), { host: 'github.com', owner: 'owner', name: 'repo' })
})

test('parseRemoteUrl reads the ssh forms', () => {
  assert.deepEqual(parsed('git@github.com:owner/repo.git'), { host: 'github.com', owner: 'owner', name: 'repo' })
  assert.deepEqual(parsed('github.com:owner/repo'), { host: 'github.com', owner: 'owner', name: 'repo' })
  assert.deepEqual(parsed('ssh://git@github.com/owner/repo.git'), { host: 'github.com', owner: 'owner', name: 'repo' })
  assert.deepEqual(parsed('ssh://git@github.com:22/owner/repo.git'), { host: 'github.com', owner: 'owner', name: 'repo' })
  assert.deepEqual(parsed('git://github.com/owner/repo.git'), { host: 'github.com', owner: 'owner', name: 'repo' })
})

test('parseRemoteUrl keeps the whole path of a nested group as the owner', () => {
  assert.deepEqual(parsed('git@gitlab.com:group/sub/repo.git'), { host: 'gitlab.com', owner: 'group/sub', name: 'repo' })
})

test('parseRemoteUrl returns null for what it cannot read', () => {
  for (const url of ['', '   ', 'not a url', '/srv/git/repo.git', '../repo', 'file:///srv/repo.git', 'https://github.com/', 'https://github.com/owner']) {
    assert.equal(parsed(url), null, url)
  }
})

test('inferHost maps github.com to github with the repo', () => {
  assert.deepEqual(inferHost('git@github.com:owner/repo.git'), { system: 'github', repo: 'owner/repo', host: 'github.com' })
  assert.deepEqual(inferHost('https://www.github.com/owner/repo'), { system: 'github', repo: 'owner/repo', host: 'www.github.com' })
})

test('inferHost recognizes ssh.github.com, with or without the port 443', () => {
  assert.deepEqual(inferHost('ssh://git@ssh.github.com:443/owner/repo.git'), { system: 'github', repo: 'owner/repo', host: 'ssh.github.com' })
  assert.deepEqual(inferHost('git@ssh.github.com:owner/repo.git'), { system: 'github', repo: 'owner/repo', host: 'ssh.github.com' })
})

test('inferHost says nothing about a host it does not recognize, and never answers none', () => {
  assert.deepEqual(inferHost('https://gitlab.com/owner/repo.git'), { system: null, repo: null, host: 'gitlab.com' })
  assert.deepEqual(inferHost('git@github.example.com:owner/repo.git'), { system: null, repo: null, host: 'github.example.com' })
  assert.deepEqual(inferHost('work:owner/repo.git'), { system: null, repo: null, host: 'work' })
})

test('inferHost does not accept a GitHub path that is not owner/name', () => {
  assert.deepEqual(inferHost('https://github.com/a/b/c.git'), { system: null, repo: null, host: 'github.com' })
})

test('parseRemoteUrl returns null for a URL with a broken percent escape instead of throwing', () => {
  assert.equal(parseRemoteUrl('https://github.com/acme/100%.git'), null)
  assert.deepEqual(inferHost('https://github.com/acme/100%.git'), { system: null, repo: null, host: null })
})

test('inferHost infers nothing from a URL it cannot read', () => {
  assert.deepEqual(inferHost('/srv/git/repo.git'), { system: null, repo: null, host: null })
})

const remote = (name, url = `https://github.com/o/${name}.git`) => ({ name, url })

test('chooseRemote prefers origin and notes the others', () => {
  const out = chooseRemote([remote('upstream'), remote('origin')])
  assert.equal(out.state, 'chosen')
  assert.equal(out.remote.name, 'origin')
  assert.match(out.notes.join('\n'), /upstream/)
})

test('chooseRemote takes the only remote when it is not origin, with a note', () => {
  const out = chooseRemote([remote('fork')])
  assert.equal(out.state, 'chosen')
  assert.equal(out.remote.name, 'fork')
  assert.match(out.notes.join('\n'), /only remote/)
})

test('chooseRemote cannot choose between several remotes without origin', () => {
  const out = chooseRemote([remote('a'), remote('b')])
  assert.equal(out.state, 'ambiguous')
  assert.equal(out.remote, null)
  assert.match(out.notes.join('\n'), /--remote/)
})

test('chooseRemote reports no remote', () => {
  const out = chooseRemote([])
  assert.equal(out.state, 'none')
  assert.equal(out.remote, null)
})

test('chooseRemote honors a wanted name and rejects an unknown one', () => {
  assert.equal(chooseRemote([remote('origin'), remote('fork')], 'fork').remote.name, 'fork')
  const out = chooseRemote([remote('origin')], 'nope')
  assert.equal(out.state, 'unknown-name')
  assert.equal(out.remote, null)
})
