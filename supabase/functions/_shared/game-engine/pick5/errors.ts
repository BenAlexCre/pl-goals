// Thrown by Pick5Engine.validateEntry() for any business-rule failure (as
// opposed to an unexpected database/infra error). Callers (submit-pick5-picks)
// use this to distinguish "400 — the request was invalid" from "500 —
// something broke" without string-matching error messages.
export class Pick5ValidationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'Pick5ValidationError'
  }
}
