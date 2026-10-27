// The tracker contract: the operations every tracker adapter implements.
// See the pmkit design spec, section "Contract". Git host operations are not tracker operations.

export const TRACKER_OPERATIONS = [
  'discover', 'capabilities',
  'searchIssues', 'getIssue', 'createIssue', 'updateIssue', 'moveToCategory', 'assign', 'archive',
  'link', 'unlink', 'setParent',
  'getHistory', 'listComments', 'comment',
  'listCycles', 'currentCycle', 'cycleIssues', 'openCycle', 'closeCycle', 'moveToCycle',
  'listDeliverables', 'getDeliverable', 'deliverableProgress', 'createDeliverable', 'publishStatusUpdate',
  'listMilestones', 'getMilestone', 'createMilestone',
  'listReleases', 'getRelease', 'createRelease', 'releaseIssues', 'markReleased',
  'getCapacity', 'setCapacity', 'getDaysOff', 'updateCycleCapacity',
  'metricEvents',
  'readDocument', 'createDocument',
  'logTime',
]

/** Throws a TypeError that lists every contract operation the object lacks. */
export function assertTracker(tracker) {
  const missing = TRACKER_OPERATIONS.filter((name) => typeof tracker?.[name] !== 'function')
  if (missing.length > 0) throw new TypeError(`tracker is missing operations: ${missing.join(', ')}`)
  return tracker
}
