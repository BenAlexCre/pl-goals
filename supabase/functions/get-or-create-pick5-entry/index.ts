import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { corsHeaders } from '../_shared/cors.ts'
import { validateEntryRequest } from './validate.ts'

// Milestone 4, Slice 1 (entry creation) — docs/game-engine.md § GE-5.1.
//
// Not one of the Game Engine's eight lifecycle methods (GE-6) — creating the
// game_entries/game_entry_pick5 row pair is basic persistence orchestration,
// not scoring/validation/settlement/payout logic, so it stays a plain Edge
// Function rather than going through the dispatcher. If LMS/Predictor need
// equivalent creation logic in Milestones 5/6, revisit whether this should
// become shared, mode-branching logic instead of a second near-duplicate
// function — noting that now rather than guessing at a shared shape today.
//
// Auth pattern matches admin-actions/index.ts exactly: forwarded JWT resolves
// the caller's identity via a user-scoped client; a service-role client does
// the actual writes, with authorization checked explicitly in code first
// (game_entry_pick5 has no client-insert RLS policy at all — this function is
// the only path that can create one).

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

  const body = await req.json()
  const validation = validateEntryRequest(body)
  if (!validation.ok) {
    return new Response(JSON.stringify({ error: validation.error }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
  const { potId: pot_id, gameweekId: gameweek_id } = validation

  const { data: pot, error: potError } = await adminClient
    .from('pots')
    .select('id, game_type')
    .eq('id', pot_id)
    .maybeSingle()

  if (potError || !pot) {
    return new Response(JSON.stringify({ error: 'Pot not found' }), {
      status: 404,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }

  if (pot.game_type !== 'pick5') {
    return new Response(JSON.stringify({ error: `This pot is a ${pot.game_type} pot, not pick5` }), {
      status: 400,
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

  const { data: gameweek, error: gwError } = await adminClient
    .from('gameweeks')
    .select('id')
    .eq('id', gameweek_id)
    .maybeSingle()

  if (gwError || !gameweek) {
    return new Response(JSON.stringify({ error: 'Gameweek not found' }), {
      status: 404,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }

  const { data: existing, error: existingError } = await adminClient
    .from('game_entries')
    .select('*, game_entry_pick5(*)')
    .eq('pot_id', pot_id)
    .eq('user_id', userData.user.id)
    .eq('gameweek_id', gameweek_id)
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
      gameweek_id,
      entry_scope: 'gameweek',
    })
    .select()
    .single()

  // Someone else's concurrent request beat this one to the same row — the
  // unique index (game_entries_gameweek_key) is the real safety net here,
  // this just makes the race resolve gracefully instead of surfacing an
  // error to the user who did nothing wrong.
  if (insertError?.code === '23505') {
    const { data: raceWinner, error: refetchError } = await adminClient
      .from('game_entries')
      .select('*, game_entry_pick5(*)')
      .eq('pot_id', pot_id)
      .eq('user_id', userData.user.id)
      .eq('gameweek_id', gameweek_id)
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
    .from('game_entry_pick5')
    .insert({ game_entry_id: newEntry.id })
    .select()
    .single()

  if (extensionError) {
    // Compensating rollback — supabase-js has no cross-table transaction, so
    // this two-step write isn't atomic. Undo the first insert rather than
    // leave a game_entries row with no matching game_entry_pick5 extension.
    await adminClient.from('game_entries').delete().eq('id', newEntry.id)
    return new Response(JSON.stringify({ error: extensionError.message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }

  return new Response(
    JSON.stringify({
      success: true,
      entry: { ...newEntry, game_entry_pick5: extension },
      created: true,
    }),
    { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
  )
})
