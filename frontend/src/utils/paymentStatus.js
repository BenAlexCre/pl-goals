// ISSUE-86 — the one place the frontend decides how an entry's payment reads.
// Mirrors supabase/functions/_shared/game-engine/paymentEligibility.ts so the
// UI never disagrees with settlement:
//   'paid'   — an admin recorded a payment (entry_payments.is_paid = true)
//   'free'   — the pot's entry fee is €0: financially settled, no payment record
//   'unpaid' — a fee is due and none is recorded (voided at settlement)
//   null     — not enough information yet (e.g. still loading, no entry)
// "Free" is deliberately distinct from "paid": nothing is written for it.

export function isFreeEntryFee(entryFee) {
  if (entryFee === null || entryFee === undefined || entryFee === '') return false
  return Number(entryFee) === 0
}

/**
 * @param {{ isPaid: boolean|null|undefined, entryFee: number|string|null|undefined }} input
 * isPaid: true/false from a payment record, or null/undefined when there is none.
 */
export function paymentState({ isPaid, entryFee }) {
  if (isPaid === true) return 'paid'
  if (isFreeEntryFee(entryFee)) return 'free'
  if (isPaid === false) return 'unpaid'
  // No payment record at all: unpaid only if we know a fee applies.
  return entryFee === null || entryFee === undefined || entryFee === '' ? null : 'unpaid'
}

export const PAYMENT_LABEL = {
  paid: 'Paid',
  free: 'Free entry',
  unpaid: 'Unpaid',
}
