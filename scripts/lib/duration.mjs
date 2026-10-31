import { PmkitError } from './errors.mjs'

export const MAX_ENTRY_MINUTES = 24 * 60

const FORMATS = 'Use minutes (90 or 45m) or hours (1h30, 1h30m, 1.5h, 2h)'

const invalid = (text, reason) => new PmkitError('INVALID_INPUT', `"${text ?? ''}" is not a valid time: ${reason}`, `${FORMATS}, from 1 minute to 24 hours.`)

// Reads a duration such as 90, 45m, 2h, 1h30, 1h30m or 1.5h and returns whole minutes.
export function parseMinutes(input) {
  const text = String(input ?? '').trim().toLowerCase()
  if (text === '') throw invalid(input, 'it is empty')
  let minutes
  let match
  if ((match = /^(\d+)m?$/.exec(text))) minutes = Number(match[1])
  else if ((match = /^(\d+(?:\.\d+)?)h$/.exec(text))) minutes = Number(match[1]) * 60
  else if ((match = /^(\d+)h(\d{1,2})m?$/.exec(text))) {
    if (Number(match[2]) >= 60) throw invalid(input, 'minutes after the hours must be below 60')
    minutes = Number(match[1]) * 60 + Number(match[2])
  } else throw invalid(input, 'the format is not recognized')
  minutes = Math.round(minutes * 1e6) / 1e6
  if (!Number.isInteger(minutes)) throw invalid(input, 'it is not a whole number of minutes')
  if (minutes <= 0) throw invalid(input, 'it must be above zero')
  if (minutes > MAX_ENTRY_MINUTES) throw invalid(input, 'one entry is at most 24 hours (1440 minutes)')
  return minutes
}
