// Pure decision logic for "record payment received" against a season-
// scoped pot (Last Man Standing, Score Predictor) — split out the same
// way paymentAllocation.ts's computePaymentAllocation() is, for the
// identical reason: unit-testable without a live database.
//
// Unlike Pick 5 (many weekly entry_payments rows, N = amount / entry_fee),
// a season-scoped pot has exactly ONE entry_payments row per member for
// the whole competition (scope='season', gameweek_id null, GE-4.5) —
// there is no "how many weeks does this cover" question, only "does this
// amount match the one-time season fee." Launch Readiness Sprint 1B's own
// explicit product requirement — "for season-scoped modes, present the
// information naturally for a one-time season payment" — is why this is a
// genuinely different (simpler) check, not the same allocation logic
// reused with weeksRequested always equal to 1: there is no gameweek list
// to skip over, no partial-coverage case, nothing to allocate.

export type SeasonPaymentValidationResult =
  | { outcome: 'invalid_amount'; reason: string }
  | { outcome: 'valid' }

export function validateSeasonPayment(amount: number, entryFee: number): SeasonPaymentValidationResult {
  if (entryFee <= 0) {
    return {
      outcome: 'invalid_amount',
      reason: 'This pot has no entry fee configured — there is nothing to record a payment against.',
    }
  }

  // Validated in integer cents, not floating point, same reasoning as
  // paymentAllocation.ts's own exact-multiple check.
  const amountCents = Math.round(amount * 100)
  const feeCents = Math.round(entryFee * 100)

  if (amountCents !== feeCents) {
    return {
      outcome: 'invalid_amount',
      reason:
        `Amount (${amount.toFixed(2)}) must exactly match this pot's one-time entry fee ` +
        `(${entryFee.toFixed(2)}) — there is a single season payment, not a weekly one.`,
    }
  }

  return { outcome: 'valid' }
}
