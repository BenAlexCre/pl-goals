// Product rule revision, 2026-08-09, corrected 2026-08-10 (docs/decisions.md
// § Pick 5 jackpot and season rollover, rules 6-7: Payments / Admin payment
// workflow) — there is no payment gateway and no in-app payment; a player
// never pays through the application and never marks themselves paid. The
// organiser collects money off-platform (cash, bank transfer, Revolut,
// PayPal, etc.) and this action only RECORDS a payment that has already
// been received.
//
// Launch Readiness Sprint 1B (2026-08-10, resolves ISSUE-35): extended
// beyond Pick 5. This action previously threw outright for any non-Pick-5
// pot ("Recording a payment this way is only available for Pick 5 pots").
// LMS/Score Predictor are season-scoped (GE-4.5 — one flat entry fee for
// the whole competition, one entry_payments row per member, scope='season',
// gameweek_id null) — there is no "how many weeks does this amount cover"
// question for them, only "does it match the one-time season fee." The two
// scopes are different enough (weekly allocation with skip-already-paid
// logic vs. a single exact-match payment) that they're handled by two
// separate small functions below, dispatched on `pots.game_type`, rather
// than forcing one into the other's shape.
//
// dry_run (default true) computes and returns the result of either path
// without writing anything — the confirmation step the admin UI shows
// before committing, same convention bulk_verify_payments already
// established. Both paths reuse the shared `upsertEntryPayment()`
// get-or-create-by-id helper for their actual writes (also used by
// mark_paid/mark_unpaid) rather than re-deriving that logic — "do not
// duplicate backend logic."

import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { computePaymentAllocation } from './paymentAllocation.ts'
import { validateSeasonPayment } from './seasonPaymentValidation.ts'
import { upsertEntryPayment } from './upsertEntryPayment.ts'

export interface RecordPaymentGameweek {
  id: number
  number: number
  name: string
}

// Pick 5 — many weekly entry_payments rows, allocated automatically.
export interface RecordPaymentWeeklyResult {
  success: true
  scope: 'gameweek'
  dry_run: boolean
  weeks_requested: number
  weeks_materialized: number
  gameweek_ids: number[]
  gameweeks: RecordPaymentGameweek[]
  already_paid_gameweeks: RecordPaymentGameweek[]
}

// LMS / Score Predictor — a single one-time season payment. The preview
// shape the product brief asked for directly: status before, status after.
export interface RecordPaymentSeasonResult {
  success: true
  scope: 'season'
  dry_run: boolean
  status_before: 'paid' | 'unpaid'
  status_after: 'paid' | 'unpaid'
}

export type RecordPaymentResult = RecordPaymentWeeklyResult | RecordPaymentSeasonResult

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

  const { data: member } = await adminClient
    .from('pot_members')
    .select('user_id')
    .eq('pot_id', potId)
    .eq('user_id', targetUserId)
    .maybeSingle()
  if (!member) {
    throw new Error('User is not a member of this pot')
  }

  if (potRow.game_type === 'pick5') {
    return handleWeeklyRecordPayment(adminClient, callerId, potId, targetUserId, amount, dryRun, potRow)
  }
  return handleSeasonRecordPayment(adminClient, callerId, potId, targetUserId, amount, dryRun, potRow.entry_fee)
}

// Pick 5's original implementation, unchanged in behavior — just renamed
// and split out of the dispatcher above.
async function handleWeeklyRecordPayment(
  adminClient: SupabaseClient,
  callerId: string,
  potId: string,
  targetUserId: string,
  amount: number,
  dryRun: boolean,
  potRow: { league_id: number; season_id: number; entry_fee: number }
): Promise<RecordPaymentWeeklyResult> {
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
      scope: 'gameweek',
      dry_run: true,
      weeks_requested: weeksRequested,
      weeks_materialized: targetGameweekIds.length,
      gameweek_ids: targetGameweekIds,
      gameweeks: targetGameweeks,
      already_paid_gameweeks: alreadyPaidGameweeks,
    }
  }

  // Single multi-row upsert (entry_payments' pot_id/user_id/gameweek_id is
  // a full 3-column unique constraint here — Pick 5 is always
  // scope='gameweek', so this never needs upsertEntryPayment()'s partial-
  // index workaround) — atomic, so a write failure can never leave some of
  // the N weeks recorded and others not.
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
    scope: 'gameweek',
    dry_run: false,
    weeks_requested: weeksRequested,
    weeks_materialized: targetGameweekIds.length,
    gameweek_ids: targetGameweekIds,
    gameweeks: targetGameweeks,
    already_paid_gameweeks: alreadyPaidGameweeks,
  }
}

// LMS / Score Predictor — one entry_payments row, one exact-match payment.
async function handleSeasonRecordPayment(
  adminClient: SupabaseClient,
  callerId: string,
  potId: string,
  targetUserId: string,
  amount: number,
  dryRun: boolean,
  entryFee: number
): Promise<RecordPaymentSeasonResult> {
  const validation = validateSeasonPayment(amount, entryFee)
  if (validation.outcome === 'invalid_amount') {
    throw new Error(validation.reason)
  }

  const { data: existing, error: lookupError } = await adminClient
    .from('entry_payments')
    .select('is_paid')
    .eq('pot_id', potId)
    .eq('user_id', targetUserId)
    .is('gameweek_id', null)
    .maybeSingle()

  if (lookupError) {
    throw new Error(`Failed to look up existing payment: ${lookupError.message}`)
  }

  const statusBefore: 'paid' | 'unpaid' = (existing as { is_paid: boolean } | null)?.is_paid ? 'paid' : 'unpaid'

  if (dryRun) {
    return { success: true, scope: 'season', dry_run: true, status_before: statusBefore, status_after: 'paid' }
  }

  await upsertEntryPayment(adminClient, {
    pot_id: potId,
    user_id: targetUserId,
    gameweek_id: null,
    is_paid: true,
    marked_by: callerId,
  })

  return { success: true, scope: 'season', dry_run: false, status_before: statusBefore, status_after: 'paid' }
}
