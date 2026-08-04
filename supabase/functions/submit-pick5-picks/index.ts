import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { corsHeaders } from '../_shared/cors.ts'
import { resolveEngine } from '../_shared/game-engine/dispatcher.ts'
import { Pick5ValidationError } from '../_shared/game-engine/pick5/index.ts'
import type { GameEntry } from '../_shared/game-engine/types.ts'
import { validateSubmitPicksRequest } from './validate.ts'

// Milestone 4, Slice 2 (pick submission) — docs/game-engine.md § GE-5.1 / GE-6.
//
// First Edge Function to actually call the Game Engine contract: this is
// Pick5Engine.validateEntry() being invoked for real, not just exercised by
// framework-verification.test.ts's TestGameEngine fixture. Auth pattern is
// identical to get-or-create-pick5-entry/index.ts: a user-scoped client
// resolves identity, a service-role client does the actual reads/writes,
// with authorization checked explicitly in code — pick5_picks has no
// client-insert RLS policy at all (007_pick5_picks.sql), so this function is
// the only path that can write one.
//
// Resolves ISSUE-7 (goalkeeper eligibility, previously undefined/conflicting
// between the two prototype pick-building flows) by delegating the actual
// rule to Pick5Engine.validateEntry() — goalkeepers are excluded, a decision
// made explicitly for this slice rather than inherited from either prototype
// flow. See current-state.md for the full record.

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

  const body = await req.json()
  const validation = validateSubmitPicksRequest(body)
  if (!validation.ok) {
    return jsonResponse({ error: validation.error }, 400)
  }
  const { gameEntryId, playerIds } = validation

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
  if (entryRow.pots?.game_type !== 'pick5') {
    return jsonResponse({ error: `This entry belongs to a ${entryRow.pots?.game_type} pot, not pick5` }, 400)
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

  const picks = playerIds.map((playerId) => ({ playerId }))
  const ctx = { supabase: adminClient, now: () => new Date() }

  try {
    await resolveEngine('pick5').validateEntry(ctx, entry, picks)
  } catch (err) {
    if (err instanceof Pick5ValidationError) {
      return jsonResponse({ error: err.message }, 400)
    }
    return jsonResponse({ error: err instanceof Error ? err.message : 'Validation failed' }, 500)
  }

  const rows = playerIds.map((playerId, index) => ({
    game_entry_id: gameEntryId,
    pick_position: index + 1,
    player_id: playerId,
  }))

  const { data: savedPicks, error: upsertError } = await adminClient
    .from('pick5_picks')
    .upsert(rows, { onConflict: 'game_entry_id,pick_position' })
    .select()
    .order('pick_position')

  if (upsertError) {
    return jsonResponse({ error: upsertError.message }, 500)
  }

  return jsonResponse({ success: true, picks: savedPicks })
})
