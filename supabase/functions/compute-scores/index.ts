import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { corsHeaders } from '../_shared/cors.ts'
import { resolveEngine } from '../_shared/game-engine/dispatcher.ts'
import { UnknownGameTypeError } from '../_shared/game-engine/errors.ts'
import type { GameType } from '../_shared/game-engine/types.ts'
// Side-effecting import — registers 'pick5' with the dispatcher (GE-7/GE-18).
// Same pattern as compute-deadlines/index.ts (Milestone 4 Slice 3).
import '../_shared/game-engine/pick5/index.ts'

// Milestone 4, Slice 4 — docs/game-engine.md § GE-6 (calculateScore) / GE-8.3
// (Scoring flow). The loop below and everything reading/writing
// user_entries/user_entry_picks is the retired prototype's scoring logic,
// unchanged by this slice (out of scope — "do not refactor unrelated
// code"). The new game_engine dispatch block, added per gameweek alongside
// it, is entirely independent: separate tables (game_entries/pick5_picks),
// separate write path, no shared state with the old logic beyond the
// gameweek id and its already-computed isLive flag.
Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  const sb = createClient(
    Deno.env.get('SUPABASE_URL') ?? '',
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
  )

  const { data: run } = await sb
    .from('sync_runs')
    .insert({ job_name: 'compute-scores', triggered_by: 'cron' })
    .select()
    .single()

  const ctx = { supabase: sb, now: () => new Date() }
  let processed = 0
  let gameEngineDispatches = 0

  try {
    const { data: gameweeks } = await sb
      .from('gameweeks')
      .select('id')
      .in('status', ['upcoming', 'live'])

    for (const gw of gameweeks ?? []) {
      const { data: liveFixture } = await sb
        .from('fixtures')
        .select('id')
        .eq('gameweek_id', gw.id)
        .eq('status', 'live')
        .limit(1)

      const isLive = (liveFixture?.length ?? 0) > 0

      // Game Engine dispatch (new, GE-7/GE-8.3): discover which game types
      // have locked entries for this gameweek — data-driven, no hardcoded
      // 'pick5' — and call each one's calculateScore(). Only pick5 has any
      // gameweek-scoped entries today (GE-4.5), so this is a no-op for
      // lms/predictor until Milestones 5/6 register them, exactly like the
      // equivalent block in compute-deadlines.
      const { data: lockedEntries } = await sb
        .from('game_entries')
        .select('pots(game_type)')
        .eq('gameweek_id', gw.id)
        .eq('status', 'locked')

      type PotsEmbed = { game_type: GameType } | { game_type: GameType }[] | null
      const gameTypes = new Set<GameType>()
      for (const entry of (lockedEntries ?? []) as Array<{ pots: PotsEmbed }>) {
        const gameType = Array.isArray(entry.pots) ? entry.pots[0]?.game_type : entry.pots?.game_type
        if (gameType) gameTypes.add(gameType)
      }

      for (const gameType of gameTypes) {
        try {
          await resolveEngine(gameType).calculateScore(ctx, gw.id)
          gameEngineDispatches++
        } catch (err) {
          if (err instanceof UnknownGameTypeError) continue
          throw err
        }
      }

      const { data: entries } = await sb
        .from('user_entries')
        .select('id, pot_id, user_id')
        .eq('gameweek_id', gw.id)

      for (const entry of entries ?? []) {
        const { data: payment } = await sb
          .from('entry_payments')
          .select('is_paid')
          .eq('pot_id', entry.pot_id)
          .eq('user_id', entry.user_id)
          .eq('gameweek_id', gw.id)
          .maybeSingle()

        if (!payment?.is_paid) {
          await sb.from('user_entries').update({ is_void: true }).eq('id', entry.id)
          await sb.from('user_entry_picks').update({ result: 'void' }).eq('entry_id', entry.id)
          continue
        }

        const { data: picks } = await sb
          .from('user_entry_picks')
          .select('id, player_id, goal_threshold')
          .eq('entry_id', entry.id)

        let won = 0

        for (const pick of picks ?? []) {
          const { data: goals } = await sb
            .from('player_fixture_goals')
            .select('goals')
            .eq('player_id', pick.player_id)
            .eq('gameweek_id', gw.id)

          const totalGoals = (goals ?? []).reduce((sum, g) => sum + (g.goals ?? 0), 0)
          const met = totalGoals >= pick.goal_threshold

          const result = met ? (isLive ? 'winning' : 'won') : (isLive ? 'losing' : 'lost')
          if (met) won++

          await sb.from('user_entry_picks').update({
            goals_scored: totalGoals,
            result,
          }).eq('id', pick.id)

          processed++
        }

        await sb.from('user_entries').update({
          picks_won: won,
          status: isLive ? 'locked' : 'settled',
          is_void: false,
        }).eq('id', entry.id)
      }
    }

    await sb.from('sync_runs').update({
      status: 'success',
      finished_at: new Date().toISOString(),
      records_processed: processed + gameEngineDispatches,
    }).eq('id', run.id)

    return new Response(JSON.stringify({ success: true, processed, gameEngineDispatches }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  } catch (error) {
    // Pre-existing `error.message` here didn't type-check under strict mode
    // (`error` is `unknown` in a catch clause) — this file was never run
    // through `deno check` before (ISSUE-16: no test/check infra covered the
    // original Edge Functions). Fixed minimally, same pattern already used
    // in compute-deadlines/index.ts, so this slice's own additions to this
    // file can be verified cleanly; not a behavior change.
    const message = error instanceof Error ? error.message : String(error)
    await sb.from('sync_runs').update({
      status: 'failed',
      finished_at: new Date().toISOString(),
      errors: { message },
    }).eq('id', run.id)

    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
})