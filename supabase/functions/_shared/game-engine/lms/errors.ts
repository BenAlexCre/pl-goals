// Thrown by LmsEngine.validateEntry() for any business-rule failure (as
// opposed to an unexpected database/infra error) — same split, same reason,
// as Pick5ValidationError.
export class LmsValidationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'LmsValidationError'
  }
}

// Thrown by LmsEngine.awardPrize() when the pot's configured fees would
// exceed the gross prize pool (net_amount would go negative). Same
// reasoning as Pick5PrizePoolExceededError: pot_prizes.net_amount's own
// CHECK constraint already refuses this write at the database level; this
// wraps that into a specific, catchable error rather than a generic
// Postgres constraint-violation message, and fails loudly before ever
// attempting the write, per docs/decisions.md § Prize pool deductions'
// "fail loudly rather than clamp fees down to fit" decision (Pick 5's own,
// equally applicable here since the fee columns are shared platform
// config, GE-4.1).
export class LmsPrizePoolExceededError extends Error {
  constructor(potId: string, grossAmount: number, adminFeeAmount: number, charityFeeAmount: number) {
    super(
      `Pot ${potId}: configured fees (admin ${adminFeeAmount} + charity ${charityFeeAmount}) ` +
      `would exceed the gross prize pool (${grossAmount}) — net would be negative. Fix the pot's fee configuration ` +
      `before this competition can be awarded.`
    )
    this.name = 'LmsPrizePoolExceededError'
  }
}

// Thrown by LmsEngine.awardPrize() when a season-end tie needs resolving
// and the pot is configured for season_end_tie_rule = 'final_prediction'.
// That mechanism (a new pick type — winning team / first goalscorer / goal
// minute — and its own scoring logic) doesn't exist yet, per the repo
// owner's explicit "do NOT implement Final Prediction yet" instruction —
// this fails loudly and specifically rather than silently doing nothing or
// guessing at a resolution, same "no invented default" standard as
// Pick5NoEligibleWinnersError.
export class LmsFinalPredictionNotImplementedError extends Error {
  constructor(potId: string) {
    super(
      `Pot ${potId} has reached a season-end tie with season_end_tie_rule = 'final_prediction', ` +
      `but Final Prediction resolution is not implemented yet — this needs its own slice, not a guessed default.`
    )
    this.name = 'LmsFinalPredictionNotImplementedError'
  }
}
