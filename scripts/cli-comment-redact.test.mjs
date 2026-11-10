import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { run } from './pmkit.mjs'
import { makeRepo, tempDir } from './test-helpers.mjs'

// PMK-229: `issues comment --redact` replaces the secrets of the body before the tracker gets it.

const env = { ...process.env, GIT_CONFIG_GLOBAL: os.devNull, GIT_CONFIG_NOSYSTEM: '1', PMKIT_USER: 'fred' }
const SECRET = `ghp_${'a'.repeat(36)}`
const BODY = `Cause: the cursor is ignored.\nThe reporter wrote GITHUB_TOKEN=${SECRET}\n`

function setup() {
  const root = makeRepo('team')
  const dir = tempDir('pmkit-comment-redact-')
  const file = path.join(dir, 'body.md')
  const comment = async (body, extra = []) => {
    fs.writeFileSync(file, body)
    const result = await run(['issues', 'comment', 'ISS-5N1R', '--body-file', file, ...extra, '--json'], { env, cwd: root })
    return { ...result, data: JSON.parse(result.stdout) }
  }
  return { comment, root }
}

test('issues comment --redact replaces the secret, adds the count line and reports it in the JSON', async () => {
  const { comment } = setup()
  const { code, data } = await comment(BODY, ['--redact'])
  assert.equal(code, 0)
  assert.ok(!data.body.includes(SECRET))
  assert.ok(data.body.endsWith('GITHUB_TOKEN=[redacted]\n\nRedacted 1 value.'), data.body)
  assert.equal(data.redacted.count, 1)
  assert.deepEqual(data.redacted.counts, { api_key_value: 1 })
  assert.equal(data.redacted.summary, 'Redacted 1 value.')
})

test('issues comment --redact --dry-run shows the body the real run writes, and writes nothing', async () => {
  const { comment } = setup()
  const dry = await comment(BODY, ['--redact', '--dry-run'])
  const real = await comment(BODY, ['--redact'])
  assert.equal(dry.data.redacted.count, 1)
  assert.equal(dry.data.body, real.data.body)
  assert.deepEqual(dry.data.redacted, real.data.redacted)
})

test('issues comment --redact on a body with no secret adds no line and reports a count of 0', async () => {
  const { comment } = setup()
  const { data } = await comment('Plain text.\n', ['--redact'])
  assert.equal(data.body, 'Plain text.')
  assert.equal(data.redacted.count, 0)
})

test('issues comment without --redact keeps the body and has no redacted field', async () => {
  const { comment } = setup()
  const { data } = await comment(BODY)
  assert.ok(data.body.includes(SECRET))
  assert.equal('redacted' in data, false)
})

test('issues comment --redact on a body that is only a secret posts the mark and the count line', async () => {
  const { comment } = setup()
  const { code, data } = await comment(`${SECRET}\n`, ['--redact'])
  assert.equal(code, 0)
  assert.equal(data.body, '[redacted]\n\nRedacted 1 value.')
})
