import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { corsHeaders } from '../_shared/cors.ts'
import { requireVerifiedActiveUser } from '../_shared/requireVerifiedActiveUser.ts'
import { checkEntryWindow, validateEntryRequest } from './validate.ts'

// Milestone 5, Slice 1 (entry creation) — docs/game-engine.md § GE-5.2.
// Mirrors get-or-create-pick5-entry/index.ts exactly, with one structural
// difference: LMS entries are season-scoped (GE-4.5 — one entry per
// (pot, user) for the pot's whole life), not gameweek-scoped, so there is
// no gameweek_id anywhere in this request — the existing-entry lookup uses
// game_entries_season_key's shape (pot_id, user_id, gameweek_id IS NULL)
// instead of Pick 5's (pot_id, user_id, gameweek_id).
//
// Not one of the Game Engine's eight lifecycle methods (GE-6) — same
// reasoning as get-or-create-pick5-entry: creating the game_entries/
// game_entry_lms row pair is persistence orchestration, not scoring/
// validation/settlement/payout logic.
//
// Auth pattern matches get-or-create-pick5-entry/admin-actions exactly:
// forwarded JWT resolves the caller's identity via a user-scoped client; a
// service-role client does the actual writes, with authorization checked
// explicitly in code first (game_entry_lms has no client-insert RLS policy
// at all — this function is the only path that can create one).

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  const authHeader = req.headers.get('Authorization')
  if (!authHeader) {
    return new Response(JSON.stringify({ error: 'Missing auth header' }), {
      status: 401,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
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
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }

  // Phase 8D, Part 5 — unverified/banned accounts cannot create entries.
  const verifiedCheck = await requireVerifiedActiveUser(userClient, userData.user)
  if (!verifiedCheck.ok) {
    return new Response(JSON.stringify({ error: verifiedCheck.error }), {
      status: verifiedCheck.status,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }

  // Production hardening sprint, 2026-08-06: a malformed/empty body used to
  // throw here uncaught, surfacing as a bare 500 with no error detail
  // (verified live). Falling back to {} lets the existing
  // validateEntryRequest() below reject it cleanly as a 400 instead, same
  // pattern settle-gameweek/index.ts already used.
  const body = await req.json().catch(() => ({}))
  const validation = validateEntryRequest(body)
  if (!validation.ok) {
    return new Response(JSON.stringify({ error: validation.error }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
  const { potId: pot_id } = validation

  const { data: pot, error: potError } = await adminClient
    .from('pots')
    .select('id, game_type, status, rollover_source_pot_id, start_gameweek_id')
    .eq('id', pot_id)
    .maybeSingle()

  if (potError || !pot) {
    return new Response(JSON.stringify({ error: 'Pot not found' }), {
      status: 404,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }

  if (pot.game_type !== 'last_man_standing') {
    return new Response(JSON.stringify({ error: `This pot is a ${pot.game_type} pot, not last_man_standing` }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }

  // ISSUE-32 / GE-5.2: entry window. A normal pot closes forever once its
  // start_gameweek's first fixture kicks off; a rollover pot's window is
  // simply "still in draft." Checked before membership so a closed window
  // rejects consistently regardless of whether the caller already belongs
  // to the pot.
  let startGameweekKickoffUtc: string | null = null
  if (pot.start_gameweek_id !== null) {
    const { data: startGameweek } = await adminClient
      .from('gameweeks')
      .select('earliest_kickoff_utc')
      .eq('id', pot.start_gameweek_id)
      .maybeSingle()
    startGameweekKickoffUtc = startGameweek?.earliest_kickoff_utc ?? null
  }

  const windowCheck = checkEntryWindow({
    rolloverSourcePotId: pot.rollover_source_pot_id,
    potStatus: pot.status,
    startGameweekId: pot.start_gameweek_id,
    startGameweekKickoffUtc,
    now: new Date(),
  })

  if (!windowCheck.ok) {
    return new Response(JSON.stringify({ error: windowCheck.error }), {
      status: 403,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }

  const { data: membership } = await adminClient
    .from('pot_members')
    .select('user_id')
    .eq('pot_id', pot_id)
    .eq('user_id', userData.user.id)
    .maybeSingle()

  if (!membership) {
    return new Response(JSON.stringify({ error: 'Not a member of this pot' }), {
      status: 403,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }

  const { data: existing, error: existingError } = await adminClient
    .from('game_entries')
    .select('*, game_entry_lms(*)')
    .eq('pot_id', pot_id)
    .eq('user_id', userData.user.id)
    .is('gameweek_id', null)
    .maybeSingle()

  if (existingError) {
    return new Response(JSON.stringify({ error: existingError.message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }

  if (existing) {
    return new Response(JSON.stringify({ success: true, entry: existing, created: false }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }

  const { data: newEntry, error: insertError } = await adminClient
    .from('game_entries')
    .insert({
      pot_id,
      user_id: userData.user.id,
      entry_scope: 'season',
    })
    .select()
    .single()

  // Someone else's concurrent request beat this one to the same row — the
  // unique index (game_entries_season_key) is the real safety net here,
  // this just makes the race resolve gracefully instead of surfacing an
  // error to the user who did nothing wrong. Same pattern as
  // get-or-create-pick5-entry.
  if (insertError?.code === '23505') {
    const { data: raceWinner, error: refetchError } = await adminClient
      .from('game_entries')
      .select('*, game_entry_lms(*)')
      .eq('pot_id', pot_id)
      .eq('user_id', userData.user.id)
      .is('gameweek_id', null)
      .single()

    if (refetchError) {
      return new Response(JSON.stringify({ error: refetchError.message }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    return new Response(JSON.stringify({ success: true, entry: raceWinner, created: false }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }

  if (insertError) {
    return new Response(JSON.stringify({ error: insertError.message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }

  const { data: extension, error: extensionError } = await adminClient
    .from('game_entry_lms')
    .insert({ game_entry_id: newEntry.id })
    .select()
    .single()

  if (extensionError) {
    // Compensating rollback — supabase-js has no cross-table transaction, so
    // this two-step write isn't atomic. Undo the first insert rather than
    // leave a game_entries row with no matching game_entry_lms extension.
    await adminClient.from('game_entries').delete().eq('id', newEntry.id)
    return new Response(JSON.stringify({ error: extensionError.message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }

  return new Response(
    JSON.stringify({
      success: true,
      entry: { ...newEntry, game_entry_lms: extension },
      created: true,
    }),
    { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
  )
})
