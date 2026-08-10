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

// Pick5NoEligibleWinnersError removed, 2026-08-09 (product rule revision —
// docs/decisions.md § Pick 5 jackpot and season rollover). It used to be
// thrown whenever a gameweek had settled entries but zero rank-1 winners,
// on the reasoning that this "should be structurally impossible." Under
// the new win condition (exactly 5/5, not merely rank 1), zero winners is
// the normal, overwhelmingly common weekly outcome — awardPrize() now
// treats it as a silent no-op (the jackpot carries forward), the same
// philosophy LmsEngine/PredictorEngine already use for their own
// "not concluded yet" cases. Not repurposed for anything else; deleted
// outright rather than left unused.

// Thrown by Pick5Engine.awardPrize() when the pot's configured fees would
// exceed the gross prize pool (net_amount would go negative). The
// pot_prizes.net_amount CHECK constraint already refuses this write at the
// database level; this wraps that into a specific, catchable error rather
// than a generic Postgres constraint-violation message — per the repo
// owner's explicit decision to fail loudly rather than clamp fees down to
// fit, docs/decisions.md § Prize pool deductions.
export class Pick5PrizePoolExceededError extends Error {
  constructor(potId: string, gameweekId: number, grossAmount: number, adminFeeAmount: number, charityFeeAmount: number) {
    super(
      `Pot ${potId}, gameweek ${gameweekId}: configured fees (admin ${adminFeeAmount} + charity ${charityFeeAmount}) ` +
      `would exceed the gross prize pool (${grossAmount}) — net would be negative. Fix the pot's fee configuration ` +
      `before this gameweek can be awarded.`
    )
    this.name = 'Pick5PrizePoolExceededError'
  }
}
