// Tests of the Jira worklog mapping (PMK-80): a worklog as a time entry and as a log_time event.
import assert from 'node:assert/strict'
import test from 'node:test'
import { jiraStarted, toTimeEntry, worklogEvents } from './worklogs.mjs'

const worklog = (timeSpentSeconds, started = '2026-11-22T10:00:00.000+0000', accountId = 'acc-1') => ({ id: '1', author: { accountId }, started, timeSpentSeconds })

test('a worklog is an entry dated by its start, by its author, in minutes', () => {
  assert.deepEqual(toTimeEntry(worklog(2700)), { at: '2026-11-22T10:00:00.000Z', by: 'acc-1', minutes: 45 })
})

test('seconds round to the nearest minute, and an entry that rounds to zero is no entry', () => {
  assert.equal(toTimeEntry(worklog(90)).minutes, 2)
  assert.equal(toTimeEntry(worklog(20)), null)
  assert.equal(toTimeEntry({ ...worklog(60), timeSpentSeconds: undefined }), null)
})

test('the log_time events of the valid worklogs', () => {
  assert.deepEqual(worklogEvents([worklog(2700), worklog(20)]), [{ at: '2026-11-22T10:00:00.000Z', by: 'acc-1', op: 'log_time', minutes: 45 }])
})

test('a start time in the format Jira takes', () => {
  assert.equal(jiraStarted(new Date('2026-11-22T12:00:00Z')), '2026-11-22T12:00:00.000+0000')
})
