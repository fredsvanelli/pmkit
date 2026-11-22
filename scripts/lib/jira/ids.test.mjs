import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isIssueKey, normalizeKey } from './ids.mjs';

test('isIssueKey accepts Jira keys in any case', () => {
  for (const k of ['ENG-12', 'eng-12', 'A1_B-3']) assert.equal(isIssueKey(k), true, k);
});

test('isIssueKey rejects non-keys', () => {
  for (const k of ['12', 'ENG-0', 'ENG-', '-1', 'ENG 1', 'ENG-01', 42, null]) {
    assert.equal(isIssueKey(k), false, String(k));
  }
});

test('normalizeKey upper-cases', () => {
  assert.equal(normalizeKey('eng-12'), 'ENG-12');
});
