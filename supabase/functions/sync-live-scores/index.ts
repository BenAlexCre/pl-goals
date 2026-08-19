// supabase/functions/sync-live-scores/index.ts
import { createClient } from 'npm:@supabase/supabase-js@2'
import { corsHeaders } from '../_shared/cors.ts'
import { isAuthorizedAdminOrCron } from '../_shared/adminOrCronAuth.ts'

// Phase 22 (Production Live-Match Event Pipeline) — closes a real,
// previously-undiscovered gap found while auditing the WhoScored worker
// for production readiness: NOTHING in this codebase updated
// `fixtures.status`/`home_goals`/`away_goals`/`minute` during a live
// match. `sync-fixtures` (Phase 21) only runs once daily — correct for
// its own job (fixture schedule/kickoff/teams, which barely change
// intraday) but far too slow for a live score. `ws-live-events.js` (the
// WhoScored worker) only ever wrote `fixture_events` — confirmed by
// reading its source, it has no code path that touches the `fixtures`
// table at all. Meanwhile `FixtureCard.jsx`, and both the LMS and
// Predictor Game Engine (`_shared/game-engine/{lms,predictor}/engine.ts`)
// read `fixtures.status`/`home_goals`/`away_goals` directly, not
// anything derived from `fixture_events` — so without this function,
// "live score appears" (this phase's own acceptance-test step 8) and
// LMS "currently winning"/Predictor's live scoreline literally could
// not work, no matter how well the WhoScored side was hardened.
//
// This function is deliberately narrow and cheap: football-data.org
// remains the sole owner of `fixtures.status`/`home_goals`/`away_goals`/
// `minute` (per this phase's own target architecture — WhoScored owns
// `fixture_events` only, never these fields), so this is a second,
// much-tighter-cadence read of the SAME provider `sync-fixtures`
// already uses, not a new data source. It does a local, zero-cost DB
// check first (has anything kicked off recently and not finished?) and
// only calls out to football-data.org when that's true — safe to
// schedule every 1-2 minutes continuously without wasting API quota
// during the many hours/days when nothing is live. A single call to
// the competition's day-scoped matches endpoint naturally captures the
// live→finished transition too (today's finished matches are still
// returned), so this also serves as the "final reconciliation" step —
// no separate branch needed.

const API_BASE = 'https://api.football-data.org/v4'

type Json = Record<string, unknown>

function jsonResponse(body: Json, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}

async function parseBody(req: Request) {
  if (req.method !== 'POST') return {}
  try {
    return await req.json()
  } catch {
    return {}
  }
}

// Same mapping sync-fixtures/index.ts uses — kept identical rather than
// imported, since the two functions are deployed independently and this
// project's own convention (see sync-fixtures) is one small,
// self-contained file per Edge Function rather than a shared module for
// a four-line map.
function fixtureStatus(s: string | null | undefined) {
  if (s === 'TIMED') return 'scheduled'
  if (s === 'SCHEDULED') return 'tbd'
  if (s === 'IN_PLAY' || s === 'PAUSED') return 'live'
  if (s === 'FINISHED') return 'finished'
  if (s === 'POSTPONED') return 'postponed'
  if (s === 'CANCELLED' || s === 'AWARDED') return 'cancelled'
  return 'tbd'
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  if (!(await isAuthorizedAdminOrCron(req))) {
    return jsonResponse({ error: 'Unauthorized' }, 401)
  }

  const sb = createClient(
    Deno.env.get('SUPABASE_URL') ?? '',
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
  )

  const body = await parseBody(req)
  const competitionCode = String(
    body?.competitionCode ?? Deno.env.get('FOOTBALL_COMPETITION_CODE') ?? 'PL'
  )

  // Cheap local check first — do NOT call football-data.org at all
  // unless something is actually relevant right now. Same -10min/+130min
  // window ws-live-events.js already uses for its own polling, so the
  // two workers agree on what "currently relevant" means.
  const now = new Date()
  const windowStart = new Date(now.getTime() - 130 * 60 * 1000).toISOString()
  const windowEnd = new Date(now.getTime() + 10 * 60 * 1000).toISOString()

  const { data: relevantFixtures, error: relevantError } = await sb
    .from('fixtures')
    .select('id')
    .gte('kickoff_utc', windowStart)
    .lte('kickoff_utc', windowEnd)
    .not('status', 'in', '(finished,postponed,cancelled)')
    .limit(1)

  if (relevantError) {
    return jsonResponse({ error: `DB check failed: ${relevantError.message}` }, 500)
  }

  if (!relevantFixtures || relevantFixtures.length === 0) {
    return jsonResponse({ success: true, skipped: true, reason: 'no fixture in live window', updated: 0 })
  }

  const apiKey = Deno.env.get('FOOTBALL_DATA_KEY') ?? Deno.env.get('VITE_FOOTBALL_DATA_KEY') ?? ''
  if (!apiKey) {
    return jsonResponse({ error: 'Missing FOOTBALL_DATA_KEY' }, 500)
  }

  // Today's UTC date, both ends — captures in-play matches AND any that
  // finished since the last poll (the reconciliation step), in one call.
  const today = now.toISOString().slice(0, 10)

  // Only logged to sync_runs when there's actually something to report —
  // this fires every minute continuously (see migration 033), and every
  // other minute is a free, local-only no-op; logging every tick would
  // fill sync_runs with ~1440 empty rows/day for no benefit. A run row
  // still appears every time this function actually talks to
  // football-data.org, which is what "last successful live poll" (§ 11
  // health monitoring) needs to mean.
  const run = await sb
    .from('sync_runs')
    .insert({ job_name: 'sync-live-scores', triggered_by: String(body?.triggeredBy ?? 'cron'), status: 'running' })
    .select()
    .single()

  try {
    const url = new URL(`${API_BASE}/competitions/${competitionCode}/matches`)
    url.searchParams.set('dateFrom', today)
    url.searchParams.set('dateTo', today)

    const res = await fetch(url.toString(), { headers: { 'X-Auth-Token': apiKey } })
    if (!res.ok) {
      const text = await res.text()
      throw new Error(`football-data matches -> ${res.status} ${text}`)
    }

    const { matches } = (await res.json()) as { matches?: any[] }
    let updated = 0

    for (const m of matches ?? []) {
      const { error } = await sb
        .from('fixtures')
        .update({
          status: fixtureStatus(m.status),
          minute: m.minute ?? null,
          home_goals: m.score?.fullTime?.home ?? m.score?.halfTime?.home ?? 0,
          away_goals: m.score?.fullTime?.away ?? m.score?.halfTime?.away ?? 0,
          last_synced_at: new Date().toISOString(),
        })
        .eq('provider_id', String(m.id))
        .eq('provider_name', 'football-data')

      if (!error) updated++
    }

    if (run.data) {
      await sb.from('sync_runs').update({
        status: 'success',
        finished_at: new Date().toISOString(),
        records_processed: updated,
      }).eq('id', run.data.id)
    }

    return jsonResponse({ success: true, skipped: false, competitionCode, updated })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    if (run.data) {
      await sb.from('sync_runs').update({
        status: 'failed',
        finished_at: new Date().toISOString(),
        errors: { message },
      }).eq('id', run.data.id)
    }
    return jsonResponse({ error: message, competitionCode }, 500)
  }
})
