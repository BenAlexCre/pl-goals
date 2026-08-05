import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { corsHeaders } from '../_shared/cors.ts'
import { resolveEngine } from '../_shared/game-engine/dispatcher.ts'
import { UnknownGameTypeError } from '../_shared/game-engine/errors.ts'
import type { GameType } from '../_shared/game-engine/types.ts'
// Side-effecting import — registers 'pick5' with the dispatcher (GE-7/GE-18).
// This is the only mode registered today; lms/predictor imports land in
// Milestones 5/6 and this function's dispatch loop below picks them up
// automatically, with no further changes here.
import '../_shared/game-engine/pick5/index.ts'

// Milestone 4, Slice 3 — docs/game-engine.md § GE-6 (lockEntries) / GE-8.2
// (Locking flow) / GE-19 (sequence diagram, which names this exact function
// as the locking flow's Edge Function). Deadline computation itself
// (earliest_kickoff_utc/deadline_utc) is unchanged from before this slice;
// what's new is that once a gameweek's just-computed deadline has already
// passed, this function now also asks the dispatcher which game types have
// pending entries for that gameweek and calls each one's lockEntries().
//
// Discovering game types from the data (not hardcoding 'pick5') keeps this
// function mode-agnostic per GE-7 ("Edge functions never branch on
// game_type directly") — it works unchanged once LMS/Predictor register,
// without needing gameweek-scoped entries at all today, since only Pick 5
// has any (GE-4.5).
Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  const sb = createClient(
    Deno.env.get('SUPABASE_URL') ?? '',
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
  )

  const { data: run } = await sb
    .from('sync_runs')
    .insert({ job_name: 'compute-deadlines', triggered_by: 'cron' })
    .select()
    .single()

  const ctx = { supabase: sb, now: () => new Date() }
  let updated = 0
  let locked = 0

  try {
    const { data: gws } = await sb.from('gameweeks').select('id').in('status', ['upcoming', 'live'])

    for (const gw of gws ?? []) {
      const { data: fixtures } = await sb
        .from('fixtures')
        .select('kickoff_utc')
        .eq('gameweek_id', gw.id)
        .not('status', 'in', '("postponed","cancelled")')

      if (!fixtures?.length) continue

      const earliest = new Date(Math.min(...fixtures.map((f) => new Date(f.kickoff_utc).getTime())))
      const deadline = new Date(earliest.getTime() - 30 * 60 * 1000)

      await sb.from('gameweeks').update({
        earliest_kickoff_utc: earliest.toISOString(),
        deadline_utc: deadline.toISOString(),
      }).eq('id', gw.id)

      updated++

      if (ctx.now() < deadline) continue

      const { data: pendingEntries } = await sb
        .from('game_entries')
        .select('pots(game_type)')
        .eq('gameweek_id', gw.id)
        .eq('status', 'pending')

      // supabase-js infers embedded-resource shape generically (as an array)
      // when the client has no generated Database type to confirm this is
      // really a many-to-one (game_entries.pot_id -> pots.id, always exactly
      // one pot). Handled defensively rather than trusting either shape.
      type PotsEmbed = { game_type: GameType } | { game_type: GameType }[] | null
      const gameTypes = new Set<GameType>()
      for (const entry of (pendingEntries ?? []) as Array<{ pots: PotsEmbed }>) {
        const gameType = Array.isArray(entry.pots) ? entry.pots[0]?.game_type : entry.pots?.game_type
        if (gameType) gameTypes.add(gameType)
      }

      for (const gameType of gameTypes) {
        try {
          locked += await resolveEngine(gameType).lockEntries(ctx, gw.id)
        } catch (err) {
          if (err instanceof UnknownGameTypeError) continue
          throw err
        }
      }
    }

    await sb.from('sync_runs').update({
      status: 'success',
      finished_at: new Date().toISOString(),
      records_processed: locked,
    }).eq('id', run.id)

    return new Response(JSON.stringify({ success: true, updated, locked }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  } catch (error) {
    await sb.from('sync_runs').update({
      status: 'failed',
      finished_at: new Date().toISOString(),
      errors: { message: error instanceof Error ? error.message : String(error) },
    }).eq('id', run.id)

    return new Response(JSON.stringify({ error: error instanceof Error ? error.message : String(error) }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
})