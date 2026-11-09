import { PmkitError } from './errors.mjs'

export const LONG_ENTRY_MINUTES = 24 * 60

const FORMATS = 'Use minutes (90 or 45m) or hours (1h30, 1h30m, 1.5h, 2h)'

const invalid = (text, reason) => new PmkitError('INVALID_INPUT', `"${text ?? ''}" is not a valid time: ${reason}`, `${FORMATS}, from 1 minute up.`)

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
  if (!(minutes <= Number.MAX_SAFE_INTEGER)) throw invalid(input, 'it is too large to be a whole number of minutes')
  if (!Number.isInteger(minutes)) minutes = Math.round(minutes * 1e6) / 1e6
  if (!Number.isInteger(minutes)) throw invalid(input, 'it is not a whole number of minutes')
  if (minutes <= 0) throw invalid(input, 'it must be above zero')
  return minutes
}

// 1500 is 1d1h, 100000 is 69d10h40; below a day it stays 1h30.
function hoursText(minutes) {
  const days = Math.floor(minutes / 1440)
  const hours = Math.floor((minutes % 1440) / 60)
  const rest = minutes % 60
  const tail = `${hours}h${rest === 0 ? '' : String(rest).padStart(2, '0')}`
  return days > 0 ? `${days}d${hours === 0 && rest === 0 ? '' : tail}` : tail
}

// There is no ceiling on an entry. One above a day gets a note. Before the write the user checks the preview; after it the time is already logged.
export function longEntryNote(minutes, { written = false } = {}) {
  if (!(minutes > LONG_ENTRY_MINUTES)) return null
  return `${minutes} minutes (${hoursText(minutes)}) is more than a day; ${written ? 'the time is already logged, check it' : 'check the time before you confirm'}`
}
