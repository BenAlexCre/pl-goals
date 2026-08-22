import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { corsHeaders } from '../_shared/cors.ts'
import { isAuthorizedAdminOrCron } from '../_shared/adminOrCronAuth.ts'
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
// (Scoring flow). The new game_engine dispatch block below is entirely
// independent: separate tables (game_entries/pick5_picks), separate write
// path, no shared state with anything else in this file beyond the
// gameweek id.
//
// Revised, Milestone 5 Slice 4 (docs/decisions.md § LMS scoring and
// elimination): this had the exact same bug compute-deadlines had before
// its own Slice 3 fix — the dispatch discovery step queried
// game_entries.gameweek_id = <this gameweek>, which can never match an LMS
// row (always null, GE-4.5), so calculateScore() could never have been
// reached for LMS. Replaced with the same fix: call every registered
// mode's calculateScore() unconditionally, per gameweek.
//
// Remediation (red-team audit Priority 3, authorized) — this file used to
// also contain the retired prototype's own scoring loop: read
// user_entries/user_entry_picks for the gameweek, compute goals via
// player_fixture_goals, write goals_scored/result/picks_won back onto
// those same retired tables (isLive fed its 'winning'/'won'/'losing'/'lost'
// result values). Removed entirely — proven dead first: docs/current-state.md
// (2026-08-05 entry, ISSUE-33/-42) already documents no frontend code has
// created a user_entries row since the Pick 5 Game Engine cutover, and
// admin-actions/index.ts's mark_unpaid case independently confirms the same
// (ISSUE-20 cross-reference — a DIFFERENT, unrelated prototype generation,
// not this one). The retired loop shared nothing with the Game Engine
// dispatch above beyond the gameweek id and a `liveFixture`/`isLive`
// computation that existed only to feed the retired loop's own result
// values — removed alongside it, since nothing else read `isLive`.
// `processed` (the retired loop's own per-pick counter) is removed for the
// same reason; `gameEngineDispatches` is now this function's only counter.
const ALL_GAME_TYPES: GameType[] = ['pick5', 'last_man_standing', 'score_predictor']

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  // ISSUE-26 fix — see _shared/adminOrCronAuth.ts for the full reasoning.
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

  const { data: run } = await sb
    .from('sync_runs')
    .insert({ job_name: 'compute-scores', triggered_by: 'cron' })
    .select()
    .single()

  const ctx = { supabase: sb, now: () => new Date() }
  let gameEngineDispatches = 0

  try {
    // Sprint 2 audit (resolves ISSUE-3, confirmed live, not just
    // "unverified" as previously documented): player_fixture_goals is a
    // materialized view — nothing anywhere in the repo ever called
    // public.refresh_player_fixture_goals() before this fix, so it stayed
    // permanently empty (confirmed: 0 rows, even after real goal events
    // existed in fixture_events) and every read below silently saw zero
    // goals for every player, every gameweek. Both the retired prototype's
    // scoring loop and every GameEngine's own calculateScore() (pick5/lms/
    // predictor, all three inherit the same read) depend on this view being
    // current — refreshing it once per run, right before anything reads it,
    // is the smallest fix that doesn't touch the view's own definition, the
    // scoring logic, or add a new cron job.
    const { error: refreshError } = await sb.rpc('refresh_player_fixture_goals')
    if (refreshError) throw new Error(`Failed to refresh player_fixture_goals: ${refreshError.message}`)

    const { data: gameweeks } = await sb
      .from('gameweeks')
      .select('id')
      .in('status', ['upcoming', 'live'])

    for (const gw of gameweeks ?? []) {
      // Game Engine dispatch (GE-7/GE-8.3): call every registered mode's
      // calculateScore() unconditionally — see the header comment for why
      // this replaced a per-gameweek "discover which game types have
      // locked entries" pre-filter that only ever worked for Pick 5.
      for (const gameType of ALL_GAME_TYPES) {
        if (!isRegistered(gameType)) continue
        await resolveEngine(gameType).calculateScore(ctx, gw.id)
        gameEngineDispatches++
      }
    }

    await sb.from('sync_runs').update({
      status: 'success',
      finished_at: new Date().toISOString(),
      records_processed: gameEngineDispatches,
    }).eq('id', run.id)

    return new Response(JSON.stringify({ success: true, gameEngineDispatches }), {
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