import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { validateRepo } from './lib/validate.mjs'
import { makeRepo } from './test-helpers.mjs'

const brief = (result, part) => result.problems.map(({ path: file, code }) => `${code} ${file}`).filter((line) => line.includes(part)).sort()
const messageOf = (result, end) => result.problems.find((p) => p.path.endsWith(end)).message

function write(root, folder, name, text) {
  const dir = path.join(root, '.issues', folder)
  fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(path.join(dir, name), text)
}

test('the no-sprints fixture, with a customer and two requests, has no customer, request or reference problem', () => {
  const result = validateRepo(makeRepo('no-sprints'))
  assert.deepEqual(brief(result, '/customers/'), [])
  assert.deepEqual(brief(result, '/requests/'), [])
})

test('a customer file that breaks the id rule, has no name, a bad revenue or an owner who is not a member is a customer problem', () => {
  const root = makeRepo('team')
  write(root, 'customers', 'CUS-1.md', '---\nname: Good\nowner: fred\n---\n')
  write(root, 'customers', 'acme.md', '---\nname: Misnamed\n---\n')
  write(root, 'customers', 'CUS-2.md', '---\ntier: gold\n---\n')
  write(root, 'customers', 'CUS-3.md', '---\nname: A\nrevenue: -5\n---\n')
  write(root, 'customers', 'CUS-4.md', '---\nname: B\nowner: nobody\n---\n')
  write(root, 'customers', 'notes.txt', 'not a customer\n')
  const result = validateRepo(root)
  assert.deepEqual(brief(result, '/customers/'), [
    'customer .issues/customers/CUS-2.md', 'customer .issues/customers/CUS-3.md', 'customer .issues/customers/CUS-4.md', 'customer .issues/customers/acme.md',
  ])
  assert.match(messageOf(result, 'acme.md'), /not named after a customer id such as CUS-1/)
  assert.match(messageOf(result, 'CUS-2.md'), /needs a name/)
  assert.match(messageOf(result, 'CUS-4.md'), /owner "nobody" is not a member/)
})

test('a request file that does not parse or breaks a state rule is a request problem', () => {
  const root = makeRepo('team')
  write(root, 'requests', 'REQ-1.md', '---\ntitle: [\n---\n')
  write(root, 'requests', 'REQ-2.md', '---\ntitle: T\nstate: accepted\n---\n')
  write(root, 'requests', 'REQ-3.md', '---\ntitle: Fine\n---\n')
  const result = validateRepo(root)
  assert.deepEqual(brief(result, '/requests/'), ['request .issues/requests/REQ-1.md', 'request .issues/requests/REQ-2.md'])
  assert.match(messageOf(result, 'REQ-2.md'), /is accepted but names no issue/)
})

test('a request whose customer or issue has no file is a reference problem', () => {
  const root = makeRepo('team')
  write(root, 'requests', 'REQ-1.md', '---\ntitle: T\ncustomer: CUS-9\nstate: accepted\nissue: ISS-ZZZZ\n---\n')
  const result = validateRepo(root)
  assert.deepEqual(brief(result, '/requests/'), ['reference .issues/requests/REQ-1.md', 'reference .issues/requests/REQ-1.md'])
  const messages = result.problems.filter((p) => p.path.endsWith('REQ-1.md')).map((p) => p.message).sort()
  assert.deepEqual(messages, ['customer CUS-9 does not exist', 'issue ISS-ZZZZ does not exist'])
  write(root, 'customers', 'CUS-9.md', '---\nname: Now it exists\n---\n')
  assert.deepEqual(brief(validateRepo(root), '/requests/'), ['reference .issues/requests/REQ-1.md'])
})

test('a request file with conflict markers is one conflict problem and no request problem', () => {
  const root = makeRepo('team')
  write(root, 'requests', 'REQ-1.md', '---\n<<<<<<< HEAD\ntitle: A\n=======\ntitle: B\n>>>>>>> other\n---\n')
  assert.deepEqual(brief(validateRepo(root), '/requests/'), ['conflict .issues/requests/REQ-1.md'])
})
