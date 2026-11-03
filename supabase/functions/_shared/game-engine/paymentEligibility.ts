// ISSUE-86 (2026-11-02) — financial eligibility for settlement and reinstatement.
//
// Rule (owner-specified, business-rules.md § Payment Verification): an entry is
// FINANCIALLY SETTLED when it has been marked paid, OR its pot's entry fee is
// €0 (a free pot). Only unsettled entries are voided at settlement.
//
// Deliberately derived, never stored: free entries get no entry_payments row
// and no is_paid = true, so "free" stays distinguishable from "paid" in every
// report, and no historical payment record is rewritten. This is safe because
// pots.entry_fee cannot change once a pot has entries
// (prevent_pot_contract_change trigger, migrations 004/010) — "free" is fixed
// for the lifetime of a pot's entries.
//
// Entries that are already 'void' are never re-read by settle() (it selects
// only locked/pending entries), so this rule cannot un-void anything; that
// requires an explicit admin reinstatement.
import type { GameEngineContext } from './contracts.ts'

export type PaymentState = 'paid' | 'free' | 'unpaid'

export function isFreeEntryFee(entryFee: number | string | null | undefined): boolean {
  // numeric(10,2) can arrive as a number or a string depending on the client.
  return entryFee !== null && entryFee !== undefined && Number(entryFee) === 0
}

export function paymentState(input: { isPaid: boolean; potIsFree: boolean }): PaymentState {
  if (input.isPaid) return 'paid'
  if (input.potIsFree) return 'free'
  return 'unpaid'
}

export function isFinanciallySettled(input: { isPaid: boolean; potIsFree: boolean }): boolean {
  return paymentState(input) !== 'unpaid'
}

/** Ids of the given pots whose entry fee is €0. */
export async function loadFreePotIds(ctx: GameEngineContext, potIds: string[]): Promise<Set<string>> {
  if (potIds.length === 0) return new Set()
  const { data, error } = await ctx.supabase.from('pots').select('id, entry_fee').in('id', potIds)
  if (error) {
    throw new Error(`Failed to look up pot entry fees: ${error.message}`)
  }
  return new Set(
    ((data ?? []) as { id: string; entry_fee: number | string | null }[])
      .filter((p) => isFreeEntryFee(p.entry_fee))
      .map((p) => p.id),
  )
}
