// Extracted from index.ts, Launch Readiness Sprint 1B — recordPayment.ts's
// new season-scoped path (LMS/Score Predictor) needs the exact same
// get-or-create-by-id write mark_paid/mark_unpaid already use, not a
// second copy of it. Kept as its own file rather than imported back out of
// index.ts, which would create a circular import (index.ts already imports
// handleRecordPayment from recordPayment.ts).
//
// Prerequisite correction (before Milestone 6 Slice 6): mark_paid/
// mark_unpaid previously upserted entry_payments with
// `onConflict: 'pot_id,user_id,gameweek_id'` unconditionally. That target
// matches the full 3-column unique constraint
// (entry_payments_pot_id_user_id_gameweek_id_key) — correct for Pick 5's
// scope='gameweek' rows, but season-scoped rows (LMS/Predictor,
// gameweek_id null) are actually deduplicated by a different, *partial*
// unique index, entry_payments_pot_user_season_key (unique on
// (pot_id, user_id) WHERE gameweek_id IS NULL) — Postgres's ON CONFLICT
// only routes to an index whose columns match the specified target
// exactly, so this never engaged that partial index at all. Confirmed
// live, not theoretical: a second write to the same season-scoped
// (pot_id, user_id) key hard-failed with
// `duplicate key value violates unique constraint
// "entry_payments_pot_user_season_key"` — meaning marking a season-scoped
// entry paid/unpaid more than once (routine — correcting a mistake, or
// exactly the mark-paid-then-reinstate sequence this correction's own new
// feature depends on) was completely broken for LMS/Predictor.
//
// Fixed with the same get-or-create-by-id workaround this codebase
// already uses for other partial-unique-index tables
// (pot_standings_snapshots, pot_prizes — see docs/game-engine.md §
// GE-4.6): look up the existing row by its natural key first, then
// UPDATE by id if found or INSERT if not, rather than relying on
// PostgREST's upsert(onConflict) to route to an index it structurally
// cannot target. bulk_verify_payments is unaffected — gameweek_id is a
// required, non-null parameter there (always scope='gameweek'), so it
// never reaches the partial index at all.

import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2'

export async function upsertEntryPayment(
  adminClient: SupabaseClient,
  params: { pot_id: string; user_id: string; gameweek_id: number | null; is_paid: boolean; marked_by: string }
): Promise<void> {
  const { pot_id, user_id, gameweek_id, is_paid, marked_by } = params
  const scope = gameweek_id !== null ? 'gameweek' : 'season'

  let existingQuery = adminClient.from('entry_payments').select('id').eq('pot_id', pot_id).eq('user_id', user_id)
  existingQuery = gameweek_id !== null ? existingQuery.eq('gameweek_id', gameweek_id) : existingQuery.is('gameweek_id', null)
  const { data: existing, error: lookupError } = await existingQuery.maybeSingle()
  if (lookupError) {
    throw new Error(`Failed to look up existing payment record: ${lookupError.message}`)
  }

  const patch = { pot_id, user_id, gameweek_id, scope, is_paid, marked_by, marked_at: new Date().toISOString() }

  if (existing) {
    const { error: updateError } = await adminClient.from('entry_payments').update(patch).eq('id', existing.id)
    if (updateError) throw new Error(`Failed to update payment record: ${updateError.message}`)
  } else {
    const { error: insertError } = await adminClient.from('entry_payments').insert(patch)
    if (insertError) throw new Error(`Failed to create payment record: ${insertError.message}`)
  }
}
