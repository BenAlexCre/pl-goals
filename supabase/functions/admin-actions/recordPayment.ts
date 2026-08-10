// Product rule revision, 2026-08-09, corrected 2026-08-10 (docs/decisions.md
// § Pick 5 jackpot and season rollover, rules 6-7: Payments / Admin payment
// workflow) — there is no payment gateway and no in-app payment; a player
// never pays through the application and never marks themselves paid. The
// organiser collects money off-platform (cash, bank transfer, Revolut,
// PayPal, etc.) and this action only RECORDS a payment that has already
// been received: they enter the player and the amount received, and the
// application allocates it automatically to that many future gameweeks —
// the organiser never calculates or ticks individual weeks.
//
// Corrections pass, 2026-08-10: the first implementation of this action
// (then named `prepay_weeks`) always targeted "the next N upcoming
// gameweeks," regardless of whether some of them were already paid (e.g.
// via a prior individual "mark paid for this week" action, or an earlier
// payment record). That under-covers the amount actually received — if
// week 3 was already paid and a new payment is meant to cover 4 MORE
// weeks, the player should end up with 4 additional weeks of paid cover,
// not 3 new + 1 wasted re-confirming a week that was already paid. Fixed:
// the target set now explicitly skips any gameweek already marked paid for
// this user (see paymentAllocation.ts's own comment for the pure decision
// logic, extracted and unit-tested the same way bulkPayments.ts's
// classifyBulkPaymentRows() already is).
//
// dry_run (default true) computes and returns the target week count/ids
// without writing anything — the confirmation step ("£25 received. This
// will mark 5 future Pick 5 weeks as paid.") the admin UI shows before
// committing, same convention bulk_verify_payments already established.
// The write itself is one multi-row upsert (entry_payments' own natural
// key, pot_id/user_id/gameweek_id, is a full 3-column unique constraint —
// Pick 5 is always scope='gameweek', so this never needs
// upsertEntryPayment()'s partial-index workaround), not a loop of
// individual get-or-create-by-id calls — a single INSERT ... ON CONFLICT
// statement is atomic, so a write failure can never leave some of the N
// weeks recorded and others not.
//
// Phase 7 Stage 2 Slice 4: the response now includes each allocated (and
// each skipped-already-paid) gameweek's number/name, not just its id — "the
// organiser should always understand exactly what is about to happen"
// means naming GW6/GW7/..., not just a count. gameweeks was already being
// fetched for allocation purposes; this only widens the select().

import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { computePaymentAllocation } from './paymentAllocation.ts'

export interface RecordPaymentGameweek {
  id: number
  number: number
  name: string
}

export interface RecordPaymentResult {
  success: true
  dry_run: boolean
  weeks_requested: number
  weeks_materialized: number
  gameweek_ids: number[]
  gameweeks: RecordPaymentGameweek[]
  already_paid_gameweeks: RecordPaymentGameweek[]
}

export async function handleRecordPayment(
  adminClient: SupabaseClient,
  callerId: string,
  potId: string,
  body: { user_id?: string; amount?: number; dry_run?: boolean }
): Promise<RecordPaymentResult> {
  const { user_id: targetUserId, amount, dry_run: dryRun = true } = body
  if (!targetUserId) {
    throw new Error('user_id is required')
  }
  if (typeof amount !== 'number' || !Number.isFinite(amount) || amount <= 0) {
    throw new Error('amount must be a positive number')
  }

  const { data: pot, error: potError } = await adminClient
    .from('pots')
    .select('id, game_type, league_id, season_id, entry_fee')
    .eq('id', potId)
    .single()

  if (potError || !pot) {
    throw new Error(`Pot not found: ${potError?.message ?? potId}`)
  }
  const potRow = pot as { id: string; game_type: string; league_id: number; season_id: number; entry_fee: number }
  if (potRow.game_type !== 'pick5') {
    throw new Error('Recording a payment this way is only available for Pick 5 pots')
  }

  const { data: member } = await adminClient
    .from('pot_members')
    .select('user_id')
    .eq('pot_id', potId)
    .eq('user_id', targetUserId)
    .maybeSingle()
  if (!member) {
    throw new Error('User is not a member of this pot')
  }

  // Every gameweek not yet locked/started, in this pot's own league/season
  // (rule 3: Pick 5 always spans the whole season, no organiser cutoff).
  const { data: gameweeks, error: gwError } = await adminClient
    .from('gameweeks')
    .select('id, number, name')
    .eq('league_id', potRow.league_id)
    .eq('season_id', potRow.season_id)
    .eq('status', 'upcoming')
    .order('number', { ascending: true })

  if (gwError) {
    throw new Error(`Failed to look up upcoming gameweeks: ${gwError.message}`)
  }

  const eligibleGameweeks = (gameweeks ?? []) as RecordPaymentGameweek[]
  const gameweekById = new Map(eligibleGameweeks.map((gw) => [gw.id, gw]))

  const { data: existingPayments, error: paymentsError } = await adminClient
    .from('entry_payments')
    .select('gameweek_id, is_paid')
    .eq('pot_id', potId)
    .eq('user_id', targetUserId)
    .eq('scope', 'gameweek')

  if (paymentsError) {
    throw new Error(`Failed to look up existing payments: ${paymentsError.message}`)
  }

  const alreadyPaidGameweekIds = new Set(
    ((existingPayments ?? []) as { gameweek_id: number; is_paid: boolean }[])
      .filter((p) => p.is_paid)
      .map((p) => p.gameweek_id)
  )

  const allocation = computePaymentAllocation({
    amount,
    entryFee: potRow.entry_fee,
    eligibleGameweekIds: eligibleGameweeks.map((gw) => gw.id),
    alreadyPaidGameweekIds,
  })

  if (allocation.outcome === 'invalid_amount') {
    throw new Error(allocation.reason)
  }

  const { weeksRequested, gameweekIds: targetGameweekIds, skippedAlreadyPaidGameweekIds } = allocation
  const targetGameweeks = targetGameweekIds.map((id) => gameweekById.get(id)).filter((gw): gw is RecordPaymentGameweek => !!gw)
  const alreadyPaidGameweeks = skippedAlreadyPaidGameweekIds.map((id) => gameweekById.get(id)).filter((gw): gw is RecordPaymentGameweek => !!gw)

  if (dryRun) {
    return {
      success: true,
      dry_run: true,
      weeks_requested: weeksRequested,
      weeks_materialized: targetGameweekIds.length,
      gameweek_ids: targetGameweekIds,
      gameweeks: targetGameweeks,
      already_paid_gameweeks: alreadyPaidGameweeks,
    }
  }

  if (targetGameweekIds.length > 0) {
    const now = new Date().toISOString()
    const { error: writeError } = await adminClient.from('entry_payments').upsert(
      targetGameweekIds.map((gameweekId) => ({
        pot_id: potId,
        user_id: targetUserId,
        gameweek_id: gameweekId,
        scope: 'gameweek' as const,
        is_paid: true,
        marked_by: callerId,
        marked_at: now,
      })),
      { onConflict: 'pot_id,user_id,gameweek_id' }
    )
    if (writeError) {
      throw new Error(`Failed to record payment: ${writeError.message}`)
    }
  }

  return {
    success: true,
    dry_run: false,
    weeks_requested: weeksRequested,
    weeks_materialized: targetGameweekIds.length,
    gameweek_ids: targetGameweekIds,
    gameweeks: targetGameweeks,
    already_paid_gameweeks: alreadyPaidGameweeks,
  }
}
