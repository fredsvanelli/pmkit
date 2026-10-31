// The tracker contract: the operations every tracker adapter implements.
// See the pmkit design spec, section "Contract". Git host operations are not tracker operations.

export const TRACKER_OPERATIONS = [
  'discover', 'capabilities',
  'searchIssues', 'getIssue', 'createIssue', 'updateIssue', 'moveToCategory', 'assign', 'delegate', 'archive', 'delete',
  'link', 'unlink', 'setParent',
  'getHistory', 'listComments', 'comment', 'resolveThread',
  'listCycles', 'currentCycle', 'cycleIssues', 'openCycle', 'closeCycle', 'moveToCycle',
  'listDeliverables', 'getDeliverable', 'deliverableProgress', 'createDeliverable', 'publishStatusUpdate', 'listStatusUpdates',
  'listMilestones', 'getMilestone', 'createMilestone',
  'listReleases', 'getRelease', 'createRelease', 'releaseIssues', 'markReleased',
  'getCapacity', 'setCapacity', 'getDaysOff', 'updateCycleCapacity',
  'metricEvents',
  'readDocument', 'createDocument', 'listDocuments',
  'saveView', 'listViews', 'runView',
  'listGoals', 'getGoal', 'createGoal', 'goalProgress', 'setEpicGoal',
  'listCustomers', 'getCustomer', 'createCustomer', 'listRequests', 'getRequest', 'createRequest', 'acceptRequest', 'declineRequest', 'listDemandSignals',
  'listNotifications', 'markRead',
  'logTime', 'listTimeEntries',
]

/** Throws a TypeError that lists every contract operation the object lacks. */
export function assertTracker(tracker) {
  const missing = TRACKER_OPERATIONS.filter((name) => typeof tracker?.[name] !== 'function')
  if (missing.length > 0) throw new TypeError(`tracker is missing operations: ${missing.join(', ')}`)
  return tracker
}

/** A frozen object with one function per contract operation, bound to the tracker, and nothing else. Commands get only this. */
export function contractView(tracker) {
  assertTracker(tracker)
  return Object.freeze(Object.fromEntries(TRACKER_OPERATIONS.map((name) => [name, tracker[name].bind(tracker)])))
}
