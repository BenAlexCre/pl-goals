// Prerequisite correction (before Milestone 6 Slice 6) — Late Payment
// Override. New business rule: an organiser/admin may explicitly accept a
// late payment and choose to reinstate an entry settlement already voided
// for non-payment. Full reasoning, including the architecture review this
// design is drawn from, in docs/decisions.md § Late Payment Override.
//
// Split the same way bulkPayments.ts already splits classifyBulkPaymentRows()
// (pure, unit-tested) from handleBulkVerifyPayments() (DB orchestration,
// live-verified only, no bespoke unit test — same convention every
// dispatcher-driving Edge Function in this codebase already follows:
// compute-scores/settle-gameweek/compute-deadlines have no .test.ts files
// of their own either, because their own logic is "call an already-tested
// GameEngine method," not novel decision logic worth re-testing here).
//
// decideReinstatement() is that pure decision layer: given already-fetched
// facts (entry, payment, prize state), it decides what should happen,
// with zero DB or dispatcher calls of its own — testable the same way
// classifyBulkPaymentRows() is. handleReinstateEntry() does the fetching,
// writing, and calls into the Game Engine dispatcher to reuse
// calculateScore()/settle() rather than reimplementing scoring/settlement
// logic here (the whole point of "avoid introducing duplicate logic").

import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { resolveEngine } from '../_shared/game-engine/dispatcher.ts'
import type { GameEngineContext } from '../_shared/game-engine/contracts.ts'
import type { GameType } from '../_shared/game-engine/types.ts'
import '../_shared/game-engine/pick5/index.ts'
import '../_shared/game-engine/lms/index.ts'
import '../_shared/game-engine/predictor/index.ts'

export interface ReinstatementEntryFacts {
  id: string
  status: string
  gameweekId: number | null
  reinstatedAt: string | null
}

export interface ReinstatementInput {
  gameType: GameType
  entry: ReinstatementEntryFacts | null
  isPaid: boolean
  isAlreadyConcluded: boolean
}

export type ReinstatementDecision =
  | { outcome: 'no_entry' }
  // status is not 'void' AND this entry has never been through this flow
  // before (reinstatedAt is null) — a confused/accidental call on an
  // ordinary entry, not a retry. Rejected, not silently no-opped, so the
  // caller gets a clear signal something's off rather than a false
  // "success."
  | { outcome: 'not_void' }
  | { outcome: 'payment_not_verified' }
  | { outcome: 'already_concluded' }
  // writeStatus is false when the entry is already non-'void' but
  // reinstatedAt is set — a retry of a previously-started reinstatement
  // whose status write already landed but whose recompute pass may not
  // have finished. The status write is skipped (idempotent no-op either
  // way), but the recompute pass below always runs regardless, since
  // that's the part that can genuinely be incomplete after a retry.
  | { outcome: 'reinstate'; newStatus: 'locked' | 'pending'; writeStatus: boolean }

// Pure — no I/O. Every branch is independently testable.
export function decideReinstatement(input: ReinstatementInput): ReinstatementDecision {
  const { gameType, entry, isPaid, isAlreadyConcluded } = input

  if (!entry) {
    return { outcome: 'no_entry' }
  }
  if (entry.status !== 'void' && entry.reinstatedAt === null) {
    return { outcome: 'not_void' }
  }
  // Guards are re-checked unconditionally, including on a retry (Q5:
  // "remain retry-safe") — cheap reads, and correctness must never depend
  // on trusting a prior call's already-stale result.
  if (!isPaid) {
    return { outcome: 'payment_not_verified' }
  }
  if (isAlreadyConcluded) {
    return { outcome: 'already_concluded' }
  }

  // Pick 5's calculateScore() only ever processes status = 'locked'
  // entries (its own, pre-existing filter, unchanged by this correction);
  // LMS/Predictor's now filter on status = 'pending' (the cross-slice
  // correction applied earlier the same day this feature was built) — the
  // reinstated status must match whichever filter that mode's
  // calculateScore() actually reads, not a single value reused across
  // both, or the recompute pass below would silently find nothing to do.
  const newStatus = gameType === 'pick5' ? 'locked' : 'pending'
  return { outcome: 'reinstate', newStatus, writeStatus: entry.status === 'void' }
}

export async function handleReinstateEntry(
  adminClient: SupabaseClient,
  callerId: string,
  potId: string,
  body: { user_id?: string; gameweek_id?: number }
): Promise<{ success: boolean; reinstated: boolean; reason?: string }> {
  const { user_id: targetUserId, gameweek_id: requestedGameweekId } = body
  if (!targetUserId) {
    throw new Error('user_id is required')
  }

  const { data: pot, error: potError } = await adminClient
    .from('pots')
    .select('id, game_type, season_id')
    .eq('id', potId)
    .single()

  if (potError || !pot) {
    throw new Error(`Pot not found: ${potError?.message ?? potId}`)
  }

  const gameType = pot.game_type as GameType

  // GE-4.5: Pick 5's entry is gameweek-scoped; LMS's/Predictor's is
  // season-scoped (gameweek_id null) — the same distinction every other
  // per-mode entry lookup in this codebase already makes.
  let entryQuery = adminClient
    .from('game_entries')
    .select('id, status, gameweek_id, reinstated_at')
    .eq('pot_id', potId)
    .eq('user_id', targetUserId)

  if (gameType === 'pick5') {
    if (typeof requestedGameweekId !== 'number') {
      throw new Error('gameweek_id is required to reinstate a Pick 5 entry')
    }
    entryQuery = entryQuery.eq('gameweek_id', requestedGameweekId)
  } else {
    entryQuery = entryQuery.is('gameweek_id', null)
  }

  const { data: entryRow, error: entryError } = await entryQuery.maybeSingle()
  if (entryError) {
    throw new Error(`Failed to look up entry: ${entryError.message}`)
  }

  const entry: ReinstatementEntryFacts | null = entryRow
    ? { id: entryRow.id, status: entryRow.status, gameweekId: entryRow.gameweek_id, reinstatedAt: entryRow.reinstated_at }
    : null

  if (!entry) {
    return { success: false, reinstated: false, reason: 'No matching entry found.' }
  }

  // Payment Verification, GE-4.3: Pick 5 is scope='gameweek' (one fee per
  // instance); LMS/Predictor are scope='season' (one flat fee for the
  // whole competition) — same split every settle() already reads.
  const paymentScope = gameType === 'pick5' ? 'gameweek' : 'season'
  let paymentQuery = adminClient
    .from('entry_payments')
    .select('is_paid')
    .eq('pot_id', potId)
    .eq('user_id', targetUserId)
    .eq('scope', paymentScope)
  paymentQuery = entry.gameweekId !== null ? paymentQuery.eq('gameweek_id', entry.gameweekId) : paymentQuery.is('gameweek_id', null)

  const { data: payment, error: paymentError } = await paymentQuery.maybeSingle()
  if (paymentError) {
    throw new Error(`Failed to look up payment status: ${paymentError.message}`)
  }

  // "Already concluded" — the same instance-identification split as
  // above: Pick 5's pot_prizes row is keyed by (pot_id, gameweek_id,
  // scope='gameweek'); LMS/Predictor's by (pot_id, scope='season'). A
  // settled row here means real money has already been paid out for this
  // exact competition instance — reinstating past that point is refused,
  // not silently allowed, per the repo owner's explicit requirement that
  // this stays a deliberate, bounded correction, not a way to reopen an
  // already-concluded, already-paid competition.
  const prizeScope = gameType === 'pick5' ? 'gameweek' : 'season'
  let prizeQuery = adminClient.from('pot_prizes').select('is_settled').eq('pot_id', potId).eq('scope', prizeScope)
  prizeQuery = entry.gameweekId !== null ? prizeQuery.eq('gameweek_id', entry.gameweekId) : prizeQuery.is('gameweek_id', null)

  const { data: prize, error: prizeError } = await prizeQuery.maybeSingle()
  if (prizeError) {
    throw new Error(`Failed to look up prize status: ${prizeError.message}`)
  }

  const decision = decideReinstatement({
    gameType,
    entry,
    isPaid: payment?.is_paid === true,
    isAlreadyConcluded: prize?.is_settled === true,
  })

  switch (decision.outcome) {
    case 'no_entry':
      return { success: false, reinstated: false, reason: 'No matching entry found.' }
    case 'not_void':
      return { success: true, reinstated: false, reason: 'Entry is not void — nothing to reinstate.' }
    case 'payment_not_verified':
      return { success: false, reinstated: false, reason: 'Cannot reinstate — payment is not verified as paid. Mark the entry paid first.' }
    case 'already_concluded':
      return { success: false, reinstated: false, reason: 'Cannot reinstate — this competition has already concluded and its prize awarded.' }
    case 'reinstate':
      await performReinstatement(adminClient, callerId, pot, entry, decision)
      return { success: true, reinstated: true }
  }
}

// Split out from handleReinstateEntry() only to keep that function's own
// guard-checking flow readable — not independently reused elsewhere.
async function performReinstatement(
  adminClient: SupabaseClient,
  callerId: string,
  pot: { id: string; game_type: string; season_id: number },
  entry: ReinstatementEntryFacts,
  decision: Extract<ReinstatementDecision, { outcome: 'reinstate' }>
): Promise<void> {
  if (decision.writeStatus) {
    const { error: updateError } = await adminClient
      .from('game_entries')
      .update({ status: decision.newStatus, reinstated_at: new Date().toISOString(), reinstated_by: callerId })
      .eq('id', entry.id)

    if (updateError) {
      throw new Error(`Failed to reinstate entry: ${updateError.message}`)
    }
  }

  // Recompute — reuses the exact same GameEngine methods the normal cron
  // pipeline calls, never reimplemented here. Necessary, not optional:
  // once a gameweek's settle-gameweek run flips gameweeks.status to
  // 'completed', compute-scores permanently stops calling
  // calculateScore() for it (it only ever queries status in
  // ('upcoming','live')) — so without this explicit catch-up, a
  // reinstated entry's picks for every gameweek that occurred during the
  // void window would stay unresolved/incorrect forever, and its
  // cumulative stats would never include them. See docs/decisions.md §
  // Late Payment Override for the full "why a bare status flip isn't
  // sufficient" reasoning.
  const gameType = pot.game_type as GameType
  const ctx: GameEngineContext = { supabase: adminClient, now: () => new Date() }
  const engine = resolveEngine(gameType)

  if (gameType === 'pick5') {
    // Gameweek-scoped entry (GE-4.5) — exactly one gameweek is ever
    // relevant, no loop needed.
    await engine.calculateScore(ctx, entry.gameweekId!)
    // settle() is not skipped here even though it also calls
    // generateStandings()/awardPrize() internally — see decisions.md for
    // why re-running the pot's own normal settle() pipeline on now-correct
    // data is the intended outcome, not a bypassed safeguard: the
    // "already concluded" guard above is what actually prevents reopening
    // a competition whose prize was already paid; once past that guard,
    // letting the same idempotent pipeline that would have processed this
    // gameweek anyway run now, rather than never, is correct.
    await engine.settle(ctx, entry.gameweekId!)
  } else {
    // Season-scoped entry (GE-4.5) — every gameweek in the pot's own
    // season may have been skipped for this entry during the void window
    // (the cross-slice correction applied earlier the same day excludes
    // non-'pending' entries from calculateScore() entirely), so every one
    // needs revisiting. Ascending order replays them in the same sequence
    // they'd have originally occurred in — required for LMS's elimination
    // logic to reach the same conclusion it would have reached had the
    // entry never been voided at all. calculateScore() itself cheaply
    // no-ops for a gameweek that hasn't started/isn't finished yet, so
    // looping over the whole season (not just "the ones that changed") is
    // simple and safe, not wasteful in any way that matters for an
    // admin-triggered, low-frequency action.
    const { data: gameweeks, error: gwError } = await adminClient
      .from('gameweeks')
      .select('id')
      .eq('season_id', pot.season_id)
      .order('id', { ascending: true })

    if (gwError) {
      throw new Error(`Failed to look up season gameweeks: ${gwError.message}`)
    }

    const gameweekRows = (gameweeks ?? []) as { id: number }[]
    for (const gw of gameweekRows) {
      await engine.calculateScore(ctx, gw.id)
    }

    const lastGameweek = gameweekRows.at(-1)
    if (lastGameweek) {
      await engine.settle(ctx, lastGameweek.id)
    }
  }
}
