// The golden cases: the fixtures with their anchor IDs, and the argument lists of every command.
// scripts/goldens.test.mjs runs them against the goldens, and scripts/cli-hosted.test.mjs runs them over a hosted mirror.
import path from 'node:path'
import { fileURLToPath } from 'node:url'

export const INPUTS = path.join(path.dirname(fileURLToPath(import.meta.url)), '__goldens__', '_inputs')

const input = (name) => path.join(INPUTS, name)

// Anchors are the IDs the cases use. An anchor missing from its fixture is on purpose:
// the golden then records the NOT_FOUND error, which is the command's real output there.
export const FIXTURES = {
  basic: {
    about: 'empty: config files only, no issues, epics, sprints or documents',
    issue: 'ISS-0000', other: 'ISS-0001', conflicted: 'ISS-0000', epic: 'EPC-0000', sprint: '2026-10-12', doc: 'missing.md', milestone: 'v1.0', release: '1.0.0',
  },
  team: {
    about: 'small team: 2 members, 13 issues, 1 epic, a closed and an active sprint, ISS-3Q6T has conflict markers',
    issue: 'ISS-5N1R', other: 'ISS-4M2S', conflicted: 'ISS-3Q6T', epic: 'EPC-2M9D', sprint: '2026-10-12', doc: 'missing.md', milestone: 'v1.0', release: '1.0.0',
  },
  'messy-merge': {
    about: 'after merging two tracker branches: ISS-4 add/add conflict, ISS-5 status conflict, ISS-6 events out of order, two active sprints',
    issue: 'ISS-1', other: 'ISS-2', conflicted: 'ISS-4', epic: 'EPC-1', sprint: '2026-10-12', doc: 'missing.md', milestone: 'v1.0', release: '1.0.0',
  },
  'no-sprints': {
    about: 'a team without sprints: 6 issues, an epic with children, a comment, a document, a milestone and a release',
    // v1.0 is the one milestone file. ISS-9B2X holds the one comment, is in_review and has no parent, so get --comments, move and parent show real output.
    issue: 'ISS-9B2X', other: 'ISS-6R3N', conflicted: 'ISS-0000', epic: 'EPC-4H7V', sprint: '2026-10-12', doc: 'specs/overview.md', milestone: 'v1.0', release: '1.0.0',
  },
}

// One entry per command in COMMANDS: the argument lists after the command name.
// Each case runs as text and --json, and a write also runs with --dry-run.
export const CASES = {
  init: () => [[], ['--update'], ['--root', 'fresh']],
  capabilities: () => [[]],
  discover: () => [[]],
  whoami: () => [[]],
  'issues list': () => [[], ['--sprint', 'current'], ['--blocked'], ['--category', 'done']],
  'issues get': (a) => [[a.issue], [a.issue, '--comments', '--history'], [a.conflicted]],
  'issues dependencies': (a) => [[a.epic], [a.issue]],
  'issues create': () => [['--title', 'Golden sample', '--type', 'task', '--description-file', input('description.md')]],
  'issues update': (a) => [[a.issue, '--title', 'Renamed', '--criteria-file', input('criteria.md')]],
  'issues move': (a) => [[a.issue, 'done'], [a.conflicted, 'done']],
  'issues assign': (a) => [[a.issue, 'fred']],
  // No fixture has an agent member, so the goldens record the refusal; scripts/cli-delegate.test.mjs covers a real delegation.
  'issues delegate': (a) => [[a.issue, 'agent:claude', '--instructions-file', input('instructions.md')]],
  'issues link': (a) => [[a.issue, a.other, '--kind', 'blocks']],
  'issues parent': (a) => [[a.issue, a.epic]],
  'issues comment': (a) => [[a.issue, '--body-file', input('comment.md')]],
  // No fixture issue has a thread to resolve, so the case is the refusal for a comment that is not there.
  'issues resolve': (a) => [[a.issue, 'missing-comment']],
  'issues log-time': (a) => [[a.issue, '30']],
  'issues time-entries': (a) => [[a.issue]],
  'issues archive': (a) => [[a.issue]],
  'cycle list': () => [[], ['--state', 'closed']],
  'cycle current': () => [[]],
  'cycle issues': (a) => [[a.sprint]],
  'cycle open': () => [['--start', '2026-10-26']],
  'cycle close': (a) => [[a.sprint]],
  'cycle add': (a) => [[a.issue, '--to', 'current']],
  'cycle capacity': (a) => [[a.sprint]],
  'linear triage show': () => [[]],
  'linear triage set': () => [['--off']],
  'linear triage suggestions': () => [[]],
  'linear customers list': () => [[]],
  'linear customers show': () => [['--customer', 'acme']],
  'linear customers set': () => [['--customer', 'acme', '--tier', 'gold']],
  'linear customers link': () => [['--customer', 'acme', '--issue', 'ISS-1']],
  'epic list': () => [[]],
  'epic get': (a) => [[a.epic]],
  'epic progress': (a) => [[a.epic]],
  'epic create': () => [['--title', 'Golden epic']],
  'milestone list': () => [[]],
  'milestone get': (a) => [[a.milestone], ['missing-milestone']],
  // A new id, and the anchor again, which is a CONFLICT where the milestone exists.
  'milestone create': (a) => [['v2.0', '--name', 'Golden milestone', '--due', '2026-12-01'], [a.milestone]],
  'release list': () => [[], ['--state', 'released']],
  'release get': (a) => [[a.release], ['missing-release']],
  'release issues': (a) => [[a.release]],
  // A new id, and the anchor again, which is a CONFLICT where the release exists.
  'release create': (a) => [['2.0.0', '--name', 'Golden release', '--tag', 'v2.0.0', '--target', '2026-12-01'], [a.release]],
  'release mark-released': (a) => [[a.release]],
  'release-notes': (a) => [[], ['--release', a.release]],
  'epic update-status': (a) => [[a.epic, '--health', 'on_track', '--body-file', input('update.md')]],
  'epic updates': (a) => [[a.epic]],
  'docs list': () => [[]],
  'docs read': (a) => [[a.doc]],
  'docs create': () => [['golden/new.md', '--body-file', input('doc.md')]],
  'metrics velocity': () => [[]],
  'metrics cycle-time': () => [[]],
  'metrics lead-time': () => [[]],
  'metrics throughput': () => [[]],
  'metrics aging': () => [[]],
  events: () => [[]],
  risks: () => [[]],
  'alerts list': () => [[]],
  'issues branch': (a) => [[a.issue]],
  'pr open': (a) => [['--issue', a.issue]],
  'pr ready': (a) => [['--issue', a.issue]],
  'pr status': () => [[]],
  'deploys list': () => [[]],
  'ci logs': () => [['--run', '9']],
  'pr sync': () => [[]],
  changelog: () => [['--file', input('CHANGELOG.md'), '--since', '0.0.0'], ['--file', input('CHANGELOG.md'), '--since', '0.3.0']],
  render: (a) => [['board'], ['roadmap', '--format', 'html'], ['sprint'], ['sprint', '--sprint', a.sprint], ['board', '--save']],
  migrate: () => [[]],
  reindex: () => [[]],
  'local-migrate export': () => [['--workspace', 'acme', '--team', 'ACME']],
  'local-migrate import': () => [['--workspace', 'acme', '--team', 'ACME']],
  'local-migrate status': () => [[]],
  'local-migrate undo': () => [[]],
  'local-migrate switch': () => [['--to', 'linear']],
  validate: () => [[]],
}

// Writes, and init (which takes --dry-run without being a write), also run with --dry-run.
export const takesDryRun = (command) => Boolean(command.write || command.dryRun)
