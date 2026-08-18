import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { corsHeaders } from '../_shared/cors.ts'
import { requireVerifiedActiveUser } from '../_shared/requireVerifiedActiveUser.ts'
import { resolveEngine } from '../_shared/game-engine/dispatcher.ts'
import { PredictorValidationError } from '../_shared/game-engine/predictor/index.ts'
import type { GameEntry } from '../_shared/game-engine/types.ts'
import { validateSubmitPredictorPickRequest } from './validate.ts'

// Milestone 6, Slice 2 (pick submission) — docs/game-engine.md § GE-5.3 / GE-6.
// Mirrors submit-lms-pick/index.ts closely; the real difference is Score
// Predictor's own pick shape (a scoreline + an optional goalscorer guess for
// one chosen fixture, not a team choice) — a season-scoped entry has no
// gameweek_id of its own, so gameweek_id is a request parameter here, same
// reasoning as submit-lms-pick.
//
// Auth pattern identical to submit-pick5-picks/submit-lms-pick: a
// user-scoped client resolves identity, a service-role client does the
// actual reads/writes, with authorization checked explicitly in code —
// predictor_fixture_picks has no client-insert RLS policy at all
// (017_predictor_picks.sql), so this function is the only path that can
// write one.

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  const authHeader = req.headers.get('Authorization')
  if (!authHeader) {
    return jsonResponse({ error: 'Missing auth header' }, 401)
  }

  const adminClient = createClient(
    Deno.env.get('SUPABASE_URL') ?? '',
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
  )

  const userClient = createClient(
    Deno.env.get('SUPABASE_URL') ?? '',
    Deno.env.get('SUPABASE_ANON_KEY') ?? '',
    { global: { headers: { Authorization: authHeader } } }
  )

  const { data: userData, error: authError } = await userClient.auth.getUser()
  if (authError || !userData.user) {
    return jsonResponse({ error: 'Unauthorized' }, 401)
  }

  // Phase 8D, Part 5 — unverified/banned accounts cannot submit predictions.
  const verifiedCheck = await requireVerifiedActiveUser(userClient, userData.user)
  if (!verifiedCheck.ok) {
    return jsonResponse({ error: verifiedCheck.error }, verifiedCheck.status)
  }

  // Production hardening sprint pattern, applied here from the start (not
  // retrofitted later like the other five functions were): a malformed body
  // must never crash uncaught. Falling back to {} lets the existing
  // validateSubmitPredictorPickRequest() below reject it cleanly as a 400.
  const body = await req.json().catch(() => ({}))
  const validation = validateSubmitPredictorPickRequest(body)
  if (!validation.ok) {
    return jsonResponse({ error: validation.error }, 400)
  }
  const { gameEntryId, gameweekId, fixtureId, predictedHomeScore, predictedAwayScore, goalscorerPlayerId } = validation

  const { data: entryRow, error: entryError } = await adminClient
    .from('game_entries')
    .select('*, pots(game_type)')
    .eq('id', gameEntryId)
    .maybeSingle()

  if (entryError) {
    return jsonResponse({ error: entryError.message }, 500)
  }
  if (!entryRow) {
    return jsonResponse({ error: 'Entry not found' }, 404)
  }
  if (entryRow.user_id !== userData.user.id) {
    return jsonResponse({ error: 'Not your entry' }, 403)
  }
  if (entryRow.pots?.game_type !== 'score_predictor') {
    return jsonResponse({ error: `This entry belongs to a ${entryRow.pots?.game_type} pot, not score_predictor` }, 400)
  }

  const entry: GameEntry = {
    id: entryRow.id,
    potId: entryRow.pot_id,
    userId: entryRow.user_id,
    gameweekId: entryRow.gameweek_id,
    entryScope: entryRow.entry_scope,
    status: entryRow.status,
    payoutAmount: Number(entryRow.payout_amount),
    settledAt: entryRow.settled_at,
  }

  const ctx = { supabase: adminClient, now: () => new Date() }

  try {
    await resolveEngine('score_predictor').validateEntry(ctx, entry, {
      gameweekId,
      fixtureId,
      predictedHomeScore,
      predictedAwayScore,
      goalscorerPlayerId,
    })
  } catch (err) {
    if (err instanceof PredictorValidationError) {
      return jsonResponse({ error: err.message }, 400)
    }
    return jsonResponse({ error: err instanceof Error ? err.message : 'Validation failed' }, 500)
  }

  // Same re-check-immediately-before-the-write pattern as
  // submit-pick5-picks/submit-lms-pick (docs/decisions.md § Same-request
  // write races) — validateEntry() above checked entry.status against the
  // snapshot read at the top of this request; re-verified directly,
  // immediately before the write, to close the window as tightly as this
  // request can.
  const { data: freshEntry, error: freshEntryError } = await adminClient
    .from('game_entries')
    .select('status')
    .eq('id', gameEntryId)
    .single()

  if (freshEntryError) {
    return jsonResponse({ error: freshEntryError.message }, 500)
  }
  if (freshEntry.status !== 'pending') {
    return jsonResponse(
      { error: `Entry is ${freshEntry.status}, not pending — picks can no longer be changed` },
      400
    )
  }

  const { data: savedPick, error: upsertError } = await adminClient
    .from('predictor_fixture_picks')
    .upsert(
      {
        game_entry_id: gameEntryId,
        gameweek_id: gameweekId,
        fixture_id: fixtureId,
        predicted_home_score: predictedHomeScore,
        predicted_away_score: predictedAwayScore,
        goalscorer_player_id: goalscorerPlayerId,
      },
      { onConflict: 'game_entry_id,gameweek_id' }
    )
    .select()
    .single()

  if (upsertError) {
    return jsonResponse({ error: upsertError.message }, 500)
  }

  return jsonResponse({ success: true, pick: savedPick })
})
