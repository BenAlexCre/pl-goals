import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { corsHeaders } from '../_shared/cors.ts'
import { isAuthorizedAdminOrCron } from '../_shared/adminOrCronAuth.ts'
import { isRegistered, resolveEngine } from '../_shared/game-engine/dispatcher.ts'
import type { GameType } from '../_shared/game-engine/types.ts'
// Side-effecting imports — register each mode with the dispatcher (GE-7/
// GE-18). Milestone 6 Slice 3: added the predictor import below — this is
// the ONLY change this file needed for Score Predictor locking. Confirmed
// before writing any Predictor locking code (not discovered by a live
// failure): the dispatch loop itself already had zero mode-specific
// branching and zero discovery bug (the ALL_GAME_TYPES/isRegistered()
// rewrite below is what Milestone 5 Slice 3 already fixed for LMS, and it
// generalizes to any mode with no further change) — the only reason
// resolveEngine('score_predictor') would ever have failed here is that
// nothing in this function's own module graph ever imported
// predictor/index.ts, so registerEngine('score_predictor', ...) never ran
// within this specific Edge Function's process. Not a "discovery" bug in
// the LMS sense (a query silently excluding a whole mode) — a plain
// missing registration import, exactly what this comment block's own
// prior version already anticipated ("Predictor's import lands in
// Milestone 6... with no further changes here").
import '../_shared/game-engine/pick5/index.ts'
import '../_shared/game-engine/lms/index.ts'
import '../_shared/game-engine/predictor/index.ts'

// Milestone 4, Slice 3 — docs/game-engine.md § GE-6 (lockEntries) / GE-8.2
// (Locking flow) / GE-19 (sequence diagram, which names this exact function
// as the locking flow's Edge Function). Deadline computation itself
// (earliest_kickoff_utc/deadline_utc) is unchanged from before this slice;
// what's new is that once a gameweek's just-computed deadline has already
// passed, this function now also calls every registered mode's
// lockEntries().
//
// Revised, Milestone 5 Slice 3 (docs/decisions.md § LMS locking): this used
// to pre-filter which game types to call by querying game_entries for rows
// with gameweek_id = this gameweek — which only ever matched Pick 5,
// because that pre-filter silently assumed every mode's entries are
// gameweek-scoped. LMS's are season-scoped (GE-4.5, gameweek_id always
// null on game_entries itself), so that filter would have permanently
// excluded LMS from ever being locked, confirmed by reasoning through it
// before writing any LMS locking code (not discovered by a live failure).
// Replaced with the simpler, genuinely mode-agnostic version below: call
// every *registered* engine's lockEntries() unconditionally and let each
// mode's own implementation decide internally whether it has anything to
// do (Pick5Engine and LmsEngine both already short-circuit to a fast
// no-op query when there's nothing to lock) — no assumption here about
// what "has entries for this gameweek" even means for a given mode.
//
// Every GameType this specification names (GE-1), not just the ones
// registered today — isRegistered() below is what actually gates the call,
// so this list doesn't need updating as Milestone 6 lands.
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

      for (const gameType of ALL_GAME_TYPES) {
        if (!isRegistered(gameType)) continue
        locked += await resolveEngine(gameType).lockEntries(ctx, gw.id)
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