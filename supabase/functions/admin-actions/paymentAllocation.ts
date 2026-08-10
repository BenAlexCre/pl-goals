// Pure decision logic for "record payment received" — split out from
// recordPayment.ts so it's unit-testable without a live database, same
// pattern already established by bulkPayments.ts's classifyBulkPaymentRows().
// Every DB read (pot config, upcoming gameweeks, existing entry_payments
// state) happens in recordPayment.ts and is handed in here as already-
// resolved data — this function only decides validity and, if valid, which
// gameweeks the payment allocates to.

export interface PaymentAllocationInput {
  amount: number
  entryFee: number
  // Every gameweek eligible to be paid for (status = 'upcoming' in the
  // pot's own league/season), ordered ascending by gameweek number.
  eligibleGameweekIds: number[]
  // Gameweeks this user already has is_paid = true for — skipped so this
  // payment extends coverage by exactly weeksRequested NEW weeks, rather
  // than wasting allocation re-confirming weeks already covered.
  alreadyPaidGameweekIds: Set<number>
}

export type PaymentAllocationResult =
  | { outcome: 'invalid_amount'; reason: string }
  | {
      outcome: 'allocated'
      weeksRequested: number
      gameweekIds: number[]
      // Phase 7 Stage 2 Slice 4 — the organiser must "always understand
      // exactly what is about to happen": every already-paid gameweek
      // encountered while collecting weeksRequested unpaid ones (not the
      // user's entire paid history — only the ones actually skipped over
      // to reach this allocation), so the UI can show "Already paid: GW5"
      // next to "Will allocate to: GW6, GW7...".
      skippedAlreadyPaidGameweekIds: number[]
    }

export function computePaymentAllocation(input: PaymentAllocationInput): PaymentAllocationResult {
  const { amount, entryFee, eligibleGameweekIds, alreadyPaidGameweekIds } = input

  if (entryFee <= 0) {
    return {
      outcome: 'invalid_amount',
      reason: 'This pot has no entry fee configured — there is nothing to record a payment against.',
    }
  }

  // Validated in integer cents, not floating point — e.g. 0.1 + 0.2 style
  // drift is a real risk comparing raw floats for an "exact multiple" check.
  const amountCents = Math.round(amount * 100)
  const feeCents = Math.round(entryFee * 100)

  if (amountCents % feeCents !== 0) {
    const nearestBelow = (Math.floor(amountCents / feeCents) * feeCents) / 100
    const nearestAbove = (Math.ceil(amountCents / feeCents) * feeCents) / 100
    return {
      outcome: 'invalid_amount',
      reason:
        `Amount (${amount.toFixed(2)}) must be an exact multiple of the weekly entry fee (${entryFee.toFixed(2)}). ` +
        (nearestBelow > 0 ? `Try ${nearestBelow.toFixed(2)} or ${nearestAbove.toFixed(2)}.` : `Try ${nearestAbove.toFixed(2)}.`),
    }
  }

  const weeksRequested = amountCents / feeCents
  const gameweekIds: number[] = []
  const skippedAlreadyPaidGameweekIds: number[] = []

  for (const id of eligibleGameweekIds) {
    if (gameweekIds.length >= weeksRequested) break
    if (alreadyPaidGameweekIds.has(id)) {
      skippedAlreadyPaidGameweekIds.push(id)
      continue
    }
    gameweekIds.push(id)
  }

  return { outcome: 'allocated', weeksRequested, gameweekIds, skippedAlreadyPaidGameweekIds }
}
