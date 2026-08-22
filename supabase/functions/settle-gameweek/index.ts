import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { corsHeaders } from '../_shared/cors.ts'
import { isAuthorizedAdminOrCron } from '../_shared/adminOrCronAuth.ts'
import { isRegistered, resolveEngine } from '../_shared/game-engine/dispatcher.ts'
import type { GameType } from '../_shared/game-engine/types.ts'
// Side-effecting imports — register each mode with the dispatcher (GE-7/
// GE-18). Same pattern as compute-deadlines/compute-scores. Milestone 6
// Slice 5: added the predictor import below — ALL_GAME_TYPES already
// listed 'score_predictor' and the dispatch loop already called it
// unconditionally, same registration-only gap already fixed in
// compute-deadlines (Slice 3) and compute-scores (Slice 4), not a new
// discovery bug.
import '../_shared/game-engine/pick5/index.ts'
import '../_shared/game-engine/lms/index.ts'
import '../_shared/game-engine/predictor/index.ts'

// Milestone 4, Slice 5 — docs/game-engine.md § GE-6 (settle) / GE-8.4
// (Settlement flow). The "all fixtures finished" check gates both the Game
// Engine dispatch below and the gameweeks.status='completed' transition
// after it — the new game_engine dispatch block is entirely independent of
// that transition: separate tables, separate write path, no shared state
// beyond the gameweek id.
//
// GE-19's Settlement sequence diagram doesn't show a sync_runs write for
// this flow (unlike the Locking diagram, which explicitly called for one in
// compute-deadlines) — none added here, matching the spec as written rather
// than inferring one from the other two functions' pattern.
//
// Revised, Milestone 5 Slice 5 (docs/decisions.md § LMS settlement): same
// discovery bug Slices 3/4 already fixed in compute-deadlines/compute-scores
// — the dispatch step queried game_entries.gameweek_id = <this gameweek>,
// which can never match an LMS row (always null, GE-4.5). Replaced with the
// same fix: call every registered mode's settle() unconditionally.
//
// Remediation (red-team audit Priority 3, authorized) — this file used to
// also write the retired prototype's own settlement: mark user_entries
// 'settled', then rank each pot's rows by picks_won and upsert
// leaderboard_snapshots. Removed entirely — proven dead first (same
// evidence as compute-scores/index.ts's own remediation note: docs/
// current-state.md's 2026-08-05 entry, ISSUE-33/-42, confirms no frontend
// code has created a user_entries row since the Pick 5 Game Engine
// cutover). leaderboard_snapshots itself has had zero readers since that
// same cutover — frontend/src/hooks/useLeaderboard.js's own header comment
// documents it now reads pot_standings_snapshots exclusively, which the
// Game Engine dispatch below already writes via each engine's own
// settle() -> generateStandings() call. The gameweeks.status='completed'/
// is_current=false transition immediately below is NOT part of the retired
// path despite sitting among it — confirmed by repo-wide search that no
// Game Engine code performs this transition itself, making it this
// function's own genuinely-current responsibility. Preserved exactly.
const ALL_GAME_TYPES: GameType[] = ['pick5', 'last_man_standing', 'score_predictor']

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  // ISSUE-26 fix — see _shared/adminOrCronAuth.ts for the full reasoning.
  // Doubly important here: this function also accepts an arbitrary
  // gameweek_id in the request body with no ownership check, so an
  // unauthenticated caller could previously force any gameweek to settle
  // prematurely.
  if (!(await isAuthorizedAdminOrCron(req))) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }

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

      // Game Engine dispatch (GE-7/GE-8.4): call every registered mode's
      // settle() unconditionally — see the header comment for why this
      // replaced a per-gameweek "discover which game types have locked
      // entries" pre-filter that only ever worked for Pick 5. Any thrown
      // error propagates to this gameweek's own try/catch, below — same
      // per-gameweek isolation as before, just without the now-impossible
      // UnknownGameTypeError branch (isRegistered() already guards it).
      for (const gameType of ALL_GAME_TYPES) {
        if (!isRegistered(gameType)) continue
        await resolveEngine(gameType).settle(ctx, gw.id)
        gameEngineDispatches++
      }

      await sb.from('gameweeks')
        .update({ status: 'completed', is_current: false })
        .eq('id', gw.id)
    } catch (err) {
      errors.push({ gameweek_id: gw.id, message: err instanceof Error ? err.message : String(err) })
    }
  }

  return new Response(JSON.stringify({ success: errors.length === 0, gameEngineDispatches, errors }), {
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
})