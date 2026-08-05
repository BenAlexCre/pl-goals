import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { corsHeaders } from '../_shared/cors.ts'
import { resolveEngine } from '../_shared/game-engine/dispatcher.ts'
import { UnknownGameTypeError } from '../_shared/game-engine/errors.ts'
import type { GameType } from '../_shared/game-engine/types.ts'
// Side-effecting import — registers 'pick5' with the dispatcher (GE-7/GE-18).
// Same pattern as compute-deadlines/compute-scores (Milestone 4 Slices 3-4).
import '../_shared/game-engine/pick5/index.ts'

// Milestone 4, Slice 5 — docs/game-engine.md § GE-6 (settle) / GE-8.4
// (Settlement flow). The "all fixtures finished" check and everything
// reading/writing user_entries/leaderboard_snapshots below it is the
// retired prototype's settlement logic, unchanged by this slice (out of
// scope). The new game_engine dispatch block, added once that same check
// passes, is entirely independent: separate tables, separate write path,
// no shared state with the old logic beyond the gameweek id.
//
// GE-19's Settlement sequence diagram doesn't show a sync_runs write for
// this flow (unlike the Locking diagram, which explicitly called for one in
// compute-deadlines) — none added here, matching the spec as written rather
// than inferring one from the other two functions' pattern.
Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  const sb = createClient(
    Deno.env.get('SUPABASE_URL') ?? '',
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
  )

  const ctx = { supabase: sb, now: () => new Date() }

  const body = await req.json().catch(() => ({}))
  const targetGameweek = body.gameweek_id ?? null

  let query = sb.from('gameweeks').select('id').neq('status', 'completed')
  if (targetGameweek) query = query.eq('id', targetGameweek)

  const { data: gameweeks } = await query
  let gameEngineDispatches = 0
  // Production readiness audit (2026-08-05): previously, one gameweek's
  // thrown error (e.g. Pick5PrizePoolExceededError — a real, documented
  // failure mode, not hypothetical) propagated out of this loop entirely,
  // silently aborting settlement for every other gameweek/pot in the same
  // batch with no structured error anywhere. Each gameweek's processing is
  // now isolated in its own try/catch so one failure can't block unrelated
  // ones; failures are collected and returned in the response rather than
  // thrown, since this function deliberately writes no sync_runs row at all
  // (GE-19's Settlement diagram doesn't call for one, unlike Locking) and
  // inventing that logging path now would be a larger change than this fix
  // calls for.
  const errors: { gameweek_id: number; message: string }[] = []

  for (const gw of gameweeks ?? []) {
    try {
      const { data: fixtures } = await sb
        .from('fixtures')
        .select('status')
        .eq('gameweek_id', gw.id)
        .not('status', 'in', '("postponed","cancelled")')

      if (!fixtures?.length) continue
      if (!fixtures.every((f) => f.status === 'finished')) continue

      // Game Engine dispatch (new, GE-7/GE-8.4): discover which game types
      // have locked entries for this gameweek — data-driven, no hardcoded
      // 'pick5' — and call each one's settle(). Same pattern as the dispatch
      // blocks already added to compute-deadlines/compute-scores.
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
          await resolveEngine(gameType).settle(ctx, gw.id)
          gameEngineDispatches++
        } catch (err) {
          if (err instanceof UnknownGameTypeError) continue
          throw err
        }
      }

      await sb.from('user_entries')
        .update({ status: 'settled', settled_at: new Date().toISOString() })
        .eq('gameweek_id', gw.id)
        .neq('status', 'void')

      await sb.from('gameweeks')
        .update({ status: 'completed', is_current: false })
        .eq('id', gw.id)

      const { data: potIds } = await sb
        .from('user_entries')
        .select('pot_id')
        .eq('gameweek_id', gw.id)

      const uniquePotIds = [...new Set((potIds ?? []).map((r) => r.pot_id))]

      for (const potId of uniquePotIds) {
        const { data: rows } = await sb
          .from('user_entries')
          .select('user_id, picks_won, picks_total, is_void')
          .eq('pot_id', potId)
          .eq('gameweek_id', gw.id)
          .order('picks_won', { ascending: false })

        const sorted = [...(rows ?? [])]
          .filter((r) => !r.is_void)
          .sort((a, b) => b.picks_won - a.picks_won)

        for (let i = 0; i < sorted.length; i++) {
          const row = sorted[i]
          await sb.from('leaderboard_snapshots').upsert({
            pot_id: potId,
            gameweek_id: gw.id,
            user_id: row.user_id,
            rank: i + 1,
            picks_won: row.picks_won,
            picks_total: row.picks_total,
            entries_count: 1,
            strike_rate: row.picks_total > 0 ? Number(((row.picks_won / row.picks_total) * 100).toFixed(2)) : 0,
            is_overall: false,
            is_void: row.is_void,
          }, { onConflict: 'pot_id,gameweek_id,user_id' })
        }
      }
    } catch (err) {
      errors.push({ gameweek_id: gw.id, message: err instanceof Error ? err.message : String(err) })
    }
  }

  return new Response(JSON.stringify({ success: errors.length === 0, gameEngineDispatches, errors }), {
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
})