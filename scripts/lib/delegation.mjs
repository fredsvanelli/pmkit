// The delegation comment: the record that `delegate` leaves on an issue it hands to an agent member.
// See docs/superpowers/specs/2026-10-30-pmk-57-delegate-to-agent-design.md. PMK-58 reads it back with parseDelegation.

/** An agent member id: `agent:` and a lowercase name. */
export const AGENT_ID = /^agent:[a-z0-9-]+$/

const RECORD_LINE = /^Delegated to (agent:[a-z0-9-]+) by (\S+), to run (locally)\.$/

/** The comment body for a delegation that runs locally. Blank instructions fall back to the issue's own description. */
export function delegationComment({ issue, agent, by, instructions }) {
  const text = typeof instructions === 'string' && instructions.trim() !== '' ? instructions.trim() : `Work on ${issue} as its description and acceptance criteria say.`
  return [
    `Delegated to ${agent} by ${by}, to run locally.`,
    '',
    '## Instructions',
    '',
    text,
    '',
    '## Run it locally',
    '',
    'This tracker does not start agents. To run this issue:',
    '',
    '1. Open a session of the agent in this repository.',
    `2. Run \`/pmkit:issues:work ${issue}\` and add \`--as ${agent}\` to every pmkit write, so the claim, the branch and the PR are recorded as the agent's.`,
    '3. The work command asks before the plan, the branch, the PR and each tracker write. Nothing runs without those answers.',
    '',
  ].join('\n')
}

/** `{ agent, by, run }` when the first line of `body` is a delegation record, else null. */
export function parseDelegation(body) {
  if (typeof body !== 'string') return null
  const match = RECORD_LINE.exec(body.split('\n')[0])
  return match ? { agent: match[1], by: match[2], run: 'local' } : null
}

/** The one line the CLI prints after a local delegation. */
export const localRunLine = (issue, agent) => `the agent runs locally: /pmkit:issues:work ${issue} with --as ${agent} on every pmkit write`
