// Thrown by PredictorEngine.validateEntry() for any business-rule failure (as
// opposed to an unexpected database/infra error) — same split, same reason,
// as Pick5ValidationError/LmsValidationError.
export class PredictorValidationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'PredictorValidationError'
  }
}

// Thrown by PredictorEngine.awardPrize() when the pot's configured fees
// would exceed the gross prize pool (net_amount would go negative). Same
// reasoning, same shape, as Pick5PrizePoolExceededError/
// LmsPrizePoolExceededError — pot_prizes.net_amount's own CHECK constraint
// already refuses this write at the database level; this wraps that into a
// specific, catchable error rather than a generic Postgres
// constraint-violation message, and fails loudly before ever attempting the
// write, per docs/decisions.md § Prize pool deductions' "fail loudly rather
// than clamp fees down to fit" decision (equally applicable here since the
// fee columns are shared platform config, GE-4.1).
export class PredictorPrizePoolExceededError extends Error {
  constructor(potId: string, grossAmount: number, adminFeeAmount: number, charityFeeAmount: number) {
    super(
      `Pot ${potId}: configured fees (admin ${adminFeeAmount} + charity ${charityFeeAmount}) ` +
      `would exceed the gross prize pool (${grossAmount}) — net would be negative. Fix the pot's fee configuration ` +
      `before this competition can be awarded.`
    )
    this.name = 'PredictorPrizePoolExceededError'
  }
}
