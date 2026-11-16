import assert from 'node:assert/strict'
import test from 'node:test'
import { compareGithubIds, isIssueId, issueIdOf, notFound, parseIssueId } from './ids.mjs'

test('parseIssueId reads plain, hash and owner/name forms', () => {
  assert.deepEqual(parseIssueId('12', 'acme/widgets'), { repo: 'acme/widgets', number: 12 })
  assert.deepEqual(parseIssueId('#12', 'acme/widgets'), { repo: 'acme/widgets', number: 12 })
  assert.deepEqual(parseIssueId('Acme/Widgets#12', 'acme/widgets'), { repo: 'acme/widgets', number: 12 })
  assert.deepEqual(parseIssueId('acme/other#5', 'acme/widgets'), { repo: 'acme/other', number: 5 })
})

test('parseIssueId rejects anything else', () => {
  for (const bad of ['', '0', '012', '-1', 'ISS-12', 'acme/other/5', 'acme#5', '12a', ' 12', null, undefined]) {
    assert.equal(parseIssueId(bad, 'acme/widgets'), null, String(bad))
    assert.equal(isIssueId(bad, 'acme/widgets'), false, String(bad))
  }
  assert.equal(isIssueId('12', 'acme/widgets'), true)
})

test('issueIdOf drops the repository for the scope repository', () => {
  assert.equal(issueIdOf({ number: 12, repository: { nameWithOwner: 'ACME/widgets' } }, 'acme/widgets'), '12')
  assert.equal(issueIdOf({ number: 5, repository: { nameWithOwner: 'acme/other' } }, 'acme/widgets'), 'acme/other#5')
})

test('compareGithubIds puts numbers first, by value', () => {
  assert.deepEqual(['10', 'acme/other#5', '2'].sort(compareGithubIds), ['2', '10', 'acme/other#5'])
  assert.deepEqual(['b/x#1', 'a/x#10', 'a/x#2'].sort(compareGithubIds), ['a/x#2', 'a/x#10', 'b/x#1'])
})

test('notFound builds the NOT_FOUND error', () => {
  const error = notFound('12')
  assert.equal(error.code, 'NOT_FOUND')
  assert.equal(error.message, 'issue 12 does not exist')
  assert.equal(error.nextStep, 'pmkit issues list')
})
