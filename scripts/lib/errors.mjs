export const ERROR_CODES = [
  'NOT_CONFIGURED',
  'NOT_FOUND',
  'NOT_SUPPORTED',
  'INVALID_INPUT',
  'CONFLICT',
  'AUTH',
  'RATE_LIMITED',
  'UPSTREAM',
]

export class PmkitError extends Error {
  constructor(code, message, nextStep, details) {
    if (!ERROR_CODES.includes(code)) throw new TypeError(`unknown error code "${code}"`)
    super(message)
    this.name = 'PmkitError'
    this.code = code
    this.nextStep = nextStep
    this.details = details
  }
}

export const isPmkitError = (error) => error instanceof PmkitError
