import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { corsHeaders } from '../_shared/cors.ts'
import { isRegistered, resolveEngine } from '../_shared/game-engine/dispatcher.ts'
import type { GameType } from '../_shared/game-engine/types.ts'
// Side-effecting imports — register each mode with the dispatcher (GE-7/
// GE-18). Same pattern as compute-deadlines/index.ts. Milestone 6 Slice 4:
// added the predictor import below — same reasoning as
// compute-deadlines' own Slice 3 fix, not a new discovery: the dispatch
// loop below already listed 'score_predictor' in ALL_GAME_TYPES and called
// it unconditionally; it just needed the registration side-effect actually
// imported within this function's own module graph.
import '../_shared/game-engine/pick5/index.ts'
import '../_shared/game-engine/lms/index.ts'
import '../_shared/game-engine/predictor/index.ts'

// Milestone 4, Slice 4 — docs/game-engine.md § GE-6 (calculateScore) / GE-8.3
// (Scoring flow). The loop below and everything reading/writing
// user_entries/user_entry_picks is the retired prototype's scoring logic,
// unchanged by this slice (out of scope — "do not refactor unrelated
// code"). The new game_engine dispatch block, added per gameweek alongside
// it, is entirely independent: separate tables (game_entries/pick5_picks),
// separate write path, no shared state with the old logic beyond the
// gameweek id and its already-computed isLive flag.
//
// Revised, Milestone 5 Slice 4 (docs/decisions.md § LMS scoring and
// elimination): this had the exact same bug compute-deadlines had before
// its own Slice 3 fix — the dispatch discovery step queried
// game_entries.gameweek_id = <this gameweek>, which can never match an LMS
// row (always null, GE-4.5), so calculateScore() could never have been
// reached for LMS. Replaced with the same fix: call every registered
// mode's calculateScore() unconditionally, per gameweek.
const ALL_GAME_TYPES: GameType[] = ['pick5', 'last_man_standing', 'score_predictor']

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

      // Game Engine dispatch (GE-7/GE-8.3): call every registered mode's
      // calculateScore() unconditionally — see the header comment for why
      // this replaced a per-gameweek "discover which game types have
      // locked entries" pre-filter that only ever worked for Pick 5.
      for (const gameType of ALL_GAME_TYPES) {
        if (!isRegistered(gameType)) continue
        await resolveEngine(gameType).calculateScore(ctx, gw.id)
        gameEngineDispatches++
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