import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { redact } from './lib/redact.mjs'
import { run } from './pmkit.mjs'
import { makeRepo, tempDir } from './test-helpers.mjs'

const GH = 'a'.repeat(36)
const CASES = [
  ['github_token', `push failed with ghp_${GH} in the url`, 'push failed with [redacted] in the url'],
  ['github_token', `gho_${GH} ghu_${GH} ghs_${GH} ghr_${GH}`, '[redacted] [redacted] [redacted] [redacted]', 4],
  ['github_token', `token github_pat_${'B1_'.repeat(10)}`, 'token [redacted]'],
  ['aws_key', 'key AKIAIOSFODNN7EXAMPLE and ASIAIOSFODNN7EXAMPLE', 'key [redacted] and [redacted]', 2],
  ['private_key', 'before\n-----BEGIN RSA PRIVATE KEY-----\nMIIEow\nabc\n-----END RSA PRIVATE KEY-----\nafter', 'before\n[redacted]\nafter'],
  ['private_key', '-----BEGIN PRIVATE KEY-----\nxyz', '[redacted]'],
  ['private_key', 'a\n-----BEGIN PRIVATE KEY-----\nxyz\n\nlater line', 'a\n[redacted]\n\nlater line'],
  ['private_key', '-----BEGIN OPENSSH PRIVATE KEY-----\nb3Blbn\n-----END OPENSSH PRIVATE KEY-----\nline after: expected 3 events', '[redacted]\nline after: expected 3 events'],
  ['private_key', '-----BEGIN PGP PRIVATE KEY BLOCK-----\nabc\n-----END PGP PRIVATE KEY BLOCK-----\nok', '[redacted]\nok'],
  ['bearer', 'sent Bearer abc.def-123_x/y= to the api', 'sent Bearer [redacted] to the api'],
  ['bearer', 'sent bearer AbC123xyz9 and BEARER Zz9Zz9Zz9Zz9', 'sent bearer [redacted] and BEARER [redacted]', 2],
  ['authorization', 'Authorization: Basic dXNlcjpwYXNz\nnext line', 'Authorization: [redacted]\nnext line'],
  ['api_key_value', 'config api_key=sk-12345 and API-KEY: "abc 12 def"', 'config api_key=[redacted]'],
  ['api_key_value', 'API-KEY: "abc 12 def" and more', 'API-KEY: [redacted] and more'],
  ['api_key_value', 'GITHUB_TOKEN=abc12345', 'GITHUB_TOKEN=[redacted]'],
  ['api_key_value', '{"client_secret": "s3cr3t12", "password":"pw-1234x"}', '{"client_secret": [redacted], "password":[redacted]}', 2],
  ['api_key_value', 'DB_PASSWORD: hunter2!!', 'DB_PASSWORD: [redacted]'],
  ['jwt', 'cookie eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjMifQ.SflKxwRJSMeKKF2QT4 end', 'cookie [redacted] end'],
  ['url_credentials', 'clone https://user:pa55@github.com/o/r.git', 'clone https://[redacted]@github.com/o/r.git'],
  ['url_credentials', 'postgres://admin:secret@db:5432/app', 'postgres://[redacted]@db:5432/app'],
  ['url_credentials', 'redis://:s3cret@cache:6379', 'redis://[redacted]@cache:6379'],
  ['url_credentials', 'mongodb://user:p@ss@host/db', 'mongodb://[redacted]@host/db'],
  ['url_credentials', 'DATABASE_URL=postgres://app:senha@db/prod', 'DATABASE_URL=postgres://[redacted]@db/prod'],
  ['gitlab_token', `pushing with glpat-${'x'.repeat(20)}`, 'pushing with [redacted]'],
  ['slack_token', `SLACK=xoxb-123456789012-1234567890123-${'a'.repeat(24)} and xoxp-12345678901-abcdef`, 'SLACK=[redacted] and [redacted]', 2],
  ['ai_api_key', `using key sk-proj-${'a'.repeat(48)}`, 'using key [redacted]'],
  ['api_key_value', `export ANTHROPIC_API_KEY=sk-ant-api03-${'a'.repeat(90)}`, 'export ANTHROPIC_API_KEY=[redacted]'],
  ['google_api_key', `maps key AIzaSy${'A'.repeat(33)}`, 'maps key [redacted]'],
  ['api_key_value', `//registry.npmjs.org/:_authToken=npm_${'a'.repeat(36)}`, '//registry.npmjs.org/:_authToken=[redacted]'],
  ['npm_token', `npm token npm_${'a'.repeat(36)}`, 'npm token [redacted]'],
  ['stripe_key', `${'sk'}_live_${'a'.repeat(24)} rk_live_${'b'.repeat(24)}`, '[redacted] [redacted]', 2],
  ['api_key_value', 'PASSWD=hunter2-ok1\nDB_PWD=hunter2-ok1\ncredentials=hunter2-ok1', 'PASSWD=[redacted]\nDB_PWD=[redacted]\ncredentials=[redacted]', 3],
  ['api_key_value', 'password=hunter2 and "password": "hunter2"', 'password=[redacted]'],
  ['api_key_value', 'aws_secret_access_key = wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY', 'aws_secret_access_key = [redacted]'],
  ['github_token', `curl -H "Authorization: token ghp_${'b'.repeat(36)}" https://api.github.com`, null],
]

for (const [type, input, output, count = 1] of CASES.filter((row) => row[2] !== null)) {
  test(`redact replaces ${type} in: ${input.slice(0, 40).replace(/\n/g, ' ')}`, () => {
    const result = redact(input)
    assert.equal(result.text, output)
    assert.equal(result.counts[type], count)
    assert.equal(result.count, count)
  })
}

test('redact leaves a text with no secret unchanged, with a count of 0', () => {
  const text = 'FAIL src/events.mjs:12\nexpected 3 events, got 5\nsee https://github.com/o/r/pull/7 and the key idea\n'
  const { summary, ...result } = redact(text)
  assert.deepEqual(result, { text, count: 0, counts: {} })
})

test('a value is counted once when two patterns match it', () => {
  const result = redact('Authorization: Bearer abc.def')
  assert.equal(result.text, 'Authorization: [redacted]')
  assert.equal(result.count, 1)
})

test('text redact reads a file with no tracker and returns the text and the counts', async () => {
  const root = makeRepo('team')
  const dir = tempDir()
  const file = path.join(dir, 'log.txt')
  fs.writeFileSync(file, `step 1\r\nGITHUB_TOKEN=abc12345\r\nclone https://u:p@h/r.git\r\n`)
  const result = await run(['text', 'redact', '--file', file, '--json'], { cwd: root })
  assert.equal(result.code, 0, result.stdout + result.stderr)
  const data = JSON.parse(result.stdout)
  assert.equal(data.text, 'step 1\nGITHUB_TOKEN=[redacted]\nclone https://[redacted]@h/r.git\n')
  assert.deepEqual(data.counts, { api_key_value: 1, url_credentials: 1 })
  assert.equal(data.count, 2)
  const text = await run(['text', 'redact', '--file', file], { cwd: root })
  assert.match(text.stdout, /GITHUB_TOKEN=\[redacted\]/)
  assert.doesNotMatch(text.stdout, /abc12345/)
})

test('text redact refuses a missing file and a call with no --file', async () => {
  const root = makeRepo('team')
  for (const args of [['text', 'redact', '--file', '/no/such/file'], ['text', 'redact']]) {
    const result = await run([...args, '--json'], { cwd: root })
    assert.equal(result.code, 2)
    assert.equal(JSON.parse(result.stdout).error.code, 'INVALID_INPUT')
  }
})

const SAME = [
  'at Object.<anonymous> (src/token.mjs:12:5)',
  'The `password:` key is optional.',
  '- `password`: the database password',
  'Use a Bearer token in the header.',
  'https://example.com/user@domain',
  'commit 3f786850e387550fdab836ed7e6dc881de23001b fixed it',
  'task-force-alpha-bravo-charlie-delta-echo and the sk-short',
]
for (const text of SAME) {
  test(`redact leaves ${JSON.stringify(text.slice(0, 45))} unchanged`, () => {
    const { summary, ...result } = redact(text)
    assert.deepEqual(result, { text, count: 0, counts: {} })
  })
}

// PMK-197: the false positives that `text redact` accepts so that no value after a secret key is missed. The same list is in
// docs/superpowers/specs/2026-11-09-pmk-197-redact-no-missed-secrets-design.md.
const FALSE_POSITIVES = [
  ['Unexpected token: < in JSON at position 0', 'Unexpected token: [redacted]'],
  ['if (password === undefined) throw new Error("no password")', 'if (password === [redacted])'],
  ['max_tokens=4096 and tokenizer=cl100k', 'max_tokens=4096 and tokenizer=[redacted]'],
  ['Set the password: field in config.yaml to your own value.', 'Set the password: [redacted]'],
  ['the parser reads the next token: a comma', 'the parser reads the next token: [redacted]'],
  ['const token = getToken(req)', 'const token = [redacted]'],
  ['  secretName: process.env.NAME,', '  secretName: [redacted]'],
  ['not ok 3 - token: refresh expired token', 'not ok 3 - token: [redacted]'],
  ['password: abc12 and token=1a2b3c4', 'password: [redacted]'],
  ['Error: invalid token:\n    at foo (src/a.js:1:2)', 'Error: invalid token:\n    [redacted]'],
  ['the password:\n  see the docs', 'the password:\n  [redacted]'],
  ['password:\n  next: line', 'password:\n  next: [redacted]'],
]
for (const [text, output, count = 1] of FALSE_POSITIVES) {
  test(`redact accepts the false positive ${JSON.stringify(text.slice(0, 45))}`, () => {
    const result = redact(text)
    assert.equal(result.text, output)
    assert.equal(result.count, count)
  })
}

test('a secret inside an Authorization line counts once, as authorization', () => {
  const result = redact(`curl -H "Authorization: token ghp_${'b'.repeat(36)}" https://api.github.com`)
  assert.deepEqual(result.counts, { authorization: 1 })
  assert.equal(result.text, 'curl -H "Authorization: [redacted]" https://api.github.com')
})

test('a secret after a secret key counts once, as the key value', () => {
  for (const text of [`token: "ghp_${'c'.repeat(36)}"`, 'secret=xoxb-1234567890abc!Rest#9']) {
    const result = redact(text)
    assert.deepEqual(result.counts, { api_key_value: 1 }, text)
    assert.equal(result.text, `${text.slice(0, text.search(/[:=]/) + 1)}${text.includes(': ') ? ' ' : ''}[redacted]`)
  }
})

test('the summary line uses the singular for 1 and the plural otherwise', () => {
  assert.equal(redact('GITHUB_TOKEN=abc12345').summary, 'Redacted 1 value.')
  assert.equal(redact('GITHUB_TOKEN=abc12345\nAKIAIOSFODNN7EXAMPLE').summary, 'Redacted 2 values.')
  assert.equal(redact('nothing here').summary, 'Redacted 0 values.')
})

test('a long run of word characters is redacted in linear time', () => {
  for (const unit of ['a', 'token', 'token=', 'password_', 'a.']) {
    const text = unit.repeat(Math.ceil(80000 / unit.length))
    const start = process.hrtime.bigint()
    redact(text)
    const ms = Number(process.hrtime.bigint() - start) / 1e6
    assert.ok(ms < 1000, `${JSON.stringify(unit)} took ${ms} ms`)
  }
})
