import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { run } from './pmkit.mjs'
import { ADAPTERS } from './lib/adapters.mjs'
import { makeRepo, tempDir } from './test-helpers.mjs'

// `alerts scan` (PMK-73): the alerts no issue covers yet, with a priority from the severity.

const FAKE_NPM = `#!/usr/bin/env node
process.stdout.write(process.env.PMKIT_FAKE_NPM_OUT ?? '')
process.exitCode = Number(process.env.PMKIT_FAKE_NPM_STATUS ?? 0)
`

const REPORT = JSON.stringify({
  auditReportVersion: 2,
  vulnerabilities: {
    minimist: { name: 'minimist', severity: 'moderate', via: [{ title: 'Prototype Pollution', url: 'https://example.com/a/1' }], fixAvailable: true },
    lodash: { name: 'lodash', severity: 'critical', via: [{ title: 'Command Injection', url: 'https://example.com/a/2' }], fixAvailable: false },
    tar: { name: 'tar', severity: 'high', via: ['minimist'], fixAvailable: true },
    glob: { name: 'glob', severity: 'low', via: [{ title: 'Slow match', url: 'https://example.com/a/4' }], fixAvailable: true },
  },
})

function fakeNpmDir() {
  const dir = tempDir('pmkit-npm-')
  fs.writeFileSync(path.join(dir, 'npm'), FAKE_NPM, { mode: 0o755 })
  fs.chmodSync(path.join(dir, 'npm'), 0o755)
  return dir
}

function setup({ lockfile = 'package-lock.json', out = REPORT, status = 1, config } = {}) {
  const root = makeRepo('basic')
  if (lockfile) fs.writeFileSync(path.join(root, lockfile), '{}\n')
  if (config) fs.appendFileSync(path.join(root, '.issues', 'config.yaml'), config)
  const env = {
    ...process.env, PATH: `${fakeNpmDir()}${path.delimiter}${process.env.PATH}`, PMKIT_FAKE_NPM_OUT: out, PMKIT_FAKE_NPM_STATUS: String(status),
    GIT_CONFIG_GLOBAL: os.devNull, GIT_CONFIG_NOSYSTEM: '1', PMKIT_USER: 'fred',
  }
  const pmkit = (args, options = {}) => run(args, { env, cwd: root, ...options })
  const scan = async (args = [], options = {}) => {
    const result = await pmkit(['alerts', 'scan', ...args, '--json'], options)
    return { ...result, data: result.stdout.trim().startsWith('{') ? JSON.parse(result.stdout) : null }
  }
  return { root, pmkit, scan }
}

test('alerts scan returns one candidate per alert with a priority from the severity, highest first', async () => {
  const { scan } = setup()
  const { code, data, stderr } = await scan()
  assert.equal(code, 0, stderr)
  assert.equal(data.absent, false)
  assert.equal(data.incomplete, false)
  assert.deepEqual(data.candidates.map((c) => [c.package, c.severity, c.priority, c.type]), [
    ['lodash', 'critical', 'urgent', 'bug'], ['tar', 'high', 'high', 'bug'], ['minimist', 'medium', 'medium', 'bug'], ['glob', 'low', 'low', 'bug'],
  ])
  assert.equal(data.candidates[1].title, 'Security: tar: vulnerable through minimist')
  assert.match(data.candidates[0].description, /\nalert-key: [0-9a-f]{12}\n$/)
  assert.deepEqual(data.matched, [])
})

test('a second run creates nothing for the alerts an issue already holds, whatever the status', async () => {
  const { root, pmkit, scan } = setup()
  const first = (await scan()).data
  for (const candidate of first.candidates.slice(0, 3)) {
    const file = path.join(tempDir('pmkit-body-'), 'body.md')
    fs.writeFileSync(file, candidate.description)
    const created = await pmkit(['issues', 'create', '--title', candidate.title, '--type', candidate.type, '--priority', candidate.priority, '--description-file', file, '--json'])
    assert.equal(created.code, 0, created.stderr)
  }
  const doneId = JSON.parse((await pmkit(['issues', 'list', '--json'])).stdout).issues.find((issue) => issue.title === first.candidates[0].title).id
  assert.equal((await pmkit(['issues', 'move', doneId, 'done', '--json'])).code, 0)
  const second = (await scan()).data
  assert.deepEqual(second.candidates.map((c) => c.package), ['glob'])
  assert.equal(second.matched.length, 3)
  assert.ok(second.matched.every((m) => typeof m.issue === 'string'))
  assert.ok(root)
})

test('a failed scanner makes the scan incomplete, with a warning that says to create nothing', async () => {
  const { scan, pmkit } = setup({ out: 'boom' })
  const { code, data } = await scan()
  assert.equal(code, 0)
  assert.equal(data.incomplete, true)
  assert.equal(data.absent, false)
  assert.deepEqual(data.candidates, [])
  const text = await pmkit(['alerts', 'scan'])
  assert.match(text.stderr, /warning: npm-audit failed: npm audit output is not valid JSON/)
  assert.match(text.stderr, /incomplete: .*Do not create issues from this list/)
  assert.doesNotMatch(text.stdout, /^no alerts$/m)
})

test('without a scanner the scan says the capability is absent and what is missing', async () => {
  const { scan, pmkit } = setup({ lockfile: null })
  const { data } = await scan()
  assert.equal(data.absent, true)
  assert.equal(data.incomplete, false)
  assert.deepEqual(data.candidates, [])
  const text = await pmkit(['alerts', 'scan'])
  assert.match(text.stdout, /security alerts are absent in this repository: no scanner found \(npm-audit needs package-lock\.json or npm-shrinkwrap\.json\)/)
})

test('a scanner with no findings says there is nothing to create', async () => {
  const { pmkit } = setup({ out: JSON.stringify({ vulnerabilities: {} }), status: 0 })
  assert.equal((await pmkit(['alerts', 'scan'])).stdout.trim(), 'no alerts')
})

test('an issue file that cannot be read makes the scan incomplete', async () => {
  const { root, scan, pmkit } = setup()
  const first = (await scan()).data.candidates[0]
  const file = path.join(tempDir('pmkit-body-'), 'body.md')
  fs.writeFileSync(file, first.description)
  const created = JSON.parse((await pmkit(['issues', 'create', '--title', first.title, '--description-file', file, '--json'])).stdout)
  const issueFile = path.join(root, '.issues', 'issues', created.after.id, 'issue.md')
  fs.writeFileSync(issueFile, `<<<<<<< HEAD\n${fs.readFileSync(issueFile, 'utf8')}=======\nother\n>>>>>>> branch\n`)
  const { data } = await scan()
  assert.equal(data.incomplete, true)
  assert.deepEqual(data.unread, { count: 1, ids: [created.after.id] })
  const text = await pmkit(['alerts', 'scan'])
  assert.match(text.stderr, new RegExp(`incomplete: 1 issue could not be read \\(${created.after.id}\\).*Do not create issues from this list.*/pmkit:local:doctor`))
})

test('a tracker read that is cut makes the scan incomplete', async () => {
  const { scan } = setup()
  const adapters = {
    ...ADAPTERS,
    local: {
      ...ADAPTERS.local,
      create: async (...args) => {
        const tracker = await ADAPTERS.local.create(...args)
        return { ...tracker, searchIssues: async (filter) => ({ ...(await tracker.searchIssues(filter)), hasMore: true }) }
      },
    },
  }
  const { data } = await scan([], { adapters })
  assert.equal(data.incomplete, true)
  assert.equal(data.unread.count, 0)
})

test('a config with three priorities clamps low to the last one', async () => {
  const { root, scan } = setup()
  fs.writeFileSync(path.join(root, '.issues', 'config.yaml'), fs.readFileSync(path.join(root, '.issues', 'config.yaml'), 'utf8').replace('priorities: [urgent, high, medium, low]', 'priorities: [p1, p2, p3]'))
  const { data } = await scan()
  assert.deepEqual(data.candidates.map((c) => c.priority), ['p1', 'p2', 'p3', 'p3'])
})

test('--severity keeps only the listed severities and rejects an unknown value', async () => {
  const { scan } = setup()
  assert.deepEqual((await scan(['--severity', 'critical,high'])).data.candidates.map((c) => c.package), ['lodash', 'tar'])
  const bad = await scan(['--severity', 'bogus'])
  assert.equal(bad.code, 2)
  assert.equal(JSON.parse(bad.stdout).error.code, 'INVALID_INPUT')
})

test('the text output is a table of key, severity, priority, package and title', async () => {
  const { pmkit } = setup()
  const { stdout } = await pmkit(['alerts', 'scan'])
  assert.match(stdout, /^Key\s+\| Severity\s+\| Priority\s+\| Package\s+\| Title/m)
  assert.match(stdout, /critical\s+\| urgent\s+\| lodash\s+\| Security: lodash: Command Injection/)
})
